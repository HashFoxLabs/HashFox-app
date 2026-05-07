import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	const engineUrl = env.PARQUET_ENGINE_URL;
	if (!engineUrl) {
		return new Response(JSON.stringify({ error: 'PARQUET_ENGINE_URL not configured' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const body = await request.json();

	try {
		const res = await fetch(`${engineUrl}/api/v1/preview`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body)
		});
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
