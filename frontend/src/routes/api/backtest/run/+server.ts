/**
 * POST /api/backtest/run
 *
 * Submits a backtest job to the parquet engine and returns the job_id.
 * Polling is performed by the client against /api/backtest/status/[job_id]
 * to avoid the Cloudflare Workers per-invocation subrequest limit.
 */

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
	const {
		paths,
		strategy_code,
		initial_capital = 10000,
		start_date = null,
		end_date = null,
		backtest_type = 'highfrequency'
	} = body;

	if (!paths?.length) {
		return new Response(JSON.stringify({ error: 'No paths provided' }), {
			status: 400,
			headers: { 'Content-Type': 'application/json' }
		});
	}

	const backtestEndpoint = backtest_type === 'longrun'
		? `${engineUrl}/api/v1/backtest-longrun`
		: `${engineUrl}/api/v1/backtest-highfrequency`;

	try {
		const submitRes = await fetch(backtestEndpoint, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ paths, strategy_code, initial_capital, start_date, end_date })
		});

		if (!submitRes.ok) {
			const errText = await submitRes.text().catch(() => 'Unknown error');
			return new Response(
				JSON.stringify({ error: `Engine error (${submitRes.status}): ${errText}` }),
				{ status: 502, headers: { 'Content-Type': 'application/json' } }
			);
		}

		const { job_id } = await submitRes.json();
		return new Response(JSON.stringify({ job_id }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' }
		});
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(
			JSON.stringify({ error: `Failed to reach backtest engine: ${message}` }),
			{ status: 502, headers: { 'Content-Type': 'application/json' } }
		);
	}
};
