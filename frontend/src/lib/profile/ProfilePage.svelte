<script lang="ts">
	import { onMount } from 'svelte';
	import { walletStore } from '$lib/wallet/stores';
	import {
		fetchProfile,
		updateAvatar,
		updateBanner,
		fetchPostedTrades,
		fetchPostedStrategies,
		unpostTrade,
		type PostedTrade,
		type PostedStrategy
	} from '$lib/supabase';
	import SocialPostCard from '$lib/components/social/SocialPostCard.svelte';
	import MintCardModal from '$lib/profile/MintCardModal.svelte';
	import type { SharedTrade, TradeDirection, MarketType } from '$lib/social/types';

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let loading = true;
	let copied = false;

	// DB profile
	let profileUsername = '';
	let profileAvatarUrl = '';
	let profileBannerUrl = '';

	let uploadingAvatar = false;
	let uploadingBanner = false;
	let avatarInput: HTMLInputElement;
	let bannerInput: HTMLInputElement;

	// Posts
	let postedTrades: PostedTrade[] = [];
	let postedStrategies: PostedStrategy[] = [];
	let postsLoading = false;
	let postsError = '';

	type Filter = 'all' | 'trades' | 'strategies';
	let filter: Filter = 'all';

	let mintModalOpen = false;

	function walletAddress(): string {
		return wallet?.publicKey?.toBase58 ? wallet.publicKey.toBase58() : wallet?.publicKey?.toString?.() || '';
	}

	function short(addr: string) {
		if (!addr) return '';
		return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
	}

	const BLOCKBERG_PAIR_SYMBOLS: Record<number, string> = {
		0: 'BTC/USDT',
		1: 'ETH/USDT',
		2: 'BNB/USDT',
		3: 'SOL/USDT',
		4: 'XRP/USDT'
	};

	async function loadProfile() {
		const addr = walletAddress();
		if (!addr) return;
		const p = await fetchProfile(addr);
		profileUsername = p?.username || '';
		profileAvatarUrl = p?.avatar_url || '';
		profileBannerUrl = p?.banner_url || '';
	}

	async function loadPosts() {
		const addr = walletAddress();
		if (!addr) return;
		postsLoading = true;
		postsError = '';
		try {
			const [t, s] = await Promise.all([fetchPostedTrades(addr), fetchPostedStrategies(addr)]);
			// Profile shows only what the user explicitly posted to the community,
			// not every closed trade we auto-sync to Supabase.
			postedTrades = t.filter((row) => row.posted === true || row.is_published === true);
			postedStrategies = s.filter((row) => row.is_published === true);
		} catch (err: any) {
			postsError = err?.message ?? 'Failed to load posts';
		} finally {
			postsLoading = false;
		}
	}

	function num(v: any): number | undefined {
		if (v === null || v === undefined) return undefined;
		const n = typeof v === 'number' ? v : Number(v);
		return Number.isFinite(n) ? n : undefined;
	}

	function mapTrade(t: PostedTrade): SharedTrade {
		const isBlockberg = (t.source || '').toLowerCase().includes('blockberg');
		// Prefer the stored canonical title; for crypto rows append /USDT if it's
		// a bare ticker. Fall back to the pair-index lookup for legacy rows.
		const rawTitle = t.market_title || null;
		let asset: string;
		if (isBlockberg) {
			if (rawTitle) asset = rawTitle.includes('/') ? rawTitle : `${rawTitle}/USDT`;
			else if (t.pair_index !== null && t.pair_index !== undefined)
				asset = BLOCKBERG_PAIR_SYMBOLS[t.pair_index] || `PAIR #${t.pair_index}`;
			else asset = t.market_id || 'Market';
		} else {
			asset = rawTitle || t.market_id || 'Market';
		}
		const posType = (t.position_type || '').toLowerCase();
		const direction: TradeDirection =
			posType === 'long' || posType === 'short' || posType === 'yes' || posType === 'no'
				? (posType as TradeDirection)
				: 'long';
		const entry = num(t.entry_price) ?? 0;
		const exit = num(t.exit_price);
		const pnl = num(t.pnl) ?? 0;
		const margin = num(t.margin_usd);
		// Prefer return-on-margin for perps (so a small price move on a 3× position
		// shows the levered % the user actually realized); fall back to price change.
		const pnlPct =
			margin && margin > 0
				? (pnl / margin) * 100
				: entry > 0 && exit !== undefined
					? ((exit - entry) / entry) * 100
					: 0;
		const isPolymarket = (t.source || '').toLowerCase() === 'polymarket';
		const isTraditional = (t.source || '').toLowerCase() === 'traditional';
		const marketType: MarketType = isPolymarket
			? 'prediction'
			: isBlockberg
				? 'crypto'
				: isTraditional
					? 'stocks'
					: 'crypto';
		return {
			id: `profile-trade-${t.id}`,
			dbId: t.id,
			positionKey: t.position_key ?? undefined,
			isFromDb: true,
			dbType: 'trade',
			authorUserId: t.user_id ?? undefined,
			username: profileUsername || short(walletAddress()),
			avatarUrl: profileAvatarUrl || undefined,
			marketType,
			tradeType: 'paper-trade',
			asset,
			direction,
			entryPrice: entry,
			exitPrice: exit ?? null,
			pnl,
			pnlPercent: pnlPct,
			duration: '',
			timestamp: t.opened_at || t.created_at || new Date().toISOString(),
			comment: t.analysis || undefined,
			likes: t.likes_count || 0,
			commentCount: t.comments_count || 0,
			amount: num(t.amount),
			takeProfit: num(t.take_profit_price),
			stopLoss: num(t.stop_loss_price),
			status: t.status || undefined,
			platform: t.platform || t.source || undefined,
			tradeMode: t.trade_mode || undefined,
			orderType: t.order_type || undefined,
			leverage: t.leverage != null ? Number(t.leverage) : undefined,
			marginUsd: margin ?? undefined,
			liquidationPrice: t.liquidation_price != null ? Number(t.liquidation_price) : undefined,
			closePrice: t.close_price != null ? Number(t.close_price) : undefined,
			closedAt: t.closed_at || undefined,
			realizedPnl: t.realized_pnl != null ? Number(t.realized_pnl) : undefined
		};
	}

	function mapStrategy(s: PostedStrategy): SharedTrade {
		const roi = num(s.total_return_percent) ?? 0;
		const initial = num(s.initial_capital);
		const final = num(s.final_capital);
		const platform = Array.isArray(s.platform)
			? s.platform.join(', ')
			: (s.platform as any) || undefined;
		const equity = Array.isArray(s.equity_curve)
			? (s.equity_curve as any[])
					.filter((p: any) => p?.timestamp && p?.equity != null)
					.map((p: any) => ({ timestamp: p.timestamp, equity: Number(p.equity) }))
			: undefined;
		return {
			id: `profile-strat-${s.id}`,
			dbId: s.id,
			isFromDb: true,
			dbType: 'strategy',
			authorUserId: s.user_id ?? undefined,
			username: profileUsername || short(walletAddress()),
			avatarUrl: profileAvatarUrl || undefined,
			marketType: 'prediction',
			tradeType: 'backtest',
			asset: s.strategy_name || 'Strategy',
			direction: roi >= 0 ? 'long' : 'short',
			entryPrice: 0,
			exitPrice: null,
			pnl: (final ?? 0) - (initial ?? 0),
			pnlPercent: roi,
			duration: '',
			strategy: s.strategy_name || undefined,
			timestamp: s.created_at || new Date().toISOString(),
			comment: s.description || s.backtest_data?.description || undefined,
			likes: s.likes_count || 0,
			commentCount: s.comments_count || 0,
			winRate: num(s.win_rate),
			sharpeRatio: num(s.sharpe_ratio),
			maxDrawdown: num(s.max_drawdown_percent) ?? num(s.max_drawdown),
			totalTrades: s.total_trades ?? undefined,
			profitFactor: num(s.profit_factor),
			startBalance: initial,
			endBalance: final,
			initialCapital: initial,
			finalCapital: final,
			winningTrades: s.winning_trades ?? undefined,
			losingTrades: s.losing_trades ?? undefined,
			equityCurveRaw: equity && equity.length >= 2 ? equity : undefined,
			entryType: s.entry_type || undefined,
			backtestStopLoss: num(s.stop_loss),
			backtestTakeProfit: num(s.take_profit),
			positionSizingType: s.position_sizing_type || undefined,
			positionSizingValue: num(s.position_sizing_value),
			platform,
			description: s.description || undefined,
			strategyType: s.strategy_type || undefined,
			avgHoldTime: num(s.avg_hold_time),
			marketsAnalyzed: s.markets_analyzed ?? undefined,
			executionTime: s.execution_time ?? undefined,
			strategyConfig: s.backtest_data?.strategyConfig || undefined
		};
	}

	async function handleUnpostTrade(item: SharedTrade) {
		const addr = walletAddress();
		if (!addr || !item.dbId) return;
		const res = await unpostTrade(addr, {
			tradeId: item.dbId,
			positionKey: item.positionKey ?? null
		});
		if (!res.ok) {
			alert(res.error || 'Failed to remove post.');
			return;
		}
		// Drop locally so the list re-renders without a refetch round-trip.
		postedTrades = postedTrades.filter((t) => t.id !== item.dbId);
	}

	async function handleAvatarUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		const addr = walletAddress();
		if (!file || !addr) return;
		if (!file.type.startsWith('image/')) return alert('Please select an image file');
		if (file.size > 2 * 1024 * 1024) return alert('Image must be under 2MB');

		const sb = (await import('$lib/supabase')).getSupabase?.() ?? null;
		if (!sb) return alert('Supabase is not configured');

		uploadingAvatar = true;
		try {
			const ext = file.name.split('.').pop() || 'png';
			const path = `${addr}.${ext}`;

			const { data: existing } = await sb.storage.from('avatar').list('', { search: addr });
			if (existing?.length) await sb.storage.from('avatar').remove(existing.map((f: any) => f.name));

			const { error: upErr } = await sb.storage.from('avatar').upload(path, file, { upsert: true });
			if (upErr) throw new Error(upErr.message);

			const { data: urlData } = sb.storage.from('avatar').getPublicUrl(path);
			const url = `${urlData.publicUrl}?t=${Date.now()}`;
			await updateAvatar(addr, url);

			profileAvatarUrl = url;
			walletStore.update((s) => ({ ...s, avatarUrl: url }));
		} catch (err: any) {
			alert(`Failed to upload avatar: ${err?.message ?? err}`);
		} finally {
			uploadingAvatar = false;
		}
	}

	async function handleBannerUpload(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		const addr = walletAddress();
		if (!file || !addr) return;
		if (!file.type.startsWith('image/')) return alert('Please select an image file');
		if (file.size > 5 * 1024 * 1024) return alert('Image must be under 5MB');

		const sb = (await import('$lib/supabase')).getSupabase?.() ?? null;
		if (!sb) return alert('Supabase is not configured');

		uploadingBanner = true;
		try {
			const ext = file.name.split('.').pop() || 'png';
			const path = `${addr}.${ext}`;

			const { data: existing } = await sb.storage.from('banner').list('', { search: addr });
			if (existing?.length) await sb.storage.from('banner').remove(existing.map((f: any) => f.name));

			const { error: upErr } = await sb.storage.from('banner').upload(path, file, { upsert: true });
			if (upErr) throw new Error(upErr.message);

			const { data: urlData } = sb.storage.from('banner').getPublicUrl(path);
			const url = `${urlData.publicUrl}?t=${Date.now()}`;
			await updateBanner(addr, url);

			profileBannerUrl = url;
			walletStore.update((s) => ({ ...s, bannerUrl: url }));
		} catch (err: any) {
			alert(`Failed to upload banner: ${err?.message ?? err}`);
		} finally {
			uploadingBanner = false;
		}
	}

	$: feed = (() => {
		const trades: SharedTrade[] =
			filter === 'strategies' ? [] : postedTrades.map(mapTrade);
		const strats: SharedTrade[] =
			filter === 'trades' ? [] : postedStrategies.map(mapStrategy);
		const items = [...trades, ...strats];
		items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
		return items;
	})();

	onMount(async () => {
		loading = false;
	});

	let lastLoadedWallet: string | null = null;
	$: {
		const addr = walletAddress();
		if (wallet.connected && addr && addr !== lastLoadedWallet) {
			lastLoadedWallet = addr;
			void Promise.all([loadProfile(), loadPosts()]);
		}
	}
