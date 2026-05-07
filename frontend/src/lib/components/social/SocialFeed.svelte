<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { walletStore } from '$lib/wallet/stores';
	import SocialPostCard from './SocialPostCard.svelte';
	import LiveChat from './LiveChat.svelte';
	import LiveChatModal from './LiveChatModal.svelte';
	import {
		fetchPublishedFeed,
		fetchFeedProfiles,
		resolveConnectedUser,
		fetchFollowing,
		toggleFollow,
		ASSET_OPTIONS,
		type SharedTrade,
		type FeedUserProfile,
		type ConnectedSocialUser,
		type MarketType,
		type TradeType
	} from '$lib/social/types';

	let trades: SharedTrade[] = [];
	let profiles: FeedUserProfile[] = [];
	let loading = true;
	let connectedUser: ConnectedSocialUser | null = null;

	let search = '';
	let marketType: 'all' | MarketType = 'all';
	let tradeTypeFilter: 'all' | TradeType = 'all';
	let pnlFilter: 'all' | 'positive' | 'negative' = 'all';
	let asset: string = '';
	let showProfiles = false;
	let showChat = false;
	let followingOnly = false;

	let followingIds: Set<string> = new Set();
	let loadingFollowing = false;

	let openDropdown: 'market' | 'type' | 'pnl' | 'asset' | null = null;

	const marketOpts: { value: 'all' | MarketType; label: string }[] = [
		{ value: 'all', label: 'All Markets' },
		{ value: 'crypto', label: 'Crypto' },
		{ value: 'prediction', label: 'Prediction' },
		{ value: 'forex', label: 'Forex' },
		{ value: 'stocks', label: 'Stocks' },
		{ value: 'commodities', label: 'Commodities' }
	];
	const typeOpts: { value: 'all' | TradeType; label: string }[] = [
		{ value: 'all', label: 'All Types' },
		{ value: 'paper-trade', label: 'Paper Trade' },
		{ value: 'backtest', label: 'Backtest' }
	];
	const pnlOpts: { value: 'all' | 'positive' | 'negative'; label: string }[] = [
		{ value: 'all', label: 'All P&L' },
		{ value: 'positive', label: 'Profitable' },
		{ value: 'negative', label: 'Losing' }
	];

	$: assetOpts = marketType !== 'all'
		? [{ value: '', label: 'All Assets' }, ...ASSET_OPTIONS[marketType].map((a) => ({ value: a, label: a }))]
		: null;

	async function loadAll() {
		loading = true;
		try {
			trades = await fetchPublishedFeed();
			profiles = await fetchFeedProfiles(trades);
		} catch (err) {
			console.warn('[SocialFeed] load failed', err);
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
		} else {
			connectedUser = null;
		}
	});

	onMount(loadAll);

	$: if (connectedUser?.userId) {
		(async () => {
			loadingFollowing = true;
			try {
				followingIds = await fetchFollowing(connectedUser!.userId);
			} finally {
				loadingFollowing = false;
			}
		})();
	} else {
		followingIds = new Set();
		followingOnly = false;
	}

	function shortAddr(a: string) {
		return a ? `${a.slice(0, 4)}…${a.slice(-4)}` : '';
	}

	function gotoProfile(p: FeedUserProfile) {
		goto(`/profile?address=${p.walletAddress}`);
	}

	function toggleDropdown(k: typeof openDropdown) {
		openDropdown = openDropdown === k ? null : k;
	}

	function selectMarket(v: 'all' | MarketType) {
		marketType = v; asset = ''; openDropdown = null;
	}
	function selectType(v: 'all' | TradeType) { tradeTypeFilter = v; openDropdown = null; }
	function selectPnl(v: 'all' | 'positive' | 'negative') { pnlFilter = v; openDropdown = null; }
	function selectAsset(v: string) { asset = v; openDropdown = null; }

	function clearFilters() {
		search = '';
		marketType = 'all';
		tradeTypeFilter = 'all';
		pnlFilter = 'all';
		asset = '';
		followingOnly = false;
	}

	function onDocClick(e: MouseEvent) {
		const t = e.target as HTMLElement;
		if (!t.closest('.dd')) openDropdown = null;
	}

	$: filteredTrades = (() => {
		const q = search.toLowerCase().trim();
		return trades
			.filter((t) => {
				if (followingOnly) {
					if (!connectedUser?.userId) return false;
					if (!t.authorUserId) return false;
					if (!followingIds.has(t.authorUserId)) return false;
				}
				if (marketType !== 'all' && t.marketType !== marketType) return false;
				if (tradeTypeFilter !== 'all' && t.tradeType !== tradeTypeFilter) return false;
				if (pnlFilter === 'positive' && t.pnl < 0) return false;
				if (pnlFilter === 'negative' && t.pnl >= 0) return false;
				if (asset && t.asset !== asset && t.subcategory !== asset) return false;
				if (q) {
					const hay = [t.username, t.asset, t.subcategory, t.strategy, t.marketType, t.direction]
						.filter(Boolean)
						.join(' ')
						.toLowerCase();
					if (!hay.includes(q)) return false;
				}
				return true;
			})
			.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
	})();

	async function handleToggleFollow(targetUserId: string) {
		if (!connectedUser?.userId) return;
		const wasFollowing = followingIds.has(targetUserId);
		const optimistic = new Set(followingIds);
		if (wasFollowing) optimistic.delete(targetUserId);
		else optimistic.add(targetUserId);
		followingIds = optimistic;

		const res = await toggleFollow(connectedUser.userId, targetUserId, !wasFollowing);
		if (!res.ok) {
			// revert
			const reverted = new Set(followingIds);
			if (wasFollowing) reverted.add(targetUserId);
			else reverted.delete(targetUserId);
			followingIds = reverted;
		}
	}

	$: filteredProfiles = (() => {
		const q = search.toLowerCase().trim();
		if (!q && !showProfiles) return [] as FeedUserProfile[];
		return profiles.filter((p) =>
			!q ? true : p.username.toLowerCase().includes(q) || p.walletAddress.toLowerCase().includes(q)
		);
	})();

	$: marketLabel = marketOpts.find((o) => o.value === marketType)?.label ?? 'All Markets';
	$: typeLabel = typeOpts.find((o) => o.value === tradeTypeFilter)?.label ?? 'All Types';
	$: pnlLabel = pnlOpts.find((o) => o.value === pnlFilter)?.label ?? 'All P&L';
	$: assetLabel = asset || 'All Assets';
