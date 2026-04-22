import axios from 'axios';

export interface PolyEvent {
	id: string;
	slug: string;
	title: string;
	subtitle?: string;
	description?: string;
	image?: string;
	active: boolean;
	closed: boolean;
	archived: boolean;
	liquidity?: number;
	volume?: number;
	categories?: string[];
	tags?: string[];
	markets: PolyMarket[];
}

export interface PolyMarket {
	id: string;
	question: string;
	description?: string;
	end_date_iso: string;
	outcomePrices?: string[] | number[];
	volume?: number;
	volume_24hr?: number;
	liquidity?: number;
	clobTokenIds?: string[];
	enableOrderBook?: boolean;
	enable_order_book?: boolean;
	yesPrice?: number;
	noPrice?: number;
}

export class PolymarketClient {
	private baseURL: string;

	constructor() {
		this.baseURL = '/api';
	}

	async fetchEvents(limit = 10, offset = 0): Promise<PolyEvent[]> {
		try {
			const response = await axios.get(`${this.baseURL}/events`, {
				params: { limit: limit * 2, offset, active: true, closed: false }
			});

			if (!Array.isArray(response.data)) return [];

			const tradableEvents = response.data
				.filter((event: PolyEvent) => event.markets?.some((m) => m.enableOrderBook || (m as any).enable_order_book))
				.slice(0, limit);

			for (const event of tradableEvents) {
				for (const market of event.markets) {
					this.processMarketTokens(market);
				}
			}

			return tradableEvents;
		} catch (error) {
			console.error('Error fetching Polymarket events:', error);
			return [];
		}
	}

	/**
	 * Fetches events from multiple buckets (active/open + active/closed + any/closed)
	 * and dedupes by event id. Used by the global search to find anything.
	 */
	async searchAllEvents(limit = 300): Promise<PolyEvent[]> {
		const fetchConfigs = [
			{ active: true, closed: false },
			{ active: false, closed: true },
			{ active: true, closed: true }
		];

		try {
			const results = await Promise.all(
				fetchConfigs.map((config) =>
					axios
						.get(`${this.baseURL}/events`, {
							params: {
								limit,
								offset: 0,
								active: config.active,
								closed: config.closed
							}
						})
						.catch((err) => {
							console.warn('searchAllEvents bucket failed:', config, err?.message);
							return { data: [] };
						})
				)
			);

			const byId = new Map<string, PolyEvent>();
			for (const response of results) {
				if (!Array.isArray(response.data)) continue;
				for (const event of response.data as PolyEvent[]) {
					if (byId.has(event.id)) continue;
					if (event.markets) {
						for (const market of event.markets) this.processMarketTokens(market);
					}
					byId.set(event.id, event);
				}
			}
			return Array.from(byId.values());
		} catch (error) {
			console.error('Error searching all events:', error);
			return [];
		}
	}

	private processMarketTokens(market: PolyMarket): PolyMarket {
		try {
			const prices = market.outcomePrices
				? typeof market.outcomePrices === 'string'
					? JSON.parse(market.outcomePrices)
					: market.outcomePrices
				: [];

			if (Array.isArray(prices) && prices.length >= 2) {
				market.yesPrice = typeof prices[0] === 'string' ? parseFloat(prices[0]) : prices[0];
				market.noPrice = typeof prices[1] === 'string' ? parseFloat(prices[1]) : prices[1];
			} else {
				market.yesPrice = 0;
				market.noPrice = 0;
			}
		} catch {
			market.yesPrice = 0;
			market.noPrice = 0;
		}
		return market;
	}
}

export const polymarketClient = new PolymarketClient();
