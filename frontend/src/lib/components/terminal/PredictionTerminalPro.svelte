<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { BN } from '$lib/vendor/anchor';
	import { PublicKey } from '@solana/web3.js';
	import { walletStore } from '$lib/wallet/stores';
	import { sessionKey } from '$lib/stores/sessionKey';
	import { polymarketClient, type PolyEvent, type PolyMarket } from '$lib/polymarket';
	import { pendingPredictionEvent } from '$lib/stores/pendingPredictionEvent';
	import { hashfoxClient } from '$lib/hashfoxClient';
	import MarketPriceChart from '$lib/components/prediction/MarketPriceChart.svelte';
	import OrderBook from '$lib/components/prediction/OrderBook.svelte';
	import MarketRules from '$lib/components/prediction/MarketRules.svelte';
	import {
		buildConnection,
		buildProgram,
		buyYes,
		buyNo,
		sellYes,
		sellNo,
		fetchAllPredictionPositions,
		initializeUserAccount,
		getUserAccount,
		priceScaled,
		usd,
		PRICE_SCALE,
		USD_SCALE,
		type BalanceBreakdown,
		type PredictionPositionAccount
	} from '$lib/hashfox';

	type Side = 'Yes' | 'No';
	type Tab = 'Buy' | 'Sell';
	type CenterTab = 'orderbook' | 'chart' | 'info';

	interface SellPositionView {
		pubkey: string;
		positionId: number;
		marketId: string;
		side: Side;
		shares: number;
		remainingShares: number;
		pricePerShare: number;
		amountUsd: number;
	}

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let session: any = {};
	sessionKey.subscribe((s) => (session = s));

	let events: PolyEvent[] = [];
	let statsEvents: PolyEvent[] = [];
	let loading = true;
	let loadingMore = false;
	let hasMore = true;
	let eventsOffset = 0;
	const PAGE_SIZE = 20;
	let listScrollEl: HTMLDivElement;

	let selectedEvent: PolyEvent | null = null;
	let selectedMarket: PolyMarket | null = null;
	let selectedSide: Side = 'Yes';
	let tradeTab: Tab = 'Buy';
	let centerTab: CenterTab = 'chart';
	let showResolved = false;

	let amount = 0;
	let stopLoss = 0;
	let takeProfit = 0;

	let busy = false;
	let statusMessage = '';

	let balance: BalanceBreakdown = { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };
	let solBalance = 0;
	let accountInitialized = false;

	let userPositions: SellPositionView[] = [];
	let selectedPosition: SellPositionView | null = null;
	let loadingPositions = false;

	let poll: ReturnType<typeof setInterval> | null = null;

	function isResolved(m: PolyMarket | null): boolean {
		if (!m) return true;
		const yp = m.yesPrice ?? 0;
		return yp === 0 || yp === 1;
	}

	$: activeMarkets =
		selectedEvent?.markets
			.filter((m) => !isResolved(m))
			.sort((a, b) => (b.yesPrice ?? 0) - (a.yesPrice ?? 0)) ?? [];
	$: resolvedMarkets = selectedEvent?.markets.filter((m) => isResolved(m)) ?? [];

	$: statsPool = statsEvents.length > 0 ? statsEvents : events;
	$: totalActiveMarkets = statsPool.reduce(
		(n, ev) => n + ev.markets.filter((m) => !isResolved(m)).length,
		0
	);
	$: totalVolume = statsPool.reduce((n, ev) => n + (ev.volume ?? 0), 0);
	$: nextEndingLabel = (() => {
		const now = Date.now();
		let min = Infinity;
		for (const ev of statsPool) {
			for (const m of ev.markets) {
				if (isResolved(m) || !m.end_date_iso) continue;
				const t = new Date(m.end_date_iso).getTime();
				if (t > now && t < min) min = t;
			}
		}
		if (!Number.isFinite(min)) return '—';
		const diff = min - now;
		const days = Math.floor(diff / 86_400_000);
		const hours = Math.floor((diff % 86_400_000) / 3_600_000);
		if (days > 0) return `${days}d ${hours}h`;
		const mins = Math.floor((diff % 3_600_000) / 60_000);
		return `${hours}h ${mins}m`;
	})();

	$: chartMarkets = activeMarkets
		.filter((m) => m.clobTokenIds?.[0])
		.slice(0, 5)
		.map((m) => ({
			tokenId: m.clobTokenIds![0],
			label: (m.question || '').replace(/^Will /, '').slice(0, 30) || 'Market'
		}));

	function openEvent(ev: PolyEvent) {
		selectedEvent = ev;
		const firstActive =
			ev.markets.find((m) => !isResolved(m)) ?? ev.markets[0] ?? null;
		selectedMarket = firstActive;
		centerTab = 'chart';
		amount = 0;
		selectedPosition = null;
		statusMessage = '';
	}

	function backToEvents() {
		selectedEvent = null;
		selectedMarket = null;
		amount = 0;
		selectedPosition = null;
	}

	function pickMarket(m: PolyMarket) {
		selectedMarket = m;
		amount = 0;
		selectedPosition = null;
	}

	function pickSide(s: Side) {
		selectedSide = s;
		selectedPosition = null;
		amount = 0;
	}

	function setMaxAmount() {
		if (tradeTab === 'Buy') amount = Math.max(0, balance.availableUsd);
		else if (selectedPosition) amount = selectedPosition.remainingShares;
	}

	function addAmount(v: number) {
		if (tradeTab === 'Buy')
			amount = Math.min(balance.availableUsd, Math.max(0, amount + v));
		else if (selectedPosition) {
			const max = selectedPosition.remainingShares;
			amount = Math.min(max, Math.max(0, amount + v));
		}
	}

	function pctAmount(p: number) {
		if (tradeTab === 'Buy') amount = balance.availableUsd * (p / 100);
		else if (selectedPosition)
			amount = selectedPosition.remainingShares * (p / 100);
	}

	async function refreshAccount() {
		if (!wallet?.connected) {
			balance = { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };
			accountInitialized = false;
			userPositions = [];
			return;
		}
		try {
			solBalance = await hashfoxClient.getBalance();
			accountInitialized = await hashfoxClient.isAccountInitialized();
			if (accountInitialized) {
				balance = await hashfoxClient.getBalanceBreakdown();
				await loadUserPositions();
			} else {
				balance = { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };
				userPositions = [];
			}
		} catch (err) {
			console.warn('prediction refresh failed', err);
		}
	}

	function enumKey(v: any): string {
		if (!v || typeof v !== 'object') return '';
		const k = Object.keys(v)[0];
		return k ? k.toLowerCase() : '';
	}

	async function loadUserPositions() {
		if (!wallet?.connected || !selectedMarket) {
			userPositions = [];
			return;
		}
		loadingPositions = true;
		try {
			const conn = buildConnection();
			const program = buildProgram(conn, wallet.adapter);
			const all = await fetchAllPredictionPositions(program, wallet.publicKey);
			const filtered: SellPositionView[] = [];
			for (const entry of all) {
				const acc = entry.account as PredictionPositionAccount;
				if (acc.marketId !== selectedMarket.id) continue;
				const status = enumKey(acc.status);
				if (status !== 'active' && status !== 'partiallysold') continue;
				const side: Side = enumKey(acc.predictionType) === 'yes' ? 'Yes' : 'No';
				if (side !== selectedSide) continue;
				filtered.push({
					pubkey: entry.pubkey.toBase58(),
					positionId: Number(acc.positionId.toString()),
					marketId: acc.marketId,
					side,
					shares: Number(acc.shares.toString()) / USD_SCALE,
					remainingShares: Number(acc.remainingShares.toString()) / USD_SCALE,
					pricePerShare: Number(acc.pricePerShare.toString()) / PRICE_SCALE,
					amountUsd: Number(acc.amountUsd.toString()) / USD_SCALE
				});
			}
			userPositions = filtered;
			if (filtered.length > 0 && !selectedPosition) selectedPosition = filtered[0];
			else if (filtered.length === 0) selectedPosition = null;
		} catch (err) {
			console.warn('load prediction positions failed', err);
			userPositions = [];
		} finally {
			loadingPositions = false;
		}
	}

	async function handleTrade() {
		if (busy) return;
		if (!wallet?.connected) {
			statusMessage = 'Connect a wallet first.';
			return;
		}
		if (!selectedMarket) {
			statusMessage = 'Select a market first.';
			return;
		}
		if (isResolved(selectedMarket)) {
			statusMessage = 'Market is resolved.';
			return;
		}
		const priceDec =
			selectedSide === 'Yes'
				? (selectedMarket.yesPrice ?? 0)
				: (selectedMarket.noPrice ?? 0);
		if (priceDec <= 0) {
			statusMessage = 'Invalid price.';
			return;
		}
		if (!amount || amount <= 0) {
			statusMessage = 'Enter a valid amount.';
			return;
		}
		if (tradeTab === 'Buy' && amount > balance.availableUsd + 0.01) {
			statusMessage = `Insufficient available USDT (${balance.availableUsd.toFixed(2)}).`;
			return;
		}
		if (
			tradeTab === 'Sell' &&
			(!selectedPosition || amount > selectedPosition.remainingShares + 0.01)
		) {
			statusMessage = 'Not enough shares to sell.';
			return;
		}

		busy = true;
		statusMessage = 'Submitting…';
		try {
			const conn = buildConnection();
			const program = buildProgram(conn, wallet.adapter);
			const acc = await getUserAccount(program, wallet.publicKey);
			if (!acc) {
				statusMessage = 'Initializing paper account…';
				await initializeUserAccount(program, wallet.publicKey, new BN(10_000_000));
			}
			const sessionToken: PublicKey | null = session.active ? session.token : null;

			let sig = '';
			if (tradeTab === 'Buy') {
				const marketId = (selectedMarket.id || selectedEvent?.slug || '').slice(0, 128);
				const fn = selectedSide === 'Yes' ? buyYes : buyNo;
				sig = await fn(program, wallet.publicKey, {
					marketId,
					amountUsd: usd(amount),
					pricePerShare: priceScaled(priceDec),
					stopLoss: stopLoss > 0 ? priceScaled(stopLoss / 100) : new BN(0),
					takeProfit: takeProfit > 0 ? priceScaled(takeProfit / 100) : new BN(0),
					sessionToken
				});
			} else {
				if (!selectedPosition) throw new Error('No position selected');
				const fn = selectedSide === 'Yes' ? sellYes : sellNo;
				sig = await fn(
					program,
					wallet.publicKey,
					new BN(selectedPosition.positionId),
					usd(amount),
					priceScaled(priceDec),
					sessionToken
				);
			}

			statusMessage = `${tradeTab} ${selectedSide} submitted · ${sig.slice(0, 8)}…`;
			amount = 0;
			await refreshAccount();
		} catch (err: any) {
			console.error(err);
			statusMessage = err?.message ?? 'Trade failed.';
		} finally {
			busy = false;
		}
	}

	$: if (tradeTab === 'Sell' && wallet?.connected && selectedMarket) void loadUserPositions();
	$: if (wallet?.connected) void refreshAccount();

	async function loadEvents(append = false) {
		if (append) {
			if (loadingMore || !hasMore) return;
			loadingMore = true;
		} else {
			loading = true;
			eventsOffset = 0;
			hasMore = true;
		}
		try {
			const batch = await polymarketClient.fetchEvents(PAGE_SIZE, eventsOffset);
			if (append) {
				const seen = new Set(events.map((e) => e.id));
				events = [...events, ...batch.filter((e) => !seen.has(e.id))];
			} else {
				events = batch;
			}
			if (batch.length < PAGE_SIZE) hasMore = false;
			eventsOffset += batch.length;
		} catch (err) {
			console.warn('polymarket events fetch failed', err);
			hasMore = false;
		} finally {
			loading = false;
			loadingMore = false;
		}
	}

	function handleListScroll(e: Event) {
		const el = e.target as HTMLElement;
		if (!el) return;
		const scrolledToBottom = el.scrollHeight - el.scrollTop <= el.clientHeight + 240;
		if (scrolledToBottom && !loadingMore && hasMore) void loadEvents(true);
	}

	const pendingUnsub = pendingPredictionEvent.subscribe(async (ev) => {
		if (!ev) return;
		pendingPredictionEvent.set(null);
		const existing = events.find((e) => e.id === ev.id);
		if (existing) {
			openEvent(existing);
		} else {
			events = [ev, ...events];
			openEvent(ev);
		}
	});

	async function loadStatsEvents() {
		try {
			const all = await polymarketClient.searchAllEvents(500);
			statsEvents = all.filter((ev) => ev.active && !ev.closed && !ev.archived);
		} catch (err) {
			console.warn('prediction stats fetch failed', err);
		}
	}

	onMount(async () => {
		await loadEvents(false);
		void loadStatsEvents();
		void refreshAccount();
		poll = setInterval(() => {
			if (wallet?.connected) void refreshAccount();
		}, 12_000);
	});

	onDestroy(() => {
		if (poll) clearInterval(poll);
		pendingUnsub();
	});

	function cents(p: number | undefined): string {
		return ((p ?? 0) * 100).toFixed(1);
	}
	function fmtUsd(n: number, d = 2): string {
		return n.toLocaleString('en-US', {
			minimumFractionDigits: d,
			maximumFractionDigits: d
		});
	}
	function fmtVol(v: number | undefined): string {
		if (!v) return '$0';
		if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
		if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
		return `$${v.toFixed(0)}`;
	}
