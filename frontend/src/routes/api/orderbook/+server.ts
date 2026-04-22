import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const SYNTHESIS_BASE = 'https://synthesis.trade/api/v1';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const { tokenIds } = await request.json();
		if (!Array.isArray(tokenIds) || tokenIds.length === 0) {
			return json({ success: false, error: 'tokenIds array required' }, { status: 400 });
		}
		const apiKey = env.SYNTHESIS_API_KEY;
		if (!apiKey) {
			return json({ success: false, error: 'Missing SYNTHESIS_API_KEY' }, { status: 500 });
		}
		const resp = await fetch(`${SYNTHESIS_BASE}/markets/orderbooks`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-PROJECT-API-KEY': apiKey
			},
			body: JSON.stringify(tokenIds)
		});
		if (!resp.ok) throw new Error(`Synthesis ${resp.status}`);
		const data = await resp.json();
		return json(data);
	} catch (err) {
		console.error('[orderbook] error:', err);
		return json({ success: false, error: 'Failed to fetch orderbook' }, { status: 500 });
	}
};
