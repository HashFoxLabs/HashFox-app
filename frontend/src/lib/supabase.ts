import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '$lib/env';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
	if (client) return client;
	if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
	client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
	return client;
}

export interface UserProfile {
	username: string | null;
	avatar_url: string | null;
	banner_url: string | null;
}

async function fetchUserId(walletAddress: string): Promise<string | null> {
	const sb = getSupabase();
	if (!sb) return null;
	const { data, error } = await sb
		.from('users')
		.select('id')
		.eq('wallet_address', walletAddress)
		.maybeSingle();
	if (error) {
		console.warn('[supabase] user id fetch error', error.message);
		return null;
	}
	return (data as any)?.id ?? null;
}

export interface PublicProfile {
	walletAddress: string;
	username: string | null;
	avatarUrl: string | null;
}

/** Bulk lookup so the competition page can render usernames + avatars for an
 * entire participant list in a single round-trip. Wallets without a row come
 * back with username/avatarUrl = null. */
export async function fetchPublicProfiles(
	walletAddresses: string[]
): Promise<Map<string, PublicProfile>> {
	const out = new Map<string, PublicProfile>();
	const unique = Array.from(new Set(walletAddresses.filter(Boolean)));
	if (unique.length === 0) return out;
	for (const w of unique) out.set(w, { walletAddress: w, username: null, avatarUrl: null });
	const sb = getSupabase();
	if (!sb) return out;
	const { data, error } = await sb
		.from('users')
		.select('wallet_address, username, avatar_url')
		.in('wallet_address', unique);
	if (error) {
		console.warn('[supabase] public profile bulk fetch error', error.message);
		return out;
	}
	for (const row of (data as any[]) ?? []) {
		const w = row.wallet_address as string;
		if (!w) continue;
		out.set(w, {
			walletAddress: w,
			username: (row.username as string | null) ?? null,
			avatarUrl: (row.avatar_url as string | null) ?? null
		});
	}
	return out;
}

export async function fetchProfile(walletAddress: string): Promise<UserProfile | null> {
	const sb = getSupabase();
	if (!sb) return null;
	const { data, error } = await sb
		.from('users')
		.select('username, avatar_url, banner_url')
		.eq('wallet_address', walletAddress)
		.maybeSingle();
	if (error) {
		console.warn('[supabase] profile fetch error', error.message);
		return null;
	}
	return (data as UserProfile) ?? null;
}

export async function isUsernameAvailable(
	username: string,
	excludingWallet?: string
): Promise<boolean> {
	const sb = getSupabase();
	if (!sb) return true;
	let query = sb.from('users').select('wallet_address').eq('username', username).limit(1);
	if (excludingWallet) query = query.neq('wallet_address', excludingWallet);
	const { data, error } = await query.maybeSingle();
	if (error && error.code !== 'PGRST116') {
		console.warn('[supabase] username availability check error', error.message);
		return false;
	}
	return !data;
}

export async function upsertUsername(
	walletAddress: string,
	username: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const sb = getSupabase();
	if (!sb) return { ok: false, error: 'Database unavailable' };
	const available = await isUsernameAvailable(username, walletAddress);
	if (!available) return { ok: false, error: 'Username already taken' };
	const { error } = await sb
		.from('users')
		.upsert({ wallet_address: walletAddress, username }, { onConflict: 'wallet_address' });
	if (error) {
		// Unique-violation from a concurrent writer
		if (error.code === '23505') return { ok: false, error: 'Username already taken' };
		return { ok: false, error: error.message };
	}
	return { ok: true };
}

export async function updateAvatar(walletAddress: string, avatarUrl: string): Promise<void> {
	const sb = getSupabase();
	if (!sb) return;
	await sb.from('users').upsert(
		{ wallet_address: walletAddress, avatar_url: avatarUrl },
		{ onConflict: 'wallet_address' }
	);
}

export async function updateBanner(walletAddress: string, bannerUrl: string): Promise<void> {
	const sb = getSupabase();
	if (!sb) return;
	await sb.from('users').upsert(
		{ wallet_address: walletAddress, banner_url: bannerUrl },
		{ onConflict: 'wallet_address' }
	);
}

export interface PostedTrade {
	id: string;
	user_id?: string | null;
	position_key?: string | null;
	source: string | null;
	position_type: string | null;
	entry_price: number | null;
	exit_price: number | null;
	amount: number | null;
	pnl: number | null;
	market_id: string | null;
	market_title: string | null;
	pair_index?: number | null;
	platform: string | null;
	status: string | null;
	analysis: string | null;
	is_published: boolean | null;
	posted?: boolean | null;
	opened_at: string | null;
	created_at?: string | null;
	likes_count?: number | null;
	comments_count?: number | null;
	take_profit_price?: number | null;
	stop_loss_price?: number | null;
	trade_mode?: string | null;
	order_type?: string | null;
	leverage?: number | null;
	margin_usd?: number | null;
	liquidation_price?: number | null;
	close_price?: number | null;
	closed_at?: string | null;
	realized_pnl?: number | null;
}

