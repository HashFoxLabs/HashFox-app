<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import WalletButton from '$lib/wallet/WalletButton.svelte';
	import CreateUsernameModal from '$lib/profile/CreateUsernameModal.svelte';
	import { walletStore, setWalletUsername } from '$lib/wallet/stores';
	import {
		activeCompetition,
		refreshActiveCompetition,
		clearActiveCompetition
	} from '$lib/stores/activeCompetition';
	import { findCompUserPda } from '$lib/competition';
	import { selectedMarket } from '$lib/stores/selectedMarket';
	import {
		pythPrices,
		startPythStream,
		stopPythStream
	} from '$lib/stores/pythPrices';
	import { hashfoxClient } from '$lib/hashfoxClient';
	import { findMarket, type MarketEntry } from '$lib/markets';
	import { USD_SCALE } from '$lib/hashfox';
	import { userBalance, setUserBalance, clearUserBalance } from '$lib/stores/userBalance';

	const LEFT_PYTH_CRYPTO = ['SOL', 'BTC', 'ETH', 'BNB'] as const;
	const RIGHT_PYTH_STOCKS = ['NVDA', 'AAPL', 'TSLA', 'MSFT'] as const;
	const DEVNET_FUNDING_DISMISS_KEY = 'hashfox_devnet_funding_dismissed';

	type SynthMarket = {
		id: string;
		title: string;
		image?: string | null;
		yesPrice?: number;
		noPrice?: number;
	};
	let synthMarkets: SynthMarket[] = [];
	let synthLoading = false;
	let titleWrapEls: HTMLElement[] = [];

	function registerTitleWrap(node: HTMLElement) {
		if (!titleWrapEls.includes(node)) titleWrapEls = [...titleWrapEls, node];
		return {
			destroy() {
				titleWrapEls = titleWrapEls.filter((el) => el !== node);
			}
		};
	}

	let market: MarketEntry;
	selectedMarket.subscribe((m) => (market = m));

	let prices: Record<string, any> = {};
	pythPrices.subscribe((p) => (prices = p));

	let connectedWallet: any = null;
	let walletAddress = '';
	let walletBalanceSol = 0;
	let usdBalance = 0;
	userBalance.subscribe((b) => {
		usdBalance = b.availableUsd;
	});
	let accountInitialized = false;
	let magicBlockStatus = 'Ready - Connect wallet to trade';
	let fastTradingSessionActive = false;
	let sessionTimeLabel = '';

	let showSessionFundModal = false;
	let sessionFundSolAmount = 0.05;
	let sessionFundLoading = false;

	let showSessionActiveNotice = false;

	let showDevnetWalletFundingModal = false;
	let fundingPopupSolBalance = 0;
	let fundingPopupAddress = '';

	let showUsernameModal = false;
	let usernameModalDismissedFor: string | null = null;
	let usernameDefaultName: string | null = null;

	let disconnectSessionLoading = false;
	let initializeLoading = false;
	let statusPoll: ReturnType<typeof setInterval> | null = null;

	let activeComp: { pubkey: any; view: any; loaded: boolean } = {
		pubkey: null,
		view: null,
		loaded: false
	};
	// Re-pull the balance when either the cup *identity* (join / claim) OR
	// the cup *status* changes — status flipping pending → active flips the
	// balance source between main and per-cup PDA, so we have to refresh on
	// both. We still skip refreshes that would only echo our own writes
	// (refreshStatus → setUserBalance → ... ) to avoid an RPC-bound loop;
	// the dedupe key encodes both pubkey + status so identical writes no-op.
	let lastCompSig: string | null = null;
	activeCompetition.subscribe((s) => {
		activeComp = s;
		const key = s.pubkey ? s.pubkey.toBase58() : '';
		const status = s.view?.status ?? '';
		const sig = `${key}|${status}`;
		if (sig === lastCompSig) return;
		lastCompSig = sig;
		if (connectedWallet?.connected && accountInitialized) void refreshStatus();
	});

	walletStore.subscribe((w) => {
		const wasConnected = connectedWallet?.connected;
		connectedWallet = w;
		if (w.connected && w.publicKey) {
			walletAddress = w.publicKey.toBase58();
			hashfoxClient.setConnectedWallet(w.adapter);
			// Embedded-wallet funding prompt should not re-trigger on every route change.
			// Gate it to once-per-session-per-wallet-address.
			if (w.isEmbedded && typeof sessionStorage !== 'undefined') {
				const key = `hashfox_embedded_seen_${walletAddress}`;
				if (!sessionStorage.getItem(key)) {
					sessionStorage.setItem(key, '1');
					if (!wasConnected) sessionStorage.removeItem(DEVNET_FUNDING_DISMISS_KEY);
				}
			}
			maybeOfferUsername();
			void refreshStatus();
		} else {
			walletAddress = '';
			hashfoxClient.setConnectedWallet(null);
			walletBalanceSol = 0;
			clearUserBalance();
			clearActiveCompetition();
			accountInitialized = false;
			fastTradingSessionActive = false;
			magicBlockStatus = 'Ready - Connect wallet to trade';
			showSessionFundModal = false;
			showSessionActiveNotice = false;
			showDevnetWalletFundingModal = false;
			showUsernameModal = false;
			usernameModalDismissedFor = null;
			usernameDefaultName = null;
		}
	});

	function maybeOfferUsername() {
		if (!connectedWallet?.connected || !walletAddress) return;
		if (!connectedWallet.profileHydrated) return;
		if (connectedWallet.username) return;
		if (usernameModalDismissedFor === walletAddress) return;
		if (showUsernameModal) return;
		usernameDefaultName = connectedWallet.embeddedName || connectedWallet.embeddedEmail || null;
		showUsernameModal = true;
	}

	function handleUsernameSaved(name: string) {
		setWalletUsername(name);
		showUsernameModal = false;
		maybeOfferDevnetFunding();
	}

	function dismissUsernameModal() {
		usernameModalDismissedFor = walletAddress;
		showUsernameModal = false;
	}

	async function refreshStatus() {
		if (!connectedWallet?.connected) return;
		try {
			walletBalanceSol = await hashfoxClient.getBalance();
			accountInitialized = await hashfoxClient.isAccountInitialized();
			if (accountInitialized) {
				// Only show the per-cup balance while the cup is *Active*.
				// During pending (waiting-for-fill) and settled (waiting-for-
				// claim) the user is back on their main paper balance — the
				// terminals route trades there too, so the navbar must match.
				const compPubkey = activeComp?.pubkey;
				const compIsLive = activeComp?.view?.status === 'active';
				if (compIsLive && compPubkey && connectedWallet.publicKey) {
					try {
						const program = hashfoxClient.getProgram();
						const [compUserPda] = findCompUserPda(compPubkey, connectedWallet.publicKey);
						const compAcc = await (program?.account as any).userAccount.fetch(compUserPda);
						const total = Number(compAcc.usdBalance.toString()) / USD_SCALE;
						const locked = Number(compAcc.lockedMarginUsd.toString()) / USD_SCALE;
						setUserBalance({
							totalUsd: total,
							lockedUsd: locked,
							availableUsd: Math.max(0, total - locked)
						});
					} catch (err) {
						// Devnet RPC throttling (429) is the common cause here. We
						// MUST NOT fall back to getBalanceBreakdown() — that's the
						// main account, and writing it to the store while the user
						// is inside a cup is exactly what produced the navbar
						// flicker. Keep the stale comp balance; the next poll
						// refreshes it.
						console.warn('[topchrome] comp balance fetch failed (keeping stale)', err);
					}
				} else {
					setUserBalance(await hashfoxClient.getBalanceBreakdown());
				}
				// Pick up tournament mode (or its absence) so trade panels know
				// whether to route through comp_* instructions.
				void refreshActiveCompetition();
			} else {
				clearUserBalance();
				clearActiveCompetition();
			}
			fastTradingSessionActive = hashfoxClient.isPaperTradingSessionActive();
			magicBlockStatus = fastTradingSessionActive
				? 'Connected · Session active'
				: accountInitialized
					? 'Connected · No session'
					: 'Connected · Init required';
			if (fastTradingSessionActive) sessionTimeLabel = formatSessionRemainingLabel();
			maybeOfferDevnetFunding();
		} catch (err) {
			console.error('Status refresh failed:', err);
			magicBlockStatus = 'Connected - Status check failed';
		}
	}

	function maybeOfferDevnetFunding() {
		if (typeof sessionStorage === 'undefined') return;
		if (sessionStorage.getItem(DEVNET_FUNDING_DISMISS_KEY)) return;
		if (!connectedWallet?.connected) return;
		if (showSessionFundModal) return;
		if (showUsernameModal) return;
		// Always prompt embedded wallets on first connect (they start at 0 SOL);
		// external wallets only when balance is actually low.
		if (!connectedWallet.isEmbedded && walletBalanceSol >= 0.05) return;
		fundingPopupSolBalance = walletBalanceSol;
		fundingPopupAddress = walletAddress;
		showDevnetWalletFundingModal = true;
	}

	function dismissDevnetFundingModal() {
		if (typeof sessionStorage !== 'undefined') {
			sessionStorage.setItem(DEVNET_FUNDING_DISMISS_KEY, '1');
		}
		showDevnetWalletFundingModal = false;
	}

	function openSessionFundModal() {
		if (!connectedWallet?.connected || hashfoxClient.isPaperTradingSessionActive()) return;
		sessionFundSolAmount = 0.05;
		showDevnetWalletFundingModal = false;
		showSessionFundModal = true;
	}

	function closeSessionFundModal() {
		showSessionFundModal = false;
		sessionFundLoading = false;
	}

	function formatSessionRemainingLabel(): string {
		const sec = hashfoxClient.getPaperSessionTimeRemainingSeconds();
		if (sec <= 0) return '';
		const h = Math.floor(sec / 3600);
		const m = Math.floor((sec % 3600) / 60);
		return h > 0 ? `${h}h ${m}m` : `${m}m`;
	}

	async function requestAirdrop() {
		if (!connectedWallet?.connected) return;
		try {
			magicBlockStatus = 'Requesting airdrop...';
			await hashfoxClient.requestAirdrop(2);
			magicBlockStatus = 'Airdrop sent';
			let ticks = 0;
			const poll = setInterval(async () => {
				ticks++;
				await refreshStatus();
				if (showDevnetWalletFundingModal) fundingPopupSolBalance = walletBalanceSol;
				if (walletBalanceSol > 1) {
					magicBlockStatus = `Funded: ${walletBalanceSol.toFixed(2)} SOL`;
					clearInterval(poll);
				}
				if (ticks > 30) clearInterval(poll);
			}, 2000);
		} catch (err: any) {
			console.error('Airdrop error:', err);
			magicBlockStatus = 'Airdrop failed';
		}
	}

	async function initializeAccount() {
		if (!connectedWallet?.connected) return;
		if (walletBalanceSol < 0.15) {
			magicBlockStatus = 'Insufficient SOL. Click AIRDROP first.';
			return;
		}
		initializeLoading = true;
		try {
			magicBlockStatus = 'Initializing paper account…';
			await hashfoxClient.initializeAccount(0.1);
			magicBlockStatus = 'Account initialized';
			await refreshStatus();
			if (!hashfoxClient.isPaperTradingSessionActive()) openSessionFundModal();
		} catch (err: any) {
			console.error('Init error:', err);
			magicBlockStatus = err?.message || 'Initialization failed';
		} finally {
			initializeLoading = false;
		}
	}

	async function confirmFundSession() {
		const amount = Number(sessionFundSolAmount);
		if (!connectedWallet?.connected) return;
		if (amount < 0.01 || amount > 2 || Number.isNaN(amount)) {
			magicBlockStatus = 'Enter between 0.01 and 2 SOL.';
			return;
		}
		const reserve = 0.02;
		if (walletBalanceSol < amount + reserve) {
			magicBlockStatus = `Need ${(amount + reserve).toFixed(3)} SOL (top-up + fees). Use AIRDROP.`;
			return;
		}
		sessionFundLoading = true;
		try {
			magicBlockStatus = 'Approve session funding…';
			await hashfoxClient.createPaperTradingSession({ topUpSol: amount });
			fastTradingSessionActive = true;
			showSessionFundModal = false;
			magicBlockStatus = 'Connected · Session active';
			sessionTimeLabel = formatSessionRemainingLabel();
			showSessionActiveNotice = true;
			await refreshStatus();
		} catch (err: any) {
			console.error(err);
			magicBlockStatus = err?.message || 'Session funding failed';
		} finally {
			sessionFundLoading = false;
		}
	}

	async function disconnectPaperSession() {
		if (!connectedWallet?.connected) return;
		disconnectSessionLoading = true;
		try {
			magicBlockStatus = 'Ending session…';
			await hashfoxClient.revokePaperTradingSession();
			fastTradingSessionActive = false;
			showSessionActiveNotice = false;
			magicBlockStatus = 'Connected · No session';
			await refreshStatus();
		} catch (err: any) {
			console.error(err);
			magicBlockStatus = err?.message || 'Session revoke failed';
			await refreshStatus();
		} finally {
			disconnectSessionLoading = false;
		}
	}

	async function copyWalletAddress() {
		if (!walletAddress) return;
		try {
			await navigator.clipboard.writeText(walletAddress);
			magicBlockStatus = 'Wallet address copied';
		} catch {
			magicBlockStatus = 'Copy failed';
		}
	}

	function tickerPriceFmt(p: any): string {
		if (!p || p.price <= 0) return '—';
		const v = p.price;
		const decimals = v >= 100 ? 2 : v >= 1 ? 3 : 5;
		return v.toFixed(decimals);
	}

	function onTickerSelect(sym: string) {
		const m = findMarket(sym);
		if (m) selectedMarket.set(m);
		if (!$page.url.pathname.startsWith('/terminal')) goto('/terminal');
	}

	async function loadSynthMarkets() {
		synthLoading = true;
		try {
			// Pull many markets so the marquee feels seamless.
			const res = await fetch('/api/events?limit=120&active=true');
			if (!res.ok) throw new Error('Failed to fetch markets');
			const events = await res.json();
			// Diversify: round-robin across events so we don't show 18 markets from one hot event.
			const perEvent: SynthMarket[][] = (events || []).map((ev: any) => {
				const arr: SynthMarket[] = [];
				for (const mk of ev?.markets || []) {
					arr.push({
						id: mk.id,
						title: mk.question || mk.title || ev?.title || 'Market',
						image: mk.image || ev?.image || null,
						yesPrice: typeof mk.yesPrice === 'number' ? mk.yesPrice : undefined,
						noPrice: typeof mk.noPrice === 'number' ? mk.noPrice : undefined
					});
				}
				return arr;
			});

			const mixed: SynthMarket[] = [];
			const max = 64;
			const takenPerEvent = new Array(perEvent.length).fill(0);
			let rounds = 0;
			while (mixed.length < max && rounds < 50) {
				let progressed = false;
				for (let idx = 0; idx < perEvent.length; idx++) {
					const bucket = perEvent[idx];
					if (!bucket?.length) continue;
					// Force diversity early: cap at 2 per event until we have a solid mix.
					if (mixed.length < 24 && takenPerEvent[idx] >= 2) continue;
					mixed.push(bucket.shift()!);
					takenPerEvent[idx]++;
					progressed = true;
					if (mixed.length >= max) break;
				}
				if (!progressed) break;
				rounds++;
			}

			// Fallback: if round-robin produced too few, just flatten remaining.
			if (mixed.length < 6) {
				const flattened: SynthMarket[] = [];
				for (const bucket of perEvent) flattened.push(...(bucket || []));
				synthMarkets = flattened.slice(0, max);
			} else {
				synthMarkets = mixed.slice(0, max);
			}

			// After DOM updates, enable per-title scrolling only when needed (prevents blank titles).
			queueMicrotask(() => {
				// prune detached nodes (list re-renders when markets refresh)
				titleWrapEls = titleWrapEls.filter((el) => el.isConnected);
				for (const el of titleWrapEls) {
					const needsScroll = el.scrollWidth > el.clientWidth + 2;
					el.classList.toggle('scroll', needsScroll);
				}
			});
		} catch {
			synthMarkets = [];
		} finally {
			synthLoading = false;
		}
	}

	onMount(() => {
		startPythStream();
		void loadSynthMarkets();
		statusPoll = setInterval(() => {
			if (connectedWallet?.connected) void refreshStatus();
		}, 20_000);
	});

	onDestroy(() => {
		if (statusPoll) clearInterval(statusPoll);
		stopPythStream();
	});
