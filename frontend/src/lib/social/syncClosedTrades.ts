import { upsertClosedTrade, fetchPostedStateByPositionKeys } from '$lib/supabase';
import type { EnrichedTradingPosition } from '$lib/hashfox';

function isoFromSeconds(ts: number): string | null {
	if (!ts || Number.isNaN(ts)) return null;
	return new Date(ts * 1000).toISOString();
}

function isClosedTradingStatus(s: string): boolean {
	return s === 'closed' || s === 'liquidated' || s === 'cancelled';
}

export interface CompTradeContext {
	pubkey: string;
	name: string;
}

export function tradingPositionKey(positionId: number, comp?: CompTradeContext | null): string {
	if (comp?.pubkey) return `comp_trading:${comp.pubkey}:${positionId}`;
	return `trading:${positionId}`;
}

export function predictionPositionKey(positionId: number): string {
	return `prediction:${positionId}`;
}

/** Auto-save every closed trading position (perp + spot) to Supabase.
 *  When `comp` is provided, the row is tagged with the cup pubkey + name
 *  and the position_key is namespaced so cup trades can never collide with
 *  the trader's regular-mode position counter. */
export async function syncClosedTradingPositions(
	walletAddress: string,
	positions: EnrichedTradingPosition[],
	comp?: CompTradeContext | null
): Promise<Record<string, boolean>> {
	if (!walletAddress || positions.length === 0) return {};
	const closed = positions.filter((p) => isClosedTradingStatus(p.status));
	if (closed.length === 0) return {};

	await Promise.all(
		closed.map(async (p) => {
			const positionKey = tradingPositionKey(p.positionId, comp);
			const source = p.marketCategory === 'crypto' ? 'blockberg' : 'traditional';
			const res = await upsertClosedTrade(walletAddress, {
				positionKey,
				source,
				positionType: p.direction || 'long',
				entryPrice: p.entryPrice,
				exitPrice: p.closePrice > 0 ? p.closePrice : null,
				amount: p.sizeUsd,
				pnl: p.realizedPnl,
				marketId: p.pairSymbol,
				marketTitle: p.pairSymbol,
				pairIndex: p.pairIndex,
				platform: source,
				status: p.status,
				openedAtIso: isoFromSeconds(p.openedAt),
				takeProfitPrice: p.takeProfitPrice > 0 ? p.takeProfitPrice : null,
				stopLossPrice: p.stopLossPrice > 0 ? p.stopLossPrice : null,
				tradeMode: p.tradeMode,
				orderType: p.orderType,
				leverage: p.tradeMode === 'perp' ? p.leverage : null,
				marginUsd: p.marginUsd,
				liquidationPrice: p.tradeMode === 'perp' && p.liquidationPrice > 0 ? p.liquidationPrice : null,
				closePrice: p.closePrice > 0 ? p.closePrice : null,
				closedAtIso: isoFromSeconds(p.closedAt),
				realizedPnl: p.realizedPnl,
				competitionPubkey: comp?.pubkey ?? null,
				competitionName: comp?.name ?? null
			});
			if (!res.ok) console.warn('[sync] trading upsert failed', positionKey, res.error);
		})
	);

	return fetchPostedStateByPositionKeys(
		walletAddress,
		closed.map((p) => tradingPositionKey(p.positionId, comp))
	);
}
