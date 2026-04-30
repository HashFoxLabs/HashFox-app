import { getSupabase } from '$lib/supabase';

export type MarketType = 'crypto' | 'prediction' | 'forex' | 'stocks' | 'commodities';
export type TradeType = 'paper-trade' | 'backtest';
export type TradeDirection = 'long' | 'short' | 'yes' | 'no';

export interface SharedTrade {
	id: string;
	dbId?: string;
	isFromDb?: boolean;
	dbType?: 'trade' | 'strategy';
	authorUserId?: string;
	username: string;
	avatarUrl?: string;
	marketType: MarketType;
	tradeType: TradeType;
	asset: string;
	subcategory?: string;
	direction: TradeDirection;
	entryPrice: number;
	exitPrice: number | null;
	pnl: number;
	pnlPercent: number;
	duration: string;
	strategy?: string;
	timestamp: string;
	comment?: string;
	likes: number;
	commentCount: number;
	winRate?: number;
	sharpeRatio?: number;
	maxDrawdown?: number;
	totalTrades?: number;
	profitFactor?: number;
	startBalance?: number;
	endBalance?: number;
	equityCurveRaw?: { timestamp: string; equity: number }[];
	amount?: number;
	takeProfit?: number;
	stopLoss?: number;
	status?: string;
	platform?: string;
	positionKey?: string;
	tradeMode?: 'spot' | 'perp' | 'prediction' | string;
	orderType?: 'market' | 'limit' | string;
	leverage?: number;
	marginUsd?: number;
	liquidationPrice?: number;
	closePrice?: number;
	closedAt?: string;
	realizedPnl?: number;
	winningTrades?: number;
	losingTrades?: number;
	entryType?: string;
	backtestStopLoss?: number;
	backtestTakeProfit?: number;
	positionSizingType?: string;
	positionSizingValue?: number;
	initialCapital?: number;
	finalCapital?: number;
	description?: string;
	strategyType?: string;
	avgHoldTime?: number;
	marketsAnalyzed?: number;
	executionTime?: number;
	strategyConfig?: {
		strategyType?: string;
		position?: string;
		priceInf?: number;
		priceSup?: number;
		amount?: number;
		threshold?: number;
		stopLoss?: number;
		takeProfit?: number;
		trailingStop?: number;
		maxHoldHours?: number;
		cooldownHours?: number;
		initialCash?: number;
	};
}

export interface FeedUserProfile {
	id: string;
	username: string;
	avatarUrl: string | null;
	bannerUrl: string | null;
	walletAddress: string;
	tradeCount: number;
	strategyCount: number;
	totalPnl: number;
	winRate: number;
}

export interface FeedComment {
	id?: string;
	userId?: string;
	user: string;
	text: string;
	avatarUrl?: string;
}

export interface ConnectedSocialUser {
	userId: string;
	username: string;
	walletAddress: string;
	avatarUrl?: string | null;
}

const PAIR_SYMBOLS: Record<number, string> = {
	0: 'BTC/USDT',
	1: 'ETH/USDT',
	2: 'BNB/USDT',
	3: 'SOL/USDT',
	4: 'XRP/USDT'
};

