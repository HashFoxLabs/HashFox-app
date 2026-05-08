import { getSupabase } from '$lib/supabase';

export interface TraderCardStats {
	userId: string;
	username: string;
	walletAddress: string;
	avatarUrl: string | null;
	periodStart: string;
	periodEnd: string;
	periodDays: number;
	tradeCount: number;
	winCount: number;
	lossCount: number;
	winRate: number;
	totalPnl: number;
	totalVolume: number;
	roiPercent: number;
	bestTradePnl: number;
	worstTradePnl: number;
	avgTradePnl: number;
}

async function fetchUserId(walletAddress: string): Promise<string | null> {
	const sb = getSupabase();
	if (!sb) return null;
	const { data } = await sb
		.from('users')
		.select('id')
		.eq('wallet_address', walletAddress)
		.maybeSingle();
	return (data as any)?.id ?? null;
}

/** Aggregate every trade we have for this wallet, period = first trade -> now.
 *  Includes both posted and unposted trades since the card represents lifetime
 *  performance, not just published activity. */
export async function fetchTraderCardStats(
	walletAddress: string
): Promise<TraderCardStats | null> {
	const sb = getSupabase();
	if (!sb || !walletAddress) return null;

	const userId = await fetchUserId(walletAddress);
	if (!userId) return null;

	const { data: profile } = await sb
		.from('users')
		.select('id, username, wallet_address, avatar_url')
		.eq('id', userId)
		.maybeSingle();
	const userRow = profile as any;
	if (!userRow) return null;

	const PAGE_SIZE = 1000;
	const trades: any[] = [];
	let offset = 0;
	for (let i = 0; i < 20; i++) {
		const { data, error } = await sb
			.from('trades')
			.select('pnl, amount, opened_at, created_at, closed_at, status')
			.eq('user_id', userId)
			.is('competition_pubkey', null)
			.range(offset, offset + PAGE_SIZE - 1);
		if (error) {
			console.warn('[traderCard] trades fetch error', error.message);
			break;
		}
		const rows = (data as any[]) ?? [];
		trades.push(...rows);
		if (rows.length < PAGE_SIZE) break;
		offset += PAGE_SIZE;
	}

	let tradeCount = 0;
	let winCount = 0;
	let lossCount = 0;
	let totalPnl = 0;
	let totalVolume = 0;
	let bestTradePnl = 0;
	let worstTradePnl = 0;
	let earliest: number | null = null;

	for (const t of trades) {
		const pnl = Number(t.pnl) || 0;
		const amount = Number(t.amount) || 0;
		tradeCount += 1;
		totalPnl += pnl;
		totalVolume += amount;
		if (pnl > 0) winCount += 1;
		else if (pnl < 0) lossCount += 1;
		if (pnl > bestTradePnl) bestTradePnl = pnl;
		if (pnl < worstTradePnl) worstTradePnl = pnl;

		const ts = t.opened_at || t.created_at || t.closed_at || null;
		if (ts) {
			const ms = new Date(ts).getTime();
			if (Number.isFinite(ms) && (earliest === null || ms < earliest)) earliest = ms;
		}
	}

	const closed = winCount + lossCount;
	const periodEndMs = Date.now();
	const periodStartMs = earliest ?? periodEndMs;
	const periodDays = Math.max(
		1,
		Math.round((periodEndMs - periodStartMs) / 86_400_000)
	);

	return {
		userId,
		username: userRow.username || '',
		walletAddress: userRow.wallet_address || walletAddress,
		avatarUrl: userRow.avatar_url ?? null,
		periodStart: new Date(periodStartMs).toISOString(),
		periodEnd: new Date(periodEndMs).toISOString(),
		periodDays,
		tradeCount,
		winCount,
		lossCount,
		winRate: closed > 0 ? (winCount / closed) * 100 : 0,
		totalPnl,
		totalVolume,
		roiPercent: totalVolume > 0 ? (totalPnl / totalVolume) * 100 : 0,
		bestTradePnl,
		worstTradePnl,
		avgTradePnl: tradeCount > 0 ? totalPnl / tradeCount : 0
	};
}

export function formatPeriodLabel(stats: TraderCardStats): string {
	const fmt = (iso: string) =>
		new Date(iso).toLocaleDateString('en-US', {
			month: 'short',
			day: '2-digit',
			year: 'numeric'
		});
	return `${fmt(stats.periodStart)} → ${fmt(stats.periodEnd)}`;
}
