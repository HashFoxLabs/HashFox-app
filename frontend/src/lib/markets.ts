import type { CryptoSymbol, TraditionalSymbol } from './env';

export type MarketCategory = 'crypto' | 'traditional' | 'prediction';
export type MarketSubCategory = 'crypto' | 'stock' | 'forex' | 'metal' | 'equity' | 'prediction';

export interface MarketEntry {
	symbol: string;
	label: string;
	category: MarketCategory;
	sub: MarketSubCategory;
	pairIndex: number;
	decimals: number;
	perpEnabled: boolean;
	quote: string;
}

// Contract MarketCategory enum maps:
// Crypto=0, Stock=1, Forex=2, Metal=3, Equity=4
export const MARKET_CATEGORY_ID: Record<MarketSubCategory, number> = {
	crypto: 0,
	stock: 1,
	forex: 2,
	metal: 3,
	equity: 4,
	prediction: 255
};

// Crypto: pairIndex 0-19, perps enabled
const CRYPTO_LIST: Array<[CryptoSymbol, string, number]> = [
	['BTC', 'Bitcoin', 0], ['ETH', 'Ethereum', 1], ['BNB', 'BNB', 2], ['SOL', 'Solana', 3],
	['XRP', 'XRP', 4], ['DOGE', 'Dogecoin', 5], ['ADA', 'Cardano', 6], ['TRX', 'TRON', 7],
	['AVAX', 'Avalanche', 8], ['LINK', 'Chainlink', 9], ['DOT', 'Polkadot', 10],
	['MATIC', 'Polygon', 11], ['LTC', 'Litecoin', 12], ['UNI', 'Uniswap', 13],
	['ATOM', 'Cosmos', 14], ['NEAR', 'NEAR', 15], ['APT', 'Aptos', 16], ['SUI', 'Sui', 17],
	['INJ', 'Injective', 18], ['TAO', 'Bittensor', 19]
];

// Traditional: 10 stocks, 6 forex, 2 metals, 2 global equities — indexes match mockrock
const TRADITIONAL_LIST: Array<[TraditionalSymbol, string, number, MarketSubCategory]> = [
	['AAPL', 'Apple', 0, 'stock'], ['TSLA', 'Tesla', 1, 'stock'], ['NVDA', 'NVIDIA', 2, 'stock'],
	['AMZN', 'Amazon', 3, 'stock'], ['MSFT', 'Microsoft', 4, 'stock'], ['GOOGL', 'Alphabet', 5, 'stock'],
	['META', 'Meta', 6, 'stock'], ['NFLX', 'Netflix', 7, 'stock'], ['JPM', 'JPMorgan', 8, 'stock'],
	['AMD', 'AMD', 9, 'stock'],
	['EURUSD', 'EUR / USD', 10, 'forex'], ['GBPUSD', 'GBP / USD', 11, 'forex'],
	['USDJPY', 'USD / JPY', 12, 'forex'], ['AUDUSD', 'AUD / USD', 13, 'forex'],
	['USDCHF', 'USD / CHF', 14, 'forex'], ['USDCAD', 'USD / CAD', 15, 'forex'],
	['XAUUSD', 'Gold', 16, 'metal'], ['XAGUSD', 'Silver', 17, 'metal'],
	['BABA', 'Alibaba', 18, 'equity'], ['COIN', 'Coinbase', 19, 'equity']
];

export const ALL_MARKETS: MarketEntry[] = [
	...CRYPTO_LIST.map(([sym, label, idx]) => ({
		symbol: sym,
		label,
		category: 'crypto' as const,
		sub: 'crypto' as const,
		pairIndex: idx,
		decimals: 8,
		perpEnabled: true,
		quote: 'USD'
	})),
	...TRADITIONAL_LIST.map(([sym, label, idx, sub]) => ({
		symbol: sym,
		label,
		category: 'traditional' as const,
		sub,
		pairIndex: idx,
		decimals: sub === 'forex' ? 5 : 4,
		perpEnabled: sub !== 'metal',
		quote: 'USD'
	}))
];

export const MARKETS_BY_CATEGORY: Record<MarketCategory, MarketEntry[]> = {
	crypto: ALL_MARKETS.filter((m) => m.category === 'crypto'),
	traditional: ALL_MARKETS.filter((m) => m.category === 'traditional'),
	prediction: []
};

export const PERP_LEVERAGE_TIERS = [2, 3, 5, 10, 15, 20, 25, 50] as const;

export function findMarket(symbol: string): MarketEntry | undefined {
	return ALL_MARKETS.find((m) => m.symbol === symbol);
}
