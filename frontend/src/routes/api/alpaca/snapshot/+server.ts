import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const ALPACA_BASE = 'https://data.alpaca.markets/v2';

type Quote = {
	bp: number; // bid price
	bs: number; // bid size (round lots × 100 for IEX)
	ap: number; // ask price
	as: number; // ask size
	t: string; // timestamp
};
type Trade = {
	p: number;
	s: number;
	t: string;
	i: number; // trade id (for dedupe)
	x: string; // exchange
};

export const GET: RequestHandler = async ({ url }) => {
	const symbol = (url.searchParams.get('symbol') ?? '').toUpperCase();
	if (!symbol || !/^[A-Z.]{1,8}$/.test(symbol)) {
		return json({ ok: false, reason: 'bad_symbol' }, { status: 400 });
	}

	const keyId = env.ALPACA_KEY_ID;
	const secret = env.ALPACA_SECRET_KEY;
	if (!keyId || !secret) {
		return json({ ok: false, reason: 'no_key' }, { status: 200 });
	}

	const headers = {
		'APCA-API-KEY-ID': keyId,
		'APCA-API-SECRET-KEY': secret
	};

	try {
		const [quoteRes, tradeRes] = await Promise.all([
			fetch(`${ALPACA_BASE}/stocks/${symbol}/quotes/latest?feed=iex`, { headers }),
			fetch(`${ALPACA_BASE}/stocks/${symbol}/trades/latest?feed=iex`, { headers })
		]);

		if (!quoteRes.ok || !tradeRes.ok) {
			return json(
				{ ok: false, reason: 'upstream_error', status: [quoteRes.status, tradeRes.status] },
				{ status: 502 }
			);
		}

		const quoteJson = (await quoteRes.json()) as { quote?: Quote };
		const tradeJson = (await tradeRes.json()) as { trade?: Trade };

		return json(
			{
				ok: true,
				symbol,
				quote: quoteJson.quote ?? null,
				trade: tradeJson.trade ?? null
			},
			{
				headers: {
					// Allow short browser cache to smooth rapid re-renders without staling.
					'cache-control': 'no-store'
				}
			}
		);
	} catch (err) {
		console.error('[alpaca/snapshot] error:', err);
		return json({ ok: false, reason: 'fetch_error' }, { status: 502 });
	}
};
