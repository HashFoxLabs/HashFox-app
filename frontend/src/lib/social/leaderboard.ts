import { getSupabase } from '$lib/supabase';

export interface LeaderboardEntry {
	rank: number;
	userId: string;
	username: string;
	walletAddress: string;
	avatarUrl: string | null;
	bannerUrl: string | null;
	totalPnl: number;
	totalVolume: number;
	/** ROI badge — sum(pnl) / sum(amount) × 100 across every trade for this
	 * user. Same number shown on the leaderboard pill and next to the
	 * username in Live Chat, so reputations stay consistent. */
	pnlPercent: number;
	tradeCount: number;
	winCount: number;
	lossCount: number;
	winRate: number;
	bestTradePnl: number;
	worstTradePnl: number;
	lastActivity: string | null;
}

export interface Tournament {
	id: string;
	title: string;
	tag: string;
	prizePool: string;
	entryFee: string;
	participants: number;
	maxParticipants: number;
	startsAt: string;
	endsAt: string;
	status: 'live' | 'upcoming' | 'registration';
	description: string;
}

/** Fetch every trade row in the database (paginated under the hood) and
 * aggregate per-user stats for the leaderboard. */
export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
	const sb = getSupabase();
	if (!sb) return [];

	const PAGE_SIZE = 1000;
	const trades: any[] = [];
	let offset = 0;
	for (let i = 0; i < 20; i++) {
		const { data, error } = await sb
			.from('trades')
			.select('user_id, pnl, amount, margin_usd, created_at, status')
			.range(offset, offset + PAGE_SIZE - 1);
		if (error) {
			console.warn('[leaderboard] trades fetch error', error.message);
			break;
		}
		const rows = (data as any[]) ?? [];
		trades.push(...rows);
		if (rows.length < PAGE_SIZE) break;
		offset += PAGE_SIZE;
	}

	const { data: users, error: usersErr } = await sb
		.from('users')
		.select('id, username, wallet_address, avatar_url, banner_url');
	if (usersErr) {
		console.warn('[leaderboard] users fetch error', usersErr.message);
		return [];
	}
	const userRows = (users as any[]) ?? [];

	type Agg = {
		totalPnl: number;
		totalVolume: number;
		totalCapital: number;
		tradeCount: number;
		winCount: number;
		lossCount: number;
		bestTradePnl: number;
		worstTradePnl: number;
		lastActivity: string | null;
	};
	const aggByUser = new Map<string, Agg>();
	for (const t of trades) {
		const uid = t.user_id as string | null;
		if (!uid) continue;
		const pnl = Number(t.pnl) || 0;
		const amount = Number(t.amount) || 0;
		const margin = Number(t.margin_usd) || 0;
		// ROI denominator: capital deployed (margin). Falls back to notional for
		// legacy rows missing margin_usd, so older trades still contribute.
		const capital = margin > 0 ? margin : amount;
		const ts = (t.created_at as string | null) ?? null;
		let agg = aggByUser.get(uid);
		if (!agg) {
			agg = {
				totalPnl: 0,
				totalVolume: 0,
				totalCapital: 0,
				tradeCount: 0,
				winCount: 0,
				lossCount: 0,
				bestTradePnl: 0,
				worstTradePnl: 0,
				lastActivity: null
			};
			aggByUser.set(uid, agg);
		}
		agg.totalPnl += pnl;
		agg.totalVolume += amount;
		agg.totalCapital += capital;
		agg.tradeCount += 1;
		if (pnl > 0) agg.winCount += 1;
		else if (pnl < 0) agg.lossCount += 1;
		if (pnl > agg.bestTradePnl) agg.bestTradePnl = pnl;
		if (pnl < agg.worstTradePnl) agg.worstTradePnl = pnl;
		if (ts && (!agg.lastActivity || ts > agg.lastActivity)) agg.lastActivity = ts;
	}

	const entries: LeaderboardEntry[] = [];
	for (const u of userRows) {
		if (!u.username) continue;
		const agg = aggByUser.get(u.id);
		if (!agg || agg.tradeCount === 0) continue;
		const closed = agg.winCount + agg.lossCount;
		entries.push({
			rank: 0,
			userId: u.id,
			username: u.username,
			walletAddress: u.wallet_address ?? '',
			avatarUrl: u.avatar_url ?? null,
			bannerUrl: u.banner_url ?? null,
			totalPnl: agg.totalPnl,
			totalVolume: agg.totalVolume,
			pnlPercent: agg.totalCapital > 0 ? (agg.totalPnl / agg.totalCapital) * 100 : 0,
			tradeCount: agg.tradeCount,
			winCount: agg.winCount,
			lossCount: agg.lossCount,
			winRate: closed > 0 ? (agg.winCount / closed) * 100 : 0,
			bestTradePnl: agg.bestTradePnl,
			worstTradePnl: agg.worstTradePnl,
			lastActivity: agg.lastActivity
		});
	}

	entries.sort((a, b) => b.totalPnl - a.totalPnl);
	entries.forEach((e, i) => (e.rank = i + 1));
	return entries;
}

/** Map keyed by both `userId` and `username` so consumers (LiveChat, post
 * cards, etc.) can look up the same leaderboard pnl % regardless of which
 * identifier they have on hand. */
export function buildPnlBadgeMap(entries: LeaderboardEntry[]): Map<string, number> {
	const map = new Map<string, number>();
	for (const e of entries) {
		if (e.userId) map.set(e.userId, e.pnlPercent);
		if (e.username) map.set(e.username, e.pnlPercent);
	}
	return map;
}

/** Shared formatter so the pill renders identically everywhere. */
export function formatPnlBadge(pct: number | null | undefined): string | null {
	if (pct == null || !Number.isFinite(pct)) return null;
	const sign = pct >= 0 ? '+' : '';
	return `${sign}${pct.toFixed(2)}%`;
}

/** Hard-coded tournament catalogue used by the competition entry card and
 * the placeholder /competition page. Swap for a Supabase table when the
 * tournament backend lands. */
export function getActiveTournaments(): Tournament[] {
	const now = Date.now();
	const day = 86_400_000;
	return [
		{
			id: 'season-alpha',
			title: 'Season Alpha — Pro League',
			tag: 'FLAGSHIP',
			prizePool: '$25,000',
			entryFee: 'FREE',
			participants: 184,
			maxParticipants: 500,
			startsAt: new Date(now - 2 * day).toISOString(),
			endsAt: new Date(now + 5 * day).toISOString(),
			status: 'live',
			description:
				'Multi-asset paper-trading championship across crypto, forex and prediction markets. Top 25 split the pool.'
		},
		{
			id: 'crypto-sprint',
			title: 'Crypto Sprint #14',
			tag: 'WEEKLY',
			prizePool: '$5,000',
			entryFee: 'FREE',
			participants: 412,
			maxParticipants: 1000,
			startsAt: new Date(now - 12 * 3_600_000).toISOString(),
			endsAt: new Date(now + 36 * 3_600_000).toISOString(),
			status: 'live',
			description: 'Fast 48-hour leaderboard across BTC, ETH, SOL perpetuals.'
		},
		{
			id: 'prediction-arena',
			title: 'Prediction Arena',
			tag: 'UPCOMING',
			prizePool: '$10,000',
			entryFee: '$10',
			participants: 0,
			maxParticipants: 250,
			startsAt: new Date(now + 3 * day).toISOString(),
			endsAt: new Date(now + 10 * day).toISOString(),
			status: 'upcoming',
			description: 'Polymarket-style prediction tournament. Pre-register to lock your seat.'
		}
	];
}
