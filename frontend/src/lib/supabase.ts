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
	opened_at: string | null;
	created_at?: string | null;
	likes_count?: number | null;
	comments_count?: number | null;
	take_profit_price?: number | null;
	stop_loss_price?: number | null;
}

export async function fetchPostedTrades(walletAddress: string): Promise<PostedTrade[]> {
	const sb = getSupabase();
	if (!sb) return [];
	const userId = await fetchUserId(walletAddress);
	if (!userId) return [];
	const { data, error } = await sb
		.from('trades')
		.select(
			'id, user_id, source, position_type, entry_price, exit_price, amount, pnl, market_id, market_title, pair_index, platform, status, analysis, is_published, opened_at, created_at, likes_count, comments_count, take_profit_price, stop_loss_price'
		)
		.eq('user_id', userId)
		.order('opened_at', { ascending: false });
	if (error) {
		console.warn('[supabase] trades fetch error', error.message);
		return [];
	}
	return (data as any[]) as PostedTrade[];
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
