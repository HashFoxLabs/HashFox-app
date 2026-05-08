import { Connection, type Commitment, type Finality } from '@solana/web3.js';
import { SOLANA_RPC } from '$lib/env';

/** Drop-in replacement for `new Connection(SOLANA_RPC, commitment)` that
 *  replaces the WebSocket-based `confirmTransaction` with a polling loop.
 *
 *  Why: our production RPC sits behind a same-origin Cloudflare Worker proxy
 *  at `/api/rpc`. The proxy is HTTP-only, but web3.js auto-derives a WS URL
 *  (`wss://polymock.app/api/rpc`) and uses it for `signatureSubscribe` from
 *  inside `confirmTransaction`. That WS upgrade fails and retries forever,
 *  spamming the console and chewing CPU. Polling `getSignatureStatuses` is
 *  HTTP-only, slightly chattier, and "good enough" at devnet scale. */
export function buildConnection(commitment: Commitment = 'confirmed'): Connection {
	const conn = new Connection(SOLANA_RPC, commitment);
	patchConnection(conn);
	return conn;
}

/** Apply the WS-free confirm patch to a Connection that was constructed
 *  somewhere else (third-party libs we don't control, e.g. AnchorProvider). */
export function patchConnection(conn: Connection): Connection {
	(conn as unknown as Record<string, unknown>).confirmTransaction = (
		sigOrStrategy: unknown,
		commitment?: Commitment
	) => {
		// web3.js accepts either a signature string or a strategy object
		// `{ signature, blockhash, lastValidBlockHeight }`. We only care about
		// the signature; the polling loop doesn't need the strategy.
		const sig =
			typeof sigOrStrategy === 'string'
				? sigOrStrategy
				: ((sigOrStrategy as { signature?: string })?.signature ?? '');
		if (!sig) return Promise.resolve({ context: { slot: 0 }, value: { err: null } });
		return pollUntilConfirmed(conn, sig, commitment ?? 'confirmed');
	};
	return conn;
}

async function pollUntilConfirmed(
	conn: Connection,
	signature: string,
	commitment: Commitment | Finality
): Promise<{ context: { slot: number }; value: { err: unknown } }> {
	const target = commitmentRank(commitment);
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const res = await conn.getSignatureStatuses([signature]);
		const status = res.value[0];
		if (status) {
			if (status.err) {
				throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
			}
			const reached = commitmentRank(status.confirmationStatus ?? 'processed');
			if (reached >= target) {
				return { context: { slot: status.slot ?? 0 }, value: { err: null } };
			}
		}
		await sleep(800);
	}
	throw new Error(`Timed out waiting for ${signature.slice(0, 8)}… to confirm`);
}

function commitmentRank(c: Commitment | Finality | string): number {
	switch (c) {
		case 'processed':
			return 0;
		case 'confirmed':
			return 1;
		case 'finalized':
		case 'max':
		case 'root':
		case 'single':
		case 'singleGossip':
		case 'recent':
			return 2;
		default:
			return 1;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
