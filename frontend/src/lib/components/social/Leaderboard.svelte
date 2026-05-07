<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { walletStore } from '$lib/wallet/stores';
	import {
		fetchLeaderboard,
		formatPnlBadge,
		type LeaderboardEntry
	} from '$lib/social/leaderboard';
	import {
		resolveConnectedUser,
		fetchFollowing,
		toggleFollow,
		type ConnectedSocialUser
	} from '$lib/social/types';
	import {
		fetchAllCompetitions,
		competitionTotalPoolSol,
		fmtCountdown,
		type CompetitionView
	} from '$lib/competition';
	import { hashfoxClient } from '$lib/hashfoxClient';
	import { Connection, Keypair } from '@solana/web3.js';
	import { AnchorProvider, Program, type Idl } from '$lib/vendor/anchor';
	import { SOLANA_RPC } from '$lib/env';
	import hashfoxIdl from '$lib/idl/hashfox.json';

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

	let entries: LeaderboardEntry[] = [];
	let loading = true;
	let connectedUser: ConnectedSocialUser | null = null;
	let followingIds: Set<string> = new Set();
	let pendingFollow: Set<string> = new Set();
	let timeframe: 'all' | '30d' | '7d' = 'all';
	let search = '';

	let competitions: CompetitionView[] = [];
	let compsLoading = true;
	let nowMs = Date.now();
	const tickInterval = setInterval(() => (nowMs = Date.now()), 1000);
	onDestroy(() => clearInterval(tickInterval));

	$: liveComps = competitions.filter((c) => c.status === 'active');
	$: pendingComps = competitions.filter((c) => c.status === 'pending');
	$: visibleComps = (() => {
		const live = liveComps.slice().sort((a, b) => a.endTs - b.endTs);
		const pending = pendingComps.slice().sort((a, b) => b.createdAt - a.createdAt);
		return [...live, ...pending].slice(0, 4);
	})();
	$: totalPlayers = competitions.reduce((acc, c) => acc + c.participantCount, 0);
	$: totalPoolSol = competitions.reduce((acc, c) => acc + competitionTotalPoolSol(c), 0);

	function fmtPoolSol(v: number): string {
		if (!Number.isFinite(v) || v === 0) return '0 SOL';
		if (v >= 1000) return `${v.toFixed(0)} SOL`;
		if (v >= 100) return `${v.toFixed(1)} SOL`;
		return `${v.toFixed(2)} SOL`;
	}
	function fmtEntrySol(v: number): string {
		if (v <= 0) return 'FREE';
		if (v >= 1) return `${v.toFixed(2)} SOL`;
		return `${v.toFixed(3)} SOL`;
	}

	async function loadCompetitions() {
		compsLoading = true;
		try {
			const program = hashfoxClient.getProgram() ?? buildReadOnlyProgram();
			competitions = await fetchAllCompetitions(program);
		} catch (err) {
			console.warn('[Leaderboard] competitions load failed', err);
		} finally {
			compsLoading = false;
		}
	}

	async function loadAll() {
		loading = true;
		try {
			entries = await fetchLeaderboard();
		} catch (err) {
			console.warn('[Leaderboard] load failed', err);
		} finally {
			loading = false;
		}
	}

	let lastWallet: string | null = null;
	walletStore.subscribe(async (s) => {
		const addr = s.publicKey?.toBase58?.() ?? null;
		if (addr === lastWallet) return;
		lastWallet = addr;
		if (addr) {
			connectedUser = await resolveConnectedUser(addr, s.username, s.avatarUrl);
			// Now that the program is available, pull live competitions.
			loadCompetitions();
		} else {
			connectedUser = null;
		}
	});

	onMount(() => {
		loadAll();
		loadCompetitions();
	});

	$: if (connectedUser?.userId) {
		(async () => {
			followingIds = await fetchFollowing(connectedUser!.userId);
		})();
	} else {
		followingIds = new Set();
	}

	$: filteredEntries = (() => {
		const q = search.toLowerCase().trim();
		const list = !q
			? entries
			: entries.filter(
					(e) =>
						e.username.toLowerCase().includes(q) ||
						e.walletAddress.toLowerCase().includes(q)
				);
		// Re-rank within the filtered/sorted view so the badge stays correct
		return list.map((e, i) => ({ ...e, rank: i + 1 }));
	})();

	$: connectedRank = connectedUser
		? entries.find((e) => e.userId === connectedUser!.userId)?.rank ?? null
		: null;

	function shortAddr(a: string) {
		return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
	}

	function fmtMoney(v: number) {
		const sign = v >= 0 ? '+' : '-';
		const abs = Math.abs(v);
		if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
		if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
		return `${sign}$${abs.toFixed(2)}`;
	}

	function fmtVolume(v: number) {
		if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
		if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
		return `$${v.toFixed(0)}`;
	}

	function rankBadgeClass(rank: number): string {
		if (rank === 1) return 'gold';
		if (rank === 2) return 'silver';
		if (rank === 3) return 'bronze';
		return '';
	}

	function rankLabel(rank: number): string {
		return rank < 10 ? `0${rank}` : String(rank);
	}

	function gotoProfile(walletAddress: string) {
		if (!walletAddress) return;
		goto(`/profile?address=${walletAddress}`);
	}

	async function handleFollow(e: MouseEvent, target: LeaderboardEntry) {
		e.stopPropagation();
		if (!connectedUser?.userId || target.userId === connectedUser.userId) return;
		if (pendingFollow.has(target.userId)) return;
		const wasFollowing = followingIds.has(target.userId);

		const optimistic = new Set(followingIds);
		if (wasFollowing) optimistic.delete(target.userId);
		else optimistic.add(target.userId);
		followingIds = optimistic;
		pendingFollow = new Set(pendingFollow).add(target.userId);

		const res = await toggleFollow(connectedUser.userId, target.userId, !wasFollowing);
		if (!res.ok) {
			const reverted = new Set(followingIds);
			if (wasFollowing) reverted.add(target.userId);
			else reverted.delete(target.userId);
			followingIds = reverted;
		}
		const next = new Set(pendingFollow);
		next.delete(target.userId);
		pendingFollow = next;
	}