</script>

<div class="pred-pro">
	{#if !selectedEvent}
		<!-- EVENTS LIST VIEW -->
		<div class="list-wrap">
			<div class="list-header">
				<div class="list-stats">
					<div class="bs-cell">
						<span class="bs-label">Events</span>
						<span class="bs-value">{statsPool.length}</span>
					</div>
					<div class="bs-cell">
						<span class="bs-label">Active Markets</span>
						<span class="bs-value bs-green">{totalActiveMarkets}</span>
					</div>
					<div class="bs-cell">
						<span class="bs-label">Total Vol.</span>
						<span class="bs-value bs-usdt">{fmtVol(totalVolume)}</span>
					</div>
					<div class="bs-cell">
						<span class="bs-label">Next Ends</span>
						<span class="bs-value">{nextEndingLabel}</span>
					</div>
				</div>
				<div class="list-balance">
					<div class="bs-cell">
						<span class="bs-label">USDT</span>
						<span class="bs-value bs-usdt">{fmtUsd(balance.totalUsd)}</span>
					</div>
					<div class="bs-cell">
						<span class="bs-label">Available</span>
						<span class="bs-value bs-avail">{fmtUsd(balance.availableUsd)}</span>
					</div>
					<div class="bs-cell">
						<span class="bs-label">Locked</span>
						<span
							class="bs-value bs-lock"
							class:is-lock={balance.lockedUsd > 0}
						>{fmtUsd(balance.lockedUsd)}</span>
					</div>
				</div>
			</div>

			{#if loading}
				<div class="list-loading">
					<div class="spinner"></div>
					<span>Loading events…</span>
				</div>
			{:else if events.length === 0}
				<div class="list-empty">No events available.</div>
			{:else}
				<div
					class="events-scroll"
					bind:this={listScrollEl}
					on:scroll={handleListScroll}
				>
					<div class="events-grid">
						{#each events as ev (ev.id)}
							{@const active = ev.markets.filter((m) => !isResolved(m))}
							{@const previewMarkets = active
								.slice()
								.sort(
									(a, b) =>
										(b.volume_24hr ?? b.volume ?? 0) - (a.volume_24hr ?? a.volume ?? 0)
								)
								.slice(0, 2)}
							<div class="event-card">
								<button class="ec-head" on:click={() => openEvent(ev)}>
									{#if ev.image}
										<img src={ev.image} alt="" class="ec-img" />
									{/if}
									<div class="ec-head-text">
										<span class="ec-title">{ev.title}</span>
										{#if ev.categories && ev.categories[0]}
											<span class="ec-cat">{ev.categories[0].replace(/_/g, ' ')}</span>
										{/if}
									</div>
								</button>

								<div class="ec-markets">
									{#each previewMarkets as m (m.id)}
										<div class="ec-market">
											<button
												class="ec-q"
												title={m.question}
												on:click={() => openEvent(ev)}
											>
												<span class="ec-q-text">{m.question || 'Unknown'}</span>
												<span class="ec-chance">
													<span class="ec-chance-pct">{((m.yesPrice ?? 0) * 100).toFixed(0)}%</span>
													<span class="ec-chance-lbl">chance</span>
												</span>
											</button>
											<div class="ec-actions">
												<button class="ec-side ec-yes" on:click={() => openEvent(ev)}>Yes</button>
												<button class="ec-side ec-no" on:click={() => openEvent(ev)}>No</button>
											</div>
										</div>
									{/each}

									{#if previewMarkets.length === 0}
										<div class="ec-empty">No active markets</div>
									{/if}

									<div class="ec-foot">
										{#if ev.volume}
											<span class="ec-vol">{fmtVol(ev.volume)} Vol.</span>
										{/if}
										<span class="ec-count">{active.length} active</span>
										<button class="ec-open" on:click={() => openEvent(ev)}>Open ▸</button>
									</div>
								</div>
							</div>
						{/each}
					</div>

					{#if loadingMore}
						<div class="list-loading more">
							<div class="spinner"></div>
							<span>Loading more…</span>
						</div>
					{:else if !hasMore && events.length > 0}
						<div class="list-end">End of events.</div>
					{/if}
				</div>
			{/if}
		</div>
	{:else}
		<!-- EVENT DETAIL VIEW (polymock-style) -->
		<div class="ev-header">
			<button class="ev-back" on:click={backToEvents} title="Back to events">←</button>
			{#if selectedEvent.image}
				<img src={selectedEvent.image} alt="" class="ev-logo" />
			{/if}
			<span class="ev-title">{selectedEvent.title}</span>
			<div class="ev-meta">
				<span class="ev-chip">{activeMarkets.length} active</span>
				{#if resolvedMarkets.length > 0}
					<span class="ev-chip resolved">{resolvedMarkets.length} resolved</span>
				{/if}
			</div>
			<div class="ev-balance">
				<div class="bs-cell">
					<span class="bs-label">USDT</span>
					<span class="bs-value bs-usdt">{fmtUsd(balance.totalUsd)}</span>
				</div>
				<div class="bs-cell">
					<span class="bs-label">Available</span>
					<span class="bs-value bs-avail">{fmtUsd(balance.availableUsd)}</span>
				</div>
				<div class="bs-cell">
					<span class="bs-label">Locked</span>
					<span class="bs-value bs-lock" class:is-lock={balance.lockedUsd > 0}
						>{fmtUsd(balance.lockedUsd)}</span
					>
				</div>
			</div>
		</div>

		<div class="ev-body">
			<!-- LEFT SIDEBAR: market list -->
			<div class="ev-sidebar">
				<div class="ev-sidebar-label">MARKETS</div>
				{#each activeMarkets as market (market.id)}
					<button
						class="ev-mrow"
						class:active={selectedMarket?.id === market.id}
						on:click={() => pickMarket(market)}
					>
						<div class="ev-mrow-bar">
							<div
								class="ev-mrow-fill"
								style="height:{((market.yesPrice || 0) * 100).toFixed(0)}%"
							></div>
						</div>
						<div class="ev-mrow-info">
							<span class="ev-mrow-name">{market.question || 'Unknown'}</span>
							<span class="ev-mrow-pct">{cents(market.yesPrice)}¢</span>
						</div>
					</button>
				{/each}

				{#if resolvedMarkets.length > 0}
					<button
						class="ev-resolved-toggle"
						on:click={() => (showResolved = !showResolved)}
					>
						{showResolved ? '▲' : '▼'} {resolvedMarkets.length} resolved
					</button>
					{#if showResolved}
						{#each resolvedMarkets as market (market.id)}
							<button
								class="ev-mrow resolved"
								class:active={selectedMarket?.id === market.id}
								on:click={() => pickMarket(market)}
							>
								<div class="ev-mrow-info">
									<span class="ev-mrow-name">{market.question || 'Unknown'}</span>
									<span class="resolved-chip">Resolved</span>
								</div>
							</button>
						{/each}
					{/if}
				{/if}
			</div>

			<!-- CENTER: chart / orderbook / rules -->
			<div class="ev-main">
				{#if selectedMarket}
					<div class="ev-banner">
						<div class="ev-banner-title">{selectedMarket.question}</div>
						<div class="ev-banner-pills">
							<button
								class="pill pill-yes"
								class:pill-active={selectedSide === 'Yes'}
								on:click={() => {
									selectedSide = 'Yes';
									tradeTab = 'Buy';
								}}
							>
								Yes <strong>{cents(selectedMarket.yesPrice)}¢</strong>
							</button>
							<button
								class="pill pill-no"
								class:pill-active={selectedSide === 'No'}
								on:click={() => {
									selectedSide = 'No';
									tradeTab = 'Buy';
								}}
							>
								No <strong>{cents(selectedMarket.noPrice)}¢</strong>
							</button>
							<span class="ev-stat"
								>Vol. {fmtVol(
									selectedMarket.volume_24hr ?? selectedMarket.volume
								)}</span
							>
							{#if selectedMarket.end_date_iso}
								<span class="ev-stat">
									Ends {new Date(selectedMarket.end_date_iso).toLocaleDateString(
										'en-US',
										{ month: 'short', day: 'numeric' }
									)}
								</span>
							{/if}
						</div>
					</div>

					<div class="ev-center-tabs">
						<button
							class="ev-ctab"
							class:active={centerTab === 'chart'}
							on:click={() => (centerTab = 'chart')}>Chart</button
						>
						<button
							class="ev-ctab"
							class:active={centerTab === 'orderbook'}
							on:click={() => (centerTab = 'orderbook')}>Order Book</button
						>
						<button
							class="ev-ctab"
							class:active={centerTab === 'info'}
							on:click={() => (centerTab = 'info')}>Info & Rules</button
						>
					</div>

					<div
						class="ev-center-content"
						class:is-chart={centerTab === 'chart'}
					>
						{#if centerTab === 'chart'}
							{#if chartMarkets.length > 0}
								{#key selectedEvent.id + ':' + chartMarkets.map((m) => m.tokenId).join(',')}
									<MarketPriceChart markets={chartMarkets} />
								{/key}
							{:else}
								<div class="ev-empty">No price history available.</div>
							{/if}
						{:else if centerTab === 'orderbook'}
							{#if selectedMarket.clobTokenIds?.length}
								{#key selectedMarket.id}
									<OrderBook
										tokenIds={selectedMarket.clobTokenIds}
										yesLabel="Yes"
										noLabel="No"
									/>
								{/key}
							{:else}
								<div class="ev-empty">Orderbook unavailable for this market.</div>
							{/if}
						{:else}
							<MarketRules event={selectedEvent} market={selectedMarket} />
						{/if}
					</div>
				{:else}
					<div class="ev-empty">← Select a market</div>
				{/if}
			</div>

			<!-- RIGHT: trading panel -->
			<div class="ev-trade">
				{#if selectedMarket}
					<div class="ev-trade-inner">
						<div class="outcome-row">
							<button
								class="oc oc-yes"
								class:active={selectedSide === 'Yes'}
								on:click={() => pickSide('Yes')}
							>
								Yes<br /><span class="oc-pct">{cents(selectedMarket.yesPrice)}¢</span>
							</button>
							<button
								class="oc oc-no"
								class:active={selectedSide === 'No'}
								on:click={() => pickSide('No')}
							>
								No<br /><span class="oc-pct">{cents(selectedMarket.noPrice)}¢</span>
							</button>
						</div>

						<div class="trade-tabs">
							<button
								class="tt-btn"
								class:tt-active={tradeTab === 'Buy'}
								on:click={() => (tradeTab = 'Buy')}>Buy</button
							>
							<button
								class="tt-btn"
								class:tt-active={tradeTab === 'Sell'}
								on:click={() => (tradeTab = 'Sell')}>Sell</button
							>
						</div>

						<div class="amount-block">
							<div class="amount-head">
								<span class="amount-lbl"
									>{tradeTab === 'Buy' ? 'Amount (USD)' : 'Shares'}</span
								>
								<span class="amount-bal">
									{#if tradeTab === 'Buy'}
										${fmtUsd(balance.availableUsd)}
									{:else if selectedPosition}
										{selectedPosition.remainingShares.toFixed(2)} avail.
									{/if}
								</span>
							</div>
							<div class="amount-input-wrap">
								{#if tradeTab === 'Buy'}<span class="amt-cur">$</span>{/if}
								<input
									class="amt-input"
									type="number"
									inputmode="decimal"
									min="0"
									step="0.01"
									bind:value={amount}
									placeholder="0.00"
								/>
								{#if tradeTab === 'Sell'}<span class="amt-suffix">shares</span>{/if}
							</div>
							<div class="quick-row">
								{#if tradeTab === 'Buy'}
									<button class="q-btn" on:click={() => addAmount(1)}>+$1</button>
									<button class="q-btn" on:click={() => addAmount(10)}>+$10</button>
									<button class="q-btn" on:click={() => addAmount(50)}>+$50</button>
									<button class="q-btn" on:click={setMaxAmount}>Max</button>
								{:else if selectedPosition}
									<button class="q-btn" on:click={() => pctAmount(25)}>25%</button>
									<button class="q-btn" on:click={() => pctAmount(50)}>50%</button>
									<button class="q-btn" on:click={() => pctAmount(75)}>75%</button>
									<button class="q-btn" on:click={setMaxAmount}>Max</button>
								{/if}
							</div>
						</div>

						{#if tradeTab === 'Buy'}
							<div class="sltp-wrap">
								<div class="sltp-body">
									<div class="sltp-stack">
										<div class="sltp-group">
											<label class="sltp-lbl">
												<span class="sl-badge">SL</span>
												<span>Stop Loss</span>
											</label>
											<div class="sltp-input-wrap">
												<input
													class="sltp-input"
													type="number"
													bind:value={stopLoss}
													min="0"
													step="0.01"
													placeholder="45.5"
												/>
												<span class="sltp-suffix">¢</span>
											</div>
										</div>
										<div class="sltp-group">
											<label class="sltp-lbl">
												<span class="tp-badge">TP</span>
												<span>Take Profit</span>
											</label>
											<div class="sltp-input-wrap">
												<input
													class="sltp-input"
													type="number"
													bind:value={takeProfit}
													min="0"
													step="0.01"
													placeholder="85.5"
												/>
												<span class="sltp-suffix">¢</span>
											</div>
										</div>
									</div>
								</div>
							</div>
						{/if}

						{#if tradeTab === 'Sell'}
							{#if loadingPositions}
								<div class="pos-empty">Loading positions…</div>
							{:else if userPositions.length > 0}
								<div class="pos-list">
									{#each userPositions as p (p.pubkey)}
										<button
											class="pos-row"
											class:active={selectedPosition?.positionId === p.positionId}
											on:click={() => {
												selectedPosition = p;
												amount = 0;
											}}
										>
											<span
												class="pr-side"
												class:pr-yes={p.side === 'Yes'}
												class:pr-no={p.side === 'No'}>{p.side}</span
											>
											<span class="pr-sz">{p.remainingShares.toFixed(2)} sh</span>
											<span class="pr-px"
												>@ {(p.pricePerShare * 100).toFixed(1)}¢</span
											>
										</button>
									{/each}
								</div>
							{:else if wallet?.connected}
								<div class="pos-empty">No {selectedSide} position.</div>
							{/if}
						{/if}

						{#if tradeTab === 'Buy'}
							{@const priceDec =
								selectedSide === 'Yes'
									? (selectedMarket.yesPrice ?? 0)
									: (selectedMarket.noPrice ?? 0)}
							{@const shares = priceDec > 0 && amount > 0 ? amount / priceDec : 0}
							<div class="summary">
								<div class="sum-row">
									<span>Avg price</span><span>{cents(priceDec)}¢</span>
								</div>
								<div class="sum-row">
									<span>Shares</span><span>{shares.toFixed(2)}</span>
								</div>
								<div class="sum-row hl">
									<span>Potential win</span>
									<span class="orange">${shares.toFixed(2)}</span>
								</div>
							</div>
						{/if}

						<button
							class="action"
							class:action-yes={selectedSide === 'Yes'}
							class:action-no={selectedSide === 'No'}
							disabled={busy ||
								!wallet?.connected ||
								amount <= 0 ||
								(tradeTab === 'Sell' && !selectedPosition) ||
								isResolved(selectedMarket)}
							on:click={handleTrade}
						>
							{#if busy}
								Processing…
							{:else if isResolved(selectedMarket)}
								Market resolved
							{:else if !wallet?.connected}
								Connect wallet
							{:else if tradeTab === 'Sell' && !selectedPosition}
								No {selectedSide} position
							{:else}
								{tradeTab} {selectedSide} @ {cents(
									selectedSide === 'Yes'
										? selectedMarket.yesPrice
										: selectedMarket.noPrice
								)}¢
							{/if}
						</button>

						{#if statusMessage}
							<div class="status-msg">{statusMessage}</div>
						{/if}
					</div>
				{:else}
					<div class="ev-empty">Select a market to trade.</div>
				{/if}
			</div>
		</div>

		{#if wallet?.connected && !accountInitialized}
			<div class="bottom-strip">
				<div class="bs-hint">
					Paper account not initialized — your first trade will call the initializer automatically.
				</div>
			</div>
		{/if}
	{/if}
</div>

<style>
	.pred-pro {
		background: #000;
		color: #ccc;
		font-family: 'Courier New', monospace;
		min-height: calc(100vh - 160px);
		display: flex;
		flex-direction: column;
	}

	/* ───── EVENTS LIST VIEW ───── */
	.list-wrap {
		padding: 0;
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
	}
	.events-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
		min-height: 0;
		max-height: calc(100vh - 220px);
	}
	.events-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
		gap: 14px;
	}
	.event-card {
		background: #0a0a0a;
		border: 1px solid #1a1a1a;
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		transition: border-color 0.15s, transform 0.15s;
	}
	.event-card:hover { border-color: #2a2a2a; }
	.ec-head {
		display: flex;
		gap: 10px;
		align-items: flex-start;
		padding: 12px;
		background: #050505;
		border: none;
		border-bottom: 1px solid #141414;
		cursor: pointer;
		text-align: left;
		color: inherit;
		font-family: inherit;
	}
	.ec-head:hover { background: rgba(255, 149, 0, 0.04); }
	.ec-img {
		width: 34px;
		height: 34px;
		border-radius: 6px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.ec-head-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.ec-title {
		color: #eaecef;
		font-size: 12px;
		font-weight: 900;
		line-height: 1.35;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.ec-cat {
		font-size: 9px;
		font-weight: 900;
		letter-spacing: 0.12em;
		color: #888;
		text-transform: uppercase;
	}
	.ec-markets {
		display: flex;
		flex-direction: column;
		padding: 8px 12px 12px;
		gap: 8px;
	}
	.ec-market {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-bottom: 8px;
		border-bottom: 1px solid #111;
	}
	.ec-market:last-of-type { border-bottom: none; padding-bottom: 0; }
	.ec-q {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
		background: transparent;
		border: none;
		color: #e8e8e8;
		font-family: inherit;
		font-size: 11px;
		text-align: left;
		cursor: pointer;
		padding: 0;
	}
	.ec-q-text {
		flex: 1;
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.ec-q:hover .ec-q-text { color: #ff9500; }
	.ec-chance {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		flex-shrink: 0;
	}
	.ec-chance-pct {
		color: #00ff64;
		font-weight: 900;
		font-size: 14px;
		font-variant-numeric: tabular-nums;
	}
	.ec-chance-lbl { font-size: 9px; color: #666; letter-spacing: 0.08em; }
	.ec-actions {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.ec-side {
		background: #000;
		border: 1px solid #1a1a1a;
		border-radius: 6px;
		padding: 5px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 900;
		letter-spacing: 0.1em;
		cursor: pointer;
	}
	.ec-yes { color: #00ff64; }
	.ec-yes:hover { background: rgba(0, 255, 100, 0.08); border-color: #00ff64; }
	.ec-no { color: #ff4444; }
	.ec-no:hover { background: rgba(255, 68, 68, 0.08); border-color: #ff4444; }
	.ec-empty {
		font-size: 11px;
		color: #555;
		padding: 6px 0;
		text-align: center;
	}
	.ec-foot {
		display: flex;
		align-items: center;
		gap: 10px;
		padding-top: 6px;
		border-top: 1px solid #111;
		margin-top: 2px;
	}
	.ec-vol { font-size: 10px; color: #aaa; font-variant-numeric: tabular-nums; }
	.ec-count { font-size: 10px; color: #666; letter-spacing: 0.08em; }
	.ec-open {
		margin-left: auto;
		background: transparent;
		border: 1px solid #222;
		color: #ff9500;
		padding: 4px 10px;
		font-family: inherit;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.08em;
		border-radius: 4px;
		cursor: pointer;
	}
	.ec-open:hover { border-color: #ff9500; background: rgba(255, 149, 0, 0.06); }

	.list-loading.more { padding: 20px 0; }
	.list-end {
		text-align: center;
		padding: 20px 0;
		font-size: 10px;
		color: #555;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.list-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-bottom: 1px solid #1a1a1a;
		background: #0a0a0a;
		flex-wrap: wrap;
	}
	.list-stats { display: flex; gap: 6px; flex-wrap: wrap; }
	.list-balance { display: flex; gap: 6px; flex-wrap: wrap; }

	.list-loading {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 40px;
		color: #666;
		font-size: 12px;
		justify-content: center;
	}
	.spinner {
		width: 18px;
		height: 18px;
		border: 2px solid #222;
		border-top-color: #ff9500;
		border-radius: 50%;
		animation: pl-spin 0.8s linear infinite;
	}
	@keyframes pl-spin { to { transform: rotate(360deg); } }
	.list-empty { padding: 60px; text-align: center; color: #666; }

	.event-list {
		display: flex;
		flex-direction: column;
	}
	.el-row {
		display: grid;
		grid-template-columns: minmax(0, 2.4fr) 90px 110px 110px 90px 30px;
		gap: 12px;
		align-items: center;
		padding: 12px 18px;
		background: transparent;
		border: none;
		border-bottom: 1px solid #141414;
		color: #ccc;
		font-family: inherit;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		transition: background 0.12s;
	}
	.el-row:hover:not(.el-head) {
		background: rgba(255, 149, 0, 0.04);
	}
	.el-head {
		background: #0a0a0a;
		cursor: default;
		border-bottom: 1px solid #1a1a1a;
		position: sticky;
		top: 0;
		z-index: 2;
	}
	.el-hdr {
		font-size: 10px;
		color: #666;
		font-weight: 900;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.el-hdr-title { padding-left: 30px; }
	.el-title-cell {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.el-img {
		width: 22px;
		height: 22px;
		border-radius: 5px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.el-title-wrap {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.el-title {
		color: #eaecef;
		font-size: 12px;
		font-weight: 900;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.el-sub {
		color: #888;
		font-size: 10px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.el-cell {
		color: #aaa;
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.el-yes { color: #00ff64; }
	.el-date { color: #888; }
	.el-chev { color: #555; text-align: right; }
	.el-row:hover .el-chev { color: #ff9500; }

	/* balance pills shared */
	.bs-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 12px;
		background: #000;
		border: 1px solid #1f1f1f;
		border-radius: 8px;
		min-width: 96px;
	}
	.bs-label {
		color: #666;
		font-size: 9px;
		letter-spacing: 0.14em;
		font-weight: 900;
	}
	.bs-value { color: #e8e8e8; font-size: 13px; font-weight: 900; }
	.bs-usdt { color: #ff9500; }
	.bs-avail { color: #00ff64; }
	.bs-lock.is-lock { color: #ffb84d; }

	/* ───── EVENT DETAIL VIEW ───── */
	.ev-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 18px;
		background: #0a0a0a;
		border-bottom: 1px solid #1a1a1a;
		flex-wrap: wrap;
	}
	.ev-back {
		background: #000;
		border: 1px solid #333;
		color: #ccc;
		width: 34px;
		height: 34px;
		border-radius: 6px;
		cursor: pointer;
		font-size: 16px;
		font-weight: 900;
		font-family: inherit;
	}
	.ev-back:hover { border-color: #ff9500; color: #ff9500; }
	.ev-logo {
		width: 26px;
		height: 26px;
		border-radius: 5px;
		object-fit: cover;
	}
	.ev-title {
		color: #eaecef;
		font-size: 14px;
		font-weight: 900;
		letter-spacing: 0.02em;
	}
	.ev-meta { display: flex; gap: 6px; }
	.ev-chip {
		background: rgba(0, 255, 100, 0.08);
		border: 1px solid rgba(0, 255, 100, 0.3);
		color: #00ff64;
		padding: 3px 8px;
		border-radius: 10px;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.08em;
	}
	.ev-chip.resolved {
		background: rgba(120, 120, 120, 0.08);
		border-color: #333;
		color: #888;
	}
	.ev-balance {
		margin-left: auto;
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}

	.ev-body {
		display: grid;
		grid-template-columns: 280px minmax(0, 1fr) 320px;
		align-items: stretch;
		height: calc(100vh - 160px);
		max-height: calc(100vh - 160px);
		min-height: 620px;
		overflow: hidden;
	}
	.ev-sidebar,
	.ev-trade {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		height: 100%;
		max-height: 100%;
		overflow-y: auto;
	}
	.ev-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		height: 100%;
		max-height: 100%;
		overflow: hidden;
	}
	.ev-sidebar {
		border-right: 1px solid #1a1a1a;
		background: #0a0a0a;
	}
	.ev-trade {
		background: #0a0a0a;
		border-left: 1px solid #1a1a1a;
	}

	.ev-sidebar-label {
		padding: 10px 14px;
		color: #ff9500;
		font-size: 11px;
		letter-spacing: 0.14em;
		font-weight: 900;
		border-bottom: 1px solid #1a1a1a;
		position: sticky;
		top: 0;
		background: #0a0a0a;
	}
	.ev-mrow {
		width: 100%;
		display: grid;
		grid-template-columns: 18px 1fr;
		gap: 10px;
		align-items: center;
		padding: 10px 12px;
		background: transparent;
		border: none;
		border-bottom: 1px solid #1a1a1a;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
	}
	.ev-mrow:hover { background: #111; }
	.ev-mrow.active {
		background: rgba(255, 149, 0, 0.08);
		border-left: 2px solid #ff9500;
	}
	.ev-mrow-bar {
		width: 14px;
		height: 40px;
		background: #0a0a0a;
		border: 1px solid #1a1a1a;
		display: flex;
		align-items: flex-end;
		overflow: hidden;
		border-radius: 3px;
	}
	.ev-mrow-fill {
		width: 100%;
		background: linear-gradient(to top, #00ff64, rgba(0, 255, 100, 0.4));
		min-height: 1px;
	}
	.ev-mrow-info {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.ev-mrow-name {
		color: #eaecef;
		font-size: 11px;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.ev-mrow-pct { color: #00ff64; font-size: 11px; font-weight: 900; }
	.ev-mrow.resolved .ev-mrow-name { color: #888; }
	.resolved-chip {
		color: #888;
		font-size: 9px;
		font-weight: 900;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.ev-resolved-toggle {
		width: 100%;
		padding: 8px 12px;
		background: #050505;
		border: none;
		border-top: 1px solid #1a1a1a;
		border-bottom: 1px solid #1a1a1a;
		color: #888;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.1em;
		cursor: pointer;
		font-family: inherit;
		text-align: left;
	}

	.ev-main {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 12px;
		overflow: hidden;
	}
	.ev-banner {
		padding: 10px 12px;
		background: #0a0a0a;
		border: 1px solid #1a1a1a;
		border-radius: 8px;
	}
	.ev-banner-title {
		color: #eaecef;
		font-size: 13px;
		font-weight: 900;
		margin-bottom: 8px;
	}
	.ev-banner-pills {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.pill {
		background: #000;
		border: 1px solid #222;
		color: #ccc;
		padding: 4px 10px;
		border-radius: 20px;
		font-size: 11px;
		font-weight: 700;
		font-family: inherit;
		cursor: pointer;
	}
	.pill strong { color: #fff; margin-left: 4px; }
	.pill-yes { border-color: rgba(0, 255, 100, 0.4); color: #00ff64; }
	.pill-yes.pill-active,
	.pill-yes:hover {
		background: rgba(0, 255, 100, 0.1);
		border-color: #00ff64;
	}
	.pill-no { border-color: rgba(255, 68, 68, 0.4); color: #ff4444; }
	.pill-no.pill-active,
	.pill-no:hover {
		background: rgba(255, 68, 68, 0.1);
		border-color: #ff4444;
	}
	.ev-stat {
		font-size: 10px;
		color: #888;
		letter-spacing: 0.06em;
	}

	.ev-center-tabs {
		display: flex;
		gap: 2px;
		border-bottom: 1px solid #1a1a1a;
	}
	.ev-ctab {
		background: transparent;
		border: none;
		color: #666;
		padding: 8px 14px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 900;
		letter-spacing: 0.1em;
		cursor: pointer;
		border-bottom: 2px solid transparent;
	}
	.ev-ctab:hover { color: #ccc; }
	.ev-ctab.active {
		color: #ff9500;
		border-bottom-color: #ff9500;
	}

	.ev-center-content {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.ev-center-content.is-chart {
		min-height: 260px;
	}
	.ev-empty {
		padding: 30px;
		color: #666;
		font-size: 12px;
		text-align: center;
	}

	/* Trading panel */
	.ev-trade-inner {
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		height: 100%;
		min-height: 0;
	}
	.trade-spacer { flex: 1; min-height: 0; }

	.outcome-row {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.oc {
		background: #0a0a0a;
		border: 1px solid #1f1f1f;
		color: #b8b8b8;
		padding: 10px;
		border-radius: 10px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.03em;
		cursor: pointer;
		text-align: center;
		transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
	}
	.oc-pct { font-size: 13px; color: #fff; font-weight: 800; }
	.oc-yes:hover,
	.oc-yes.active {
		background: rgba(16, 201, 128, 0.1);
		border-color: rgba(16, 201, 128, 0.55);
		color: #10c980;
	}
	.oc-no:hover,
	.oc-no.active {
		background: rgba(239, 79, 95, 0.1);
		border-color: rgba(239, 79, 95, 0.55);
		color: #ef4f5f;
	}

	.trade-tabs {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
		border-bottom: 1px solid #1a1a1a;
		padding-bottom: 4px;
	}
	.tt-btn {
		background: transparent;
		border: none;
		color: #666;
		padding: 8px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 900;
		letter-spacing: 0.1em;
		cursor: pointer;
		border-bottom: 2px solid transparent;
	}
	.tt-btn.tt-active {
		color: #ff9500;
		border-bottom-color: #ff9500;
	}

	.amount-block { display: flex; flex-direction: column; gap: 6px; }
	.amount-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 10px;
	}
	.amount-lbl {
		color: #888;
		font-weight: 900;
		letter-spacing: 0.1em;
	}
	.amount-bal { color: #666; }
	.amount-input-wrap {
		display: flex;
		align-items: center;
		border: 1px solid #222;
		background: #000;
		padding: 0 10px;
		border-radius: 6px;
	}
	.amt-cur,
	.amt-suffix { color: #666; font-size: 11px; }
	.amt-input {
		flex: 1;
		background: transparent;
		border: none;
		color: #fff;
		padding: 10px 4px;
		outline: none;
		font-family: inherit;
		font-size: 14px;
		font-weight: 900;
		min-width: 0;
	}
	.quick-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 4px;
	}
	.q-btn {
		background: #000;
		border: 1px solid #222;
		color: #ccc;
		padding: 6px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 900;
		cursor: pointer;
		border-radius: 4px;
	}
	.q-btn:hover { border-color: #ff9500; color: #ff9500; }

	.sltp-wrap {
		border: 1px solid #1a1a1a;
		border-radius: 8px;
		background: #080808;
		overflow: hidden;
	}
	.sltp-toggle {
		width: 100%;
		display: flex;
		justify-content: space-between;
		align-items: center;
		background: #080808;
		border: none;
		color: #aaa;
		padding: 9px 11px;
		font-family: inherit;
		font-size: 11.5px;
		font-weight: 700;
		letter-spacing: 0.01em;
		cursor: pointer;
		transition: color 0.12s;
	}
	.sltp-toggle:hover { color: #eaecef; }
	.sltp-badges {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.sl-badge {
		font-size: 9.5px;
		padding: 2px 5px;
		border-radius: 3px;
		font-weight: 900;
		letter-spacing: 0.04em;
		background: rgba(239, 68, 68, 0.12);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.25);
	}
	.tp-badge {
		font-size: 9.5px;
		padding: 2px 5px;
		border-radius: 3px;
		font-weight: 900;
		letter-spacing: 0.04em;
		background: rgba(16, 185, 129, 0.12);
		color: #10b981;
		border: 1px solid rgba(16, 185, 129, 0.25);
	}
	.sltp-arrow {
		font-size: 9px;
		color: #888;
		margin-left: 2px;
	}
	.sltp-body {
		padding: 10px 11px 12px;
		border-top: 1px solid #111;
		background: #060606;
	}
	.sltp-stack {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.sltp-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.sltp-lbl {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 10.5px;
		font-weight: 700;
		color: #aaa;
		letter-spacing: 0.02em;
	}
	.sltp-input-wrap {
		display: flex;
		align-items: center;
		background: #040404;
		border: 1px solid #1a1a1a;
		border-radius: 6px;
		transition: border-color 0.15s, box-shadow 0.15s;
	}
	.sltp-input-wrap:focus-within {
		border-color: #ff9500;
		box-shadow: 0 0 0 1px rgba(255, 149, 0, 0.18);
	}
	.sltp-input {
		flex: 1;
		min-width: 0;
		background: transparent;
		border: none;
		color: #eaecef;
		padding: 8px 0 8px 10px;
		font-family: inherit;
		font-size: 13px;
		font-weight: 700;
		outline: none;
		-moz-appearance: textfield;
	}
	.sltp-input::-webkit-outer-spin-button,
	.sltp-input::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.sltp-suffix {
		padding: 0 10px;
		font-size: 11px;
		color: #888;
		flex-shrink: 0;
	}

	.pos-list { display: flex; flex-direction: column; gap: 4px; }
	.pos-row {
		display: grid;
		grid-template-columns: 50px 1fr auto;
		gap: 8px;
		align-items: center;
		padding: 8px 10px;
		background: #000;
		border: 1px solid #1a1a1a;
		color: #ccc;
		font-family: inherit;
		font-size: 11px;
		cursor: pointer;
		border-radius: 6px;
	}
	.pos-row.active {
		border-color: #ff9500;
		background: rgba(255, 149, 0, 0.05);
	}
	.pr-side { font-weight: 900; letter-spacing: 0.08em; font-size: 10px; }
	.pr-yes { color: #00ff64; }
	.pr-no { color: #ff4444; }
	.pr-sz { color: #e8e8e8; }
	.pr-px { color: #888; font-size: 10px; }
	.pos-empty {
		font-size: 11px;
		color: #666;
		padding: 8px 10px;
		background: #000;
		border: 1px dashed #1a1a1a;
		border-radius: 6px;
		text-align: center;
	}

	.summary {
		background: #000;
		border: 1px solid #1a1a1a;
		border-radius: 6px;
		padding: 10px 12px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.sum-row {
		display: flex;
		justify-content: space-between;
		font-size: 11px;
		color: #aaa;
	}
	.sum-row.hl { color: #fff; font-weight: 900; margin-top: 4px; }
	.orange { color: #ff9500; }

	.action {
		padding: 13px 14px;
		border: 1px solid transparent;
		border-radius: 10px;
		background: #111;
		color: #666;
		font-family: inherit;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
		flex-shrink: 0;
		margin-top: auto;
		transition:
			transform 0.12s ease,
			filter 0.12s ease,
			box-shadow 0.12s ease;
	}
	.action:not(:disabled).action-yes {
		background: linear-gradient(180deg, #10c980 0%, #0a9a63 100%);
		border-color: rgba(16, 201, 128, 0.55);
		color: #03180f;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 2px 10px rgba(16, 201, 128, 0.18);
	}
	.action:not(:disabled).action-no {
		background: linear-gradient(180deg, #ef4f5f 0%, #c73848 100%);
		border-color: rgba(239, 79, 95, 0.55);
		color: #ffffff;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 2px 10px rgba(239, 79, 95, 0.18);
	}
	.action:not(:disabled):hover { filter: brightness(1.07); transform: translateY(-1px); }
	.action:not(:disabled):active { transform: translateY(0); filter: brightness(0.96); }
	.action:disabled { cursor: not-allowed; opacity: 0.45; }

	.status-msg {
		font-size: 10px;
		color: #ff9500;
		text-align: center;
		padding: 4px 8px;
		background: rgba(255, 149, 0, 0.08);
		border-radius: 4px;
	}

	.bottom-strip {
		padding: 10px 16px;
		background: #0a0a0a;
		border-top: 1px solid #1a1a1a;
	}
	.bs-row {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 8px;
		align-items: center;
	}
	.bs-block {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.bs-k {
		color: #666;
		font-size: 9px;
		letter-spacing: 0.14em;
		font-weight: 900;
	}
	.bs-v { color: #e8e8e8; font-size: 13px; font-weight: 900; }
	.bs-green { color: #00ff64; }
	.bs-orange { color: #ffb84d; }
	.bs-refresh-cell { justify-self: end; }
	.bs-refresh {
		background: #000;
		border: 1px solid #222;
		color: #ccc;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.1em;
		cursor: pointer;
		border-radius: 4px;
	}
	.bs-refresh:hover { border-color: #ff9500; color: #ff9500; }
	.bs-hint {
		margin-top: 8px;
		font-size: 10px;
		color: #888;
		letter-spacing: 0.04em;
	}

	@media (max-width: 1024px) {
		.ev-body {
			grid-template-columns: 1fr;
			height: auto;
			max-height: none;
			overflow: visible;
		}
		.ev-sidebar,
		.ev-main,
		.ev-trade {
			height: auto;
			max-height: none;
			overflow-y: visible;
		}
		.ev-sidebar,
		.ev-trade {
			border-left: none;
			border-right: none;
			border-top: 1px solid #1a1a1a;
		}
		.events-scroll { max-height: none; }
		.bs-row { grid-template-columns: repeat(3, 1fr); }
	}
	@media (max-width: 640px) {
		.events-grid { grid-template-columns: 1fr; }
		.bs-row { grid-template-columns: repeat(2, 1fr); }
	}
</style>