export async function fetchPostedTrades(walletAddress: string): Promise<PostedTrade[]> {
	const sb = getSupabase();
	if (!sb) return [];
	const userId = await fetchUserId(walletAddress);
	if (!userId) return [];
	const { data, error } = await sb
		.from('trades')
		.select(
			'id, user_id, position_key, source, position_type, entry_price, exit_price, amount, pnl, market_id, market_title, pair_index, platform, status, analysis, is_published, posted, opened_at, created_at, likes_count, comments_count, take_profit_price, stop_loss_price, trade_mode, order_type, leverage, margin_usd, liquidation_price, close_price, closed_at, realized_pnl'
		)
		.eq('user_id', userId)
		.order('opened_at', { ascending: false });
	if (error) {
		console.warn('[supabase] trades fetch error', error.message);
		return [];
	}
	return (data as any[]) as PostedTrade[];
}

export interface ClosedTradeUpsertInput {
	positionKey: string;
	source: string;
	positionType: string;
	entryPrice: number | null;
	exitPrice: number | null;
	amount: number | null;
	pnl: number | null;
	marketId: string | null;
	marketTitle: string | null;
	pairIndex: number | null;
	platform: string | null;
	status: string | null;
	openedAtIso: string | null;
	analysis?: string | null;
	takeProfitPrice?: number | null;
	stopLossPrice?: number | null;
	tradeMode?: string | null;
	orderType?: string | null;
	leverage?: number | null;
	marginUsd?: number | null;
	liquidationPrice?: number | null;
	closePrice?: number | null;
	closedAtIso?: string | null;
	realizedPnl?: number | null;
}

export async function upsertClosedTrade(
	walletAddress: string,
	input: ClosedTradeUpsertInput
): Promise<{ ok: true } | { ok: false; error: string }> {
	const sb = getSupabase();
	if (!sb) return { ok: false, error: 'Database unavailable' };
	const userId = await fetchUserId(walletAddress);
	if (!userId) return { ok: false, error: 'User not found in database' };

	const row: any = {
		user_id: userId,
		position_key: input.positionKey,
		source: input.source,
		position_type: input.positionType,
		entry_price: input.entryPrice,
		exit_price: input.exitPrice,
		amount: input.amount,
		pnl: input.pnl,
		market_id: input.marketId,
		market_title: input.marketTitle,
		pair_index: input.pairIndex,
		platform: input.platform,
		status: input.status,
		opened_at: input.openedAtIso,
		take_profit_price: input.takeProfitPrice ?? null,
		stop_loss_price: input.stopLossPrice ?? null,
		trade_mode: input.tradeMode ?? null,
		order_type: input.orderType ?? null,
		leverage: input.leverage ?? null,
		margin_usd: input.marginUsd ?? null,
		liquidation_price: input.liquidationPrice ?? null,
		close_price: input.closePrice ?? null,
		closed_at: input.closedAtIso ?? null,
		realized_pnl: input.realizedPnl ?? null
	};
	if (input.analysis !== undefined) row.analysis = input.analysis;

	const { error } = await sb.from('trades').upsert(row, { onConflict: 'position_key' });
	if (error) return { ok: false, error: error.message };
	return { ok: true };
}

export async function fetchPostedStateByPositionKeys(
	walletAddress: string,
	positionKeys: string[]
): Promise<Record<string, boolean>> {
	const out: Record<string, boolean> = {};
	if (positionKeys.length === 0) return out;
	const sb = getSupabase();
	if (!sb) return out;
	const userId = await fetchUserId(walletAddress);
	if (!userId) return out;
	const { data, error } = await sb
		.from('trades')
		.select('position_key, posted, is_published')
		.eq('user_id', userId)
		.in('position_key', positionKeys);
	if (error) {
		console.warn('[supabase] posted state fetch error', error.message);
		return out;
	}
	for (const row of (data as any[]) ?? []) {
		const key = row.position_key as string | null;
		if (!key) continue;
		out[key] = !!(row.posted ?? row.is_published);
	}
	return out;
}

/** Remove a trade from the public feed. Accepts either the position_key
 *  (preferred for History rows) or the DB row id (used by Profile, since
 *  the SharedTrade may carry the row id even when the row predates the
 *  position_key column). */
export async function unpostTrade(
	walletAddress: string,
	identifier: { positionKey?: string | null; tradeId?: string | null }
): Promise<{ ok: true } | { ok: false; error: string }> {
	const sb = getSupabase();
	if (!sb) return { ok: false, error: 'Database unavailable' };
	const userId = await fetchUserId(walletAddress);
	if (!userId) return { ok: false, error: 'User not found in database' };

	let q = sb
		.from('trades')
		.update({ posted: false, is_published: false })
		.eq('user_id', userId);
	if (identifier.tradeId) q = q.eq('id', identifier.tradeId);
	else if (identifier.positionKey) q = q.eq('position_key', identifier.positionKey);
	else return { ok: false, error: 'Missing trade identifier' };

	const { data, error } = await q.select('id');
	if (error) return { ok: false, error: error.message };
	if (!data || data.length === 0) {
		return { ok: false, error: 'Post not found or not owned by current user' };
	}
	return { ok: true };
}