export async function fetchPublishedFeed(): Promise<SharedTrade[]> {
	const sb = getSupabase();
	if (!sb) return [];
	const [tradesRes, strategiesRes] = await Promise.all([
		sb
			.from('trades')
			.select(
				'id, user_id, source, position_type, entry_price, exit_price, amount, pnl, market_id, market_title, pair_index, analysis, is_published, likes_count, comments_count, created_at, take_profit_price, stop_loss_price, status, platform, trade_mode, order_type, leverage, margin_usd, liquidation_price, close_price, closed_at, realized_pnl, users(username, avatar_url)'
			)
			.or('posted.eq.true,is_published.eq.true')
			.order('created_at', { ascending: false })
			.limit(50),
		sb
			.from('backtest_strategies')
			.select(
				'id, user_id, strategy_name, strategy_type, description, total_return_percent, initial_capital, final_capital, win_rate, sharpe_ratio, max_drawdown, total_trades, winning_trades, losing_trades, profit_factor, equity_curve, is_published, likes_count, comments_count, created_at, entry_type, stop_loss, take_profit, position_sizing_type, position_sizing_value, platform, avg_hold_time, markets_analyzed, execution_time, backtest_data, users(username, avatar_url)'
			)
			.eq('is_published', true)
			.order('created_at', { ascending: false })
			.limit(50)
	]);

	const items: SharedTrade[] = [];
	const trades = tradesRes.data ?? [];
	const strategies = strategiesRes.data ?? [];

	for (const t of trades as any[]) {
		const isBlockberg = t.source === 'blockberg';
		const isTraditional = t.source === 'traditional';
		const isPolymarket = t.source === 'polymarket';
		// market_title is stored as the bare symbol (e.g. "BTC"); for crypto
		// surface it as the trading pair "BTC/USDT". Legacy rows fall back to
		// the pair-index lookup which is already in pair form.
		const rawTitle = t.market_title || null;
		let symbol: string;
		if (isBlockberg) {
			if (rawTitle) {
				symbol = rawTitle.includes('/') ? rawTitle : `${rawTitle}/USDT`;
			} else if (t.pair_index != null) {
				symbol = PAIR_SYMBOLS[t.pair_index] || 'UNKNOWN';
			} else {
				symbol = 'UNKNOWN';
			}
		} else {
			symbol = rawTitle || t.market_id || 'Market';
		}
		const posType = (t.position_type || '').toLowerCase();
		const direction: TradeDirection =
			posType === 'long' || posType === 'short' || posType === 'yes' || posType === 'no'
				? (posType as TradeDirection)
				: 'long';
		const entry = Number(t.entry_price) || 0;
		const exit = t.exit_price != null ? Number(t.exit_price) : null;
		const pnl = Number(t.pnl) || 0;
		const margin = t.margin_usd != null ? Number(t.margin_usd) : null;
		// Prefer realized return on margin for perps; fall back to price change for spot/prediction.
		const pnlPct =
			margin && margin > 0
				? (pnl / margin) * 100
				: entry > 0 && exit != null
					? ((exit - entry) / entry) * 100
					: 0;
		const marketType: MarketType = isPolymarket
			? 'prediction'
			: isBlockberg
				? 'crypto'
				: isTraditional
					? 'stocks'
					: 'crypto';

		items.push({
			id: `db-trade-${t.id}`,
			dbId: t.id,
			isFromDb: true,
			dbType: 'trade',
			authorUserId: t.user_id,
			username: t.users?.username || 'anon',
			avatarUrl: t.users?.avatar_url || undefined,
			marketType,
			tradeType: 'paper-trade',
			asset: symbol,
			direction,
			entryPrice: entry,
			exitPrice: exit,
			pnl,
			pnlPercent: pnlPct,
			duration: '',
			strategy: '',
			timestamp: t.created_at,
			comment: t.analysis || undefined,
			likes: t.likes_count || 0,
			commentCount: t.comments_count || 0,
			amount: Number(t.amount) || undefined,
			takeProfit: t.take_profit_price != null ? Number(t.take_profit_price) : undefined,
			stopLoss: t.stop_loss_price != null ? Number(t.stop_loss_price) : undefined,
			status: t.status || undefined,
			platform: t.platform || t.source || undefined,
			tradeMode: t.trade_mode || undefined,
			orderType: t.order_type || undefined,
			leverage: t.leverage != null ? Number(t.leverage) : undefined,
			marginUsd: margin ?? undefined,
			liquidationPrice:
				t.liquidation_price != null ? Number(t.liquidation_price) : undefined,
			closePrice: t.close_price != null ? Number(t.close_price) : undefined,
			closedAt: t.closed_at || undefined,
			realizedPnl: t.realized_pnl != null ? Number(t.realized_pnl) : undefined
		});
	}

	for (const s of strategies as any[]) {
		const roi = Number(s.total_return_percent) || 0;
		items.push({
			id: `db-strat-${s.id}`,
			dbId: s.id,
			isFromDb: true,
			dbType: 'strategy',
			authorUserId: s.user_id,
			username: s.users?.username || 'anon',
			avatarUrl: s.users?.avatar_url || undefined,
			marketType: 'prediction',
			tradeType: 'backtest',
			asset: s.strategy_name || 'Strategy',
			direction: roi >= 0 ? 'long' : 'short',
			entryPrice: 0,
			exitPrice: null,
			pnl: (Number(s.final_capital) || 0) - (Number(s.initial_capital) || 0),
			pnlPercent: roi,
			duration: '',
			strategy: s.strategy_name,
			timestamp: s.created_at,
			comment: s.description || s.backtest_data?.description || undefined,
			likes: s.likes_count || 0,
			commentCount: s.comments_count || 0,
			winRate: Number(s.win_rate) || undefined,
			sharpeRatio: Number(s.sharpe_ratio) || undefined,
			maxDrawdown: Number(s.max_drawdown) || undefined,
			totalTrades: s.total_trades || undefined,
			startBalance: Number(s.initial_capital) || undefined,
			endBalance: Number(s.final_capital) || undefined,
			equityCurveRaw: Array.isArray(s.equity_curve)
				? (s.equity_curve as any[])
						.filter((p: any) => p?.timestamp && p?.equity != null)
						.map((p: any) => ({ timestamp: p.timestamp, equity: Number(p.equity) }))
				: undefined,
			profitFactor: Number(s.profit_factor) || undefined,
			winningTrades: s.winning_trades || undefined,
			losingTrades: s.losing_trades || undefined,
			entryType: s.entry_type || undefined,
			backtestStopLoss: s.stop_loss != null ? Number(s.stop_loss) : undefined,
			backtestTakeProfit: s.take_profit != null ? Number(s.take_profit) : undefined,
			positionSizingType: s.position_sizing_type || undefined,
			positionSizingValue:
				s.position_sizing_value != null ? Number(s.position_sizing_value) : undefined,
			initialCapital: Number(s.initial_capital) || undefined,
			finalCapital: Number(s.final_capital) || undefined,
			platform: Array.isArray(s.platform)
				? s.platform.join(', ')
				: s.platform || undefined,
			description: s.description || s.backtest_data?.description || undefined,
			strategyType: s.strategy_type || undefined,
			avgHoldTime: s.avg_hold_time != null ? Number(s.avg_hold_time) : undefined,
			marketsAnalyzed: s.markets_analyzed || undefined,
			executionTime: s.execution_time || undefined,
			strategyConfig: s.backtest_data?.strategyConfig || undefined
		});
	}

	items.sort(
		(a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
	);
	return items;
}

export async function fetchFeedProfiles(trades: SharedTrade[]): Promise<FeedUserProfile[]> {
	const sb = getSupabase();
	if (!sb) return [];
	const { data: users } = await sb
		.from('users')
		.select('id, username, wallet_address, avatar_url, banner_url')
		.order('username');
	if (!users || users.length === 0) return [];

	const byUser = new Map<string, SharedTrade[]>();
	for (const t of trades) {
		if (!t.isFromDb) continue;
		const list = byUser.get(t.username);
		if (list) list.push(t);
		else byUser.set(t.username, [t]);
	}

	const out: FeedUserProfile[] = [];
	for (const u of users as any[]) {
		if (!u.username) continue;
		const mine = byUser.get(u.username) || [];
		const tradeCount = mine.filter((t) => t.tradeType === 'paper-trade').length;
		const strategyCount = mine.filter((t) => t.tradeType === 'backtest').length;
		const pnls = mine.map((t) => t.pnlPercent).filter((p) => p !== 0);
		const avgPnl = pnls.length > 0 ? pnls.reduce((a, b) => a + b, 0) / pnls.length : 0;
		const wins = mine.filter((t) => t.pnl > 0).length;
		const winRate = mine.length > 0 ? (wins / mine.length) * 100 : 0;
		out.push({
			id: u.id,
			username: u.username,
			avatarUrl: u.avatar_url || null,
			bannerUrl: u.banner_url || null,
			walletAddress: u.wallet_address,
			tradeCount,
			strategyCount,
			totalPnl: avgPnl,
			winRate
		});
	}
	out.sort((a, b) => b.totalPnl - a.totalPnl);
	return out;
}

export async function resolveConnectedUser(
	walletAddress: string,
	fallbackUsername: string | null,
	fallbackAvatar: string | null
): Promise<ConnectedSocialUser | null> {
	const sb = getSupabase();
	if (!sb || !walletAddress) return null;
	const { data } = await sb
		.from('users')
		.select('id, username, avatar_url')
		.eq('wallet_address', walletAddress)
		.maybeSingle();
	const row = data as { id?: string; username?: string; avatar_url?: string | null } | null;
	if (!row?.id) return null;
	return {
		userId: row.id,
		username: row.username || fallbackUsername || 'anon',
		walletAddress,
		avatarUrl: row.avatar_url ?? fallbackAvatar ?? null
	};
}

export async function checkLiked(
	userId: string,
	postId: string,
	postType: 'trade' | 'strategy'
): Promise<boolean> {
	const sb = getSupabase();
	if (!sb) return false;
	const { data } = await sb
		.from('post_likes')
		.select('id')
		.eq('user_id', userId)
		.eq('post_id', postId)
		.eq('post_type', postType)
		.maybeSingle();
	return !!data;
}

export async function toggleLike(
	userId: string,
	postId: string,
	postType: 'trade' | 'strategy',
	isLiking: boolean,
	nextCount: number
): Promise<{ ok: boolean; error?: string }> {
	const sb = getSupabase();
	if (!sb) return { ok: false, error: 'Supabase unavailable' };
	if (isLiking) {
		const { error } = await sb
			.from('post_likes')
			.insert({ user_id: userId, post_id: postId, post_type: postType });
		if (error) return { ok: false, error: error.code === '23505' ? 'Already liked' : error.message };
	} else {
		const { error } = await sb
			.from('post_likes')
			.delete()
			.eq('user_id', userId)
			.eq('post_id', postId)
			.eq('post_type', postType);
		if (error) return { ok: false, error: error.message };
	}
	const countTable = postType === 'trade' ? 'trades' : 'backtest_strategies';
	await sb.from(countTable).update({ likes_count: Math.max(0, nextCount) }).eq('id', postId);
	return { ok: true };
}

export async function fetchComments(
	postId: string,
	postType: 'trade' | 'strategy'
): Promise<FeedComment[]> {
	const sb = getSupabase();
	if (!sb) return [];
	const table = postType === 'trade' ? 'trade_comments' : 'strategy_comments';
	const fk = postType === 'trade' ? 'trade_id' : 'strategy_id';
	const { data } = await sb
		.from(table)
		.select('*, users!inner(username, avatar_url)')
		.eq(fk, postId)
		.order('created_at', { ascending: true });
	if (!data) return [];
	return (data as any[]).map((c) => ({
		id: c.id,
		userId: c.user_id,
		user: c.users?.username || 'anon',
		text: c.content,
		avatarUrl: c.users?.avatar_url || undefined
	}));
}

export async function addComment(
	postId: string,
	postType: 'trade' | 'strategy',
	userId: string,
	text: string,
	nextCount: number
): Promise<{ id?: string }> {
	const sb = getSupabase();
	if (!sb) return {};
	const table = postType === 'trade' ? 'trade_comments' : 'strategy_comments';
	const fk = postType === 'trade' ? 'trade_id' : 'strategy_id';
	const { data } = await sb
		.from(table)
		.insert({ [fk]: postId, user_id: userId, content: text })
		.select('id')
		.single();
	const countTable = postType === 'trade' ? 'trades' : 'backtest_strategies';
	await sb.from(countTable).update({ comments_count: nextCount }).eq('id', postId);
	return { id: (data as any)?.id };
}

export async function deleteComment(
	commentId: string,
	postId: string,
	postType: 'trade' | 'strategy',
	nextCount: number
): Promise<void> {
	const sb = getSupabase();
	if (!sb) return;
	const table = postType === 'trade' ? 'trade_comments' : 'strategy_comments';
	await sb.from(table).delete().eq('id', commentId);
	const countTable = postType === 'trade' ? 'trades' : 'backtest_strategies';
	await sb.from(countTable).update({ comments_count: Math.max(0, nextCount) }).eq('id', postId);
}

export async function editComment(
	commentId: string,
	postType: 'trade' | 'strategy',
	text: string
): Promise<void> {
	const sb = getSupabase();
	if (!sb) return;
	const table = postType === 'trade' ? 'trade_comments' : 'strategy_comments';
	await sb.from(table).update({ content: text }).eq('id', commentId);
}

export async function fetchFollowing(userId: string): Promise<Set<string>> {
	const out = new Set<string>();
	const sb = getSupabase();
	if (!sb || !userId) return out;
	const { data } = await sb
		.from('follows')
		.select('following_id')
		.eq('follower_id', userId);
	for (const row of (data ?? []) as any[]) {
		if (row.following_id) out.add(row.following_id);
	}
	return out;
}

export async function toggleFollow(
	followerId: string,
	followingId: string,
	isFollowing: boolean
): Promise<{ ok: boolean; error?: string }> {
	if (!followerId || !followingId) return { ok: false, error: 'Missing user id' };
	if (followerId === followingId) return { ok: false, error: "You can't follow yourself" };
	const sb = getSupabase();
	if (!sb) return { ok: false, error: 'Supabase unavailable' };
	if (isFollowing) {
		const { error } = await sb
			.from('follows')
			.insert({ follower_id: followerId, following_id: followingId });
		if (error && error.code !== '23505') return { ok: false, error: error.message };
	} else {
		const { error } = await sb
			.from('follows')
			.delete()
			.eq('follower_id', followerId)
			.eq('following_id', followingId);
		if (error) return { ok: false, error: error.message };
	}
	return { ok: true };
}

export const MARKET_TYPE_LABELS: Record<MarketType, string> = {
	crypto: 'CRYPTO',
	prediction: 'PREDICTION',
	forex: 'FOREX',
	stocks: 'STOCKS',
	commodities: 'COMMODITIES'
};

export const ASSET_OPTIONS: Record<MarketType, string[]> = {
	crypto: [
		'BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'XRP', 'AVAX', 'DOT', 'MATIC', 'LINK',
		'UNI', 'ATOM', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'SEI', 'TIA', 'JUP'
	],
	prediction: [
		'Sports', 'Politics', 'Crypto', 'Entertainment', 'Science', 'Economics',
		'Technology', 'Weather', 'Elections', 'Awards', 'Esports', 'Culture'
	],
	forex: [
		'EUR/USD', 'GBP/USD', 'USD/JPY', 'AUD/USD', 'USD/CAD', 'USD/CHF',
		'NZD/USD', 'EUR/GBP', 'EUR/JPY', 'GBP/JPY', 'AUD/JPY', 'EUR/AUD'
	],
	stocks: [
		'AAPL', 'TSLA', 'SPY', 'MSFT', 'NVDA', 'AMZN', 'GOOG', 'META',
		'AMD', 'NFLX', 'DIS', 'BA', 'JPM', 'V', 'WMT', 'COIN', 'PLTR', 'RIVN'
	],
	commodities: [
		'Gold', 'Silver', 'Oil', 'Natural Gas', 'Copper', 'Platinum', 'Palladium',
		'Wheat', 'Corn', 'Soybeans', 'Coffee', 'Sugar'
	]
};
