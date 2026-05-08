<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { PublicKey } from '@solana/web3.js';
	import { walletStore } from '$lib/wallet/stores';
	import { hashfoxClient } from '$lib/hashfoxClient';
	import { Connection, Keypair } from '@solana/web3.js';
	import { AnchorProvider, Program, type Idl } from '$lib/vendor/anchor';
	import { SOLANA_RPC } from '$lib/env';
	import hashfoxIdl from '$lib/idl/hashfox.json';
	import {
		fetchAllCompetitions,
		fetchCompetitionByPda,
		fetchCompetitionParticipants,
		createCompetition,
		joinCompetition,
		reportScore,
		settleCompetition,
		claimCompetitionExit,
		isCompetitionJoinable,
		competitionTotalPoolSol,
		fmtCountdown,
		COMP_NAME_MAX_LEN,
		COMP_MIN_DURATION_SECS,
		COMP_MAX_DURATION_SECS,
		COMP_MIN_PARTICIPANTS,
		type CompetitionView,
		type CompUserView
	} from '$lib/competition';
	import {
		activeCompetition,
		refreshActiveCompetition
	} from '$lib/stores/activeCompetition';
	import {
		fetchPublicProfiles,
		fetchCompClosedTrades,
		fetchCompUserStats,
		type PublicProfile,
		type CompClosedTrade,
		type CompUserStats
	} from '$lib/supabase';

	type Filter = 'all' | 'pending' | 'active' | 'settled';

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let comps: CompetitionView[] = [];
	let loading = true;
	let busy = false;
	let message = '';
	let filter: Filter = 'all';
	let selectedKey: string | null = null;
	let participants: CompUserView[] = [];
	let participantsLoading = false;
	let profiles: Map<string, PublicProfile> = new Map();
	let participantsModalOpen = false;
	let compTrades: CompClosedTrade[] = [];
	let compStats: Map<string, CompUserStats> = new Map();
	let compTradesLoading = false;
	let tradesModalOpen = false;

	// Create form state
	let createOpen = false;
	let formName = '';
	let formEntrySol = 0.1;
	let formMaxParticipants = 3;
	let formDurationDays = 3;
	$: formTargetSol = formEntrySol * formMaxParticipants;
	let creating = false;
	let createMsg = '';

	let myActive: { pubkey: PublicKey | null; view: CompetitionView | null; loaded: boolean } = {
		pubkey: null,
		view: null,
		loaded: false
	};
	activeCompetition.subscribe((s) => (myActive = s));

	let now = Date.now();
	const tick = setInterval(() => (now = Date.now()), 1000);
	onDestroy(() => clearInterval(tick));

	$: filtered = (() => {
		if (filter === 'all') return comps;
		return comps.filter((c) => c.status === filter);
	})();

	$: selected = filtered.find((c) => c.pubkey === selectedKey)
		?? comps.find((c) => c.pubkey === selectedKey)
		?? filtered[0]
		?? null;

	$: aggregateStats = (() => {
		const live = comps.filter((c) => c.status === 'active');
		const pending = comps.filter((c) => c.status === 'pending');
		const totalPool = comps.reduce((acc, c) => acc + competitionTotalPoolSol(c), 0);
		const totalPlayers = comps.reduce((acc, c) => acc + c.participantCount, 0);
		return {
			liveCount: live.length,
			pendingCount: pending.length,
			totalPool,
			totalPlayers
		};
	})();

	function fmtSol(v: number, decimals = 2): string {
		if (!Number.isFinite(v)) return '0';
		if (v >= 1000) return v.toFixed(0);
		if (v >= 100) return v.toFixed(1);
		return v.toFixed(decimals);
	}

	function fmtUsd(v: number): string {
		if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
		if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`;
		return `$${v.toFixed(2)}`;
	}

	/** Build a program tied to a throw-away keypair so the listing/podium fetch
	 * works before the user connects a wallet. Read-only — never signs. */
	function buildReadOnlyProgram(): any {
		const conn = new Connection(SOLANA_RPC, 'confirmed');
		const dummy = Keypair.generate();
		const wallet = {
			publicKey: dummy.publicKey,
			signTransaction: async (tx: any) => tx,
			signAllTransactions: async (txs: any[]) => txs
		};
		const provider = new AnchorProvider(conn, wallet as any, { commitment: 'confirmed' });
		return new Program(hashfoxIdl as Idl, provider);
	}

	async function loadAll() {
		loading = true;
		try {
			const program = hashfoxClient.getProgram() ?? buildReadOnlyProgram();
			comps = await fetchAllCompetitions(program);
			// Newest first; pending > active > settled secondary sort.
			comps.sort((a, b) => {
				const order = { pending: 0, active: 1, settled: 2 } as const;
				if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
				return b.createdAt - a.createdAt;
			});
			if (!selectedKey && comps.length > 0) selectedKey = comps[0].pubkey;
			// Resolve creator + cached podium profiles up-front so the list shows
			// usernames/avatars without flashing addresses first.
			const wallets = new Set<string>();
			for (const c of comps) {
				wallets.add(c.creator);
				for (const t of c.top) {
					if (t.participant && t.participant !== PublicKey.default.toBase58()) {
						wallets.add(t.participant);
					}
				}
			}
			await mergeProfiles(Array.from(wallets));
		} catch (err) {
			console.warn('[competition] load failed', err);
		} finally {
			loading = false;
		}
	}

	async function mergeProfiles(wallets: string[]) {
		try {
			const fresh = await fetchPublicProfiles(wallets);
			const next = new Map(profiles);
			for (const [k, v] of fresh) next.set(k, v);
			profiles = next;
		} catch (err) {
			console.warn('[competition] profile fetch failed', err);
		}
	}

	function profileFor(wallet: string): PublicProfile | null {
		if (!wallet) return null;
		return profiles.get(wallet) ?? null;
	}

	function displayName(wallet: string): string {
		const p = profileFor(wallet);
		if (p?.username) return `@${p.username}`;
		return shortAddr(wallet);
	}

	function avatarInitial(wallet: string): string {
		const p = profileFor(wallet);
		if (p?.username) return p.username[0]?.toUpperCase() ?? '?';
		return wallet.slice(0, 1).toUpperCase();
	}

	async function loadParticipants() {
		if (!selected) {
			participants = [];
			return;
		}
		const program = hashfoxClient.getProgram() ?? buildReadOnlyProgram();
		participantsLoading = true;
		try {
			participants = await fetchCompetitionParticipants(program, new PublicKey(selected.pubkey));
			participants.sort((a, b) => b.totalUsd - a.totalUsd);
			// Hydrate any new participant wallets we don't have a profile for yet.
			const missing = participants
				.map((p) => p.owner)
				.filter((w) => !profiles.has(w));
			if (missing.length > 0) await mergeProfiles(missing);
		} finally {
			participantsLoading = false;
		}
	}

	$: if (selected) loadParticipants();
	$: if (selected) loadCompTrades(selected.pubkey);

	async function loadCompTrades(pubkey: string) {
		compTradesLoading = true;
		try {
			const [trades, stats] = await Promise.all([
				fetchCompClosedTrades(pubkey, 200),
				fetchCompUserStats(pubkey)
			]);
			compTrades = trades;
			compStats = stats;
		} catch (err) {
			console.warn('[competition] comp trades load failed', err);
		} finally {
			compTradesLoading = false;
		}
	}

	function fmtPnl(v: number): string {
		if (!Number.isFinite(v)) return '$0';
		const sign = v > 0 ? '+' : '';
		return `${sign}${fmtUsd(v)}`;
	}

	function timeAgo(iso: string | null): string {
		if (!iso) return '—';
		const ms = Date.parse(iso);
		if (Number.isNaN(ms)) return '—';
		void now;
		const diff = Math.max(0, Date.now() - ms);
		const sec = Math.floor(diff / 1000);
		if (sec < 60) return `${sec}s ago`;
		const min = Math.floor(sec / 60);
		if (min < 60) return `${min}m ago`;
		const hr = Math.floor(min / 60);
		if (hr < 24) return `${hr}h ago`;
		const days = Math.floor(hr / 24);
		return `${days}d ago`;
	}

	/** Live ranking enriched with realized PnL + #closed trades from Supabase.
	 *  totalUsd = on-chain usd_balance (already includes locked margin AND
	 *  realized PnL from closed positions, since the program credits/debits
	 *  the balance on close). We sort by it and surface the Supabase-derived
	 *  realized PnL as a separate "Cup PnL" stat for transparency. */
	$: rankedParticipants = (() => {
		return [...participants].map((p) => {
			const stat = compStats.get(p.owner);
			return {
				...p,
				realizedPnl: stat?.realizedPnl ?? 0,
				closedTrades: stat?.tradeCount ?? 0,
				wins: stat?.wins ?? 0,
				losses: stat?.losses ?? 0,
				winRate: stat?.winRate ?? 0
			};
		}).sort((a, b) => b.totalUsd - a.totalUsd);
	})();

	let lastWallet: string | null = null;
	walletStore.subscribe(async (s) => {
		const addr = s.publicKey?.toBase58?.() ?? null;
		if (addr === lastWallet) return;
		lastWallet = addr;
		if (s.connected) {
			await loadAll();
			await refreshActiveCompetition();
		}
	});

	onMount(async () => {
		// Honor ?cup=PDA deeplinks coming from the leaderboard widget.
		const cup = $page.url.searchParams.get('cup');
		if (cup) selectedKey = cup;
		// Wallet store may not have fired yet on cold mount; try once unconditionally.
		await loadAll();
		await refreshActiveCompetition();
	});

	async function refresh() {
		await loadAll();
		await refreshActiveCompetition();
		await loadParticipants();
		if (selected) await loadCompTrades(selected.pubkey);
	}

	async function handleJoin(c: CompetitionView) {
		if (!wallet.connected || !wallet.publicKey) {
			message = 'Connect a wallet first.';
			return;
		}
		if (myActive?.pubkey && !myActive.pubkey.equals(PublicKey.default)) {
			message = 'You are already in an active competition. Claim exit after it settles.';
			return;
		}
		const program = hashfoxClient.getProgram();
		if (!program) {
			message = 'Wallet not ready.';
			return;
		}
		busy = true;
		message = `Joining ${c.name}…`;
		try {
			// Make sure the user's main account exists; init if missing.
			const acc = await hashfoxClient.getUserAccount();
			if (!acc) {
				message = 'Initializing paper account…';
				await hashfoxClient.initializeAccount(0.1);
			}
			const sig = await joinCompetition(program, wallet.publicKey, new PublicKey(c.pubkey));
			message = `Joined · ${sig.slice(0, 8)}…`;
			await refresh();
		} catch (err: any) {
			console.error(err);
			message = err?.message ?? 'Join failed.';
		} finally {
			busy = false;
		}
	}

	async function handleClaimExit(c: CompetitionView) {
		if (!wallet.connected || !wallet.publicKey) return;
		const program = hashfoxClient.getProgram();
		if (!program) return;
		busy = true;
		message = 'Claiming exit…';
		try {
			const sig = await claimCompetitionExit(program, wallet.publicKey, new PublicKey(c.pubkey));
			message = `Exit claimed · ${sig.slice(0, 8)}…`;
			await refresh();
		} catch (err: any) {
			console.error(err);
			message = err?.message ?? 'Claim failed.';
		} finally {
			busy = false;
		}
	}

	async function handleSettle(c: CompetitionView) {
		if (!wallet.connected || !wallet.publicKey) return;
		const program = hashfoxClient.getProgram();
		if (!program) return;
		const podiumKeys = c.top.map((t) =>
			t.participant === PublicKey.default.toBase58() ? PublicKey.default : new PublicKey(t.participant)
		);
		busy = true;
		message = 'Settling…';
		try {
			const sig = await settleCompetition(program, wallet.publicKey, new PublicKey(c.pubkey), {
				first: podiumKeys[0] ?? PublicKey.default,
				second: podiumKeys[1] ?? PublicKey.default,
				third: podiumKeys[2] ?? PublicKey.default
			});
			message = `Settled · ${sig.slice(0, 8)}…`;
			await refresh();
		} catch (err: any) {
			console.error(err);
			message = err?.message ?? 'Settle failed.';
		} finally {
			busy = false;
		}
	}

	async function handleReportTop3(c: CompetitionView) {
		// Permissionlessly push the current balances of the top participants
		// into the on-chain leaderboard cache, so settle picks up real winners.
		if (!wallet.connected || !wallet.publicKey) return;
		const program = hashfoxClient.getProgram();
		if (!program) return;
		busy = true;
		message = 'Refreshing leaderboard…';
		try {
			const sorted = [...participants].sort((a, b) => b.totalUsd - a.totalUsd).slice(0, 10);
			for (const p of sorted) {
				try {
					await reportScore(
						program,
						wallet.publicKey,
						new PublicKey(c.pubkey),
						new PublicKey(p.owner)
					);
				} catch (err) {
					console.warn('[reportScore] failed for', p.owner, err);
				}
			}
			message = 'Leaderboard refreshed.';
			await refresh();
		} catch (err: any) {
			message = err?.message ?? 'Refresh failed.';
		} finally {
			busy = false;
		}
	}

	function validateCreateForm(): string | null {
		const name = formName.trim();
		if (!name) return 'Name required.';
		if (name.length > COMP_NAME_MAX_LEN) return `Name must be ≤ ${COMP_NAME_MAX_LEN} chars.`;
		if (!(formEntrySol > 0)) return 'Entry ticket must be > 0.';
		if (!Number.isInteger(formMaxParticipants))
			return 'Max participants must be a whole number.';
		if (formMaxParticipants < COMP_MIN_PARTICIPANTS)
			return `Need at least ${COMP_MIN_PARTICIPANTS} participants.`;
		if (!Number.isInteger(formDurationDays))
			return 'Duration must be a whole number of days.';
		const dur = formDurationDays * 86_400;
		if (dur < COMP_MIN_DURATION_SECS || dur > COMP_MAX_DURATION_SECS)
			return `Duration must be between 3 and 21 days.`;
		return null;
	}

	async function handleCreate() {
		if (!wallet.connected || !wallet.publicKey) {
			createMsg = 'Connect a wallet first.';
			return;
		}
		const err = validateCreateForm();
		if (err) {
			createMsg = err;
			return;
		}
		const program = hashfoxClient.getProgram();
		if (!program) {
			createMsg = 'Wallet not ready.';
			return;
		}
		if (myActive?.pubkey && !myActive.pubkey.equals(PublicKey.default)) {
			createMsg = 'You are already in an active competition — claim exit before creating a new one.';
			return;
		}
		creating = true;
		createMsg = 'Creating competition…';
		try {
			// The creator has to join their own cup (the contract gives them no
			// special role), so we make sure their main UserAccount exists before
			// firing the create + join sequence.
			const acc = await hashfoxClient.getUserAccount();
			if (!acc) {
				createMsg = 'Initializing paper account…';
				await hashfoxClient.initializeAccount(0.1);
			}

			const { signature, competition } = await createCompetition(program, wallet.publicKey, {
				name: formName.trim(),
				entryTicketSol: formEntrySol,
				targetSol: formEntrySol * formMaxParticipants,
				durationSecs: formDurationDays * 86_400
			});
			createMsg = `Created · ${signature.slice(0, 8)}… · joining…`;

			try {
				const joinSig = await joinCompetition(program, wallet.publicKey, competition);
				createMsg = `Created + joined · ${joinSig.slice(0, 8)}…`;
			} catch (joinErr: any) {
				console.warn('[competition] auto-join after create failed', joinErr);
				createMsg = `Created · auto-join failed (${joinErr?.message ?? 'unknown'}). Click JOIN to enter.`;
			}

			formName = '';
			await loadAll();
			await refreshActiveCompetition();
			selectedKey = competition.toBase58();
			createOpen = false;
		} catch (e: any) {
			console.error(e);
			createMsg = e?.message ?? 'Create failed.';
		} finally {
			creating = false;
		}
	}

	function shortAddr(a: string) {
		if (!a) return '';
		return a === PublicKey.default.toBase58() ? '—' : `${a.slice(0, 4)}…${a.slice(-4)}`;
	}

	function podiumPctFor(rank: 0 | 1 | 2): string {
		if (rank === 0) return '50%';
		if (rank === 1) return '30%';
		return '15%';
	}

	function statusLabel(s: CompetitionView['status']): string {
		if (s === 'active') return 'LIVE';
		if (s === 'pending') return 'OPEN';
		return 'SETTLED';
	}

	function progressPct(c: CompetitionView): number {
		if (c.maxParticipants === 0) return 0;
		return Math.min(100, (c.participantCount / c.maxParticipants) * 100);
	}

	$: timeLabel = (() => {
		if (!selected) return { label: '—', value: '—' };
		void now;
		if (selected.status === 'pending') {
			return {
				label: 'WAITING FOR FILL',
				value: `${selected.participantCount}/${selected.maxParticipants}`
			};
		}
		if (selected.status === 'active') {
			return { label: 'ENDS IN', value: fmtCountdown(selected.endTs) };
		}
		return { label: 'SETTLED', value: '✓' };
	})();

	$: amInThis = !!(myActive?.pubkey && selected && myActive.pubkey.toBase58() === selected.pubkey);
	$: canSettle = !!(selected && selected.status === 'active' && now / 1000 >= selected.endTs);
	$: alreadyInOther = !!(
		myActive?.pubkey
		&& selected
		&& myActive.pubkey.toBase58() !== selected.pubkey
		&& !myActive.pubkey.equals(PublicKey.default)
	);

	$: myActiveLive = myActive?.view && myActive.view.status === 'active';
	$: myActivePending = myActive?.view && myActive.view.status === 'pending';
	$: myActiveSettled = myActive?.view && myActive.view.status === 'settled';
</script>

<main class="comp-page">
	<header class="hero">
		<button class="back-btn" on:click={() => goto('/')}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
			</svg>
			BACK TO LEADERBOARD
		</button>

		<h1>Trade. Climb. <span class="grad">Win.</span></h1>
		<div class="hero-stats">
			<div>
				<strong>{aggregateStats.liveCount}</strong>
				<span>LIVE</span>
			</div>
			<div>
				<strong>{aggregateStats.pendingCount}</strong>
				<span>OPEN</span>
			</div>
			<div>
				<strong>{fmtSol(aggregateStats.totalPool, 2)} SOL</strong>
				<span>TOTAL POOLS</span>
			</div>
			<div>
				<strong>{aggregateStats.totalPlayers}</strong>
				<span>PLAYERS</span>
			</div>
		</div>
	</header>

	{#if myActive?.loaded && myActive.view}
		<div class="active-banner {myActive.view.status}">
			<div class="ab-left">
				<span class="ab-tag">YOU ARE IN A COMPETITION</span>
				<span class="ab-name">{myActive.view.name}</span>
				<span class="ab-meta">
					{#if myActiveLive}
						Live · ends in {fmtCountdown(myActive.view.endTs)}
					{:else if myActivePending}
						Pending · waiting for {myActive.view.maxParticipants - myActive.view.participantCount} more entries
					{:else if myActiveSettled}
						Settled — claim your exit to free your wallet for the next cup
					{/if}
				</span>
			</div>
			<div class="ab-right">
				<button
					class="secondary"
					on:click={() => myActive.pubkey && (selectedKey = myActive.pubkey.toBase58())}
				>
					VIEW DETAIL
				</button>
				{#if myActiveLive}
					<button class="primary" on:click={() => goto('/terminal')}>OPEN TERMINAL</button>
				{:else if myActiveSettled}
					<button
						class="primary"
						disabled={busy}
						on:click={() => myActive.view && handleClaimExit(myActive.view)}
					>
						{busy ? '…' : 'CLAIM EXIT'}
					</button>
				{/if}
			</div>
		</div>
	{/if}

	<section class="block">
		<div class="block-head">
			<h2>Competitions</h2>
			<div class="block-head-actions">
				<div class="seg">
					<button class:on={filter === 'all'} on:click={() => (filter = 'all')}>ALL</button>
					<button class:on={filter === 'pending'} on:click={() => (filter = 'pending')}>OPEN</button>
					<button class:on={filter === 'active'} on:click={() => (filter = 'active')}>LIVE</button>
					<button class:on={filter === 'settled'} on:click={() => (filter = 'settled')}>SETTLED</button>
				</div>
				<button class="ghost" on:click={refresh} disabled={loading || busy}>
					{loading ? 'LOADING…' : 'REFRESH'}
				</button>
				<button class="primary sm" on:click={() => (createOpen = !createOpen)}>
					{createOpen ? 'CLOSE' : '+ NEW CUP'}
				</button>
			</div>
		</div>

		{#if createOpen}
			<div class="create-form">
				<div class="cf-head">
					<strong>Create Competition</strong>
					<span class="muted">{COMP_MIN_PARTICIPANTS}+ participants · 3 – 21 days · auto-starts when every seat is filled</span>
				</div>
				<div class="cf-grid">
					<label class="field">
						<span>Name (max {COMP_NAME_MAX_LEN})</span>
						<input type="text" maxlength={COMP_NAME_MAX_LEN} bind:value={formName} placeholder="Crypto Sprint #15" />
					</label>
					<label class="field">
						<span>Entry ticket (SOL)</span>
						<input type="number" min="0.001" step="0.001" bind:value={formEntrySol} />
					</label>
					<label class="field">
						<span>Max participants</span>
						<input
							type="number"
							min={COMP_MIN_PARTICIPANTS}
							step="1"
							bind:value={formMaxParticipants}
							on:input={(e) => {
								const v = parseInt((e.target as HTMLInputElement).value, 10);
								formMaxParticipants = Number.isFinite(v) ? Math.max(COMP_MIN_PARTICIPANTS, v) : COMP_MIN_PARTICIPANTS;
							}}
						/>
						<small>= {(formEntrySol * formMaxParticipants).toFixed(3)} SOL pool</small>
					</label>
					<label class="field">
						<span>Duration (days)</span>
						<input
							type="number"
							min={3}
							max={21}
							step="1"
							bind:value={formDurationDays}
							on:input={(e) => {
								const v = parseInt((e.target as HTMLInputElement).value, 10);
								formDurationDays = Number.isFinite(v) ? Math.min(21, Math.max(3, v)) : 3;
							}}
						/>
					</label>
				</div>
				<div class="cf-actions">
					<button class="primary" disabled={creating} on:click={handleCreate}>
						{creating ? 'CREATING…' : `CREATE & JOIN — PAY ${formEntrySol.toFixed(3)} SOL`}
					</button>
					<span class="cf-hint">
						Creator joins their own cup automatically — no privileged role.
					</span>
					{#if createMsg}
						<span class="cf-msg">{createMsg}</span>
					{/if}
				</div>
			</div>
		{/if}

		{#if message}
			<div class="banner">{message}</div>
		{/if}

		{#if loading}
			<div class="placeholder">Loading on-chain competitions…</div>
		{:else if comps.length === 0}
			<div class="placeholder">
				No competitions on chain yet. Create the first cup with the <strong>+ NEW CUP</strong> button above.
			</div>
		{:else}
			<div class="cup-grid">
				<div class="cup-list">
					{#each filtered as t (t.pubkey)}
						<button
							class="cup-row"
							class:active={selectedKey === t.pubkey}
							on:click={() => (selectedKey = t.pubkey)}
						>
							<div class="cup-row-head">
								<span class="cup-tag {t.status}">{statusLabel(t.status)}</span>
								<span class="cup-row-title">{t.name}</span>
							</div>
							<div class="cup-row-meta">
								<span class="prize">{fmtSol(competitionTotalPoolSol(t))} SOL</span>
								<span class="dot-sep">·</span>
								<span>{fmtSol(t.entryTicketSol, 3)} SOL entry</span>
								<span class="dot-sep">·</span>
								<span>{t.participantCount}/{t.maxParticipants}</span>
							</div>
							{#if t.status === 'active'}
								<div class="cup-row-foot">Ends in {fmtCountdown(t.endTs)}</div>
							{:else if t.status === 'pending'}
								<div class="cup-row-foot">Open — waiting for fill</div>
							{:else}
								<div class="cup-row-foot">Settled · {new Date(t.createdAt * 1000).toLocaleDateString()}</div>
							{/if}
						</button>
					{:else}
						<div class="placeholder small">No competitions in this view.</div>
					{/each}
				</div>

				{#if selected}
					<div class="cup-detail">
						<div class="cup-detail-head">
							<div>
								<span class="cup-tag {selected.status}">{statusLabel(selected.status)}</span>
								<h3>{selected.name}</h3>
								<a
									class="creator-chip"
									href={`/profile?address=${selected.creator}`}
									title={selected.creator}
								>
									<span class="cc-label">CREATED BY</span>
									<span class="cc-avatar">
										{#if profileFor(selected.creator)?.avatarUrl}
											<img src={profileFor(selected.creator)!.avatarUrl!} alt="" />
										{:else}
											<span class="cc-fallback">{avatarInitial(selected.creator)}</span>
										{/if}
									</span>
									<span class="cc-name">{displayName(selected.creator)}</span>
								</a>
							</div>
							<span class="cup-status {selected.status}">
								{statusLabel(selected.status)}
							</span>
						</div>

						<div class="prize-hero {selected.status}">
							<div class="ph-coins" aria-hidden="true">
								<span class="coin c1">◎</span>
								<span class="coin c2">◎</span>
								<span class="coin c3">◎</span>
							</div>
							<div class="ph-body">
								<span class="ph-label">{selected.status === 'pending' ? 'TARGET PRIZE POOL' : 'PRIZE POOL'}</span>
								<div class="ph-amount">
									<strong>{fmtSol(competitionTotalPoolSol(selected))}</strong>
									<span class="ph-unit">SOL</span>
								</div>
								{#if selected.status === 'pending'}
									<div class="ph-sub">
										<span class="ph-collected">{fmtSol(selected.prizePoolSol)} SOL</span>
										collected of {fmtSol(selected.targetSol)} SOL target
									</div>
								{:else if selected.status === 'active'}
									<div class="ph-sub">
										Locked in vault · paying out 50 / 30 / 15 / 5 (treasury) on settle
									</div>
								{:else}
									<div class="ph-sub">Distributed on-chain · cup settled</div>
								{/if}
							</div>
						</div>

						<div class="cup-stats">
							<div>
								<span>ENTRY</span>
								<strong>{fmtSol(selected.entryTicketSol, 3)} SOL</strong>
							</div>
							<div>
								<span>PARTICIPANTS</span>
								<strong>{selected.participantCount} / {selected.maxParticipants}</strong>
							</div>
							<div>
								<span>{timeLabel.label}</span>
								<strong>{timeLabel.value}</strong>
							</div>
						</div>

						<div class="cup-progress">
							<div class="bar"><div class="fill" style="width: {progressPct(selected)}%"></div></div>
							<span>{progressPct(selected).toFixed(0)}% capacity</span>
						</div>

						<div class="payout-grid">
							{#each [0, 1, 2] as i (i)}
								{@const slot = selected.top[i]}
								{@const filled = slot && slot.participant !== PublicKey.default.toBase58()}
								<div class="payout">
									<div class="rk">#{i + 1}</div>
									<div class="rk-pct">{podiumPctFor(i as 0 | 1 | 2)}</div>
									<div class="rk-prize">
										{fmtSol(competitionTotalPoolSol(selected) * (i === 0 ? 0.5 : i === 1 ? 0.3 : 0.15), 3)} SOL
									</div>
									{#if filled}
										<a class="rk-chip" href={`/profile?address=${slot.participant}`} title={slot.participant}>
											<span class="rk-avatar">
												{#if profileFor(slot.participant)?.avatarUrl}
													<img src={profileFor(slot.participant)!.avatarUrl!} alt="" />
												{:else}
													<span class="rk-fallback">{avatarInitial(slot.participant)}</span>
												{/if}
											</span>
											<span class="rk-name">{displayName(slot.participant)}</span>
										</a>
										<div class="rk-bal">{fmtUsd(slot.balanceUsd)} bal</div>
									{:else}
										<div class="rk-addr empty">— pending —</div>
									{/if}
								</div>
							{/each}
						</div>

						<div class="cup-actions">
							{#if selected.status === 'pending'}
								{#if amInThis}
									<button class="primary" disabled>YOU'RE IN — TRADING UNLOCKS AT FILL</button>
								{:else if alreadyInOther}
									<button class="primary" disabled>ALREADY IN ANOTHER CUP</button>
								{:else}
									<button
										class="primary"
										disabled={busy || !wallet.connected || !isCompetitionJoinable(selected)}
										on:click={() => selected && handleJoin(selected)}
									>
										{wallet.connected
											? `JOIN — PAY ${fmtSol(selected.entryTicketSol, 3)} SOL`
											: 'CONNECT WALLET TO JOIN'}
									</button>
								{/if}
							{:else if selected.status === 'active'}
								{#if amInThis}
									<button class="primary" on:click={() => goto('/terminal')}>OPEN TRADING TERMINAL</button>
								{:else}
									<button class="primary" disabled>CUP IS LIVE — JOINS CLOSED</button>
								{/if}
								<button class="secondary" disabled={busy} on:click={() => selected && handleReportTop3(selected)}>
									REFRESH ON-CHAIN PODIUM
								</button>
								{#if canSettle}
									<button class="secondary" disabled={busy} on:click={() => selected && handleSettle(selected)}>
										SETTLE NOW
									</button>
								{/if}
							{:else}
								{#if amInThis}
									<button class="primary" disabled={busy} on:click={() => selected && handleClaimExit(selected)}>
										CLAIM EXIT
									</button>
								{/if}
								<span class="settled-note">Rewards distributed on-chain · 50 / 30 / 15 / 5 (treasury).</span>
							{/if}
							<button class="ghost" on:click={refresh} disabled={busy || loading}>REFRESH</button>
						</div>

						<div class="participants-block">
							<div class="pb-head">
								<strong>Live ranking</strong>
								<span class="muted">
									{participantsLoading ? 'loading…' : `${participants.length} entered`}
								</span>
								{#if participants.length > 0}
									<button class="ghost xs" on:click={() => (participantsModalOpen = true)}>
										VIEW ALL ({participants.length})
									</button>
								{/if}
							</div>
							{#if participants.length === 0 && !participantsLoading}
								<div class="placeholder small">No participants yet.</div>
							{:else}
								<div class="ranking-head">
									<span>#</span>
									<span>TRADER</span>
									<span>BALANCE</span>
									<span>CUP PNL</span>
									<span>TRADES</span>
								</div>
								<div class="ranking">
									{#each rankedParticipants.slice(0, 10) as p, i (p.pubkey)}
										<a
											class="rank-row"
											class:me={wallet.publicKey && p.owner === wallet.publicKey.toBase58()}
											href={`/profile?address=${p.owner}`}
											title={p.owner}
										>
											<span class="rank-idx">#{i + 1}</span>
											<span class="rank-trader">
												<span class="rank-avatar">
													{#if profileFor(p.owner)?.avatarUrl}
														<img src={profileFor(p.owner)!.avatarUrl!} alt="" />
													{:else}
														<span class="rank-fallback">{avatarInitial(p.owner)}</span>
													{/if}
												</span>
												<span class="rank-name">{displayName(p.owner)}</span>
											</span>
											<span class="rank-bal">
												<strong>{fmtUsd(p.totalUsd)}</strong>
												{#if p.lockedUsd > 0}
													<small>· {fmtUsd(p.lockedUsd)} locked</small>
												{/if}
											</span>
											<span class="rank-pnl" class:up={p.realizedPnl > 0} class:down={p.realizedPnl < 0}>
												{p.closedTrades > 0 ? fmtPnl(p.realizedPnl) : '—'}
											</span>
											<span class="rank-trades">
												{#if p.closedTrades > 0}
													{p.closedTrades} · {(p.winRate * 100).toFixed(0)}% W
												{:else}
													—
												{/if}
											</span>
										</a>
									{/each}
								</div>
							{/if}
						</div>

						<div class="comp-trades-block">
							<div class="pb-head">
								<strong>Recent trades</strong>
								<span class="muted">
									{compTradesLoading ? 'loading…' : `${compTrades.length} closed`}
								</span>
								{#if compTrades.length > 5}
									<button class="ghost xs" on:click={() => (tradesModalOpen = true)}>
										VIEW ALL ({compTrades.length})
									</button>
								{/if}
							</div>
							{#if compTrades.length === 0 && !compTradesLoading}
								<div class="placeholder small">No closed trades in this cup yet.</div>
							{:else}
								<div class="trade-feed">
									{#each compTrades.slice(0, 8) as t (t.position_key)}
										{@const pnl = Number(t.realized_pnl ?? t.pnl ?? 0)}
										<a class="trade-row" href={`/profile?address=${t.wallet_address}`} title={t.wallet_address}>
											<span class="tr-trader">
												<span class="tr-avatar">
													{#if t.avatar_url}
														<img src={t.avatar_url} alt="" />
													{:else}
														<span class="tr-fallback">{(t.username ?? t.wallet_address ?? '?')[0]?.toUpperCase()}</span>
													{/if}
												</span>
												<span class="tr-name">
													{t.username ? `@${t.username}` : shortAddr(t.wallet_address)}
												</span>
											</span>
											<span class="tr-market">{t.market_title ?? t.market_id ?? '—'}</span>
											<span class="tr-side {t.position_type ?? ''}">
												{(t.position_type ?? '').toUpperCase()}
												{#if t.trade_mode === 'perp' && t.leverage}
													· {t.leverage}x
												{/if}
											</span>
											<span class="tr-pnl" class:up={pnl > 0} class:down={pnl < 0}>{fmtPnl(pnl)}</span>
											<span class="tr-time">{timeAgo(t.closed_at ?? t.opened_at)}</span>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				{/if}
			</div>

			{#if tradesModalOpen && selected}
				<div
					class="modal-backdrop"
					role="presentation"
					on:click={() => (tradesModalOpen = false)}
					on:keydown={(e) => e.key === 'Escape' && (tradesModalOpen = false)}
				>
					<div
						class="modal"
						role="dialog"
						aria-modal="true"
						aria-label="Cup trades"
						tabindex="-1"
						on:click|stopPropagation
						on:keydown|stopPropagation
					>
						<div class="modal-head">
							<div>
								<strong>Trades — {selected.name}</strong>
								<span class="muted">{compTrades.length} closed</span>
							</div>
							<button class="ghost xs" on:click={() => (tradesModalOpen = false)}>CLOSE</button>
						</div>
						<div class="modal-body">
							{#if compTrades.length === 0}
								<div class="placeholder small">No trades yet.</div>
							{:else}
								<div class="trade-feed">
									{#each compTrades as t (t.position_key)}
										{@const pnl = Number(t.realized_pnl ?? t.pnl ?? 0)}
										<a class="trade-row" href={`/profile?address=${t.wallet_address}`} title={t.wallet_address}>
											<span class="tr-trader">
												<span class="tr-avatar">
													{#if t.avatar_url}
														<img src={t.avatar_url} alt="" />
													{:else}
														<span class="tr-fallback">{(t.username ?? t.wallet_address ?? '?')[0]?.toUpperCase()}</span>
													{/if}
												</span>
												<span class="tr-name">
													{t.username ? `@${t.username}` : shortAddr(t.wallet_address)}
												</span>
											</span>
											<span class="tr-market">{t.market_title ?? t.market_id ?? '—'}</span>
											<span class="tr-side {t.position_type ?? ''}">
												{(t.position_type ?? '').toUpperCase()}
												{#if t.trade_mode === 'perp' && t.leverage}
													· {t.leverage}x
												{/if}
											</span>
											<span class="tr-pnl" class:up={pnl > 0} class:down={pnl < 0}>{fmtPnl(pnl)}</span>
											<span class="tr-time">{timeAgo(t.closed_at ?? t.opened_at)}</span>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}

			{#if participantsModalOpen && selected}
				<div
					class="modal-backdrop"
					role="presentation"
					on:click={() => (participantsModalOpen = false)}
					on:keydown={(e) => e.key === 'Escape' && (participantsModalOpen = false)}
				>
					<div
						class="modal"
						role="dialog"
						aria-modal="true"
						aria-label="Participants"
						tabindex="-1"
						on:click|stopPropagation
						on:keydown|stopPropagation
					>
						<div class="modal-head">
							<div>
								<strong>Participants — {selected.name}</strong>
								<span class="muted">{participants.length} entered</span>
							</div>
							<button class="ghost xs" on:click={() => (participantsModalOpen = false)}>CLOSE</button>
						</div>
						<div class="modal-body">
							{#if participants.length === 0}
								<div class="placeholder small">No participants yet.</div>
							{:else}
								<div class="ranking-head">
									<span>#</span>
									<span>TRADER</span>
									<span>BALANCE</span>
									<span>CUP PNL</span>
									<span>TRADES</span>
								</div>
								<div class="ranking modal-ranking">
									{#each rankedParticipants as p, i (p.pubkey)}
										<a
											class="rank-row"
											class:me={wallet.publicKey && p.owner === wallet.publicKey.toBase58()}
											href={`/profile?address=${p.owner}`}
											title={p.owner}
										>
											<span class="rank-idx">#{i + 1}</span>
											<span class="rank-trader">
												<span class="rank-avatar">
													{#if profileFor(p.owner)?.avatarUrl}
														<img src={profileFor(p.owner)!.avatarUrl!} alt="" />
													{:else}
														<span class="rank-fallback">{avatarInitial(p.owner)}</span>
													{/if}
												</span>
												<span class="rank-name">{displayName(p.owner)}</span>
											</span>
											<span class="rank-bal">
												<strong>{fmtUsd(p.totalUsd)}</strong>
												{#if p.lockedUsd > 0}
													<small>· {fmtUsd(p.lockedUsd)} locked</small>
												{/if}
											</span>
											<span class="rank-pnl" class:up={p.realizedPnl > 0} class:down={p.realizedPnl < 0}>
												{p.closedTrades > 0 ? fmtPnl(p.realizedPnl) : '—'}
											</span>
											<span class="rank-trades">
												{#if p.closedTrades > 0}
													{p.closedTrades} · {(p.winRate * 100).toFixed(0)}% W
												{:else}
													—
												{/if}
											</span>
										</a>
									{/each}
								</div>
							{/if}
						</div>
					</div>
				</div>
			{/if}
		{/if}
	</section>

	<section class="block">
		<div class="block-head">
			<h2>How it works</h2>
		</div>
		<div class="how-grid">
			<div class="how">
				<span class="how-step">01</span>
				<strong>Create or join</strong>
				<p>Anyone can spin up a cup with an entry ticket and a SOL target. Joining locks the ticket into the program's vault PDA.</p>
			</div>
			<div class="how">
				<span class="how-step">02</span>
				<strong>Auto-start</strong>
				<p>Once the target is met, the cup flips to <em>Active</em> on-chain and the trade window opens for its duration.</p>
			</div>
			<div class="how">
				<span class="how-step">03</span>
				<strong>Trade with 100k</strong>
				<p>Each participant gets a fresh 100k USD paper balance scoped to the comp. Spot, perps, and prediction markets all count.</p>
			</div>
			<div class="how">
				<span class="how-step">04</span>
				<strong>Settle &amp; payout</strong>
				<p>After the timer, anyone can call <code>settle_competition</code>. The vault pays 50 / 30 / 15 % to the top 3 and 5 % to treasury.</p>
			</div>
		</div>
	</section>
</main>

<style>
	.comp-page {
		background: #000;
		color: #e8e8e8;
		min-height: 100vh;
		padding: 32px 18px 80px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.back-btn {
		display: inline-flex; align-items: center; gap: 6px;
		background: rgba(255, 255, 255, 0.04); border: 1px solid #2a2a2a;
		color: #ccc; padding: 7px 12px; border-radius: 999px;
		font-family: 'Courier New', monospace; font-size: 10px; font-weight: 800;
		letter-spacing: 0.1em; cursor: pointer; transition: all 0.15s;
		margin-bottom: 18px;
	}
	.back-btn:hover { color: #ff5a00; border-color: rgba(255, 90, 0, 0.5); }

	.hero {
		padding: 28px 28px 36px;
		background:
			radial-gradient(circle at 0% 0%, rgba(255, 90, 0, 0.18), transparent 50%),
			radial-gradient(circle at 100% 0%, rgba(255, 102, 204, 0.12), transparent 50%),
			#0a0a0a;
		border: 1px solid #222;
		border-radius: 18px;
	}
	.hero h1 {
		margin: 14px 0 8px; color: #fff;
		font-size: clamp(34px, 5vw, 54px); font-weight: 900;
		letter-spacing: -0.02em; line-height: 1.05;
	}
	.hero h1 .grad {
		background: linear-gradient(90deg, #ff5a00, #ffb733, #ff66cc);
		-webkit-background-clip: text; background-clip: text; color: transparent;
	}
	.hero-sub { color: #aaa; max-width: 720px; font-size: 14px; line-height: 1.6; margin: 0 0 22px; }
	.hero-stats {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
		max-width: 720px;
	}
	.hero-stats div {
		padding: 12px 14px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid #222;
		border-radius: 12px;
	}
	.hero-stats strong {
		display: block; color: #ff5a00; font-family: 'Courier New', monospace;
		font-size: 22px; font-weight: 900;
	}
	.hero-stats span {
		color: #777; font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 800; letter-spacing: 0.14em;
	}

	.active-banner {
		margin-top: 18px;
		display: flex; gap: 16px; flex-wrap: wrap; align-items: center; justify-content: space-between;
		padding: 14px 18px;
		background: linear-gradient(180deg, rgba(0, 255, 102, 0.06), rgba(255, 255, 255, 0.01));
		border: 1px solid rgba(0, 255, 102, 0.35);
		border-radius: 14px;
	}
	.active-banner.pending { border-color: rgba(255, 90, 0, 0.4); background: linear-gradient(180deg, rgba(255, 90, 0, 0.05), rgba(255, 255, 255, 0.01)); }
	.active-banner.settled { border-color: rgba(255, 102, 204, 0.4); background: linear-gradient(180deg, rgba(255, 102, 204, 0.05), rgba(255, 255, 255, 0.01)); }
	.ab-left { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.ab-tag { color: #00ff66; font-family: 'Courier New', monospace; font-size: 10px; font-weight: 900; letter-spacing: 0.18em; }
	.active-banner.pending .ab-tag { color: #ff5a00; }
	.active-banner.settled .ab-tag { color: #ff66cc; }
	.ab-name { color: #fff; font-size: 18px; font-weight: 800; }
	.ab-meta { color: #aaa; font-size: 12px; font-family: 'Courier New', monospace; }
	.ab-right { display: flex; gap: 8px; flex-wrap: wrap; }

	.block { margin-top: 30px; }
	.block-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
	.block-head h2 { color: #fff; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
	.block-head-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }

	.seg {
		display: inline-flex; gap: 2px;
		padding: 3px;
		background: #0a0a0a; border: 1px solid #222; border-radius: 999px;
	}
	.seg button {
		background: transparent; border: none; cursor: pointer;
		color: #888; padding: 5px 11px; border-radius: 999px;
		font-family: 'Courier New', monospace; font-size: 10px; font-weight: 900; letter-spacing: 0.12em;
	}
	.seg button.on { color: #000; background: #ff5a00; }

	.cup-grid {
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		gap: 16px;
	}
	.cup-list { display: flex; flex-direction: column; gap: 8px; max-height: 720px; overflow-y: auto; padding-right: 4px; }
	.cup-row {
		display: flex; flex-direction: column; gap: 6px; text-align: left;
		padding: 14px;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 12px;
		cursor: pointer;
		font-family: inherit; color: inherit;
		transition: all 0.15s;
	}
	.cup-row:hover { border-color: rgba(255, 90, 0, 0.4); }
	.cup-row.active { border-color: #ff5a00; background: rgba(255, 90, 0, 0.06); }
	.cup-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.cup-row-title { color: #fff; font-weight: 700; font-size: 13px; word-break: break-word; }
	.cup-row-meta {
		font-family: 'Courier New', monospace;
		color: #888; font-size: 11px;
		display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
	}
	.cup-row-meta .prize { color: #00ff66; font-weight: 900; }
	.cup-row-meta .dot-sep { color: #444; }
	.cup-row-foot { color: #666; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.04em; }

	.cup-tag {
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 900; letter-spacing: 0.16em;
		padding: 3px 7px; border-radius: 4px;
		background: rgba(255, 90, 0, 0.12); color: #ff5a00;
		border: 1px solid rgba(255, 90, 0, 0.4);
	}
	.cup-tag.active { background: rgba(0, 255, 102, 0.10); color: #00ff66; border-color: rgba(0, 255, 102, 0.35); }
	.cup-tag.settled { background: rgba(255, 102, 204, 0.10); color: #ff66cc; border-color: rgba(255, 102, 204, 0.35); }

	.cup-detail {
		padding: 22px;
		background: linear-gradient(180deg, rgba(255, 90, 0, 0.05), rgba(255, 255, 255, 0.01));
		border: 1px solid rgba(255, 90, 0, 0.2);
		border-radius: 14px;
		display: flex; flex-direction: column; gap: 16px;
	}
	.cup-detail-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
	.cup-detail-head h3 { color: #fff; font-size: 22px; font-weight: 800; margin: 8px 0 0; letter-spacing: -0.01em; }
	.cup-status {
		font-family: 'Courier New', monospace;
		font-size: 10px; font-weight: 900; letter-spacing: 0.16em;
		padding: 4px 10px; border-radius: 999px;
	}
	.cup-status.active { background: rgba(0, 255, 102, 0.10); color: #00ff66; border: 1px solid rgba(0, 255, 102, 0.35); }
	.cup-status.pending { background: rgba(255, 90, 0, 0.10); color: #ff5a00; border: 1px solid rgba(255, 90, 0, 0.35); }
	.cup-status.settled { background: rgba(255, 102, 204, 0.10); color: #ff66cc; border: 1px solid rgba(255, 102, 204, 0.35); }
	.cup-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }

	.prize-hero {
		position: relative; overflow: hidden;
		display: flex; gap: 18px; align-items: center;
		padding: 22px 26px;
		border-radius: 16px;
		background:
			radial-gradient(circle at 0% 0%, rgba(0, 255, 102, 0.18), transparent 55%),
			radial-gradient(circle at 100% 100%, rgba(255, 215, 0, 0.14), transparent 55%),
			linear-gradient(135deg, #0c1a10, #0a0a0a);
		border: 1px solid rgba(0, 255, 102, 0.45);
		box-shadow: 0 0 24px rgba(0, 255, 102, 0.08), inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}
	.prize-hero.pending {
		background:
			radial-gradient(circle at 0% 0%, rgba(255, 90, 0, 0.18), transparent 55%),
			radial-gradient(circle at 100% 100%, rgba(255, 102, 204, 0.12), transparent 55%),
			linear-gradient(135deg, #1a0e07, #0a0a0a);
		border-color: rgba(255, 90, 0, 0.5);
		box-shadow: 0 0 24px rgba(255, 90, 0, 0.10), inset 0 1px 0 rgba(255, 255, 255, 0.04);
	}
	.prize-hero.settled {
		background:
			radial-gradient(circle at 0% 0%, rgba(255, 102, 204, 0.16), transparent 55%),
			linear-gradient(135deg, #1a0a18, #0a0a0a);
		border-color: rgba(255, 102, 204, 0.45);
	}
	.ph-coins {
		display: flex; flex-direction: column; gap: 2px; line-height: 1;
		font-size: 18px; color: rgba(0, 255, 102, 0.55);
	}
	.prize-hero.pending .ph-coins { color: rgba(255, 90, 0, 0.6); }
	.prize-hero.settled .ph-coins { color: rgba(255, 102, 204, 0.6); }
	.ph-coins .coin { display: inline-block; }
	.ph-coins .c1 { font-size: 26px; }
	.ph-coins .c2 { font-size: 20px; opacity: 0.75; }
	.ph-coins .c3 { font-size: 14px; opacity: 0.5; }
	.ph-body { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
	.ph-label {
		color: #00ff66; font-family: 'Courier New', monospace;
		font-size: 11px; font-weight: 900; letter-spacing: 0.22em;
	}
	.prize-hero.pending .ph-label { color: #ff5a00; }
	.prize-hero.settled .ph-label { color: #ff66cc; }
	.ph-amount { display: flex; align-items: baseline; gap: 8px; line-height: 1; }
	.ph-amount strong {
		color: #fff;
		font-family: 'Courier New', monospace;
		font-size: clamp(40px, 6vw, 60px);
		font-weight: 900;
		letter-spacing: -0.02em;
		background: linear-gradient(90deg, #ffd24a, #ffb733, #00ff66);
		-webkit-background-clip: text; background-clip: text; color: transparent;
		text-shadow: 0 0 24px rgba(0, 255, 102, 0.25);
	}
	.prize-hero.pending .ph-amount strong {
		background: linear-gradient(90deg, #ffd24a, #ff5a00, #ff66cc);
		-webkit-background-clip: text; background-clip: text; color: transparent;
		text-shadow: 0 0 24px rgba(255, 90, 0, 0.3);
	}
	.ph-unit {
		color: #00ff66; font-family: 'Courier New', monospace;
		font-size: 22px; font-weight: 900; letter-spacing: 0.06em;
	}
	.prize-hero.pending .ph-unit { color: #ff5a00; }
	.prize-hero.settled .ph-unit { color: #ff66cc; }
	.ph-sub {
		color: #aaa; font-family: 'Courier New', monospace;
		font-size: 12px;
	}
	.ph-collected { color: #00ff66; font-weight: 900; }
	.prize-hero.pending .ph-collected { color: #ff5a00; }
	.cup-stats div {
		padding: 12px;
		background: rgba(255, 255, 255, 0.03); border: 1px solid #1f1f1f; border-radius: 10px;
		display: flex; flex-direction: column; gap: 4px;
	}
	.cup-stats span { color: #777; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.14em; font-weight: 800; }
	.cup-stats strong { color: #fff; font-family: 'Courier New', monospace; font-size: 16px; font-weight: 900; }
	.cup-progress { display: flex; flex-direction: column; gap: 6px; }
	.cup-progress .bar { height: 6px; border-radius: 999px; background: rgba(255, 255, 255, 0.05); overflow: hidden; }
	.cup-progress .fill { height: 100%; background: linear-gradient(90deg, #ff5a00, #ffb733); }
	.cup-progress span { color: #777; font-family: 'Courier New', monospace; font-size: 11px; }

	.payout-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
	.payout {
		padding: 12px;
		background: rgba(255, 255, 255, 0.02); border: 1px solid #1f1f1f; border-radius: 10px;
		display: flex; flex-direction: column; gap: 2px;
	}
	.payout .rk { color: #ff5a00; font-family: 'Courier New', monospace; font-size: 12px; font-weight: 900; letter-spacing: 0.06em; }
	.payout .rk-pct { color: #aaa; font-family: 'Courier New', monospace; font-size: 11px; }
	.payout .rk-prize { color: #00ff66; font-family: 'Courier New', monospace; font-size: 14px; font-weight: 900; }
	.payout .rk-addr { color: #ddd; font-family: 'Courier New', monospace; font-size: 11px; margin-top: 4px; }
	.payout .rk-addr.empty { color: #555; font-style: italic; }
	.payout .rk-bal { color: #888; font-family: 'Courier New', monospace; font-size: 10px; }

	.cup-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
	.primary, .secondary, .ghost {
		padding: 12px 20px;
		border-radius: 10px; cursor: pointer;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 900; letter-spacing: 0.12em;
		transition: all 0.15s;
		border: 1px solid transparent;
	}
	.primary.sm { padding: 8px 14px; font-size: 10px; }
	.primary { background: #ff5a00; color: #000; border-color: #ff5a00; }
	.primary:hover:not(:disabled) { background: #ffb733; box-shadow: 0 6px 20px rgba(255, 90, 0, 0.35); }
	.primary:disabled { opacity: 0.55; cursor: not-allowed; }
	.secondary { background: transparent; color: #ccc; border-color: #2a2a2a; }
	.secondary:hover:not(:disabled) { color: #fff; border-color: #ff5a00; }
	.secondary:disabled { opacity: 0.55; cursor: not-allowed; }
	.ghost { background: transparent; color: #888; border-color: #1f1f1f; }
	.ghost:hover:not(:disabled) { color: #ccc; border-color: #2a2a2a; }
	.ghost:disabled { opacity: 0.5; cursor: not-allowed; }
	.settled-note { color: #888; font-family: 'Courier New', monospace; font-size: 11px; }

	.create-form {
		padding: 16px;
		background: rgba(255, 90, 0, 0.04);
		border: 1px solid rgba(255, 90, 0, 0.25);
		border-radius: 12px;
		margin-bottom: 14px;
		display: flex; flex-direction: column; gap: 12px;
	}
	.cf-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
	.cf-head strong { color: #fff; font-size: 14px; font-weight: 800; }
	.cf-head .muted { color: #777; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.06em; }
	.cf-grid { display: grid; grid-template-columns: 1.4fr 1fr 1fr 1fr; gap: 10px; }
	.field { display: flex; flex-direction: column; gap: 5px; }
	.field span { color: #888; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.08em; }
	.field input {
		background: #000; color: #fff;
		border: 1px solid #2a2a2a; border-radius: 8px;
		padding: 9px 11px; font-family: 'Courier New', monospace; font-size: 12px;
		outline: none;
	}
	.field input:focus { border-color: #ff5a00; }
	.field small { color: #666; font-family: 'Courier New', monospace; font-size: 10px; }
	.cf-actions { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
	.cf-msg { color: #ccc; font-family: 'Courier New', monospace; font-size: 11px; }
	.cf-hint { color: #777; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.04em; }

	.banner {
		padding: 10px 14px; margin-bottom: 14px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid #2a2a2a; border-radius: 10px;
		color: #ddd; font-family: 'Courier New', monospace; font-size: 12px;
	}

	.placeholder { padding: 28px; text-align: center; color: #777; font-family: 'Courier New', monospace; font-size: 13px; background: #0a0a0a; border: 1px dashed #2a2a2a; border-radius: 12px; }
	.placeholder.small { padding: 14px; font-size: 11px; }

	.participants-block { display: flex; flex-direction: column; gap: 8px; }
	.comp-trades-block { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }

	.ranking-head {
		display: grid;
		grid-template-columns: 36px minmax(0, 1.4fr) minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 0.9fr);
		gap: 8px;
		padding: 6px 10px;
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 900; letter-spacing: 0.16em;
		color: #777;
		border-bottom: 1px solid #1a1a1a;
	}
	.ranking-head span:nth-child(3),
	.ranking-head span:nth-child(4),
	.ranking-head span:nth-child(5) { text-align: right; }

	.rank-pnl { font-family: 'Courier New', monospace; font-weight: 900; text-align: right; color: #888; }
	.rank-pnl.up { color: #00ff66; }
	.rank-pnl.down { color: #ff4d4d; }
	.rank-trades { font-family: 'Courier New', monospace; color: #888; text-align: right; font-size: 11px; }
	.rank-bal { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
	.rank-bal strong { color: #00ff66; font-weight: 900; }
	.rank-bal small { color: #777; font-size: 9px; }

	.trade-feed { display: flex; flex-direction: column; }
	.trade-row {
		display: grid;
		grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 0.7fr) minmax(0, 0.7fr) minmax(0, 0.6fr);
		gap: 8px;
		padding: 8px 10px;
		font-family: 'Courier New', monospace; font-size: 11px;
		border-bottom: 1px solid #1a1a1a;
		text-decoration: none; color: inherit;
		align-items: center;
		transition: background 0.12s;
	}
	.trade-row:hover { background: rgba(255, 90, 0, 0.04); }
	.tr-trader { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
	.tr-avatar {
		width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
		background: #1a1a1a; flex-shrink: 0;
		display: inline-flex; align-items: center; justify-content: center;
		border: 1px solid #2a2a2a;
	}
	.tr-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.tr-fallback { color: #ff5a00; font-size: 11px; font-weight: 900; }
	.tr-name { color: #ddd; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tr-market { color: #ccc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.tr-side {
		font-weight: 900; letter-spacing: 0.1em;
		padding: 2px 6px; border-radius: 4px;
		text-align: center; font-size: 10px;
		background: rgba(255, 255, 255, 0.04); color: #aaa;
		justify-self: start;
	}
	.tr-side.long { background: rgba(0, 255, 102, 0.10); color: #00ff66; }
	.tr-side.short { background: rgba(255, 77, 77, 0.10); color: #ff4d4d; }
	.tr-side.yes { background: rgba(0, 255, 102, 0.10); color: #00ff66; }
	.tr-side.no { background: rgba(255, 77, 77, 0.10); color: #ff4d4d; }
	.tr-pnl { font-weight: 900; text-align: right; color: #888; }
	.tr-pnl.up { color: #00ff66; }
	.tr-pnl.down { color: #ff4d4d; }
	.tr-time { color: #666; text-align: right; font-size: 10px; }
	.pb-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
	.pb-head strong { color: #fff; font-size: 13px; font-weight: 800; }
	.pb-head .muted { color: #777; font-family: 'Courier New', monospace; font-size: 11px; }
	.ranking { display: flex; flex-direction: column; }
	.rank-row {
		display: grid;
		grid-template-columns: 36px minmax(0, 1.4fr) minmax(0, 1.1fr) minmax(0, 0.9fr) minmax(0, 0.9fr);
		gap: 8px;
		padding: 8px 10px;
		font-family: 'Courier New', monospace; font-size: 11px;
		border-bottom: 1px solid #1a1a1a;
		align-items: center;
		text-decoration: none; color: inherit;
		cursor: pointer;
		transition: background 0.12s;
	}
	.rank-row:hover { background: rgba(255, 90, 0, 0.04); }
	.rank-row.me { background: rgba(255, 90, 0, 0.08); border-radius: 6px; }
	.rank-idx { color: #ff5a00; font-weight: 900; }
	.rank-trader { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
	.rank-avatar {
		width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
		background: #1a1a1a; flex-shrink: 0;
		display: inline-flex; align-items: center; justify-content: center;
		border: 1px solid #2a2a2a;
	}
	.rank-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.rank-fallback {
		color: #ff5a00; font-family: 'Courier New', monospace;
		font-size: 11px; font-weight: 900;
	}
	.rank-name {
		color: #ddd; font-weight: 700;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.rank-row:hover .rank-name { color: #fff; }
	.rank-bal { color: #00ff66; font-weight: 900; text-align: right; }
	.rank-locked { color: #777; text-align: right; }

	.creator-chip {
		display: inline-flex; align-items: center; gap: 8px;
		margin-top: 8px; padding: 5px 10px 5px 6px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid #1f1f1f;
		border-radius: 999px;
		text-decoration: none; color: inherit;
		font-family: 'Courier New', monospace; font-size: 11px;
		transition: all 0.15s;
	}
	.creator-chip:hover { border-color: rgba(255, 90, 0, 0.4); background: rgba(255, 90, 0, 0.05); }
	.cc-label { color: #777; font-size: 9px; font-weight: 900; letter-spacing: 0.14em; }
	.cc-avatar {
		width: 22px; height: 22px; border-radius: 50%; overflow: hidden;
		background: #1a1a1a;
		display: inline-flex; align-items: center; justify-content: center;
		border: 1px solid #2a2a2a;
	}
	.cc-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.cc-fallback { color: #ff5a00; font-size: 11px; font-weight: 900; }
	.cc-name { color: #ddd; font-weight: 700; }
	.creator-chip:hover .cc-name { color: #fff; }

	.rk-chip {
		display: inline-flex; align-items: center; gap: 6px;
		margin-top: 4px;
		text-decoration: none; color: inherit;
		font-family: 'Courier New', monospace; font-size: 11px;
	}
	.rk-avatar {
		width: 20px; height: 20px; border-radius: 50%; overflow: hidden;
		background: #1a1a1a;
		display: inline-flex; align-items: center; justify-content: center;
		border: 1px solid #2a2a2a;
	}
	.rk-avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.rk-fallback { color: #ff5a00; font-size: 10px; font-weight: 900; }
	.rk-name {
		color: #ddd; font-weight: 700;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		max-width: 110px;
	}
	.rk-chip:hover .rk-name { color: #fff; }

	.ghost.xs {
		padding: 4px 9px; font-size: 9px; letter-spacing: 0.12em;
		border-radius: 999px;
	}

	.modal-backdrop {
		position: fixed; inset: 0; z-index: 1000;
		background: rgba(0, 0, 0, 0.7); backdrop-filter: blur(4px);
		display: flex; align-items: center; justify-content: center;
		padding: 24px;
	}
	.modal {
		width: 100%; max-width: 560px;
		max-height: 85vh; overflow: hidden;
		background: #0a0a0a;
		border: 1px solid rgba(255, 90, 0, 0.3);
		border-radius: 14px;
		display: flex; flex-direction: column;
	}
	.modal-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 14px 18px;
		border-bottom: 1px solid #1a1a1a;
	}
	.modal-head strong { color: #fff; font-size: 14px; font-weight: 800; margin-right: 10px; }
	.modal-head .muted { color: #777; font-family: 'Courier New', monospace; font-size: 11px; }
	.modal-body { overflow-y: auto; padding: 8px 14px 14px; }
	.modal-ranking .rank-row { padding: 9px 8px; }

	.how-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
	.how {
		padding: 16px;
		background: #0a0a0a; border: 1px solid #222; border-radius: 12px;
		display: flex; flex-direction: column; gap: 6px;
	}
	.how-step { color: #ff5a00; font-family: 'Courier New', monospace; font-size: 10px; letter-spacing: 0.16em; font-weight: 900; }
	.how strong { color: #fff; font-size: 14px; font-weight: 800; }
	.how p { color: #999; font-size: 12px; line-height: 1.55; margin: 0; }
	.how code { background: #000; border: 1px solid #222; padding: 1px 5px; border-radius: 4px; color: #ff5a00; font-size: 11px; }

	@media (max-width: 1080px) {
		.cup-grid { grid-template-columns: 1fr; }
		.cf-grid { grid-template-columns: 1fr 1fr; }
		.how-grid { grid-template-columns: 1fr 1fr; }
		.cup-stats { grid-template-columns: repeat(2, 1fr); }
		.hero-stats { grid-template-columns: repeat(2, 1fr); }
	}
	@media (max-width: 700px) {
		.cf-grid { grid-template-columns: 1fr; }
		.how-grid { grid-template-columns: 1fr; }
		.payout-grid { grid-template-columns: 1fr; }
		.rank-row { grid-template-columns: 32px 1fr 80px 70px; }
		.rank-locked { display: none; }
		.rank-trades { display: none; }
		.ranking-head { grid-template-columns: 32px 1fr 80px 70px; }
		.ranking-head span:nth-child(5) { display: none; }
		.trade-row { grid-template-columns: 1fr 1fr 60px 70px; }
		.tr-time { display: none; }
	}
</style>
