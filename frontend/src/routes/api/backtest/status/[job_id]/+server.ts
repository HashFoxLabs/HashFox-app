/**
 * GET /api/backtest/status/[job_id]
 *
 * Proxies a single status check to the parquet engine. The client polls this
 * endpoint; each poll is its own Worker invocation, sidestepping the
 * per-invocation subrequest limit.
 */

import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const engineUrl = env.PARQUET_ENGINE_URL;
	if (!engineUrl) {
		return new Response(JSON.stringify({ error: 'PARQUET_ENGINE_URL not configured' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const { job_id } = params;
	if (!job_id) {
		return new Response(JSON.stringify({ error: 'Missing job_id' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	try {
		const res = await fetch(`${engineUrl}/api/v1/backtest/${encodeURIComponent(job_id)}`);
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
