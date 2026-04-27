import { writable } from 'svelte/store';
import type { OrderBookData, OrderBookRow, TradeRow } from './binanceOrderbook';

/**
 * Real US-equity orderbook store.
 *
 * Polls the server-side `/api/alpaca/snapshot` endpoint (which proxies Alpaca's
 * IEX feed using server-only credentials) to get the latest top-of-book quote
 * and most recent trade. The Alpaca free tier exposes IEX data only, so this
 * is L1 (best bid / best ask) plus a rolling trade tape — there is no L2 depth.
 *
 * If the server reports `no_key`, the store transitions to an "Unconfigured"
 * status and emits an empty book so the caller can fall back to synthetic.
 */

const POLL_INTERVAL_MS = 1000;
const MAX_TRADES = 50;

const emptyBook = (): OrderBookData => ({ asks: [], bids: [], spreadAbs: 0, spreadPct: 0 });

export const stocksOrderBook = writable<OrderBookData>(emptyBook());
export const stocksTrades = writable<TradeRow[]>([]);
export const stocksStatus = writable('Idle');
export const stocksUnconfigured = writable(false);
/** Symbol for the active Alpaca snapshot poll — for cross-page live marks. */
export const stocksStreamingSymbol = writable<string>('');

let pollTimer: ReturnType<typeof setInterval> | null = null;
let abort: AbortController | null = null;
let currentSymbol = '';
let lastTradeId = 0;

function formatTime(ts: string | number): string {
	const d = new Date(ts);
	const h = d.getHours().toString().padStart(2, '0');
	const m = d.getMinutes().toString().padStart(2, '0');
	const s = d.getSeconds().toString().padStart(2, '0');
	return `${h}:${m}:${s}`;
}

function buildL1Book(bp: number, bs: number, ap: number, as: number): OrderBookData {
	if (!bp || !ap) return emptyBook();
	const ask: OrderBookRow = { price: ap, size: as, total: as };
	const bid: OrderBookRow = { price: bp, size: bs, total: bs };
	const spreadAbs = ap - bp;
	const mid = (ap + bp) / 2;
	const spreadPct = mid > 0 ? (spreadAbs / mid) * 100 : 0;
	return { asks: [ask], bids: [bid], spreadAbs, spreadPct };
}

async function poll(symbol: string) {
	if (currentSymbol !== symbol) return;
	abort?.abort();
	abort = new AbortController();
	try {
		const res = await fetch(`/api/alpaca/snapshot?symbol=${encodeURIComponent(symbol)}`, {
			signal: abort.signal
		});
		const data = (await res.json()) as {
			ok: boolean;
			reason?: string;
			quote?: { bp: number; bs: number; ap: number; as: number; t: string } | null;
			trade?: { p: number; s: number; t: string; i: number } | null;
		};
		if (currentSymbol !== symbol) return;

		if (!data.ok) {
			if (data.reason === 'no_key') {
				stocksUnconfigured.set(true);
				stocksStatus.set('Unconfigured');
			} else {
				stocksStatus.set('Error');
			}
			stocksOrderBook.set(emptyBook());
			return;
		}

		stocksUnconfigured.set(false);
		stocksStatus.set('Live · IEX');

		if (data.quote) {
			const { bp, bs, ap, as } = data.quote;
			stocksOrderBook.set(buildL1Book(bp, bs, ap, as));
		}

		if (data.trade && data.trade.i !== lastTradeId) {
			const prevId = lastTradeId;
			lastTradeId = data.trade.i;
			// Only emit a tape entry once we've established a baseline; this avoids
			// inserting the very first observed trade as if it were "new".
			if (prevId !== 0) {
				const t = data.trade;
				// Infer aggressor side from print price vs current mid (UI hint only).
				const ap = data.quote?.ap ?? 0;
				const bp = data.quote?.bp ?? 0;
				const mid = ap > 0 && bp > 0 ? (ap + bp) / 2 : t.p;
				const side: 'buy' | 'sell' = t.p >= mid ? 'buy' : 'sell';
				const row: TradeRow = {
					side,
					price: t.p,
					size: t.s,
					t: formatTime(t.t)
				};
				stocksTrades.update((list) => [row, ...list].slice(0, MAX_TRADES));
			}
		}
	} catch (err: unknown) {
		if ((err as Error)?.name === 'AbortError') return;
		stocksStatus.set('Reconnecting…');
	}
}

export function connectStocks(symbol: string): void {
	disconnectStocks();
	currentSymbol = symbol;
	stocksStreamingSymbol.set(symbol);
	lastTradeId = 0;
	stocksStatus.set('Connecting…');
	stocksOrderBook.set(emptyBook());
	stocksTrades.set([]);
	void poll(symbol);
	pollTimer = setInterval(() => poll(symbol), POLL_INTERVAL_MS);
}

export function disconnectStocks(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
	abort?.abort();
	abort = null;
	currentSymbol = '';
	lastTradeId = 0;
	stocksStreamingSymbol.set('');
	stocksStatus.set('Idle');
}
