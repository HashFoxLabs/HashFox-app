import { json } from '@sveltejs/kit';
import { SYNTHESIS_API_KEY } from '$env/static/private';
import type { RequestHandler } from './$types';

const SYNTHESIS_API_BASE = 'https://synthesis.trade/api/v1';

// Maps our display category names to the tag slugs Synthesis/Polymarket actually uses
const TAG_MAP: Record<string, string> = {
	economy: 'economics',
	elections: 'global-elections',
	finance: 'business',
	world: 'geopolitics',
	politics: 'Politics',
	entertainment: 'Entertainment',
	health: 'Health',
	culture: 'pop-culture'
};

function normalizeTags(raw: string): string {
	return raw
		.split(',')
		.map((t) => {
			const trimmed = t.trim().toLowerCase();
			return TAG_MAP[trimmed] ?? trimmed;
		})
		.join(',');
}

export const GET: RequestHandler = async ({ url }) => {
	try {
		if (!SYNTHESIS_API_KEY) {
			return json({ error: 'SYNTHESIS_API_KEY not configured' }, { status: 500 });
		}

		const limit = url.searchParams.get('limit') || '5';
		const tags = url.searchParams.get('tags') || '';
		const ended = url.searchParams.get('ended') || '';

		const params = new URLSearchParams({
			venue: 'polymarket',
			sort: 'volume',
			order: 'DESC',
			limit,
			markets: 'true'
		});
		if (tags) params.set('tags', normalizeTags(tags));
		if (ended === 'true') {
			params.set('max_ends_at', new Date().toISOString());
		}

		const response = await fetch(`${SYNTHESIS_API_BASE}/markets?${params}`, {
			headers: {
				Accept: 'application/json',
				'X-PROJECT-API-KEY': SYNTHESIS_API_KEY
			}
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = await response.json();
		if (!data.success || !data.response) {
			throw new Error('Invalid response from Synthesis API');
		}

		const now = new Date();
		const markets: any[] = [];
		for (const item of data.response) {
			if (!item.markets) continue;
			for (const market of item.markets) {
				const endsAt = market.ends_at ? new Date(market.ends_at) : null;
				const hasEnded = endsAt ? endsAt < now : false;

				if (ended === 'true' && !hasEnded) continue;
				if (ended === 'true' && !endsAt) continue;
				if (ended === 'false' && hasEnded) continue;

				const leftPrice = parseFloat(market.left_price || '0');
				const rightPrice = parseFloat(market.right_price || '0');
				let resolvedOutcome: string | null = null;
				if (market.resolved === true) {
					if (market.winner_token_id === market.left_token_id) {
						resolvedOutcome = market.left_outcome || 'Yes';
					} else if (market.winner_token_id === market.right_token_id) {
						resolvedOutcome = market.right_outcome || 'No';
					}
				}

				markets.push({
					id: market.condition_id || market.market_id,
					question: market.question || market.outcome,
					title: market.question || market.outcome,
					slug: market.slug,
					image: market.image || item.image,
					active: market.active,
					closed: hasEnded,
					resolved: market.resolved === true,
					resolvedOutcome,
					volume: parseFloat(market.volume || '0'),
					volume_24hr: parseFloat(market.volume24hr || '0'),
					liquidity: parseFloat(market.liquidity || '0'),
					outcomePrices: [market.left_price, market.right_price],
					clobTokenIds: [market.left_token_id, market.right_token_id],
					outcomes: JSON.stringify([market.left_outcome || 'Yes', market.right_outcome || 'No']),
					end_date_iso: market.ends_at,
					endDate: market.ends_at,
					createdAt: market.created_at,
					conditionId: market.condition_id || market.market_id,
					tags: item.tags || item.labels || [],
					category: (item.tags || item.labels || [])[0] || '',
					enableOrderBook: true,
					enable_order_book: true,
					yesPrice: leftPrice,
					noPrice: rightPrice,
					last_trade_price: leftPrice,
					neg_risk: item.neg_risk || false
				});
			}
		}

		return json(markets, {
			headers: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET',
				'Access-Control-Allow-Headers': 'Content-Type'
			}
		});
	} catch (error) {
		return json(
			{ error: 'Failed to fetch markets', details: error instanceof Error ? error.message : 'Unknown error' },
			{
				status: 500,
				headers: {
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET',
					'Access-Control-Allow-Headers': 'Content-Type'
				}
			}
		);
	}
};