</script>

<svelte:window on:click={onDocClick} />

<section class="social-section">
	<div class="section-inner">
		<div class="section-header aligned-left">
			<h2>Community Feed</h2>
		</div>

		<div class="filter-bar">
			<div class="search-wrap">
				<svg class="search-ic" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
				</svg>
				<input
					type="text"
					placeholder="Search trades, users, strategies…"
					bind:value={search}
				/>
				{#if search}
					<button class="clear-btn" aria-label="Clear search" on:click={() => (search = '')}>
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>

			<div class="filters">
				<div class="dd">
					<button class="dd-btn" class:on={marketType !== 'all'} on:click|stopPropagation={() => toggleDropdown('market')}>
						<span>Market: {marketLabel}</span>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
					</button>
					{#if openDropdown === 'market'}
						<div class="dd-menu">
							{#each marketOpts as o}
								<button class:active={marketType === o.value} on:click={() => selectMarket(o.value)}>{o.label}</button>
							{/each}
						</div>
					{/if}
				</div>

				<div class="dd">
					<button class="dd-btn" class:on={tradeTypeFilter !== 'all'} on:click|stopPropagation={() => toggleDropdown('type')}>
						<span>Type: {typeLabel}</span>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
					</button>
					{#if openDropdown === 'type'}
						<div class="dd-menu">
							{#each typeOpts as o}
								<button class:active={tradeTypeFilter === o.value} on:click={() => selectType(o.value)}>{o.label}</button>
							{/each}
						</div>
					{/if}
				</div>

				<div class="dd">
					<button class="dd-btn" class:on={pnlFilter !== 'all'} on:click|stopPropagation={() => toggleDropdown('pnl')}>
						<span>P&L: {pnlLabel}</span>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
					</button>
					{#if openDropdown === 'pnl'}
						<div class="dd-menu">
							{#each pnlOpts as o}
								<button class:active={pnlFilter === o.value} on:click={() => selectPnl(o.value)}>{o.label}</button>
							{/each}
						</div>
					{/if}
				</div>

				<div class="dd">
					<button class="dd-btn" class:on={asset !== ''} class:disabled={!assetOpts}
						on:click|stopPropagation={() => assetOpts && toggleDropdown('asset')}>
						<span>Asset: {assetLabel}</span>
						<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
					</button>
					{#if openDropdown === 'asset' && assetOpts}
						<div class="dd-menu scroll">
							{#each assetOpts as o}
								<button class:active={asset === o.value} on:click={() => selectAsset(o.value)}>{o.label}</button>
							{/each}
						</div>
					{/if}
				</div>

				<button class="profile-toggle" class:on={showProfiles} on:click={() => (showProfiles = !showProfiles)}>
					Profiles
				</button>

				<button
					class="profile-toggle"
					class:on={followingOnly}
					disabled={!connectedUser || loadingFollowing}
					on:click={() => (followingOnly = !followingOnly)}
					title={!connectedUser ? 'Connect wallet to filter by following' : 'Show only posts from users you follow'}
				>
					Following only
				</button>

				<button class="chat-btn" on:click={() => (showChat = true)}>
					<span class="chat-dot"></span>
					Live Chat
				</button>
			</div>
		</div>

		{#if filteredProfiles.length > 0}
			<div class="divider">
				<div class="line"></div>
				<span class="div-tag">PROFILES ({filteredProfiles.length})</span>
				<div class="line"></div>
			</div>
			<div class="profile-grid">
				{#each filteredProfiles as p (p.id)}
					<button class="profile-card" on:click={() => gotoProfile(p)}>
						<div class="banner">
							{#if p.bannerUrl}
								<img src={p.bannerUrl} alt="" />
							{:else}
								<div class="banner-fallback"></div>
							{/if}
						</div>
						<div class="pc-avatar-wrap">
							{#if p.avatarUrl}
								<img class="pc-avatar" src={p.avatarUrl} alt={p.username} />
							{:else}
								<div class="pc-avatar fallback">{p.username[0]?.toUpperCase()}</div>
							{/if}
						</div>
						<div class="pc-body">
							<div class="pc-head">
								<h3>@{p.username}</h3>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7" /></svg>
							</div>
							<p class="pc-addr">{shortAddr(p.walletAddress)}</p>
							<div class="pc-tags">
								<span class="tag-trade">{p.tradeCount} Trade{p.tradeCount === 1 ? '' : 's'}</span>
								<span class="tag-strat">{p.strategyCount} Strat{p.strategyCount === 1 ? '' : 's'}</span>
							</div>
							<div class="pc-stats">
								<div><strong>{p.tradeCount + p.strategyCount}</strong><span>POSTS</span></div>
								<div><strong class:up={p.totalPnl >= 0} class:down={p.totalPnl < 0}>{p.totalPnl >= 0 ? '+' : ''}{p.totalPnl.toFixed(1)}%</strong><span>AVG P&L</span></div>
								<div><strong>{p.winRate.toFixed(0)}%</strong><span>WIN RATE</span></div>
							</div>
						</div>
					</button>
				{/each}
			</div>
		{/if}

		{#if !showProfiles}
			<div class="divider">
				<div class="line purple"></div>
				<span class="div-tag purple">POSTS ({filteredTrades.length})</span>
				<div class="line purple"></div>
			</div>
			<div class="feed-split">
				<div class="posts-col">
					{#if loading}
						<div class="placeholder">Loading feed…</div>
					{:else if filteredTrades.length > 0}
						<div class="post-list">
							{#each filteredTrades as t (t.id)}
								<SocialPostCard
									trade={t}
									{connectedUser}
									{followingIds}
									onToggleFollow={handleToggleFollow}
								/>
							{/each}
						</div>
					{:else}
						<div class="placeholder">
							No posts match your filters.
							<button class="reset" on:click={clearFilters}>Clear all filters</button>
						</div>
					{/if}
				</div>
				<aside class="chat-col">
					{#if !showChat}
						<LiveChat
							{connectedUser}
							{profiles}
							embedded
							onExpand={() => (showChat = true)}
						/>
					{:else}
						<div class="chat-placeholder">
							<span class="cp-dot"></span>
							Chat opened in fullscreen
						</div>
					{/if}
				</aside>
			</div>
		{:else if filteredProfiles.length === 0}
			<div class="placeholder">No profiles found.</div>
		{/if}
	</div>
</section>

{#if showChat}
	<LiveChatModal {connectedUser} {profiles} onClose={() => (showChat = false)} />
{/if}

<style>
	.social-section {
		padding: 34px 0 40px;
		background: #000;
		border-bottom: 1px solid #222;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	.section-inner { max-width: none; margin: 0; padding: 0 18px; }
	.section-header { text-align: center; margin-bottom: 1.75rem; }
	.section-header.aligned-left { text-align: left; }
	.section-header h2 { font-size: 26px; font-weight: 800; margin: 0; letter-spacing: -0.02em; color: #fff; }
	.section-header p { color: #9a9a9a; font-size: 13px; margin: 0; }

	.filter-bar {
		display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
		padding: 14px;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 12px;
		position: relative; z-index: 10;
	}
	.search-wrap { position: relative; flex: 1; min-width: 220px; }
	.search-wrap input {
		width: 100%;
		padding: 10px 36px;
		background: rgba(255,255,255,0.04);
		border: 1px solid #2a2a2a; border-radius: 10px;
		color: #fff; font-size: 13px;
		font-family: inherit;
	}
	.search-wrap input::placeholder { color: #666; }
	.search-wrap input:focus { outline: none; border-color: rgba(255, 90, 0,0.5); }
	.search-ic { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #666; }
	.clear-btn {
		position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
		background: transparent; border: none; color: #666; cursor: pointer; padding: 2px;
	}
	.clear-btn:hover { color: #fff; }

	.filters { display: flex; gap: 6px; flex-wrap: wrap; }
	.dd { position: relative; }
	.dd-btn {
		display: flex; align-items: center; gap: 6px;
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		color: #ccc; padding: 9px 12px; border-radius: 10px;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700;
		letter-spacing: 0.04em; cursor: pointer; transition: all 0.15s;
	}
	.dd-btn:hover { border-color: #444; color: #fff; }
	.dd-btn.on { background: rgba(255, 90, 0,0.1); border-color: rgba(255, 90, 0,0.4); color: #ff5a00; }
	.dd-btn.disabled { opacity: 0.4; cursor: not-allowed; }
	.dd-menu {
		position: absolute; top: calc(100% + 6px); right: 0;
		min-width: 180px; max-height: 280px; overflow-y: auto;
		background: #111; border: 1px solid #2a2a2a; border-radius: 10px;
		box-shadow: 0 12px 30px rgba(0,0,0,0.55);
		z-index: 50;
		padding: 4px;
	}
	.dd-menu.scroll::-webkit-scrollbar { width: 6px; }
	.dd-menu.scroll::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
	.dd-menu button {
		display: block; width: 100%; text-align: left;
		padding: 8px 12px; background: transparent; border: none;
		color: #ccc; font-size: 12px; font-family: 'Courier New', monospace;
		border-radius: 6px; cursor: pointer;
	}
	.dd-menu button:hover { background: rgba(255,255,255,0.04); color: #fff; }
	.dd-menu button.active { background: rgba(255, 90, 0,0.1); color: #ff5a00; }

	.profile-toggle {
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		color: #ccc; padding: 9px 14px; border-radius: 10px;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700;
		letter-spacing: 0.04em; cursor: pointer; transition: all 0.15s;
	}
	.profile-toggle:hover { border-color: #444; color: #fff; }
	.profile-toggle.on { background: rgba(255, 90, 0,0.1); border-color: rgba(255, 90, 0,0.4); color: #ff5a00; }
	.profile-toggle:disabled { opacity: 0.45; cursor: not-allowed; }
	.profile-toggle:disabled:hover { border-color: #2a2a2a; color: #ccc; }

	.chat-btn {
		display: inline-flex; align-items: center; gap: 8px;
		background: rgba(255,59,59,0.08); border: 1px solid rgba(255,59,59,0.4);
		color: #ff5252; padding: 9px 14px; border-radius: 10px;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 800;
		letter-spacing: 0.06em; cursor: pointer; transition: all 0.15s;
	}
	.chat-btn:hover { background: rgba(255,59,59,0.16); color: #ff7575; border-color: rgba(255,59,59,0.6); }
	.chat-dot {
		width: 7px; height: 7px; border-radius: 50%;
		background: #ff3b3b;
		box-shadow: 0 0 8px rgba(255,59,59,0.7);
		animation: chat-pulse 1.6s infinite;
	}
	@keyframes chat-pulse {
		0% { opacity: 1; }
		50% { opacity: 0.4; }
		100% { opacity: 1; }
	}

	.divider { display: flex; align-items: center; gap: 16px; margin: 28px 0 16px; }
	.line { flex: 1; height: 1px; background: linear-gradient(90deg, transparent, rgba(255, 90, 0,0.4), transparent); }
	.line.purple { background: linear-gradient(90deg, transparent, rgba(255,102,204,0.4), transparent); }
	.div-tag {
		font-family: 'Courier New', monospace;
		padding: 5px 14px; border: 1px solid rgba(255, 90, 0,0.35); border-radius: 999px;
		background: rgba(255, 90, 0,0.08); color: #ff5a00;
		font-size: 10px; font-weight: 800; letter-spacing: 0.18em;
	}
	.div-tag.purple {
		border-color: rgba(255,102,204,0.32); background: rgba(255,102,204,0.08); color: #ff66cc;
	}

	.profile-grid {
		display: grid; gap: 12px;
		grid-template-columns: repeat(3, 1fr);
		margin-bottom: 4px;
	}
	.profile-card {
		display: block; text-align: left; width: 100%;
		background: #0a0a0a; border: 1px solid #222; border-radius: 12px;
		overflow: hidden; cursor: pointer; transition: all 0.2s;
		font-family: inherit; padding: 0;
	}
	.profile-card:hover { border-color: rgba(255, 90, 0,0.5); transform: translateY(-2px); box-shadow: 0 10px 24px rgba(0,0,0,0.4); }
	.banner { width: 100%; height: 70px; overflow: hidden; }
	.banner img { width: 100%; height: 100%; object-fit: cover; }
	.banner-fallback {
		width: 100%; height: 100%;
		background: linear-gradient(135deg, rgba(255, 90, 0,0.3), rgba(255,102,204,0.15), transparent);
	}
	.pc-avatar-wrap { padding: 0 16px; margin-top: -32px; }
	.pc-avatar {
		width: 64px; height: 64px; border-radius: 50%; object-fit: cover;
		border: 3px solid #0a0a0a; box-shadow: 0 0 0 2px rgba(255, 90, 0,0.25);
	}
	.pc-avatar.fallback {
		display: flex; align-items: center; justify-content: center;
		background: rgba(255, 90, 0,0.18); color: #ff5a00;
		font-family: 'Courier New', monospace; font-weight: 800; font-size: 22px;
	}
	.pc-body { padding: 10px 16px 16px; }
	.pc-head { display: flex; gap: 6px; align-items: center; }
	.pc-head h3 { color: #fff; font-size: 16px; font-weight: 800; margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.pc-head svg { color: #555; flex-shrink: 0; }
	.profile-card:hover .pc-head svg { color: #ff5a00; transform: translateX(2px); transition: 0.2s; }
	.pc-addr {
		font-family: 'Courier New', monospace;
		color: #666; font-size: 11px; margin: 2px 0 10px;
	}
	.pc-tags { display: flex; gap: 6px; }
	.tag-trade, .tag-strat {
		padding: 3px 8px; border-radius: 999px;
		font-size: 9px; font-weight: 800; letter-spacing: 0.05em;
		font-family: 'Courier New', monospace;
	}
	.tag-trade { background: rgba(0,200,255,0.08); color: #00c8ff; border: 1px solid rgba(0,200,255,0.25); }
	.tag-strat { background: rgba(255,102,204,0.08); color: #ff66cc; border: 1px solid rgba(255,102,204,0.25); }
	.pc-stats {
		display: grid; grid-template-columns: repeat(3, 1fr);
		gap: 8px; padding: 10px;
		background: rgba(255,255,255,0.02); border: 1px solid #1f1f1f; border-radius: 10px;
		margin-top: 10px;
	}
	.pc-stats div { text-align: center; }
	.pc-stats div + div { border-left: 1px solid #1f1f1f; }
	.pc-stats strong {
		display: block;
		font-family: 'Courier New', monospace;
		color: #fff; font-weight: 900; font-size: 14px;
	}
	.pc-stats strong.up { color: #00ff66; }
	.pc-stats strong.down { color: #ff6b6b; }
	.pc-stats span {
		display: block;
		font-size: 9px; color: #666;
		font-family: 'Courier New', monospace; letter-spacing: 0.06em;
		margin-top: 2px;
	}

	.post-list { display: flex; flex-direction: column; gap: 10px; width: 100%; }

	.feed-split {
		display: grid;
		grid-template-columns: 1fr 380px;
		gap: 16px;
		align-items: stretch;
		height: 78vh;
		min-height: 560px;
		max-height: 880px;
	}
	.posts-col {
		min-width: 0;
		overflow-y: auto;
		padding-right: 6px;
	}
	.posts-col::-webkit-scrollbar { width: 6px; }
	.posts-col::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
	.posts-col::-webkit-scrollbar-track { background: transparent; }
	.chat-col {
		min-width: 0;
		height: 100%;
		display: flex;
	}
	.chat-col :global(.chat-shell) { flex: 1; }
	.chat-placeholder {
		flex: 1;
		display: flex; align-items: center; justify-content: center;
		gap: 10px;
		border: 1px dashed #2a2a2a; border-radius: 12px;
		background: rgba(255,255,255,0.02);
		color: #777; font-size: 12px;
		font-family: 'Courier New', monospace; letter-spacing: 0.06em;
		text-align: center;
	}
	.cp-dot {
		width: 7px; height: 7px; border-radius: 50%;
		background: #ff3b3b;
		box-shadow: 0 0 8px rgba(255,59,59,0.7);
		animation: chat-pulse 1.6s infinite;
	}

	.placeholder {
		padding: 40px 18px; text-align: center;
		color: #777; font-size: 13px;
		font-family: 'Courier New', monospace;
		display: flex; flex-direction: column; gap: 12px; align-items: center;
	}
	.reset {
		background: transparent; border: none;
		color: #ff5a00; font-size: 12px; cursor: pointer;
		font-family: 'Courier New', monospace;
	}
	.reset:hover { color: #ffb733; text-decoration: underline; }

	@media (max-width: 1100px) {
		.feed-split { grid-template-columns: 1fr 340px; }
	}
	@media (max-width: 900px) {
		.feed-split {
			grid-template-columns: 1fr;
			height: auto; min-height: 0; max-height: none;
		}
		.posts-col { overflow-y: visible; padding-right: 0; }
		.chat-col { height: 60vh; min-height: 480px; }
	}
	@media (max-width: 960px) { .profile-grid { grid-template-columns: repeat(2, 1fr); } }
	@media (max-width: 640px) { .profile-grid { grid-template-columns: 1fr; } }
</style>
