<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import SocialEquityChart from './SocialEquityChart.svelte';
	import {
		fetchComments,
		toggleLike,
		checkLiked,
		addComment,
		deleteComment,
		editComment,
		MARKET_TYPE_LABELS,
		type SharedTrade,
		type FeedComment,
		type ConnectedSocialUser
	} from '$lib/social/types';

	export let trade: SharedTrade;
	export let connectedUser: ConnectedSocialUser | null = null;
	export let followingIds: Set<string> = new Set();
	export let onToggleFollow: (userId: string) => Promise<void> | void = () => {};
	export let readonly: boolean = false;
	/** Optional handler to remove the post from the public feed.
	 * When provided, an UNPOST button is rendered in the footer. */
	export let onUnpost: ((trade: SharedTrade) => Promise<void> | void) | null = null;

	let unposting = false;
	async function handleUnpost(e: MouseEvent) {
		e.stopPropagation();
		if (!onUnpost || unposting) return;
		if (!confirm('Remove this trade from the community feed?')) return;
		unposting = true;
		try {
			await onUnpost(trade);
		} finally {
			unposting = false;
		}
	}

	let showDetail = false;
	let commentText = '';
	let comments: FeedComment[] = [];
	let commentsLoaded = !trade.isFromDb;
	let liked = false;
	let likeCount = trade.likes;
	let likeChecked = false;
	let likeMessage: string | null = null;
	let submittingComment = false;
	let editingIdx: number | null = null;
	let editText = '';

	$: canFollow =
		!!connectedUser &&
		!!trade.authorUserId &&
		trade.authorUserId !== connectedUser.userId;
	$: isFollowing = !!trade.authorUserId && followingIds.has(trade.authorUserId);

	async function handleFollowClick(e: MouseEvent) {
		e.stopPropagation();
		if (!canFollow || !trade.authorUserId) return;
		await onToggleFollow(trade.authorUserId);
	}

	$: isPositive = trade.pnl >= 0;
	$: isPaper = trade.tradeType === 'paper-trade';
	$: isLongish = trade.direction === 'long' || trade.direction === 'yes';
	$: ts = new Date(trade.timestamp);
	$: dateStr = ts.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	$: timeStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
	$: commentCount = commentsLoaded ? comments.length : trade.commentCount || 0;

	function formatPrice(p: number) {
		if (!p && p !== 0) return '—';
		if (Math.abs(p) < 10) return `$${p.toFixed(3)}`;
		return `$${p.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
	}

	/** Render a percent that is non-zero but rounds to 0.00 with extra
	 *  precision, so a tiny realised loss never shows as "0.00%". */
	function formatPct(p: number): string {
		if (!Number.isFinite(p) || p === 0) return '0.00';
		const abs = Math.abs(p);
		if (abs >= 0.01) return p.toFixed(2);
		if (abs >= 0.0001) return p.toFixed(4);
		return p.toExponential(1);
	}

	function showLikeMessage(msg: string) {
		likeMessage = msg;
		setTimeout(() => {
			if (likeMessage === msg) likeMessage = null;
		}, 2000);
	}

	async function ensureLikeChecked() {
		if (!connectedUser || !trade.isFromDb || !trade.dbId || likeChecked) return;
		liked = await checkLiked(connectedUser.userId, trade.dbId, trade.dbType || 'trade');
		likeChecked = true;
	}

	$: if (connectedUser && trade.isFromDb) ensureLikeChecked();

	async function loadDbComments() {
		if (!trade.isFromDb || !trade.dbId || commentsLoaded) return;
		comments = await fetchComments(trade.dbId, trade.dbType || 'trade');
		commentsLoaded = true;
	}

	async function handleLike(e: MouseEvent) {
		e.stopPropagation();
		if (!connectedUser) {
			showLikeMessage('Connect to like posts');
			return;
		}
		const wasLiked = liked;
		liked = !wasLiked;
		likeCount = wasLiked ? Math.max(0, likeCount - 1) : likeCount + 1;
		if (trade.isFromDb && trade.dbId) {
			const res = await toggleLike(
				connectedUser.userId,
				trade.dbId,
				trade.dbType || 'trade',
				!wasLiked,
				likeCount
			);
			if (!res.ok) {
				liked = wasLiked;
				likeCount = wasLiked ? likeCount + 1 : Math.max(0, likeCount - 1);
				showLikeMessage(res.error || 'Failed');
			}
		}
	}

	async function handleAddComment() {
		const trimmed = commentText.trim();
		if (!trimmed || !connectedUser) return;
		submittingComment = true;
		commentText = '';
		if (trade.isFromDb && trade.dbId) {
			const res = await addComment(
				trade.dbId,
				trade.dbType || 'trade',
				connectedUser.userId,
				trimmed,
				comments.length + 1
			);
			comments = [
				...comments,
				{
					id: res.id,
					userId: connectedUser.userId,
					user: connectedUser.username,
					text: trimmed,
					avatarUrl: connectedUser.avatarUrl || undefined
				}
			];
		} else {
			comments = [
				...comments,
				{
					user: connectedUser.username,
					text: trimmed,
					avatarUrl: connectedUser.avatarUrl || undefined
				}
			];
		}
		submittingComment = false;
	}

	async function handleDeleteComment(idx: number) {
		const c = comments[idx];
		if (!c) return;
		comments = comments.filter((_, i) => i !== idx);
		if (trade.isFromDb && trade.dbId && c.id) {
			await deleteComment(c.id, trade.dbId, trade.dbType || 'trade', comments.length);
		}
	}

	async function handleEditComment(idx: number) {
		const trimmed = editText.trim();
		if (!trimmed) return;
		const c = comments[idx];
		if (!c) return;
		comments = comments.map((it, i) => (i === idx ? { ...it, text: trimmed } : it));
		editingIdx = null;
		editText = '';
		if (trade.isFromDb && c.id) {
			await editComment(c.id, trade.dbType || 'trade', trimmed);
		}
	}

	function openDetail() {
		showDetail = true;
		if (trade.isFromDb) loadDbComments();
	}

	function closeDetail(e?: MouseEvent) {
		if (e) e.stopPropagation();
		showDetail = false;
	}

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) showDetail = false;
	}

	function onKeyDownInput(e: KeyboardEvent) {
		if (e.key === 'Enter') handleAddComment();
	}

	function onEditKeydown(e: KeyboardEvent, idx: number) {
		if (e.key === 'Enter') handleEditComment(idx);
	}

	$: if (typeof document !== 'undefined') {
		document.body.style.overflow = showDetail ? 'hidden' : '';
	}

	onDestroy(() => {
		if (typeof document !== 'undefined') document.body.style.overflow = '';
	});

	function configItems() {
		const sc = trade.strategyConfig;
		const items: { label: string; value: string; color?: string }[] = [];
		if (sc?.strategyType || trade.strategyType) items.push({ label: 'Strategy', value: sc?.strategyType || trade.strategyType || '' });
		if (trade.entryType) items.push({ label: 'Entry Type', value: trade.entryType });
		if (sc?.position) items.push({ label: 'Side', value: sc.position });
		if (sc?.priceInf != null && sc?.priceSup != null) items.push({ label: 'Price Range', value: `${sc.priceInf} — ${sc.priceSup}` });
		if (sc?.amount != null) items.push({ label: 'Amount', value: `$${sc.amount}` });
		if (sc?.threshold != null) items.push({ label: 'Threshold', value: String(sc.threshold) });
		if (trade.positionSizingType) items.push({ label: 'Sizing', value: `${trade.positionSizingType}${trade.positionSizingValue != null ? ` (${trade.positionSizingValue}${trade.positionSizingType === 'PERCENTAGE' ? '%' : ''})` : ''}` });
		if (trade.backtestTakeProfit != null && trade.backtestTakeProfit > 0) items.push({ label: 'Take Profit', value: `${(trade.backtestTakeProfit * 100).toFixed(0)}%`, color: 'tp' });
		if (trade.backtestStopLoss != null && trade.backtestStopLoss > 0) items.push({ label: 'Stop Loss', value: `${(trade.backtestStopLoss * 100).toFixed(0)}%`, color: 'sl' });
		if (sc?.trailingStop != null) items.push({ label: 'Trailing Stop', value: `${(sc.trailingStop * 100).toFixed(0)}%` });
		if (sc?.maxHoldHours != null) items.push({ label: 'Max Hold', value: `${sc.maxHoldHours}h` });
		if (sc?.cooldownHours != null) items.push({ label: 'Cooldown', value: `${sc.cooldownHours}h` });
		return items;
	}

	$: cfgItems = configItems();
</script>

<!-- Feed row -->
<div
	class="post-row"
	class:readonly
	on:click={readonly ? undefined : openDetail}
	role={readonly ? undefined : 'button'}
	tabindex={readonly ? -1 : 0}
	on:keydown={(e) => !readonly && e.key === 'Enter' && openDetail()}
>
	<div class="avatar">
		{#if trade.avatarUrl}
			<img src={trade.avatarUrl} alt={trade.username} />
		{:else}
			<div class="avatar-fallback">{trade.username[0]?.toUpperCase()}</div>
		{/if}
	</div>

	<div class="content">
		<div class="head-row">
			<div class="head-left">
				<span class="username">@{trade.username}</span>
				{#if canFollow}
					<button
						class="follow-btn"
						class:following={isFollowing}
						on:click={handleFollowClick}
						title={isFollowing ? 'Unfollow' : 'Follow'}
					>
						{isFollowing ? 'Following' : 'Follow'}
					</button>
				{/if}
				<span class="dot">·</span>
				<span class="time">{dateStr}, {timeStr}</span>
				<span class="chip type" class:strategy={!isPaper}>{isPaper ? 'TRADE' : 'STRATEGY'}</span>
				{#if isPaper}
					<span class="chip dir" class:up={isLongish} class:down={!isLongish}>{trade.direction.toUpperCase()}</span>
				{/if}
				<span class="chip market">{MARKET_TYPE_LABELS[trade.marketType]}</span>
				{#if isPaper && trade.tradeMode && trade.tradeMode !== 'prediction'}
					<span class="chip mode">{trade.tradeMode.toUpperCase()}</span>
				{/if}
				{#if isPaper && trade.tradeMode === 'perp' && trade.leverage && trade.leverage > 1}
					<span class="chip lev">{trade.leverage}×</span>
				{/if}
				{#if isPaper && trade.orderType === 'limit'}
					<span class="chip ord">LIMIT</span>
				{/if}
				{#if trade.platform && trade.platform.toLowerCase() !== 'blockberg'}
					<span class="chip plat">{trade.platform.toUpperCase()}</span>
				{/if}
			</div>
			<div class="pnl">
				<span class="pnl-pct" class:up={isPositive} class:down={!isPositive}>
					{isPositive ? '+' : ''}{formatPct(trade.pnlPercent)}%
				</span>
				{#if isPaper}
					<span class="pnl-abs" class:up={isPositive} class:down={!isPositive}>
						{isPositive ? '+' : ''}${Math.abs(trade.pnl).toFixed(2)}
					</span>
				{/if}
			</div>
		</div>

		<div class="body">
			<p class="asset" class:long={isLongish && isPaper} class:short={!isLongish && isPaper} class:strat={!isPaper}>
				{trade.asset}
			</p>
			{#if trade.comment}
				<p class="body-text">{trade.comment}</p>
			{/if}
			{#if readonly && !isPaper && trade.equityCurveRaw && trade.equityCurveRaw.length >= 2}
				<div class="chart-card inline">
					<div class="chart-head">
						<span>EQUITY CURVE</span>
						<span class="chart-pct" class:up={isPositive} class:down={!isPositive}>
							{isPositive ? '+' : ''}{formatPct(trade.pnlPercent)}%
						</span>
					</div>
					<SocialEquityChart rawData={trade.equityCurveRaw} positive={isPositive} height={140} />
				</div>
			{/if}
			{#if !isPaper && trade.equityCurveRaw && trade.equityCurveRaw.length >= 2}
				<div class="mini-stats">
					{#if trade.winRate != null}
						<span><em>WIN</em><strong class:up={trade.winRate >= 50} class:down={trade.winRate < 50}>{trade.winRate.toFixed(0)}%</strong></span>
					{/if}
					{#if trade.totalTrades != null}
						<span><em>TRADES</em><strong>{trade.totalTrades}</strong></span>
					{/if}
					{#if trade.sharpeRatio != null}
						<span><em>SHARPE</em><strong>{trade.sharpeRatio.toFixed(2)}</strong></span>
					{/if}
					{#if trade.maxDrawdown != null}
						<span><em>MAX DD</em><strong class="down">{trade.maxDrawdown.toFixed(1)}%</strong></span>
					{/if}
				</div>
			{/if}
		</div>

		<div class="footer">
			<div class="like-wrap">
				<button class="action-btn" class:liked on:click={handleLike}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6">
						<path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
					</svg>
					<span>{likeCount}</span>
				</button>
				{#if likeMessage}
					<div class="like-toast">{likeMessage}</div>
				{/if}
			</div>
			{#if readonly}
				<span class="action-btn static">
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
					</svg>
					<span>{commentCount}</span>
				</span>
				{#if onUnpost}
					<button class="action-btn unpost" disabled={unposting} on:click={handleUnpost}>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 7h12M9 7V5a2 2 0 012-2h2a2 2 0 012 2v2m-6 4v6m4-6v6M5 7l1 13a2 2 0 002 2h8a2 2 0 002-2l1-13" />
						</svg>
						<span>{unposting ? 'REMOVING…' : 'UNPOST'}</span>
					</button>
				{/if}
			{:else}
				<button class="action-btn" on:click={(e) => { e.stopPropagation(); openDetail(); }}>
					<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
					</svg>
					<span>{commentCount}</span>
				</button>
				<button class="action-btn ghost" on:click={(e) => { e.stopPropagation(); openDetail(); }}>
					<span>View details →</span>
				</button>
			{/if}
		</div>
	</div>
</div>

<!-- Detail modal -->
{#if showDetail}
	<div
		class="modal-backdrop"
		on:click={handleBackdropClick}
		on:keydown={(e) => { if (e.key === 'Escape') showDetail = false; }}
		role="dialog"
		aria-modal="true"
		aria-label="Post details"
		tabindex="-1"
	>
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions a11y_click_events_have_key_events -->
		<div class="modal-card" on:click|stopPropagation role="document">
			<div class="modal-head">
				<div class="head-left">
					{#if trade.avatarUrl}
						<img class="head-avatar" src={trade.avatarUrl} alt={trade.username} />
					{:else}
						<div class="head-avatar-fallback">{trade.username[0]?.toUpperCase()}</div>
					{/if}
					<div class="head-text">
						<span class="username">@{trade.username}</span>
						<span class="head-time">{dateStr}, {timeStr}</span>
					</div>
					<span class="chip type" class:strategy={!isPaper}>{isPaper ? 'TRADE' : 'STRATEGY'}</span>
				</div>
				<button class="close-btn" on:click={closeDetail} aria-label="Close">
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
					</svg>
				</button>
			</div>

			<div class="modal-body">
				<div class="row-between">
					<p class="asset-big" class:long={isLongish && isPaper} class:short={!isLongish && isPaper} class:strat={!isPaper}>
						{trade.asset}
					</p>
					<span class="pill" class:up={isPositive} class:down={!isPositive}>
						{isPaper ? trade.direction.toUpperCase() : `${isPositive ? '+' : ''}${formatPct(trade.pnlPercent)}%`}
					</span>
				</div>

				<div class="tag-row">
					<span class="market-tag">{MARKET_TYPE_LABELS[trade.marketType]}</span>
					{#if trade.platform}<span class="chip plat">{trade.platform.toUpperCase()}</span>{/if}
					{#if trade.status}<span class="chip status" class:closed={trade.status === 'closed'}>{trade.status.toUpperCase()}</span>{/if}
				</div>

				{#if trade.comment}
					<div class="comment-block">&ldquo;{trade.comment}&rdquo;</div>
				{/if}

				{#if isPaper}
					<div class="card-grid">
						{#if trade.amount != null}
							<div class="grid-item"><span>Invested</span><p>${trade.amount.toFixed(2)}</p></div>
						{/if}
						<div class="grid-item"><span>Entry</span><p>{formatPrice(trade.entryPrice)}</p></div>
						<div class="grid-item"><span>Exit</span><p>{trade.exitPrice !== null ? formatPrice(trade.exitPrice) : '—'}</p></div>
						<div class="grid-item">
							<span>P&amp;L</span>
							<p class:up={isPositive} class:down={!isPositive}>
								{isPositive ? '+' : ''}${Math.abs(trade.pnl).toFixed(2)}
								<small>({isPositive ? '+' : ''}{formatPct(trade.pnlPercent)}%)</small>
							</p>
						</div>
					</div>
					{#if trade.takeProfit != null || trade.stopLoss != null}
						<div class="tp-sl-row">
							{#if trade.takeProfit != null}
								<div class="tp-pill"><span>TP:</span><strong>{formatPrice(trade.takeProfit)}</strong></div>
							{/if}
							{#if trade.stopLoss != null}
								<div class="sl-pill"><span>SL:</span><strong>{formatPrice(trade.stopLoss)}</strong></div>
							{/if}
						</div>
					{/if}
				{:else}
					{#if trade.equityCurveRaw && trade.equityCurveRaw.length >= 2}
						<div class="chart-card">
							<div class="chart-head">
								<span>EQUITY CURVE</span>
								<span class="chart-pct" class:up={isPositive} class:down={!isPositive}>
									{isPositive ? '+' : ''}{formatPct(trade.pnlPercent)}%
								</span>
							</div>
							<SocialEquityChart rawData={trade.equityCurveRaw} positive={isPositive} />
						</div>
					{/if}

					<div class="section-title">
						<div class="bar orange"></div>
						<span>RESULTS</span>
					</div>
					<div class="stat-row">
						<div class="stat"><span>Start</span><strong>${(trade.initialCapital ?? trade.startBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong></div>
						<div class="stat"><span>Final</span><strong class:up={isPositive} class:down={!isPositive}>${(trade.finalCapital ?? trade.endBalance ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</strong></div>
						<div class="stat"><span>Return</span><strong class:up={isPositive} class:down={!isPositive}>{isPositive ? '+' : ''}{formatPct(trade.pnlPercent)}%</strong></div>
						<div class="stat"><span>Net P&amp;L</span><strong class:up={isPositive} class:down={!isPositive}>{isPositive ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)}</strong></div>
					</div>
					<div class="stat-row">
						<div class="stat"><span>Win Rate</span><strong class:up={(trade.winRate ?? 0) >= 50} class:down={(trade.winRate ?? 0) < 50}>{trade.winRate != null ? `${trade.winRate.toFixed(1)}%` : '—'}</strong></div>
						<div class="stat"><span>Trades</span><strong>{trade.totalTrades ?? '—'}</strong></div>
						<div class="stat"><span>W / L</span><strong>{trade.winningTrades ?? '—'} / {trade.losingTrades ?? '—'}</strong></div>
						<div class="stat"><span>Profit Factor</span><strong>{trade.profitFactor != null ? trade.profitFactor.toFixed(2) : '—'}</strong></div>
					</div>
					<div class="stat-row">
						<div class="stat"><span>Max DD</span><strong class="down">{trade.maxDrawdown != null ? `${trade.maxDrawdown.toFixed(1)}%` : '—'}</strong></div>
						<div class="stat"><span>Sharpe</span><strong>{trade.sharpeRatio != null ? trade.sharpeRatio.toFixed(2) : '—'}</strong></div>
						<div class="stat"><span>Avg Hold</span><strong>{trade.avgHoldTime != null ? (trade.avgHoldTime >= 24 ? `${(trade.avgHoldTime / 24).toFixed(1)}d` : `${trade.avgHoldTime.toFixed(1)}h`) : '—'}</strong></div>
						<div class="stat"><span>Markets</span><strong>{trade.marketsAnalyzed ?? '—'}</strong></div>
					</div>

					{#if cfgItems.length > 0}
						<div class="section-title">
							<div class="bar purple"></div>
							<span>CONFIGURATION</span>
						</div>
						<div class="config-card">
							{#each cfgItems as item}
								<div class="config-item">
									<span>{item.label}</span>
									<strong class:up={item.color === 'tp'} class:down={item.color === 'sl'}>{item.value}</strong>
								</div>
							{/each}
						</div>
					{/if}
				{/if}

				<div class="action-bar">
					<div class="like-wrap">
						<button class="action-btn lg" class:liked on:click={handleLike}>
							<svg width="16" height="16" viewBox="0 0 24 24" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.6">
								<path stroke-linecap="round" stroke-linejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
							</svg>
							<span>{likeCount}</span>
						</button>
						{#if likeMessage}
							<div class="like-toast">{likeMessage}</div>
						{/if}
					</div>
					<span class="comment-count">
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6">
							<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
						</svg>
						{comments.length} comments
					</span>
				</div>

				<div class="comment-list">
					{#if !commentsLoaded}
						<p class="empty">Loading…</p>
					{:else if comments.length === 0}
						<p class="empty">No comments yet. Be the first!</p>
					{:else}
						{#each comments as c, i}
							{@const isOwn = connectedUser && (c.userId === connectedUser.userId || c.user === connectedUser.username)}
							<div class="comment">
								{#if c.avatarUrl}
									<img class="c-avatar" src={c.avatarUrl} alt={c.user} />
								{:else}
									<div class="c-avatar fallback">{c.user[0]?.toUpperCase()}</div>
								{/if}
								<div class="c-body">
									<span class="c-user">@{c.user}</span>
									{#if editingIdx === i}
										<div class="c-edit">
											<input bind:value={editText} on:keydown={(e) => onEditKeydown(e, i)} />
											<button class="c-save" on:click={() => handleEditComment(i)}>Save</button>
											<button class="c-cancel" on:click={() => { editingIdx = null; editText = ''; }}>Cancel</button>
										</div>
									{:else}
										<p class="c-text">{c.text}</p>
									{/if}
								</div>
								{#if isOwn && editingIdx !== i}
									<div class="c-actions">
										<button title="Edit" on:click={() => { editingIdx = i; editText = c.text; }}>
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
											</svg>
										</button>
										<button title="Delete" class="del" on:click={() => handleDeleteComment(i)}>
											<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
												<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
											</svg>
										</button>
									</div>
								{/if}
							</div>
						{/each}
					{/if}
				</div>

				{#if connectedUser}
					<div class="comment-input-row">
						<input
							type="text"
							bind:value={commentText}
							on:keydown={onKeyDownInput}
							placeholder="Write a comment..."
						/>
						<button on:click={handleAddComment} disabled={submittingComment || !commentText.trim()}>Post</button>
					</div>
				{:else}
					<p class="empty">Connect your wallet to comment</p>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	/* ── Feed row ── */
	.post-row {
		display: flex;
		gap: 14px;
		align-items: flex-start;
		padding: 18px 20px;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 12px;
		cursor: pointer;
		transition: all 0.15s;
		width: 100%;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	.post-row:hover { border-color: rgba(255, 90, 0,0.55); background: rgba(255,255,255,0.02); }
	.post-row:focus-visible { outline: 2px solid #ff5a00; outline-offset: 2px; }
	.post-row.readonly { cursor: default; }
	.post-row.readonly:hover { border-color: #222; background: #0a0a0a; }

	.chart-card.inline { margin-bottom: 0; margin-top: 2px; }
	.action-btn.static {
		display: inline-flex; align-items: center; gap: 6px;
		color: #888; padding: 6px 10px;
		font-family: 'Courier New', monospace; font-size: 12px; font-weight: 700;
	}

	.avatar { flex-shrink: 0; }
	.avatar img,
	.avatar-fallback {
		width: 44px; height: 44px; border-radius: 50%;
		display: flex; align-items: center; justify-content: center;
		object-fit: cover; border: 1px solid #2a2a2a;
		background: rgba(255, 90, 0,0.15); color: #ff5a00;
		font-family: 'Courier New', monospace; font-weight: 800; font-size: 14px;
	}

	.content { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }

	.head-row {
		display: flex; justify-content: space-between; align-items: flex-start;
		gap: 12px;
	}
	.head-left {
		display: flex; flex-wrap: wrap; gap: 6px 8px; align-items: center;
		min-width: 0;
	}
	.username { color: #fff; font-weight: 700; font-size: 14px; }
	.dot { color: #555; font-size: 13px; }
	.time { color: #777; font-size: 12px; font-family: 'Courier New', monospace; }

	.chip {
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 800; letter-spacing: 0.08em;
		padding: 2px 8px; border-radius: 999px;
		border: 1px solid #2a2a2a; background: rgba(255,255,255,0.03);
		color: #888;
	}
	.chip.type { color: #00c8ff; border-color: rgba(0,200,255,0.3); background: rgba(0,200,255,0.08); }
	.chip.type.strategy { color: #ff66cc; border-color: rgba(255,102,204,0.32); background: rgba(255,102,204,0.08); }
	.chip.dir.up { color: #00ff66; border-color: rgba(0,255,102,0.3); background: rgba(0,255,102,0.08); }
	.chip.dir.down { color: #ff6b6b; border-color: rgba(255,107,107,0.3); background: rgba(255,107,107,0.08); }
	.chip.market { color: #ff5a00; border-color: rgba(255, 90, 0,0.3); background: rgba(255, 90, 0,0.06); }
	.chip.mode { color: #d8c46d; border-color: rgba(216,196,109,0.3); background: rgba(216,196,109,0.07); }
	.chip.lev { color: #ff5a00; border-color: rgba(255, 90, 0,0.45); background: rgba(255, 90, 0,0.12); }
	.chip.ord { color: #c0a0ff; border-color: rgba(192,160,255,0.3); background: rgba(192,160,255,0.07); }
	.chip.plat { color: #aaa; }
	.chip.status { color: #00ff66; border-color: rgba(0,255,102,0.3); background: rgba(0,255,102,0.08); }
	.chip.status.closed { color: #888; border-color: #333; background: rgba(255,255,255,0.04); }

	.follow-btn {
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 800; letter-spacing: 0.08em;
		padding: 2px 9px; border-radius: 999px;
		border: 1px solid rgba(255, 90, 0,0.45);
		background: rgba(255, 90, 0,0.08);
		color: #ff5a00; cursor: pointer;
		transition: all 0.15s;
	}
	.follow-btn:hover { background: rgba(255, 90, 0,0.18); }
	.follow-btn.following {
		border-color: #2a2a2a;
		background: rgba(255,255,255,0.03);
		color: #888;
	}
	.follow-btn.following:hover {
		border-color: rgba(255,107,107,0.45);
		background: rgba(255,107,107,0.08);
		color: #ff6b6b;
	}
	.follow-btn.following:hover::before { content: 'Unfollow'; }
	.follow-btn.following:hover { font-size: 0; }
	.follow-btn.following:hover::before { font-size: 9px; }

	.pnl {
		text-align: right; flex-shrink: 0;
		display: flex; flex-direction: column; align-items: flex-end; gap: 2px;
	}
	.pnl-pct { font-family: 'Courier New', monospace; font-size: 18px; font-weight: 900; margin: 0; line-height: 1; }
	.pnl-pct.up, .pnl-abs.up { color: #00ff66; }
	.pnl-pct.down, .pnl-abs.down { color: #ff6b6b; }
	.pnl-abs { font-family: 'Courier New', monospace; font-size: 11px; font-weight: 700; opacity: 0.75; margin: 0; }

	.body { display: flex; flex-direction: column; gap: 8px; }
	.asset {
		font-family: 'Courier New', monospace;
		font-weight: 800; font-size: 16px; margin: 0; padding: 0;
		letter-spacing: -0.01em;
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
	}
	.asset.long { color: #00ff66; }
	.asset.short { color: #ff6b6b; }
	.asset.strat { color: #ff66cc; }
	.body-text { color: #d8d8d8; font-size: 14px; line-height: 1.5; margin: 0; }

	.mini-stats {
		display: flex; flex-wrap: wrap; gap: 18px;
		padding: 10px 12px;
		background: rgba(255,255,255,0.02);
		border: 1px solid #1f1f1f;
		border-radius: 10px;
		margin-top: 2px;
	}
	.mini-stats span { display: flex; flex-direction: column; gap: 2px; font-family: 'Courier New', monospace; }
	.mini-stats em { font-style: normal; font-size: 9px; color: #777; letter-spacing: 0.08em; font-weight: 700; }
	.mini-stats strong { color: #fff; font-size: 13px; font-weight: 900; }
	.mini-stats strong.up { color: #00ff66; }
	.mini-stats strong.down { color: #ff6b6b; }

	.footer { display: flex; gap: 8px; align-items: center; margin-top: 4px; }
	.action-btn {
		display: flex; align-items: center; gap: 6px;
		background: transparent; border: 1px solid transparent;
		color: #888; padding: 6px 10px; border-radius: 999px;
		font-family: 'Courier New', monospace; font-size: 12px; font-weight: 700;
		cursor: pointer; transition: all 0.15s;
	}
	.action-btn:hover { color: #ff5a00; background: rgba(255, 90, 0,0.08); }
	.action-btn.liked { color: #ff5a00; background: rgba(255, 90, 0,0.1); }
	.action-btn.ghost { margin-left: auto; color: #777; font-size: 11px; letter-spacing: 0.04em; }
	.action-btn.ghost:hover { color: #ff5a00; background: transparent; }
	.action-btn.unpost {
		margin-left: auto;
		color: #ff6b6b;
		border: 1px solid rgba(255, 107, 107, 0.3);
		background: rgba(255, 107, 107, 0.05);
	}
	.action-btn.unpost:hover { color: #fff; background: #ff4444; border-color: #ff4444; }
	.action-btn.unpost:disabled { opacity: 0.55; cursor: not-allowed; }
	.market-tag {
		font-size: 9px; font-weight: 800; letter-spacing: 0.1em;
		color: #ff5a00; font-family: 'Courier New', monospace;
	}

	.like-wrap { position: relative; }
	.like-toast {
		position: absolute; top: -28px; left: 50%; transform: translateX(-50%);
		white-space: nowrap;
		padding: 4px 8px; border-radius: 6px;
		background: #1a1a1a; border: 1px solid #333; color: #ddd;
		font-size: 10px; font-family: 'Courier New', monospace;
		box-shadow: 0 4px 16px rgba(0,0,0,0.4);
		z-index: 5;
	}

	/* ── Modal ── */
	.modal-backdrop {
		position: fixed; inset: 0; background: rgba(0,0,0,0.82);
		backdrop-filter: blur(4px);
		display: flex; align-items: center; justify-content: center;
		padding: 16px; z-index: 200;
	}
	.modal-card {
		width: 100%; max-width: 720px; max-height: 88vh; overflow-y: auto;
		background: #0a0a0a; border: 1px solid #2a2a2a; border-radius: 14px;
		box-shadow: 0 30px 100px rgba(0,0,0,0.7);
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}
	.modal-card::-webkit-scrollbar { width: 8px; }
	.modal-card::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 4px; }

	.modal-head {
		position: sticky; top: 0; z-index: 5; background: #0a0a0a;
		display: flex; justify-content: space-between; align-items: center;
		padding: 14px 18px; border-bottom: 1px solid #1f1f1f;
	}
	.head-left { display: flex; align-items: center; gap: 10px; }
	.head-avatar, .head-avatar-fallback {
		width: 32px; height: 32px; border-radius: 50%; object-fit: cover;
		border: 1px solid #2a2a2a;
		display: flex; align-items: center; justify-content: center;
		background: rgba(255, 90, 0,0.15); color: #ff5a00;
		font-family: 'Courier New', monospace; font-weight: 800; font-size: 12px;
	}
	.head-text { display: flex; flex-direction: column; gap: 1px; }
	.head-time { color: #777; font-size: 11px; font-family: 'Courier New', monospace; }
	.close-btn {
		background: transparent; border: none; color: #888; cursor: pointer; padding: 4px;
	}
	.close-btn:hover { color: #fff; }

	.modal-body { padding: 18px; }
	.row-between { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
	.asset-big {
		font-family: 'Courier New', monospace;
		font-weight: 900; font-size: 18px; margin: 0;
	}
	.asset-big.long { color: #00ff66; }
	.asset-big.short { color: #ff6b6b; }
	.asset-big.strat { color: #ff66cc; }
	.pill {
		font-family: 'Courier New', monospace;
		font-size: 12px; font-weight: 900; padding: 4px 12px;
		border: 1px solid #333; border-radius: 999px; background: rgba(255,255,255,0.03);
	}
	.pill.up { color: #00ff66; border-color: rgba(0,255,102,0.4); background: rgba(0,255,102,0.08); }
	.pill.down { color: #ff6b6b; border-color: rgba(255,107,107,0.4); background: rgba(255,107,107,0.08); }

	.tag-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }

	.comment-block {
		padding: 12px 14px; background: rgba(255,255,255,0.02);
		border: 1px solid #1f1f1f; border-radius: 10px;
		color: #fff; font-style: italic; font-size: 13px;
		margin-bottom: 14px;
	}

	.card-grid {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
		padding: 14px; background: rgba(255,255,255,0.02);
		border: 1px solid #1f1f1f; border-radius: 10px;
		margin-bottom: 14px;
	}
	.grid-item span {
		display: block; font-size: 10px; color: #777;
		font-family: 'Courier New', monospace; letter-spacing: 0.05em; text-transform: uppercase;
	}
	.grid-item p {
		font-family: 'Courier New', monospace;
		color: #fff; font-weight: 800; font-size: 13px; margin: 4px 0 0;
	}
	.grid-item p.up { color: #00ff66; }
	.grid-item p.down { color: #ff6b6b; }
	.grid-item p small { font-size: 10px; opacity: 0.7; margin-left: 4px; }

	.tp-sl-row { display: flex; gap: 8px; margin-bottom: 14px; }
	.tp-pill, .sl-pill {
		display: flex; gap: 4px; align-items: center;
		padding: 6px 10px; border-radius: 8px;
		font-family: 'Courier New', monospace; font-size: 11px;
	}
	.tp-pill { background: rgba(0,255,102,0.08); border: 1px solid rgba(0,255,102,0.25); }
	.tp-pill span { color: #888; } .tp-pill strong { color: #00ff66; font-weight: 900; }
	.sl-pill { background: rgba(255,107,107,0.08); border: 1px solid rgba(255,107,107,0.25); }
	.sl-pill span { color: #888; } .sl-pill strong { color: #ff6b6b; font-weight: 900; }

	.chart-card {
		padding: 12px;
		border: 1px solid #1f1f1f; border-radius: 10px;
		background: rgba(255,255,255,0.02);
		margin-bottom: 16px;
	}
	.chart-head {
		display: flex; justify-content: space-between; align-items: center;
		margin-bottom: 6px; padding: 0 4px;
	}
	.chart-head span:first-child {
		font-family: 'Courier New', monospace;
		font-size: 10px; color: #777; letter-spacing: 0.1em; text-transform: uppercase; font-weight: 700;
	}
	.chart-pct { font-family: 'Courier New', monospace; font-size: 12px; font-weight: 900; }
	.chart-pct.up { color: #00ff66; }
	.chart-pct.down { color: #ff6b6b; }

	.section-title { display: flex; gap: 8px; align-items: center; margin: 14px 0 10px; }
	.bar { width: 4px; height: 14px; border-radius: 2px; }
	.bar.orange { background: #ff5a00; }
	.bar.purple { background: #ff66cc; }
	.section-title span {
		font-family: 'Courier New', monospace;
		font-size: 11px; color: #aaa; letter-spacing: 0.1em; font-weight: 700;
	}
	.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 8px; }
	.stat {
		text-align: center;
		padding: 8px 4px;
		background: rgba(255,255,255,0.02);
		border: 1px solid #1f1f1f; border-radius: 8px;
	}
	.stat span {
		display: block; font-size: 9px; color: #777;
		font-family: 'Courier New', monospace; letter-spacing: 0.05em; text-transform: uppercase;
		margin-bottom: 2px;
	}
	.stat strong {
		font-family: 'Courier New', monospace;
		color: #fff; font-weight: 900; font-size: 12px;
	}
	.stat strong.up { color: #00ff66; }
	.stat strong.down { color: #ff6b6b; }

	.config-card {
		padding: 12px 14px; background: rgba(255,255,255,0.02);
		border: 1px solid #1f1f1f; border-radius: 10px;
		display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px 24px;
	}
	.config-item {
		display: flex; justify-content: space-between; align-items: center;
		font-family: 'Courier New', monospace; font-size: 11px;
	}
	.config-item span { color: #777; }
	.config-item strong { color: #ff5a00; font-weight: 800; }
	.config-item strong.up { color: #00ff66; }
	.config-item strong.down { color: #ff6b6b; }

	.action-bar {
		display: flex; gap: 10px; align-items: center;
		padding: 12px 0; margin-top: 16px; border-top: 1px solid #1f1f1f;
	}
	.action-btn.lg { padding: 7px 12px; font-size: 13px; }
	.comment-count {
		display: flex; gap: 6px; align-items: center;
		color: #888; font-family: 'Courier New', monospace; font-size: 12px;
	}

	.comment-list {
		display: flex; flex-direction: column; gap: 12px;
		max-height: 240px; overflow-y: auto; margin-bottom: 14px;
	}
	.comment-list::-webkit-scrollbar { width: 6px; }
	.comment-list::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }
	.empty { color: #666; font-size: 12px; text-align: center; padding: 12px 0; font-family: 'Courier New', monospace; }

	.comment { display: flex; gap: 8px; align-items: flex-start; }
	.c-avatar {
		width: 24px; height: 24px; border-radius: 50%; object-fit: cover;
		flex-shrink: 0; margin-top: 2px;
	}
	.c-avatar.fallback {
		display: flex; align-items: center; justify-content: center;
		background: rgba(255, 90, 0,0.15); color: #ff5a00;
		font-family: 'Courier New', monospace; font-weight: 800; font-size: 10px;
	}
	.c-body { flex: 1; min-width: 0; }
	.c-user { color: #ff5a00; font-size: 11px; font-weight: 700; }
	.c-text { color: #fff; font-size: 13px; margin: 2px 0 0; }
	.c-edit { display: flex; gap: 6px; margin-top: 4px; }
	.c-edit input {
		flex: 1; background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		padding: 6px 10px; border-radius: 8px; color: #fff;
		font-size: 12px;
	}
	.c-edit input:focus { outline: none; border-color: rgba(255, 90, 0,0.5); }
	.c-save, .c-cancel {
		background: transparent; border: none; cursor: pointer;
		font-size: 11px; font-weight: 700; padding: 0 6px;
	}
	.c-save { color: #00ff66; }
	.c-cancel { color: #888; }

	.c-actions { display: flex; gap: 4px; }
	.c-actions button {
		background: transparent; border: none; color: #555; cursor: pointer; padding: 2px;
		display: flex; align-items: center; justify-content: center;
		border-radius: 4px;
	}
	.c-actions button:hover { color: #ff5a00; background: rgba(255,255,255,0.04); }
	.c-actions button.del:hover { color: #ff6b6b; }

	.comment-input-row { display: flex; gap: 6px; }
	.comment-input-row input {
		flex: 1; background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		padding: 9px 12px; border-radius: 10px; color: #fff;
		font-size: 13px;
	}
	.comment-input-row input::placeholder { color: #666; }
	.comment-input-row input:focus { outline: none; border-color: rgba(255, 90, 0,0.5); }
	.comment-input-row button {
		background: rgba(255, 90, 0,0.12); color: #ff5a00; border: 1px solid rgba(255, 90, 0,0.4);
		padding: 9px 16px; border-radius: 10px; font-weight: 700; font-size: 12px;
		font-family: 'Courier New', monospace; letter-spacing: 0.06em;
		cursor: pointer; transition: all 0.15s;
	}
	.comment-input-row button:hover:not(:disabled) { background: rgba(255, 90, 0,0.2); }
	.comment-input-row button:disabled { opacity: 0.4; cursor: not-allowed; }

	@media (max-width: 720px) {
		.post-row { padding: 14px; }
		.head-row { flex-direction: column; }
		.pnl { align-items: flex-start; flex-direction: row; gap: 8px; }
		.card-grid { grid-template-columns: repeat(2, 1fr); }
		.stat-row { grid-template-columns: repeat(2, 1fr); }
		.config-card { grid-template-columns: 1fr; }
	}
</style>