</script>

<section class="lb-section">
	<div class="lb-inner">
		<div class="lb-header">
			<div>
				<h2>Leaderboard</h2>
			</div>
			<div class="header-meta">
				{#if connectedRank}
					<div class="my-rank">
						<span class="my-rank-label">YOUR RANK</span>
						<span class="my-rank-value">#{connectedRank}</span>
					</div>
				{/if}
				<button class="refresh-btn" on:click={loadAll} disabled={loading}>
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4 4v6h6M20 20v-6h-6M5 14a8 8 0 0014 4M19 10a8 8 0 00-14-4" />
					</svg>
					{loading ? 'LOADING' : 'REFRESH'}
				</button>
			</div>
		</div>

		<div class="lb-grid">
			<!-- LEFT: leaderboard -->
			<div class="lb-left">
				<div class="lb-toolbar">
					<div class="search-wrap">
						<svg class="search-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
						</svg>
						<input
							type="text"
							placeholder="Search trader, wallet…"
							bind:value={search}
						/>
					</div>
					<div class="seg">
						<button class:on={timeframe === 'all'} on:click={() => (timeframe = 'all')}>ALL TIME</button>
						<button class:on={timeframe === '30d'} on:click={() => (timeframe = '30d')} title="Coming soon">30D</button>
						<button class:on={timeframe === '7d'} on:click={() => (timeframe = '7d')} title="Coming soon">7D</button>
					</div>
				</div>

				{#if loading}
					<div class="placeholder">Loading rankings…</div>
				{:else if filteredEntries.length === 0}
					<div class="placeholder">
						{search ? 'No traders match your search.' : 'No trades on HashFox yet — be the first.'}
					</div>
				{:else}
					<!-- Podium for the top 3 -->
					{#if !search && filteredEntries.length >= 3}
						{@const podium = filteredEntries.slice(0, 3)}
						<div class="podium">
							{#each [podium[1], podium[0], podium[2]] as p, i}
								{@const place = i === 1 ? 1 : i === 0 ? 2 : 3}
								<button
									class="podium-card place-{place}"
									on:click={() => gotoProfile(p.walletAddress)}
								>
									<div class="podium-rank {rankBadgeClass(place)}">
										<span class="rank-num">{rankLabel(place)}</span>
									</div>
									<div class="podium-avatar">
										{#if p.avatarUrl}
											<img src={p.avatarUrl} alt={p.username} />
										{:else}
											<div class="avatar-fallback">{p.username[0]?.toUpperCase()}</div>
										{/if}
									</div>
									<div class="podium-name">@{p.username}</div>
									<span class="pnl-badge lg" class:up={p.pnlPercent >= 0} class:down={p.pnlPercent < 0}>
										{formatPnlBadge(p.pnlPercent)}
									</span>
									<div class="podium-meta">
										<span>{fmtMoney(p.totalPnl)}</span>
										<span>·</span>
										<span>{p.tradeCount} trades</span>
									</div>
								</button>
							{/each}
						</div>
					{/if}

					<div class="lb-table">
						<div class="lb-th">
							<span class="col-rank">RANK</span>
							<span class="col-trader">TRADER</span>
							<span class="col-num">P&amp;L</span>
							<span class="col-num">VOLUME</span>
							<span class="col-num hide-md">TRADES</span>
							<span class="col-num hide-md">WIN%</span>
							<span class="col-action"></span>
						</div>
						<div class="lb-rows">
							{#each filteredEntries as entry (entry.userId)}
								{@const isMe = connectedUser && entry.userId === connectedUser.userId}
								{@const isFollowing = followingIds.has(entry.userId)}
								{@const canFollow = !!connectedUser && !isMe}
								<div
									class="lb-row"
									class:me={isMe}
									role="button"
									tabindex="0"
									on:click={() => gotoProfile(entry.walletAddress)}
									on:keydown={(e) => e.key === 'Enter' && gotoProfile(entry.walletAddress)}
								>
									<span class="col-rank">
										<span class="rank-badge {rankBadgeClass(entry.rank)}">{rankLabel(entry.rank)}</span>
									</span>
									<span class="col-trader">
										<span class="row-avatar">
											{#if entry.avatarUrl}
												<img src={entry.avatarUrl} alt={entry.username} />
											{:else}
												<span class="avatar-fallback">{entry.username[0]?.toUpperCase()}</span>
											{/if}
										</span>
										<span class="trader-text">
											<span class="trader-name">@{entry.username}{isMe ? ' (you)' : ''}</span>
											<span class="trader-addr">{shortAddr(entry.walletAddress)}</span>
										</span>
									</span>
									<span class="col-num">
										<span class="pnl-badge" class:up={entry.pnlPercent >= 0} class:down={entry.pnlPercent < 0}>
											{formatPnlBadge(entry.pnlPercent)}
										</span>
									</span>
									<span class="col-num">{fmtVolume(entry.totalVolume)}</span>
									<span class="col-num hide-md">{entry.tradeCount}</span>
									<span class="col-num hide-md">{entry.winRate.toFixed(0)}%</span>
									<span class="col-action">
										{#if canFollow}
											<button
												class="follow-btn"
												class:following={isFollowing}
												disabled={pendingFollow.has(entry.userId)}
												on:click={(e) => handleFollow(e, entry)}
											>
												{isFollowing ? 'Following' : 'Follow'}
											</button>
										{:else if isMe}
											<span class="me-tag">YOU</span>
										{/if}
									</span>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- RIGHT: competition entry -->
			<aside class="lb-right">
				<div class="comp-card">
					<div class="comp-head">
						<div class="comp-title-row">
							<span class="comp-dot"></span>
							<h3>Competition Hub</h3>
						</div>
						<span class="comp-tag">ON-CHAIN</span>
					</div>
					<p class="comp-lede">
						Lock a SOL ticket, trade with a fresh <strong>100,000 USD paper balance</strong>,
						and battle the field. When the timer runs out the on-chain vault
						pays the podium automatically.
					</p>

					<div class="reward-split" aria-label="Reward distribution">
						<div class="rs-head">
							<span>PRIZE SPLIT</span>
							<span class="rs-pool">100% of pool</span>
						</div>
						<div class="rs-row gold">
							<span class="rs-rk">1ST</span>
							<span class="rs-pct">50%</span>
							<span class="rs-bar"><span style="width:100%"></span></span>
						</div>
						<div class="rs-row silver">
							<span class="rs-rk">2ND</span>
							<span class="rs-pct">30%</span>
							<span class="rs-bar"><span style="width:60%"></span></span>
						</div>
						<div class="rs-row bronze">
							<span class="rs-rk">3RD</span>
							<span class="rs-pct">15%</span>
							<span class="rs-bar"><span style="width:30%"></span></span>
						</div>
						<div class="rs-row treasury">
							<span class="rs-rk">TREASURY</span>
							<span class="rs-pct">5%</span>
							<span class="rs-bar"><span style="width:10%"></span></span>
						</div>
					</div>

					<div class="comp-stats">
						<div>
							<strong>{liveComps.length}</strong>
							<span>LIVE</span>
						</div>
						<div>
							<strong>{totalPlayers}</strong>
							<span>PLAYERS</span>
						</div>
						<div>
							<strong>{fmtPoolSol(totalPoolSol)}</strong>
							<span>POOLS</span>
						</div>
					</div>

					{#if compsLoading && competitions.length === 0}
						<div class="comp-empty">Loading on-chain competitions…</div>
					{:else if visibleComps.length === 0}
						<div class="comp-empty">
							No competitions live right now. Be the first to spin one up.
						</div>
					{:else}
						<div class="tournament-list">
							{#each visibleComps as t (t.pubkey)}
								{@const fillPct = t.maxParticipants > 0 ? (t.participantCount / t.maxParticipants) * 100 : 0}
								<button
									class="tournament-row"
									on:click={() => goto(`/competition?cup=${t.pubkey}`)}
								>
									<div class="t-top">
										<span class="t-tag {t.status}">{t.status === 'active' ? 'LIVE' : 'OPEN'}</span>
										<span class="t-title">{t.name}</span>
									</div>
									<div class="t-meta">
										<div>
											<span>PRIZE</span>
											<strong class="prize">{fmtPoolSol(competitionTotalPoolSol(t))}</strong>
										</div>
										<div>
											<span>ENTRY</span>
											<strong>{fmtEntrySol(t.entryTicketSol)}</strong>
										</div>
										<div>
											<span>{t.status === 'active' ? 'ENDS IN' : 'WAITING'}</span>
											<strong>
												{#if t.status === 'active'}
													{void nowMs}{fmtCountdown(t.endTs)}
												{:else}
													{t.maxParticipants - t.participantCount} left
												{/if}
											</strong>
										</div>
									</div>
									<div class="t-bar">
										<div class="t-fill" style="width: {Math.min(100, fillPct)}%"></div>
									</div>
									<div class="t-fill-meta">
										<span>{t.participantCount} / {t.maxParticipants} traders</span>
										<span class="status-tag {t.status === 'active' ? 'live' : 'upcoming'}">
											{t.status === 'active' ? 'LIVE' : 'OPEN'}
										</span>
									</div>
								</button>
							{/each}
						</div>
					{/if}

					<button class="comp-cta" on:click={() => goto('/competition')}>
						<span>ENTER COMPETITION HUB</span>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
							<path stroke-linecap="round" stroke-linejoin="round" d="M13 5l7 7-7 7M20 12H4" />
						</svg>
					</button>
				</div>
			</aside>
		</div>
	</div>
</section>

<style>
	.lb-section {
		padding: 34px 0 36px;
		background: #000;
		border-bottom: 1px solid #222;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	.lb-inner { max-width: none; margin: 0; padding: 0 18px; }

	.lb-header {
		display: flex; align-items: flex-end; justify-content: space-between;
		gap: 16px; flex-wrap: wrap; margin-bottom: 18px;
	}
	.lb-header h2 { font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.02em; color: #fff; }
	.header-meta { display: flex; align-items: center; gap: 10px; }
	.my-rank {
		display: flex; align-items: center; gap: 8px;
		padding: 7px 12px; background: rgba(255, 90, 0, 0.08);
		border: 1px solid rgba(255, 90, 0, 0.4); border-radius: 10px;
		font-family: 'Courier New', monospace;
	}
	.my-rank-label { color: #888; font-size: 9px; font-weight: 800; letter-spacing: 0.12em; }
	.my-rank-value { color: #ff5a00; font-size: 16px; font-weight: 900; }
	.refresh-btn {
		display: inline-flex; align-items: center; gap: 6px;
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		color: #ccc; padding: 8px 12px; border-radius: 10px;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 800;
		letter-spacing: 0.08em; cursor: pointer; transition: all 0.15s;
	}
	.refresh-btn:hover:not(:disabled) { border-color: #ff5a00; color: #ff5a00; }
	.refresh-btn:disabled { opacity: 0.55; cursor: not-allowed; }

	.lb-grid {
		display: grid;
		grid-template-columns: 1fr 380px;
		gap: 16px;
		align-items: stretch;
	}

	/* ── Toolbar ── */
	.lb-toolbar {
		display: flex; gap: 10px; align-items: center; margin-bottom: 14px;
		padding: 12px; background: #0a0a0a; border: 1px solid #222;
		border-radius: 12px; flex-wrap: wrap;
	}
	.search-wrap { position: relative; flex: 1; min-width: 200px; }
	.search-wrap input {
		width: 100%; padding: 9px 36px;
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		border-radius: 10px; color: #fff; font-size: 13px; font-family: inherit;
	}
	.search-wrap input::placeholder { color: #666; }
	.search-wrap input:focus { outline: none; border-color: rgba(255, 90, 0, 0.5); }
	.search-ic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #666; }
	.seg {
		display: inline-flex; gap: 0; padding: 3px;
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a; border-radius: 10px;
	}
	.seg button {
		background: transparent; border: none; color: #888;
		padding: 6px 12px; border-radius: 7px; cursor: pointer;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 800;
		letter-spacing: 0.08em; transition: all 0.15s;
	}
	.seg button:hover { color: #fff; }
	.seg button.on { background: rgba(255, 90, 0, 0.15); color: #ff5a00; }

	/* ── Podium ── */
	.podium {
		display: grid; grid-template-columns: repeat(3, 1fr);
		gap: 10px; margin-bottom: 16px;
		align-items: end;
	}
	.podium-card {
		display: flex; flex-direction: column; align-items: center; gap: 6px;
		padding: 18px 12px 14px; cursor: pointer;
		background: linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01));
		border: 1px solid #222; border-radius: 14px;
		transition: all 0.2s; font-family: inherit;
	}
	.podium-card:hover { transform: translateY(-3px); border-color: rgba(255, 90, 0, 0.4); }
	.podium-card.place-1 { padding-top: 22px; padding-bottom: 18px; border-color: rgba(255, 215, 0, 0.45); background: linear-gradient(180deg, rgba(255, 215, 0, 0.08), rgba(255,255,255,0.02)); }
	.podium-card.place-2 { border-color: rgba(192, 192, 192, 0.35); }
	.podium-card.place-3 { border-color: rgba(205, 127, 50, 0.35); }
	.podium-rank {
		display: inline-flex; align-items: center; justify-content: center;
		min-width: 44px; padding: 4px 10px;
		border-radius: 999px;
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		color: #aaa;
		font-family: 'Courier New', monospace;
		font-size: 12px; font-weight: 900; letter-spacing: 0.08em;
	}
	.podium-rank.gold { background: rgba(255, 215, 0, 0.12); border-color: rgba(255, 215, 0, 0.5); }
	.podium-rank.silver { background: rgba(192, 192, 192, 0.10); border-color: rgba(192, 192, 192, 0.45); }
	.podium-rank.bronze { background: rgba(205, 127, 50, 0.10); border-color: rgba(205, 127, 50, 0.45); }
	.podium-avatar img,
	.podium-avatar .avatar-fallback {
		width: 56px; height: 56px; border-radius: 50%;
		object-fit: cover; border: 2px solid #2a2a2a;
		display: flex; align-items: center; justify-content: center;
		background: rgba(255, 90, 0, 0.15); color: #ff5a00;
		font-family: 'Courier New', monospace; font-weight: 800; font-size: 18px;
	}
	.place-1 .podium-avatar img,
	.place-1 .podium-avatar .avatar-fallback { width: 64px; height: 64px; border-color: rgba(255, 215, 0, 0.6); }
	.podium-name { color: #fff; font-weight: 800; font-size: 14px; }
	.podium-meta {
		display: flex; gap: 6px; align-items: center;
		color: #666; font-family: 'Courier New', monospace; font-size: 11px;
	}

	/* Unified PnL badge — same styling and computation as the LiveChat
	 * username pill so a trader's number reads identically across surfaces. */
	.pnl-badge {
		padding: 2px 9px; border-radius: 999px;
		font-size: 10px; font-weight: 800; letter-spacing: 0.04em;
		font-family: 'Courier New', monospace;
		border: 1px solid #2a2a2a;
		background: rgba(255,255,255,0.04); color: #888;
		display: inline-block;
	}
	.pnl-badge.lg { padding: 4px 12px; font-size: 13px; font-weight: 900; }
	.pnl-badge.up { color: #00ff66; border-color: rgba(0,255,102,0.35); background: rgba(0,255,102,0.08); }
	.pnl-badge.down { color: #ff6b6b; border-color: rgba(255,107,107,0.35); background: rgba(255,107,107,0.08); }

	/* ── Table ── */
	.lb-table {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 12px;
		overflow: hidden;
	}
	.lb-th {
		display: grid;
		grid-template-columns: 60px minmax(0, 2fr) 110px 100px 80px 80px 110px;
		padding: 12px 14px;
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 800; letter-spacing: 0.12em; color: #666;
		border-bottom: 1px solid #1c1c1c;
	}
	.lb-th .col-num { text-align: right; }
	.lb-th .col-action { text-align: right; }
	.lb-rows { display: flex; flex-direction: column; max-height: 540px; overflow-y: auto; }
	.lb-rows::-webkit-scrollbar { width: 6px; }
	.lb-rows::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
	.lb-row {
		display: grid;
		grid-template-columns: 60px minmax(0, 2fr) 110px 100px 80px 80px 110px;
		align-items: center;
		padding: 12px 14px;
		background: transparent;
		border: none;
		border-top: 1px solid #161616;
		text-align: left;
		font-family: inherit;
		color: inherit;
		cursor: pointer;
		transition: background 0.15s;
	}
	.lb-row:first-child { border-top: none; }
	.lb-row:hover { background: rgba(255, 90, 0, 0.04); }
	.lb-row.me { background: rgba(255, 90, 0, 0.06); border-left: 2px solid #ff5a00; }
	.lb-row .col-num { text-align: right; font-family: 'Courier New', monospace; font-size: 12px; color: #ddd; font-weight: 700; }
	.lb-row .col-action { text-align: right; }
	.col-trader { display: flex; align-items: center; gap: 10px; min-width: 0; }
	.row-avatar img,
	.row-avatar .avatar-fallback {
		width: 32px; height: 32px; border-radius: 50%;
		object-fit: cover; border: 1px solid #2a2a2a;
		display: flex; align-items: center; justify-content: center;
		background: rgba(255, 90, 0, 0.15); color: #ff5a00;
		font-family: 'Courier New', monospace; font-weight: 800; font-size: 12px;
	}
	.trader-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
	.trader-name { color: #fff; font-weight: 700; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.trader-addr { color: #666; font-family: 'Courier New', monospace; font-size: 10px; }
	.rank-badge {
		display: inline-flex; align-items: center; justify-content: center;
		min-width: 36px; padding: 4px 8px; border-radius: 999px;
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 900; color: #aaa;
	}
	.rank-badge.gold { background: rgba(255, 215, 0, 0.12); border-color: rgba(255, 215, 0, 0.5); color: #ffd700; }
	.rank-badge.silver { background: rgba(192, 192, 192, 0.10); border-color: rgba(192, 192, 192, 0.45); color: #d8d8d8; }
	.rank-badge.bronze { background: rgba(205, 127, 50, 0.10); border-color: rgba(205, 127, 50, 0.45); color: #cd7f32; }
	.podium-rank.gold { background: rgba(255, 215, 0, 0.12); border-color: rgba(255, 215, 0, 0.5); color: #ffd700; }
	.podium-rank.silver { background: rgba(192, 192, 192, 0.10); border-color: rgba(192, 192, 192, 0.45); color: #d8d8d8; }
	.podium-rank.bronze { background: rgba(205, 127, 50, 0.10); border-color: rgba(205, 127, 50, 0.45); color: #cd7f32; }
	.follow-btn {
		font-family: 'Courier New', monospace;
		font-size: 10px; font-weight: 800; letter-spacing: 0.08em;
		padding: 5px 12px; border-radius: 999px;
		border: 1px solid rgba(255, 90, 0, 0.45);
		background: rgba(255, 90, 0, 0.08);
		color: #ff5a00; cursor: pointer;
		transition: all 0.15s;
	}
	.follow-btn:hover:not(:disabled) { background: rgba(255, 90, 0, 0.18); }
	.follow-btn.following { border-color: #2a2a2a; background: rgba(255,255,255,0.03); color: #888; }
	.follow-btn.following:hover:not(:disabled) {
		border-color: rgba(255,107,107,0.45); background: rgba(255,107,107,0.08); color: #ff6b6b;
	}
	.follow-btn:disabled { opacity: 0.55; cursor: wait; }
	.me-tag {
		display: inline-block; padding: 4px 10px;
		background: rgba(255, 90, 0, 0.12); border: 1px solid rgba(255, 90, 0, 0.4);
		color: #ff5a00; border-radius: 999px;
		font-family: 'Courier New', monospace; font-size: 9px; font-weight: 900; letter-spacing: 0.12em;
	}

	.placeholder {
		padding: 60px 18px; text-align: center;
		color: #666; font-family: 'Courier New', monospace; font-size: 13px;
		background: #0a0a0a; border: 1px solid #222; border-radius: 12px;
	}

	/* ── Right column (competition) ── */
	.lb-right { min-width: 0; }
	.comp-card {
		position: sticky; top: 100px;
		background: linear-gradient(180deg, rgba(255, 90, 0, 0.06), rgba(255,255,255,0.01));
		border: 1px solid rgba(255, 90, 0, 0.25);
		border-radius: 14px;
		padding: 18px;
		display: flex; flex-direction: column; gap: 14px;
	}
	.comp-head { display: flex; justify-content: space-between; align-items: center; }
	.comp-title-row { display: flex; gap: 8px; align-items: center; }
	.comp-dot {
		width: 8px; height: 8px; border-radius: 50%;
		background: #ff5a00;
		box-shadow: 0 0 10px rgba(255, 90, 0, 0.7);
		animation: comp-pulse 1.6s infinite;
	}
	@keyframes comp-pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.45; } }
	.comp-head h3 { color: #fff; font-size: 16px; font-weight: 800; margin: 0; }
	.comp-tag {
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 900; letter-spacing: 0.18em;
		padding: 3px 8px; border-radius: 4px;
		background: #ff5a00; color: #000;
	}
	.comp-lede { color: #aaa; font-size: 12px; line-height: 1.55; margin: 0; }
	.comp-stats {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
		background: #1c1c1c;
		border-radius: 10px; overflow: hidden;
	}
	.comp-stats div {
		background: #0a0a0a; padding: 10px 6px;
		display: flex; flex-direction: column; align-items: center; gap: 2px;
	}
	.comp-stats strong {
		color: #ff5a00; font-family: 'Courier New', monospace;
		font-weight: 900; font-size: 16px;
	}
	.comp-stats span {
		color: #777; font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 800; letter-spacing: 0.12em;
	}

	.tournament-list { display: flex; flex-direction: column; gap: 10px; }
	.tournament-row {
		padding: 12px;
		background: rgba(255,255,255,0.02);
		border: 1px solid #1f1f1f;
		border-radius: 10px;
		display: flex; flex-direction: column; gap: 8px;
		text-align: left;
		font-family: inherit; color: inherit;
		cursor: pointer; transition: all 0.15s;
		width: 100%;
	}
	.tournament-row:hover { border-color: rgba(255, 90, 0, 0.4); background: rgba(255, 90, 0, 0.04); }

	.comp-empty {
		padding: 16px;
		background: rgba(255,255,255,0.02);
		border: 1px dashed #2a2a2a;
		border-radius: 10px;
		color: #888;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		text-align: center;
		line-height: 1.5;
	}
	.t-top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.t-tag {
		font-family: 'Courier New', monospace;
		font-size: 8px; font-weight: 900; letter-spacing: 0.14em;
		padding: 3px 7px; border-radius: 4px;
		background: rgba(255, 90, 0, 0.12); color: #ff5a00;
		border: 1px solid rgba(255, 90, 0, 0.4);
	}
	.t-tag.upcoming { background: rgba(255,102,204,0.10); color: #ff66cc; border-color: rgba(255,102,204,0.4); }
	.t-tag.active { background: rgba(0,255,102,0.10); color: #00ff66; border-color: rgba(0,255,102,0.35); }
	.t-tag.pending { background: rgba(255,102,204,0.10); color: #ff66cc; border-color: rgba(255,102,204,0.4); }
	.t-title { color: #fff; font-weight: 700; font-size: 13px; }
	.t-desc { color: #888; font-size: 11px; line-height: 1.5; margin: 0; }
	.t-meta {
		display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
	}
	.t-meta div { display: flex; flex-direction: column; gap: 2px; }
	.t-meta span {
		color: #666; font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 800; letter-spacing: 0.1em;
	}
	.t-meta strong {
		color: #fff; font-family: 'Courier New', monospace;
		font-weight: 900; font-size: 13px;
	}
	.t-meta strong.prize { color: #00ff66; }
	.t-bar {
		height: 5px; border-radius: 999px;
		background: rgba(255,255,255,0.05); overflow: hidden;
	}
	.t-fill {
		height: 100%;
		background: linear-gradient(90deg, #ff5a00, #ffb733);
		transition: width 0.3s ease;
	}
	.t-fill-meta {
		display: flex; justify-content: space-between; align-items: center;
		font-family: 'Courier New', monospace; font-size: 10px;
		color: #888;
	}
	.status-tag {
		padding: 2px 8px; border-radius: 999px;
		font-size: 9px; font-weight: 900; letter-spacing: 0.12em;
	}
	.status-tag.live { background: rgba(0,255,102,0.10); color: #00ff66; border: 1px solid rgba(0,255,102,0.35); }
	.status-tag.upcoming { background: rgba(255,102,204,0.10); color: #ff66cc; border: 1px solid rgba(255,102,204,0.35); }

	.comp-cta {
		display: inline-flex; align-items: center; justify-content: center; gap: 10px;
		padding: 12px 16px; border-radius: 10px;
		background: #ff5a00; color: #000; border: none;
		font-family: 'Courier New', monospace;
		font-size: 12px; font-weight: 900; letter-spacing: 0.12em;
		cursor: pointer; transition: all 0.15s;
	}
	.comp-cta:hover { background: #ffb733; box-shadow: 0 6px 20px rgba(255, 90, 0, 0.35); transform: translateY(-1px); }

	.reward-split {
		display: flex; flex-direction: column; gap: 6px;
		padding: 12px;
		background: rgba(255, 255, 255, 0.02);
		border: 1px solid #1f1f1f;
		border-radius: 10px;
	}
	.rs-head {
		display: flex; justify-content: space-between; align-items: baseline;
		margin-bottom: 2px;
	}
	.rs-head span:first-child {
		color: #ff5a00; font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 900; letter-spacing: 0.16em;
	}
	.rs-pool { color: #777; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.1em; }
	.rs-row {
		display: grid; grid-template-columns: 64px 44px 1fr;
		align-items: center; gap: 8px;
	}
	.rs-rk {
		font-family: 'Courier New', monospace;
		font-size: 10px; font-weight: 900; letter-spacing: 0.12em;
	}
	.rs-pct {
		font-family: 'Courier New', monospace;
		font-size: 12px; font-weight: 900; text-align: right;
	}
	.rs-bar {
		height: 6px; border-radius: 999px;
		background: rgba(255, 255, 255, 0.05); overflow: hidden;
		display: block;
	}
	.rs-bar > span { display: block; height: 100%; border-radius: inherit; }
	.rs-row.gold .rs-rk, .rs-row.gold .rs-pct { color: #ffd24a; }
	.rs-row.gold .rs-bar > span { background: linear-gradient(90deg, #ffb733, #ffd24a); }
	.rs-row.silver .rs-rk, .rs-row.silver .rs-pct { color: #cfd8e3; }
	.rs-row.silver .rs-bar > span { background: linear-gradient(90deg, #8a8e96, #cfd8e3); }
	.rs-row.bronze .rs-rk, .rs-row.bronze .rs-pct { color: #d68b3d; }
	.rs-row.bronze .rs-bar > span { background: linear-gradient(90deg, #6a3a1a, #d68b3d); }
	.rs-row.treasury .rs-rk, .rs-row.treasury .rs-pct { color: #777; }
	.rs-row.treasury .rs-bar > span { background: #444; }

	@media (max-width: 1100px) {
		.lb-grid { grid-template-columns: 1fr 340px; }
	}
	@media (max-width: 920px) {
		.lb-grid { grid-template-columns: 1fr; }
		.comp-card { position: static; }
	}
	@media (max-width: 720px) {
		.lb-th, .lb-row { grid-template-columns: 50px minmax(0, 2fr) 100px 90px 90px; }
		.hide-md { display: none; }
		.podium { grid-template-columns: 1fr; }
	}
</style>