export async function markTradePosted(
	walletAddress: string,
	positionKey: string,
	comment?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
	const sb = getSupabase();
	if (!sb) return { ok: false, error: 'Database unavailable' };
	const userId = await fetchUserId(walletAddress);
	if (!userId) return { ok: false, error: 'User not found in database' };

	const patch: Record<string, any> = { posted: true, is_published: true };
	if (comment !== undefined) patch.analysis = comment;
	const { data, error } = await sb
		.from('trades')
		.update(patch)
		.eq('user_id', userId)
		.eq('position_key', positionKey)
		.select('id')
		.limit(1);
	if (error) return { ok: false, error: error.message };
	if (!data || data.length === 0) {
		return { ok: false, error: 'Trade row not found for current user/position key' };
	}
	return { ok: true };
}

export interface PostedStrategy {
	id: string;
	user_id?: string | null;
	created_at: string | null;
	strategy_name: string | null;
	description: string | null;
	strategy_type: string | null;
	platform: any;
	is_published: boolean | null;
	total_return_percent: number | null;
	win_rate: number | null;
	total_trades: number | null;
	max_drawdown_percent: number | null;
	max_drawdown?: number | null;
	likes_count: number | null;
	comments_count: number | null;
	initial_capital?: number | null;
	final_capital?: number | null;
	sharpe_ratio?: number | null;
	winning_trades?: number | null;
	losing_trades?: number | null;
	profit_factor?: number | null;
	equity_curve?: any;
	entry_type?: string | null;
	stop_loss?: number | null;
	take_profit?: number | null;
	position_sizing_type?: string | null;
	position_sizing_value?: number | null;
	avg_hold_time?: number | null;
	markets_analyzed?: number | null;
	execution_time?: number | null;
	backtest_data?: any;
}

export async function fetchPostedStrategies(walletAddress: string): Promise<PostedStrategy[]> {
	const sb = getSupabase();
	if (!sb) return [];
	const userId = await fetchUserId(walletAddress);
	if (!userId) return [];
	const { data, error } = await sb
		.from('backtest_strategies')
		.select(
			'id, user_id, created_at, strategy_name, description, strategy_type, platform, is_published, total_return_percent, win_rate, total_trades, max_drawdown_percent, max_drawdown, sharpe_ratio, initial_capital, final_capital, winning_trades, losing_trades, profit_factor, equity_curve, entry_type, stop_loss, take_profit, position_sizing_type, position_sizing_value, avg_hold_time, markets_analyzed, execution_time, backtest_data, likes_count, comments_count'
		)
		.eq('user_id', userId)
		.order('created_at', { ascending: false });
	if (error) {
		console.warn('[supabase] strategies fetch error', error.message);
		return [];
	}
	return (data as any[]) as PostedStrategy[];
}

export interface PostComment {
	id: string;
	content: string;
	created_at: string;
	username: string | null;
}

export async function fetchTradeComments(tradeIds: string[], limitPerTrade: number = 3): Promise<Record<string, PostComment[]>> {
	const sb = getSupabase();
	if (!sb) return {};
	if (tradeIds.length === 0) return {};

	// Grab recent comments in one query, then group client-side.
	const { data, error } = await sb
		.from('trade_comments')
		.select('id, trade_id, content, created_at, users!inner(username)')
		.in('trade_id', tradeIds)
		.order('created_at', { ascending: false })
		.limit(Math.min(500, tradeIds.length * limitPerTrade * 2));

	if (error) {
		console.warn('[supabase] trade comments fetch error', error.message);
		return {};
	}

	const grouped: Record<string, PostComment[]> = {};
	for (const row of (data as any[]) ?? []) {
		const tradeId = row.trade_id as string;
		if (!grouped[tradeId]) grouped[tradeId] = [];
		if (grouped[tradeId].length >= limitPerTrade) continue;
		grouped[tradeId].push({
			id: row.id,
			content: row.content,
			created_at: row.created_at,
			username: row.users?.username ?? null
		});
	}
	return grouped;
}

export async function fetchStrategyComments(strategyIds: string[], limitPerStrategy: number = 3): Promise<Record<string, PostComment[]>> {
	const sb = getSupabase();
	if (!sb) return {};
	if (strategyIds.length === 0) return {};

	const { data, error } = await sb
		.from('strategy_comments')
		.select('id, strategy_id, content, created_at, users!inner(username)')
		.in('strategy_id', strategyIds)
		.order('created_at', { ascending: false })
		.limit(Math.min(500, strategyIds.length * limitPerStrategy * 2));

	if (error) {
		console.warn('[supabase] strategy comments fetch error', error.message);
		return {};
	}

	const grouped: Record<string, PostComment[]> = {};
	for (const row of (data as any[]) ?? []) {
		const strategyId = row.strategy_id as string;
		if (!grouped[strategyId]) grouped[strategyId] = [];
		if (grouped[strategyId].length >= limitPerStrategy) continue;
		grouped[strategyId].push({
			id: row.id,
			content: row.content,
			created_at: row.created_at,
			username: row.users?.username ?? null
		});
	}
	return grouped;
}