</script>

<div class="terminal-top-chrome">
	<div class="command-bar">
		<a href="/" class="logo">
			<span class="logo-text">HASHFOX</span>
		</a>
		<div class="nav-links">
			<a href="/terminal" class="nav-link" class:active={$page.url.pathname.startsWith('/terminal')}>TERMINAL</a>
			<a href="/history" class="nav-link" class:active={$page.url.pathname.startsWith('/history')}>HISTORY</a>
		</div>

		<a
			href="/backtesting"
			class="backtesting-btn"
			class:active={$page.url.pathname.startsWith('/backtesting')}
		>
			BACKTESTING
		</a>

		<div class="magicblock-status">
			<span class="status-label">HASHFOX:</span>
			{#if connectedWallet?.connected && accountInitialized && !fastTradingSessionActive}
				<button
					type="button"
					class="status-value magicblock-session-trigger"
					title="Fund session for one-click trading"
					on:click={openSessionFundModal}
				>
					{magicBlockStatus}
				</button>
			{:else}
				<span class="status-value">{magicBlockStatus}</span>
			{/if}
			{#if connectedWallet?.connected}
				<span class="wallet-balance">{walletBalanceSol.toFixed(4)} SOL</span>
				{#if accountInitialized}
					<span class="usd-balance">${usdBalance.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
				{/if}
				{#if walletBalanceSol < 0.1}
					<button type="button" class="airdrop-btn" on:click={requestAirdrop}>AIRDROP</button>
				{/if}
				{#if !accountInitialized}
					<button
						type="button"
						class="initialize-btn"
						disabled={initializeLoading}
						on:click={initializeAccount}
					>
						{initializeLoading ? '…' : 'INITIALIZE'}
					</button>
				{/if}
				{#if accountInitialized && !fastTradingSessionActive}
					<button type="button" class="initialize-btn fast-session-btn" on:click={openSessionFundModal}>
						FAST TRADES
					</button>
				{/if}
				{#if accountInitialized && fastTradingSessionActive}
					<button
						type="button"
						class="initialize-btn session-end-btn"
						disabled={disconnectSessionLoading}
						title="Revoke session on-chain and clear local keys"
						on:click={disconnectPaperSession}
					>
						{disconnectSessionLoading ? '…' : 'END SESSION'}
					</button>
				{/if}
			{/if}
		</div>

		<div class="wallet-section">
			<WalletButton />
		</div>
	</div>

	<div class="ticker-stack">
		<!-- Line 1: Pyth crypto + stocks -->
		<div class="ticker-row primary">
			<div class="ticker-side crypto">
				<div class="ticker-prices">
					{#each LEFT_PYTH_CRYPTO as sym}
						{@const p = prices[sym]}
						{#if p}
							<div class="ticker-item" role="button" tabindex="0" on:click={() => onTickerSelect(sym)}>
								<span class="ticker-sym">{sym}/USD</span>
								<span class="price">{tickerPriceFmt(p)}</span>
								{#if p.price > 0 && p.change !== undefined}
									<span class={p.change >= 0 ? 'change-up' : 'change-down'}>
										{p.change >= 0 ? '▲' : '▼'} {Math.abs(p.change).toFixed(2)}%
									</span>
								{/if}
							</div>
						{:else}
							<div class="ticker-item">
								<span class="ticker-sym">{sym}/USD</span>
								<span class="price">—</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>

			<div class="ticker-divider"></div>

			<div class="ticker-side stocks">
				<div class="ticker-prices">
					{#each RIGHT_PYTH_STOCKS as sym}
						{@const p = prices[sym]}
						{#if p}
							<div class="ticker-item" role="button" tabindex="0" on:click={() => onTickerSelect(sym)}>
								<span class="ticker-sym">{sym}/USD</span>
								<span class="price">{tickerPriceFmt(p)}</span>
								{#if p.price > 0 && p.change !== undefined}
									<span class={p.change >= 0 ? 'change-up' : 'change-down'}>
										{p.change >= 0 ? '▲' : '▼'} {Math.abs(p.change).toFixed(2)}%
									</span>
								{/if}
							</div>
						{:else}
							<div class="ticker-item">
								<span class="ticker-sym">{sym}/USD</span>
								<span class="price">—</span>
							</div>
						{/if}
					{/each}
				</div>
			</div>
		</div>

		<!-- Line 2: Synthesis markets ticker -->
		<div class="ticker-row markets">
			<div class="market-marquee" aria-label="Synthesis markets ticker">
				{#if synthMarkets.length === 0}
					<div class="market-empty">{synthLoading ? 'Loading markets…' : 'No markets.'}</div>
				{:else}
					<div class="market-track">
						{#each [...synthMarkets, ...synthMarkets] as m, idx (m.id + ':' + idx)}
							<div class="market-chip" title={m.title}>
								{#if m.image}
									<img class="mimg" src={m.image} alt="" referrerpolicy="no-referrer" />
								{:else}
									<div class="mimg fallback"></div>
								{/if}
								<div
									class="mttl-wrap"
									aria-label={m.title}
									use:registerTitleWrap
								>
									<span class="mttl-static">{m.title}</span>
									<span class="mttl-track" aria-hidden="true">
										<span class="mttl">{m.title}</span>
										<span class="mttl sep"> • </span>
										<span class="mttl">{m.title}</span>
									</span>
								</div>
								{#if m.yesPrice !== undefined && m.noPrice !== undefined}
									<span class="mpr yes">YES {(m.yesPrice * 100).toFixed(0)}¢</span>
									<span class="mpr no">NO {(m.noPrice * 100).toFixed(0)}¢</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>

	{#if showUsernameModal && walletAddress}
		<CreateUsernameModal
			walletAddress={walletAddress}
			defaultName={usernameDefaultName}
			onSave={handleUsernameSaved}
			onDismiss={dismissUsernameModal}
		/>
	{/if}

	{#if showDevnetWalletFundingModal}
		<div
			class="hf-overlay"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			on:keydown={(e) => e.key === 'Escape' && dismissDevnetFundingModal()}
		>
			<div
				class="hf-modal"
				role="document"
				on:click|stopPropagation
				on:keydown|stopPropagation
			>
				<div class="hf-modal-header">
					<div class="hf-header-left">
						<span class="hf-dot orange"></span>
						<h3 class="hf-title">
							{connectedWallet?.isEmbedded ? 'EMBEDDED WALLET' : 'FUND WALLET'}
						</h3>
					</div>
					<span class="hf-network-badge">DEVNET</span>
				</div>

				<div class="hf-modal-body">
					<p class="hf-desc">
						{#if connectedWallet?.isEmbedded}
							This is your <strong>embedded Solana wallet</strong>, created from your social login.
							It holds SOL on devnet for fees and session funding. Balance is zero — add test SOL to continue.
						{:else}
							You need test SOL on this cluster for <strong>INITIALIZE</strong>,
							<strong>SESSION</strong> top-up, and trade fees.
						{/if}
					</p>

					<div class="hf-balance-row">
						<span class="hf-balance-label">BALANCE</span>
						<span class="hf-balance-amount">{fundingPopupSolBalance.toFixed(4)}</span>
						<span class="hf-balance-unit">SOL</span>
					</div>

					<div class="hf-field">
						<span class="hf-field-label">WALLET ADDRESS</span>
						<div class="hf-field-row">
							<code class="hf-code">{fundingPopupAddress}</code>
							<button type="button" class="hf-icon-btn" title="Copy" on:click={copyWalletAddress}>
								COPY
							</button>
						</div>
					</div>

					<a
						class="hf-faucet-link"
						href="https://faucet.solana.com/"
						target="_blank"
						rel="noopener noreferrer"
					>
						→ faucet.solana.com — free devnet SOL
					</a>

					<div class="hf-actions">
						<button type="button" class="hf-btn-secondary" on:click={dismissDevnetFundingModal}>
							CLOSE
						</button>
						<button type="button" class="hf-btn-primary" on:click={requestAirdrop}>
							REQUEST AIRDROP
						</button>
					</div>
				</div>

				<div class="hf-modal-footer">
					<span class="hf-footer-dim">SOLANA · DEVNET</span>
				</div>
			</div>
		</div>
	{/if}

	{#if showSessionFundModal}
		<div
			class="hf-overlay"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			on:keydown={(e) => e.key === 'Escape' && !sessionFundLoading && closeSessionFundModal()}
		>
			<div class="hf-modal" role="document" on:click|stopPropagation on:keydown|stopPropagation>
				<div class="hf-modal-header">
					<div class="hf-header-left">
						<span class="hf-dot orange pulse"></span>
						<h3 class="hf-title">FUND SESSION</h3>
					</div>
					<span class="hf-network-badge">1-CLICK</span>
				</div>

				<div class="hf-modal-body">
					<p class="hf-desc">
						A <strong>session key</strong> signs trades for you without wallet popups. Your wallet
						approves once; the session keypair funds ~0.002 SOL per trade for 24 hours.
					</p>

					<div class="hf-input-card">
						<label class="hf-input-label" for="sessionSolChrome">
							SOL TO FUND
							<span class="hf-input-hint">MIN 0.01 · REC 0.05–0.2</span>
						</label>
						<div class="hf-input-row">
							<input
								id="sessionSolChrome"
								type="number"
								min="0.01"
								max="2"
								step="0.01"
								bind:value={sessionFundSolAmount}
								class="hf-input"
								disabled={sessionFundLoading}
							/>
							<span class="hf-input-unit">SOL</span>
						</div>
						<p class="hf-input-estimate">
							≈ <strong>{Math.max(0, Math.floor(Number(sessionFundSolAmount) / 0.002))}</strong> trades at ~0.002 SOL each
						</p>
					</div>

					{#if walletBalanceSol < Number(sessionFundSolAmount) + 0.02}
						<p class="hf-warn">
							BALANCE <strong>{walletBalanceSol.toFixed(4)} SOL</strong> — need {(Number(sessionFundSolAmount) + 0.02).toFixed(3)} SOL (top-up + fees). Use AIRDROP first.
						</p>
					{/if}

					<div class="hf-detail-grid">
						<div class="hf-detail">
							<span class="hf-detail-label">DURATION</span>
							<span class="hf-detail-value">24H</span>
						</div>
						<div class="hf-detail">
							<span class="hf-detail-label">FUNDED</span>
							<span class="hf-detail-value">{Number(sessionFundSolAmount).toFixed(3)} SOL</span>
						</div>
						<div class="hf-detail">
							<span class="hf-detail-label">REVOCABLE</span>
							<span class="hf-detail-value">YES</span>
						</div>
					</div>

					<div class="hf-actions">
						<button
							type="button"
							class="hf-btn-secondary"
							disabled={sessionFundLoading}
							on:click={closeSessionFundModal}
						>
							CANCEL
						</button>
						<button
							type="button"
							class="hf-btn-primary"
							disabled={sessionFundLoading || Number(sessionFundSolAmount) < 0.01}
							on:click={confirmFundSession}
						>
							{#if sessionFundLoading}
								SIGNING…
							{:else}
								FUND &amp; ENABLE
							{/if}
						</button>
					</div>
				</div>

				<div class="hf-modal-footer">
					<span class="hf-footer-dim">SESSION KEY · EPHEMERAL ROLLUP</span>
				</div>
			</div>
		</div>
	{/if}

	{#if showSessionActiveNotice}
		<div
			class="hf-overlay"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			on:keydown={(e) => e.key === 'Escape' && (showSessionActiveNotice = false)}
		>
			<div class="hf-modal" role="document" on:click|stopPropagation on:keydown|stopPropagation>
				<div class="hf-modal-header">
					<div class="hf-header-left">
						<span class="hf-dot green"></span>
						<h3 class="hf-title active">SESSION ACTIVE</h3>
					</div>
					<span class="hf-network-badge success">LIVE</span>
				</div>
				<div class="hf-modal-body center">
					<p class="hf-desc">
						Session key is funded and signing. Orders execute instantly without wallet popups.
					</p>
					<div class="hf-time-badge">
						<span class="hf-time-label">EXPIRES IN</span>
						<span class="hf-time-value">{sessionTimeLabel || formatSessionRemainingLabel()}</span>
					</div>
					<button
						type="button"
						class="hf-btn-primary full"
						on:click={() => (showSessionActiveNotice = false)}
					>
						CONTINUE
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.terminal-top-chrome {
		display: flex;
		flex-direction: column;
		width: 100%;
	}

	.command-bar {
		--nav-fs: 12px;
		--nav-label-fs: 11px;
		--nav-meta-fs: 10px;
		--nav-pad-y: 5px;
		--nav-pad-x: 10px;
		--nav-pill-gap: 6px;
		box-sizing: border-box;
		width: 100%;
		background: #1a1a1a;
		padding: 8px 14px;
		display: flex;
		flex-direction: row;
		flex-wrap: nowrap;
		align-items: center;
		gap: 10px;
		border-bottom: 1px solid #333;
		overflow-x: auto;
		overflow-y: hidden;
		min-height: 52px;
		scrollbar-width: thin;
		scrollbar-color: #ff5a00 #1a1a1a;
	}
	.command-bar::-webkit-scrollbar { height: 6px; }
	.command-bar::-webkit-scrollbar-track { background: #1a1a1a; }
	.command-bar::-webkit-scrollbar-thumb { background: #ff5a00; border-radius: 3px; }

	.logo {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		text-decoration: none;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.logo-text {
		font-size: 19px;
		font-weight: bold;
		color: #ff5a00;
		letter-spacing: 2px;
		font-family: 'Courier New', monospace;
	}

	.nav-links {
		display: flex;
		flex-flow: row nowrap;
		gap: 15px;
		flex-shrink: 0;
		white-space: nowrap;
	}
	.nav-link {
		color: #666;
		background: transparent;
		text-decoration: none;
		font-family: 'Courier New', monospace;
		font-size: 14px;
		padding: 5px 11px;
		border: 1px solid transparent;
		border-radius: 6px;
		transition: all 0.2s;
		flex-shrink: 0;
		white-space: nowrap;
		font-weight: bold;
		letter-spacing: 0.05em;
		cursor: pointer;
	}
	.nav-link:hover { color: #fff; border-color: #333; }
	.nav-link.active { color: #ff5a00; border-color: #ff5a00; }


	.magicblock-status {
		display: flex;
		flex-flow: row nowrap;
		align-items: center;
		gap: var(--nav-pill-gap);
		color: #ff5a00;
		font-family: 'Courier New', monospace;
		font-size: var(--nav-fs);
		padding: var(--nav-pad-y) var(--nav-pad-x);
		background: #000;
		border: 1px solid #333;
		border-radius: 6px;
		flex: 0 0 auto;
		min-width: max-content;
		line-height: 1.25;
		white-space: nowrap;
	}

	.status-label { color: #666; font-size: var(--nav-label-fs); letter-spacing: 0.5px; }
	.status-value { color: #00ff00; font-weight: bold; font-size: var(--nav-fs); }

	.backtesting-btn {
		display: inline-flex;
		align-items: center;
		color: #ff5a00;
		background: #000;
		border: 1px solid #ff5a00;
		border-radius: 6px;
		text-decoration: none;
		font-family: 'Courier New', monospace;
		font-size: var(--nav-fs);
		font-weight: bold;
		letter-spacing: 0.15em;
		padding: var(--nav-pad-y) calc(var(--nav-pad-x) + 2px);
		flex: 0 0 auto;
		white-space: nowrap;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.backtesting-btn:hover { background: #ff5a00; color: #000; }
	.backtesting-btn.active { background: #ff5a00; color: #000; }

	.magicblock-status > * { flex: 0 0 auto; white-space: nowrap; }

	.wallet-balance { color: #00ff00; font-weight: bold; margin-left: 8px; font-size: var(--nav-fs); }
	.usd-balance { color: #ff5a00; font-weight: bold; margin-left: 4px; font-size: var(--nav-fs); }

	.airdrop-btn,
	.initialize-btn {
		background: #ff5a00;
		color: #000;
		border: none;
		border-radius: 6px;
		padding: var(--nav-pad-y) 12px;
		font-size: var(--nav-label-fs);
		font-weight: bold;
		cursor: pointer;
		margin-left: 8px;
		font-family: 'Courier New', monospace;
		letter-spacing: 1px;
		transition: all 0.2s ease;
	}
	.airdrop-btn:hover { background: #ffb733; transform: scale(1.05); }
	.initialize-btn { background: #00ff00; }
	.initialize-btn:hover:not(:disabled) { background: #33ff33; transform: scale(1.05); }
	.initialize-btn:disabled { opacity: 0.55; cursor: wait; }
	.fast-session-btn { background: #ff5a00; }
	.fast-session-btn:hover { background: #ffb733; }
	.session-end-btn { background: #3a2020; color: #ff8888; border: 1px solid #663333; }
	.session-end-btn:hover:not(:disabled) { background: #552828; color: #ffaaaa; transform: none; }
	.session-end-btn:disabled { opacity: 0.6; cursor: wait; }

	.wallet-section {
		display: flex;
		align-items: center;
		flex: 0 0 auto;
		min-width: max-content;
		white-space: nowrap;
	}

	.command-bar .wallet-section :global(.wallet-connected) {
		padding: var(--nav-pad-y) var(--nav-pad-x);
		gap: 9px;
	}
	.command-bar .wallet-section :global(.wallet-address),
	.command-bar .wallet-section :global(.wallet-name),
	.command-bar .wallet-section :global(.connect-button),
	.command-bar .wallet-section :global(.disconnect-button) {
		font-size: var(--nav-fs);
		line-height: 1.25;
	}
	.command-bar .wallet-section :global(.connect-button) {
		padding: var(--nav-pad-y) calc(var(--nav-pad-x) + 6px);
	}

	.ticker-stack {
		background: #0a0a0a;
		border-bottom: 1px solid #333;
		flex-shrink: 0;
		overflow: hidden;
	}
	.ticker-row {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.ticker-row.primary {
		height: 32px;
		padding: 0 8px;
	}
	.ticker-row.markets {
		height: 32px;
		border-top: 1px solid #222;
		padding: 0 8px;
	}
	.ticker-side {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
	}
	.ticker-side.stocks { justify-content: flex-end; }
	.ticker-divider {
		width: 1px;
		height: 18px;
		background: rgba(255,255,255,0.14);
		margin: 0 10px;
		flex: 0 0 auto;
	}

	/* Reuse old ticker styles */
	.ticker-prices {
		display: flex;
		align-items: center;
		gap: 0;
		min-width: 0;
		width: 100%;
		justify-content: space-between;
	}
	.ticker-item {
		font-family: 'Courier New', monospace;
		font-size: 10px;
		color: #888;
		display: flex;
		gap: 5px;
		align-items: center;
		cursor: pointer;
		flex: 1 1 0;
		min-width: 0;
		padding: 0 5px;
		border-bottom: 2px solid transparent;
		transition: color 0.12s ease, border-color 0.12s ease;
		white-space: nowrap;
	}
	.ticker-item > span {
		min-width: 0;
	}
	.ticker-item .ticker-sym {
		overflow: visible;
		text-overflow: clip;
		flex: 0 0 auto;
	}
	.ticker-item .price {
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ticker-item .change-up,
	.ticker-item .change-down {
		flex-shrink: 0;
	}
	.ticker-item:hover { color: #ccc; }
	.ticker-item.ticker-active { color: #ff5a00; border-bottom-color: #ff5a00; }
	.ticker-sym { font-weight: bold; letter-spacing: 0.03em; }
	.price { color: #fff; font-weight: bold; }
	.change-up { color: #00ff00; font-size: 12px; }
	.change-down { color: #ff0000; font-size: 12px; }

	/* Center: marquee markets */
	.market-marquee {
		min-width: 0;
		width: 100%;
		overflow: hidden;
		position: relative;
	}
	.market-empty {
		color: #555;
		font-family: 'Courier New', monospace;
		font-size: 11px;
	}
	.market-track {
		display: flex;
		gap: 8px;
		align-items: center;
		white-space: nowrap;
		will-change: transform;
		/* Slower, more readable ticker */
		animation: marketMarquee 360s linear infinite;
		width: max-content;
	}
	@keyframes marketMarquee {
		from { transform: translateX(0); }
		to { transform: translateX(-50%); }
	}
	@media (prefers-reduced-motion: reduce) {
		.market-track { animation: none; }
	}
	.market-chip {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 3px 6px;
		border: 1px solid #1f1f1f;
		background: #000;
		border-radius: 8px;
		min-width: 360px;
		max-width: 360px;
		flex: 0 0 auto;
	}
	.mimg {
		width: 20px;
		height: 20px;
		border-radius: 6px;
		object-fit: cover;
		border: 1px solid #222;
		background: #111;
		flex-shrink: 0;
	}
	.mimg.fallback {
		background: radial-gradient(circle at 30% 30%, rgba(255, 90, 0, 0.25), transparent 55%),
			linear-gradient(180deg, #080808 0%, #000 100%);
	}
	.mttl-wrap {
		flex: 1 1 auto;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		position: relative;
	}
	.mttl-static {
		display: inline-block;
		color: #e8e8e8;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: bold;
		white-space: nowrap;
	}
	.mttl-track {
		display: none;
		white-space: nowrap;
		will-change: transform;
	}
	.mttl-wrap.scroll .mttl-static { display: none; }
	.mttl-wrap.scroll .mttl-track {
		display: inline-flex;
		align-items: center;
		gap: 0;
		animation: titleScroll 90s linear infinite;
	}
	.mttl {
		color: #e8e8e8;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: bold;
		white-space: nowrap;
	}
	@keyframes titleScroll {
		from { transform: translateX(0); }
		to { transform: translateX(-50%); }
	}
	@media (prefers-reduced-motion: reduce) {
		.mttl-wrap.scroll .mttl-track { animation: none; }
	}
	.mpr {
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.08em;
		flex: 0 0 auto;
		white-space: nowrap;
		padding: 1px 4px;
		border-radius: 6px;
	}
	.mpr.yes { color: #00ff66; }
	.mpr.no { color: #ff6b6b; }

	@media (max-width: 860px) {
		.ticker-row.primary { height: 32px; }
		.ticker-side.stocks { display: none; }
		.ticker-divider { display: none; }
	}

	.magicblock-session-trigger {
		background: none;
		border: none;
		padding: 0;
		margin: 0;
		cursor: pointer;
		font: inherit;
		color: #00ff00;
		text-decoration: underline;
		text-underline-offset: 2px;
		text-align: left;
		white-space: nowrap;
	}
	.magicblock-session-trigger:hover { color: #33ff33; }

	.hf-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.82);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
		padding: 20px;
		animation: hfFadeIn 0.18s ease-out;
	}
	@keyframes hfFadeIn { from { opacity: 0; } to { opacity: 1; } }

	.hf-modal {
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		width: 100%;
		max-width: 460px;
		max-height: 90vh;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 90, 0, 0.06) inset;
		font-family: 'Courier New', monospace;
		display: flex;
		flex-direction: column;
		animation: hfSlideUp 0.22s ease-out;
	}
	@keyframes hfSlideUp {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.hf-modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid #222;
		background: #000;
	}
	.hf-header-left { display: flex; align-items: center; gap: 10px; }
	.hf-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}
	.hf-dot.orange { background: #ff5a00; box-shadow: 0 0 10px rgba(255, 90, 0, 0.7); }
	.hf-dot.green { background: #00ff66; box-shadow: 0 0 10px rgba(0, 255, 102, 0.6); }
	.hf-dot.pulse { animation: hfPulse 1.4s ease-in-out infinite; }
	@keyframes hfPulse {
		0%,100% { box-shadow: 0 0 10px rgba(255, 90, 0, 0.7); }
		50% { box-shadow: 0 0 18px rgba(255, 90, 0, 0.95); }
	}

	.hf-title {
		margin: 0;
		color: #ff5a00;
		font-size: 12px;
		font-weight: bold;
		letter-spacing: 0.25em;
	}
	.hf-title.active { color: #00ff66; }

	.hf-network-badge {
		font-size: 9px;
		font-weight: bold;
		letter-spacing: 0.18em;
		color: #000;
		background: #ff5a00;
		padding: 3px 8px;
		border-radius: 3px;
	}
	.hf-network-badge.success { background: #00ff66; }

	.hf-modal-body { padding: 18px 16px; display: flex; flex-direction: column; gap: 14px; }
	.hf-modal-body.center { text-align: center; align-items: center; }

	.hf-desc {
		color: #aaa;
		font-size: 12px;
		line-height: 1.6;
		margin: 0;
	}
	.hf-desc strong { color: #ff5a00; font-weight: bold; }

	.hf-balance-row {
		display: flex;
		align-items: baseline;
		gap: 10px;
		padding: 12px 14px;
		background: #000;
		border: 1px solid #222;
		border-radius: 3px;
	}
	.hf-balance-label {
		font-size: 9px;
		color: #666;
		letter-spacing: 0.2em;
	}
	.hf-balance-amount {
		font-size: 22px;
		font-weight: bold;
		color: #ff5a00;
		margin-left: auto;
	}
	.hf-balance-unit { font-size: 10px; color: #666; letter-spacing: 0.2em; }

	.hf-field { display: flex; flex-direction: column; gap: 5px; }
	.hf-field-label {
		font-size: 9px;
		color: #666;
		letter-spacing: 0.2em;
		font-weight: bold;
	}
	.hf-field-row {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #000;
		border: 1px solid #222;
		border-radius: 3px;
		padding: 8px 10px;
	}
	.hf-code {
		flex: 1;
		font-size: 10px;
		color: #e8e8e8;
		word-break: break-all;
		letter-spacing: 0.02em;
	}
	.hf-icon-btn {
		background: #0a0a0a;
		border: 1px solid #333;
		color: #ff5a00;
		border-radius: 3px;
		padding: 4px 8px;
		cursor: pointer;
		font-size: 9px;
		font-family: inherit;
		font-weight: bold;
		letter-spacing: 0.15em;
		transition: all 0.15s ease;
	}
	.hf-icon-btn:hover { background: #ff5a00; color: #000; border-color: #ff5a00; }

	.hf-faucet-link {
		font-size: 11px;
		color: #6ae;
		text-decoration: none;
		letter-spacing: 0.03em;
	}
	.hf-faucet-link:hover { color: #8cf; text-decoration: underline; }

	.hf-input-card {
		background: rgba(255, 90, 0, 0.05);
		border: 1px solid rgba(255, 90, 0, 0.3);
		border-radius: 3px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.hf-input-label {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 9px;
		color: #e8e8e8;
		letter-spacing: 0.18em;
		font-weight: bold;
	}
	.hf-input-hint { font-size: 9px; color: #666; font-weight: normal; letter-spacing: 0.12em; }
	.hf-input-row { display: flex; align-items: center; gap: 8px; }
	.hf-input {
		flex: 1;
		background: #000;
		border: 1px solid #333;
		border-radius: 3px;
		padding: 8px 10px;
		color: #ff5a00;
		font-size: 16px;
		font-weight: bold;
		font-family: inherit;
		outline: none;
	}
	.hf-input:focus { border-color: #ff5a00; }
	.hf-input-unit { color: #ff5a00; font-size: 11px; font-weight: bold; letter-spacing: 0.15em; }
	.hf-input-estimate { margin: 0; font-size: 10px; color: #888; letter-spacing: 0.05em; }
	.hf-input-estimate strong { color: #ff5a00; font-weight: bold; }

	.hf-warn {
		font-size: 10px;
		color: #ff6b6b;
		margin: 0;
		padding: 8px 10px;
		background: rgba(255, 107, 107, 0.08);
		border: 1px solid rgba(255, 107, 107, 0.35);
		border-radius: 3px;
		letter-spacing: 0.03em;
	}
	.hf-warn strong { color: #ff9999; font-weight: bold; }

	.hf-detail-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 1px;
		background: #222;
		border: 1px solid #222;
		border-radius: 3px;
		overflow: hidden;
	}
	.hf-detail {
		background: #000;
		padding: 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		align-items: center;
	}
	.hf-detail-label { font-size: 9px; color: #555; letter-spacing: 0.18em; }
	.hf-detail-value { font-size: 12px; color: #ff5a00; font-weight: bold; letter-spacing: 0.1em; }

	.hf-actions { display: flex; gap: 8px; }
	.hf-btn-primary,
	.hf-btn-secondary {
		flex: 1;
		padding: 11px 14px;
		border-radius: 3px;
		font-size: 11px;
		font-weight: bold;
		font-family: inherit;
		letter-spacing: 0.18em;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.15s ease;
	}
	.hf-btn-primary { background: #ff5a00; color: #000; border-color: #ff5a00; }
	.hf-btn-primary:hover:not(:disabled) {
		background: #ffb733;
		border-color: #ffb733;
		box-shadow: 0 0 12px rgba(255, 90, 0, 0.4);
	}
	.hf-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }
	.hf-btn-primary.full { width: 100%; }
	.hf-btn-secondary { background: #000; color: #888; border-color: #333; }
	.hf-btn-secondary:hover:not(:disabled) { color: #fff; border-color: #555; }
	.hf-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

	.hf-time-badge {
		display: inline-flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 12px 24px;
		background: rgba(0, 255, 102, 0.08);
		border: 1px solid rgba(0, 255, 102, 0.35);
		border-radius: 3px;
	}
	.hf-time-label { font-size: 9px; color: #00aa66; letter-spacing: 0.22em; }
	.hf-time-value { font-size: 18px; color: #00ff66; font-weight: bold; letter-spacing: 0.08em; }

	.hf-modal-footer {
		padding: 8px 16px;
		border-top: 1px solid #222;
		background: #000;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.hf-footer-dim { font-size: 9px; color: #444; letter-spacing: 0.2em; }
</style>
