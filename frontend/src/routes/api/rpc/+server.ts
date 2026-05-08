import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Same-origin Solana RPC proxy.
 *
 * The browser POSTs JSON-RPC payloads to /api/rpc and we forward to whatever
 * upstream is configured server-side via `SOLANA_RPC_UPSTREAM`. Two reasons
 * to do this rather than letting the browser hit the upstream directly:
 *
 *   1. CORS — many RPC providers (rpcfast among them) block browser origins
 *      without an explicit allowlist on their dashboard. Same-origin requests
 *      sidestep the entire CORS dance.
 *   2. Key hiding — when PUBLIC_SOLANA_RPC contains the api_key=... it ships
 *      in the client bundle and anyone can scrape it. With a server-side
 *      proxy the key stays in `[vars]` (no PUBLIC_ prefix) and never leaves
 *      the worker.
 */
const UPSTREAM =
	env.SOLANA_RPC_UPSTREAM ??
	env.PUBLIC_SOLANA_RPC ??
	'https://api.devnet.solana.com';

export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const body = await request.text();

	// Forward the browser's Origin (and Referer) to the upstream so RPC
	// providers that gate by allowlisted origin (rpcfast, Helius, etc.) see
	// the same value they would on a direct browser→provider call. Worker
	// fetch() sends no Origin by default, which trips "Origin not allowed".
	// Falls back to the deployed domain when the browser request lacks Origin
	// (some user agents drop it on same-origin POSTs).
	const forwardOrigin = request.headers.get('origin') ?? url.origin;
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		origin: forwardOrigin,
		referer: request.headers.get('referer') ?? `${forwardOrigin}/`
	};

	let upstream: Response;
	try {
		upstream = await fetch(UPSTREAM, { method: 'POST', headers, body });
	} catch (err) {
		console.warn('[rpc-proxy] upstream fetch failed', err);
		throw error(502, 'Upstream RPC unreachable');
	}
	const text = await upstream.text();
	return new Response(text, {
		status: upstream.status,
		headers: {
			'content-type': upstream.headers.get('content-type') ?? 'application/json',
			// Prevent any accidental edge caching of mutating RPC calls.
			'cache-control': 'no-store'
		}
	});
};

export const GET: RequestHandler = () =>
	json({ ok: true, hint: 'POST a JSON-RPC payload here' });
