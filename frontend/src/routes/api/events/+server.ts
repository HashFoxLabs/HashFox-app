import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const SYNTHESIS_API_BASE = 'https://synthesis.trade/api/v1';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const SYNTHESIS_API_KEY = env.SYNTHESIS_API_KEY;
		if (!SYNTHESIS_API_KEY) {
			return json({ error: 'Missing SYNTHESIS_API_KEY' }, { status: 500 });
		}

		const limit = url.searchParams.get('limit') || '10';
		const active = url.searchParams.get('active') || 'true';
		const offset = url.searchParams.get('offset') || '0';

		const response = await fetch(
			`${SYNTHESIS_API_BASE}/polymarket/markets?limit=${limit}&offset=${offset}&sort=volume1wk&order=DESC`,
			{
				headers: {
					Accept: 'application/json',
					'X-PROJECT-API-KEY': SYNTHESIS_API_KEY
				}
			}
		);

		if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

		const data = await response.json();
		if (!data.success || !data.response) throw new Error('Invalid response from Synthesis API');

		// The upstream /polymarket/markets response may include the same event multiple times.
		// Deduplicate by event_id and merge markets so the frontend can diversify cleanly.
		const byEventId = new Map<string, any>();

		for (const item of data.response) {
			if (!item?.event) continue;
			if (active === 'true' && !item.event.active) continue;

			const event = item.event;
			const eventId = String(event.event_id);

			const markets = (item.markets || []).map((market: any) => ({
				id: market.condition_id,
				question: market.question,
				title: market.question,
				description: market.description,
				slug: market.slug,
				image: market.image || event.image,
				active: market.active,
				closed: market.resolved,
				volume: parseFloat(market.volume || '0'),
				volume_24hr: parseFloat(market.volume24hr || '0'),
				liquidity: parseFloat(market.liquidity || '0'),
				outcomePrices: [market.left_price, market.right_price],
				clobTokenIds: [market.left_token_id, market.right_token_id],
				end_date_iso: market.ends_at,
				tags: event.tags || [],
				enableOrderBook: true,
				enable_order_book: true,
				yesPrice: parseFloat(market.left_price || '0'),
				noPrice: parseFloat(market.right_price || '0')
			}));

			const existing = byEventId.get(eventId);
			if (!existing) {
				byEventId.set(eventId, {
					id: eventId,
					slug: event.slug,
					title: event.title,
					description: event.description,
					image: event.image,
					active: event.active,
					closed: event.live?.ended || false,
					archived: false,
					liquidity: parseFloat(event.liquidity || '0'),
					volume: parseFloat(event.volume || '0'),
					categories: event.labels || [],
					tags: event.tags || [],
					markets: [...markets]
				});
			} else {
				existing.markets.push(...markets);
			}
		}

		const events = Array.from(byEventId.values());

		return json(events);
	} catch (error) {
		console.error('Error fetching Polymarket events:', error);
		return json(
			{ error: 'Failed to fetch events', details: error instanceof Error ? error.message : 'Unknown error' },
			{ status: 500 }
		);
	}
};

