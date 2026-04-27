import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const SYNTHESIS_BASE = 'https://synthesis.trade/api/v1';

type MarketDetail = {
	id: string;
	question: string;
	yesPrice: number;
	noPrice: number;
	resolved: boolean;
	resolvedOutcome: string | null;
};

function mapMarket(market: any): MarketDetail | null {
	if (!market) return null;
	const left = parseFloat(market.left_price ?? '0');
	const right = parseFloat(market.right_price ?? '0');
	let resolvedOutcome: string | null = null;
	if (market.resolved === true) {
		if (market.winner_token_id === market.left_token_id) {
			resolvedOutcome = market.left_outcome || 'Yes';
		} else if (market.winner_token_id === market.right_token_id) {
			resolvedOutcome = market.right_outcome || 'No';
		}
	}
	return {
		id: market.condition_id ?? market.market_id ?? '',
		question: market.question || market.outcome || '',
		yesPrice: Number.isFinite(left) ? left : 0,
		noPrice: Number.isFinite(right) ? right : 0,
		resolved: market.resolved === true,
		resolvedOutcome
	};
}

export const GET: RequestHandler = async ({ params }) => {
	const { conditionId } = params;
	if (!conditionId) {
		return json({ error: 'Missing conditionId' }, { status: 400 });
	}

	const apiKey = env.SYNTHESIS_API_KEY;
	if (!apiKey) {
		return json({ error: 'SYNTHESIS_API_KEY not configured' }, { status: 500 });
	}

	const headers = {
		Accept: 'application/json',
		'X-PROJECT-API-KEY': apiKey
	};

	try {
		const direct = await fetch(`${SYNTHESIS_BASE}/polymarket/market/${conditionId}`, { headers });
		if (direct.ok) {
			const data = await direct.json();
			const market = data?.response?.market ?? data?.response ?? data?.market ?? data;
			const mapped = mapMarket(market);
			if (mapped && mapped.question) return json(mapped);
		}
	} catch (err) {
		console.warn('[polymarket/market] direct lookup failed', err);
	}

	try {
		const search = await fetch(
			`${SYNTHESIS_BASE}/markets?venue=polymarket&condition_id=${conditionId}&limit=1`,
			{ headers }
		);
		if (search.ok) {
			const data = await search.json();
			const list = data?.response ?? [];
			for (const item of list) {
				for (const market of item.markets ?? []) {
					if (market.condition_id === conditionId) {
						const mapped = mapMarket(market);
						if (mapped) return json(mapped);
					}
				}
			}
		}
	} catch (err) {
		console.warn('[polymarket/market] search lookup failed', err);
	}

	return json({ error: 'Market not found', conditionId }, { status: 404 });
};
