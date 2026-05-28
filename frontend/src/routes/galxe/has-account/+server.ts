import { env } from '$env/dynamic/private';
import { PublicKey } from '@solana/web3.js';
import type { RequestHandler } from './$types';

/** Galxe quest verification: returns whether a Solana wallet has a PolyMock
 *  on-chain account. PolyMock account == the `["user", wallet]` PDA on the
 *  hashfox program; presence on-chain is the eligibility signal.
 *
 *  Galxe calls this from https://dashboard.galxe.com with `?address=<base58>`
 *  substituted in. Auth: `Authorization: Bearer <GALXE_AUTH_KEY>` (configured
 *  in the Galxe credential header field). */

const PROGRAM_ID = new PublicKey('7ApsvRSqfqCA5YbSSvAmeboFFU7hyB2HJBCpEiwmLSSi');

const UPSTREAM_RPC =
	env.SOLANA_RPC_UPSTREAM ??
	env.PUBLIC_SOLANA_RPC ??
	'https://api.devnet.solana.com';

const CORS_HEADERS: Record<string, string> = {
	'access-control-allow-origin': 'https://dashboard.galxe.com',
	'access-control-allow-methods': 'GET',
	'access-control-allow-headers': 'authorization, content-type',
	'access-control-max-age': '86400'
};

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json',
			'cache-control': 'no-store',
			...CORS_HEADERS
		}
	});
}

export const OPTIONS: RequestHandler = () =>
	new Response(null, { status: 204, headers: CORS_HEADERS });

export const GET: RequestHandler = async ({ url, request, fetch }) => {
	const expected = env.GALXE_AUTH_KEY;
	if (expected) {
		const provided = request.headers.get('authorization') ?? '';
		const token = provided.startsWith('Bearer ') ? provided.slice(7) : provided;
		if (token !== expected) {
			return jsonResponse({ eligible: false, error: 'unauthorized' }, 401);
		}
	}

	const address = url.searchParams.get('address')?.trim();
	if (!address) {
		return jsonResponse({ eligible: false, error: 'missing address' }, 400);
	}

	let wallet: PublicKey;
	try {
		wallet = new PublicKey(address);
		// Reject anything that isn't a valid ed25519 point (curve check filters
		// out PDAs accidentally passed as wallets).
		if (!PublicKey.isOnCurve(wallet.toBytes())) {
			return jsonResponse({ eligible: false, error: 'invalid address' }, 400);
		}
	} catch {
		return jsonResponse({ eligible: false, error: 'invalid address' }, 400);
	}

	const [userPda] = PublicKey.findProgramAddressSync(
		[Buffer.from('user'), wallet.toBytes()],
		PROGRAM_ID
	);

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 4000);
	try {
		// Forward a fixed Origin matching the allowlist on our RPC provider
		// (rpcfast gates by origin). Server-to-server fetches send no Origin
		// by default and get rejected; in dev `url.origin` is localhost and
		// also fails, so pin to the deployed domain.
		const rpcOrigin = env.GALXE_RPC_ORIGIN ?? 'https://polymock.app';
		const rpcRes = await fetch(UPSTREAM_RPC, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: rpcOrigin,
				referer: `${rpcOrigin}/`
			},
			signal: controller.signal,
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: 1,
				method: 'getAccountInfo',
				params: [userPda.toBase58(), { encoding: 'base64', commitment: 'confirmed' }]
			})
		});
		if (!rpcRes.ok) {
			return jsonResponse({ eligible: false, error: 'rpc upstream error' }, 502);
		}
		const payload = (await rpcRes.json()) as { result?: { value: unknown } };
		const eligible = payload?.result?.value != null;
		return jsonResponse({ eligible });
	} catch {
		return jsonResponse({ eligible: false, error: 'rpc timeout' }, 504);
	} finally {
		clearTimeout(timeout);
	}
};
