import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const SYNTHESIS_BASE = 'https://synthesis.trade/api/v1';

export const GET: RequestHandler = async ({ params, url }) => {
	const { tokenId } = params;
	const rawInterval = url.searchParams.get('interval') || '1d';
	const interval = rawInterval === 'all' ? '1d' : rawInterval;

	try {
		const apiKey = env.SYNTHESIS_API_KEY;
		const resp = await fetch(
			`${SYNTHESIS_BASE}/polymarket/market/${tokenId}/price-history?interval=${interval}&volume=true`,
			{
				headers: {
					Accept: 'application/json',
					...(apiKey ? { 'X-PROJECT-API-KEY': apiKey } : {})
				}
			}
		);
		if (!resp.ok) throw new Error(`Synthesis ${resp.status}`);
		const data = await resp.json();
		return json(data);
	} catch (err) {
		console.error('[pricehistory] error:', err);
		return json({ success: false, error: 'Failed to fetch price history' }, { status: 500 });
	}
};
