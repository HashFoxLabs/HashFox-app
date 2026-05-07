import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
	const engineUrl = env.PARQUET_ENGINE_URL;
	if (!engineUrl) {
		return new Response(JSON.stringify({ error: 'PARQUET_ENGINE_URL not configured' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const source = url.searchParams.get('source');
	const q = url.searchParams.get('q');

	const upstream = new URL(`${engineUrl}/api/v1/markets`);
	if (source) upstream.searchParams.set('source', source);
	if (q) upstream.searchParams.set('q', q);

	try {
		const res = await fetch(upstream.toString());
		const data = await res.json();
		return new Response(JSON.stringify(data), {
			status: res.status,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ error: message }), {
			status: 502,
			headers: { 'Content-Type': 'application/json' }
		});
	}
};