</script>

<main class="page">
	{#if loading}
		<div class="pad"><div class="placeholder">Loading…</div></div>
	{:else if !wallet.connected}
		<div class="pad"><div class="placeholder">Connect a wallet to view your profile.</div></div>
	{:else}
		<!-- Full-bleed banner hero -->
		<section class="hero">
			<div class="banner" role="button" tabindex="0" on:click={() => bannerInput.click()}>
				{#if profileBannerUrl}
					<img src={profileBannerUrl} alt="banner" referrerpolicy="no-referrer" />
				{:else}
					<div class="banner-fallback"></div>
				{/if}
				<div class="banner-shade"></div>
				<div class="banner-action">
					{uploadingBanner ? 'UPLOADING…' : profileBannerUrl ? 'CHANGE BANNER' : 'ADD BANNER'}
				</div>
				<input type="file" accept="image/*" bind:this={bannerInput} on:change={handleBannerUpload} style="display:none" />
			</div>

			<div class="hero-inner">
				<div class="avatar" role="button" tabindex="0" on:click={() => avatarInput.click()}>
					{#if profileAvatarUrl}
						<img src={profileAvatarUrl} alt="avatar" referrerpolicy="no-referrer" />
					{:else}
						<div class="avatar-fallback">{(profileUsername[0] || walletAddress()[0] || '?').toUpperCase()}</div>
					{/if}
					<div class="avatar-action">{uploadingAvatar ? '…' : 'EDIT'}</div>
					<input type="file" accept="image/*" bind:this={avatarInput} on:change={handleAvatarUpload} style="display:none" />
				</div>

				<div class="meta">
					<div class="uname">{profileUsername ? `@${profileUsername}` : short(walletAddress())}</div>
					<div
						class="addr"
						title="Click to copy"
						role="button"
						tabindex="0"
						on:click={() => {
							navigator.clipboard.writeText(walletAddress());
							copied = true;
							setTimeout(() => (copied = false), 1200);
						}}
					>
						{copied ? 'COPIED' : walletAddress()}
					</div>
				</div>

				<div class="hero-actions">
					<button class="mint-btn" on:click={() => (mintModalOpen = true)}>
						<span class="dot"></span>
						MINT TRADER CARD
					</button>
				</div>
			</div>
		</section>

		<MintCardModal open={mintModalOpen} onClose={() => (mintModalOpen = false)} />

		<div class="pad">
			<!-- Tabs under hero -->
			<div class="tabs">
				<button class="tab" class:active={filter === 'all'} on:click={() => (filter = 'all')}>ALL</button>
				<button class="tab" class:active={filter === 'trades'} on:click={() => (filter = 'trades')}>TRADES</button>
				<button class="tab" class:active={filter === 'strategies'} on:click={() => (filter = 'strategies')}>STRATEGIES</button>
				<span class="spacer"></span>
				<a class="link" href="/history">OPEN FULL HISTORY →</a>
			</div>

			<!-- Recap of every post (combined feed) -->
			<section class="card">
				<div class="card-head">POSTS RECAP</div>
				{#if postsError}
					<div class="placeholder err">{postsError}</div>
				{:else if postsLoading}
					<div class="placeholder">Loading posts…</div>
				{:else if feed.length === 0}
					<div class="placeholder subtle">No posts yet.</div>
				{:else}
					<div class="posts">
						{#each feed as item (item.id)}
							<SocialPostCard
								trade={item}
								readonly={true}
								onUnpost={item.dbType === 'trade' ? handleUnpostTrade : null}
							/>
						{/each}
					</div>
				{/if}
			</section>
		</div>
	{/if}
</main>

<style>
	.page {
		min-height: calc(100vh - 100px);
		background: #0a0a0a;
		color: #ccc;
		font-family: 'Courier New', monospace;
	}
	.pad {
		max-width: 1200px;
		margin: 0 auto;
		padding: 18px 16px;
	}

	.tabs {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 12px 0 2px;
	}
	.tab {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
	}
	.tab.active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0,0.05); }
	.spacer { flex: 1; }
	.link { color: #aaa; text-decoration: none; font-size: 11px; }
	.link:hover { color: #ff5a00; }

	/* Full bleed */
	.hero {
		width: 100vw;
		margin-left: calc(50% - 50vw);
		margin-right: calc(50% - 50vw);
		border-top: 1px solid #111;
		border-bottom: 1px solid #111;
		background: #000;
	}
	.banner {
		position: relative;
		height: 320px;
		cursor: pointer;
	}
	.banner img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.banner-fallback {
		width: 100%;
		height: 100%;
		background:
			radial-gradient(circle at 25% 25%, rgba(255, 90, 0, 0.30), transparent 55%),
			linear-gradient(180deg, #080808 0%, #000 100%);
	}
	.banner-shade {
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, rgba(0,0,0,0.15) 0%, rgba(0,0,0,0.85) 86%);
		pointer-events: none;
	}
	.banner-action {
		position: absolute;
		right: 18px;
		bottom: 18px;
		background: rgba(0,0,0,0.6);
		border: 1px solid #333;
		padding: 8px 12px;
		border-radius: 3px;
		color: #ff5a00;
		font-size: 10px;
		letter-spacing: 0.12em;
	}
	.hero-inner {
		max-width: 1200px;
		margin: 0 auto;
		padding: 0 16px 22px;
		display: flex;
		gap: 18px;
		align-items: flex-end;
		margin-top: -78px;
	}
	.avatar {
		width: 140px;
		height: 140px;
		border-radius: 50%;
		overflow: hidden;
		border: 2px solid #222;
		background: #000;
		position: relative;
		cursor: pointer;
		box-shadow: 0 0 0 2px rgba(255, 90, 0,0.08) inset;
		flex-shrink: 0;
	}
	.avatar img { width: 100%; height: 100%; object-fit: cover; display: block; }
	.avatar-fallback {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #ff5a00;
		color: #000;
		font-size: 46px;
		font-weight: 900;
	}
	.avatar-action {
		position: absolute;
		right: 10px;
		bottom: 10px;
		background: rgba(0,0,0,0.7);
		border: 1px solid #333;
		padding: 3px 8px;
		border-radius: 3px;
		font-size: 10px;
		color: #ccc;
	}
	.meta { min-width: 0; padding-bottom: 10px; flex: 1; }

	.hero-actions {
		padding-bottom: 10px;
		display: flex;
		align-items: flex-end;
	}
	.mint-btn {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		background: #ff5a00;
		border: 1px solid #ff5a00;
		color: #000;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.14em;
		padding: 10px 16px;
		border-radius: 6px;
		cursor: pointer;
		box-shadow: 0 6px 24px rgba(255, 90, 0, 0.25);
	}
	.mint-btn:hover { background: #ff7a2c; border-color: #ff7a2c; }
	.mint-btn .dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #000;
		box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.25) inset;
	}
	.uname { color: #ff5a00; font-size: 22px; font-weight: 900; letter-spacing: 0.04em; }
	.addr {
		color: #aaa;
		font-size: 12px;
		margin-top: 8px;
		max-width: 1000px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
	}
	.addr:hover { color: #ff5a00; }

	.card {
		background: #121212;
		border: 1px solid #222;
		border-radius: 10px;
		margin-top: 12px;
		overflow: hidden;
	}
	.card-head {
		padding: 10px 12px;
		border-bottom: 1px solid #222;
		color: #888;
		font-size: 11px;
		letter-spacing: 0.12em;
		font-weight: bold;
	}
	.placeholder {
		padding: 2rem 1rem;
		text-align: center;
		color: #666;
		font-size: 12px;
	}
	.placeholder.subtle { padding: 1rem; }
	.placeholder.err { color: #ff6b6b; }

	.posts {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 16px 12px 18px;
	}

	@media (max-width: 860px) {
		.banner { height: 240px; }
		.hero-inner { margin-top: -64px; flex-direction: column; align-items: flex-start; }
		.avatar { width: 120px; height: 120px; }
	}
</style>

