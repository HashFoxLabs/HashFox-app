import { writable } from 'svelte/store';
import { pythPrices } from './pythPrices';
import type { OrderBookData, OrderBookRow, TradeRow } from './binanceOrderbook';

const DEPTH_LEVELS = 14;
const MAX_TRADES = 50;

const emptyBook = (): OrderBookData => ({ asks: [], bids: [], spreadAbs: 0, spreadPct: 0 });

export const syntheticOrderBook = writable<OrderBookData>(emptyBook());
export const syntheticTrades = writable<TradeRow[]>([]);
export const syntheticStatus = writable('Idle');

let ticker: ReturnType<typeof setInterval> | null = null;
let currentSymbol = '';
let lastPrice = 0;
let unsubPrices: (() => void) | null = null;

function pickTick(price: number): number {
	if (price >= 1000) return 0.1;
	if (price >= 100) return 0.02;
	if (price >= 10) return 0.01;
	if (price >= 1) return 0.001;
	return 0.0001;
}

function formatTime(ts: number): string {
	const d = new Date(ts);
	const h = d.getHours().toString().padStart(2, '0');
	const m = d.getMinutes().toString().padStart(2, '0');
	const s = d.getSeconds().toString().padStart(2, '0');
	return `${h}:${m}:${s}`;
}

function seededRandom(seed: number) {
	let s = seed;
	return () => {
		s = (s * 9301 + 49297) % 233280;
		return s / 233280;
	};
}

function buildBook(price: number, symbol: string): OrderBookData {
	if (!price || price <= 0) return emptyBook();
	const tick = pickTick(price);
	const rand = seededRandom(
		Math.abs(Math.floor(price * 1000)) +
			symbol.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
	);

	const bids: OrderBookRow[] = [];
	const asks: OrderBookRow[] = [];
	for (let i = 1; i <= DEPTH_LEVELS; i++) {
		const bidPrice = price - tick * i * (0.5 + rand() * 1.5);
		const askPrice = price + tick * i * (0.5 + rand() * 1.5);
		const bidSize = (1 + rand() * 9) * (DEPTH_LEVELS - i + 1);
		const askSize = (1 + rand() * 9) * (DEPTH_LEVELS - i + 1);
		bids.push({ price: bidPrice, size: bidSize, total: 0 });
		asks.push({ price: askPrice, size: askSize, total: 0 });
	}

	let cum = 0;
	for (const a of asks) {
		cum += a.size;
		a.total = cum;
	}
	cum = 0;
	for (const b of bids) {
		cum += b.size;
		b.total = cum;
	}

	const bestAsk = asks[0]?.price ?? 0;
	const bestBid = bids[0]?.price ?? 0;
	const spreadAbs = bestAsk - bestBid;
	const mid = (bestAsk + bestBid) / 2;
	const spreadPct = mid > 0 ? (spreadAbs / mid) * 100 : 0;
	return { asks, bids, spreadAbs, spreadPct };
}

function emitRandomTrade(price: number) {
	if (!price) return;
	const side: 'buy' | 'sell' = Math.random() > 0.5 ? 'buy' : 'sell';
	const sizeMag = Math.random() < 0.7 ? 1 + Math.random() * 20 : 50 + Math.random() * 250;
	const t: TradeRow = {
		side,
		price: price + (Math.random() - 0.5) * pickTick(price),
		size: sizeMag,
		t: formatTime(Date.now())
	};
	syntheticTrades.update((list) => [t, ...list].slice(0, MAX_TRADES));
}

export function connectSynthetic(symbol: string): void {
	disconnectSynthetic();
	currentSymbol = symbol;
	syntheticStatus.set('Simulated');
	syntheticOrderBook.set(emptyBook());
	syntheticTrades.set([]);

	unsubPrices = pythPrices.subscribe((p) => {
		if (!currentSymbol) return;
		const px = p[currentSymbol]?.price ?? 0;
		if (px <= 0) return;
		lastPrice = px;
		syntheticOrderBook.set(buildBook(px, currentSymbol));
	});

	ticker = setInterval(() => {
		if (lastPrice > 0) emitRandomTrade(lastPrice);
	}, 900);
}

export function disconnectSynthetic(): void {
	if (ticker) {
		clearInterval(ticker);
		ticker = null;
	}
	if (unsubPrices) {
		unsubPrices();
		unsubPrices = null;
	}
	currentSymbol = '';
	lastPrice = 0;
	syntheticStatus.set('Idle');
}
