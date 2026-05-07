/**
 * POST /api/backtest/run
 *
 * Submits a backtest job to the parquet engine, polls until completion,
 * and streams NDJSON progress + result events back to the client.
 */

import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const POLL_INTERVAL_MS = 1000;
const MAX_POLL_ATTEMPTS = 300; // 5 minutes max

function ndjson(obj: unknown): string {
	return JSON.stringify(obj) + '\n';
}

export const POST: RequestHandler = async ({ request }) => {
	const engineUrl = env.PARQUET_ENGINE_URL;
	if (!engineUrl) {
		return new Response(
			ndjson({ type: 'error', error: 'PARQUET_ENGINE_URL not configured' }),
			{ status: 500, headers: { 'Content-Type': 'application/x-ndjson' } }
		);
	}

	const body = await request.json();
	const { paths, strategy_code, initial_capital = 10000, start_date = null, end_date = null, backtest_type = 'highfrequency' } = body;

	if (!paths?.length) {
		return new Response(
			ndjson({ type: 'error', error: 'No paths provided' }),
			{ status: 400, headers: { 'Content-Type': 'application/x-ndjson' } }
		);
	}

	const stream = new ReadableStream({
		async start(controller) {
			const enc = new TextEncoder();
			const emit = (obj: unknown) => controller.enqueue(enc.encode(ndjson(obj)));

			try {
				// Submit job
				emit({ type: 'progress', progress: 5, message: 'Submitting backtest job...' });

				const backtestEndpoint = backtest_type === 'longrun'
					? `${engineUrl}/api/v1/backtest-longrun`
					: `${engineUrl}/api/v1/backtest-highfrequency`;

				const submitRes = await fetch(backtestEndpoint, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ paths, strategy_code, initial_capital, start_date, end_date })
				});

				if (!submitRes.ok) {
					const errText = await submitRes.text().catch(() => 'Unknown error');
					emit({ type: 'error', error: `Engine error (${submitRes.status}): ${errText}` });
					controller.close();
					return;
				}

				const { job_id } = await submitRes.json();
				emit({ type: 'progress', progress: 15, message: 'Job queued, waiting for engine...' });

				// Poll
				for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
					await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

					const pollRes = await fetch(`${engineUrl}/api/v1/backtest/${job_id}`);
					if (!pollRes.ok) {
						emit({ type: 'error', error: `Poll error (${pollRes.status})` });
						controller.close();
						return;
					}

					const result = await pollRes.json();

					if (result.status === 'pending' || result.status === 'running') {
						const progress = 15 + Math.min(70, attempt * 2);
						emit({ type: 'progress', progress, message: 'Running backtest...' });
						continue;
					}

					if (result.status === 'failed') {
						emit({ type: 'error', error: result.error ?? 'Backtest failed' });
						controller.close();
						return;
					}

					if (result.status === 'done') {
						emit({ type: 'progress', progress: 95, message: 'Finalizing results...' });
						emit({ type: 'result', data: result });
						controller.close();
						return;
					}
				}

				emit({ type: 'error', error: 'Backtest timed out after 5 minutes' });
				controller.close();
			} catch (err: unknown) {
				const message = err instanceof Error ? err.message : String(err);
				emit({ type: 'error', error: `Failed to reach backtest engine: ${message}` });
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'application/x-ndjson',
			'Transfer-Encoding': 'chunked',
			'Cache-Control': 'no-cache'
		}
	});
};
