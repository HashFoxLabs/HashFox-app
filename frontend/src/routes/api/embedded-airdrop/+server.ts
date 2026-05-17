import { env } from '$env/dynamic/private';
import { error, json } from '@sveltejs/kit';
import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	SystemProgram,
	Transaction
} from '@solana/web3.js';
import bs58 from 'bs58';
import type { RequestHandler } from './$types';

/** One-shot devnet faucet for brand-new embedded wallets.
 *
 *  Funds 2 SOL on the very first Web3Auth login for a freshly minted address
 *  and never again. "First time" is detected on-chain: a new pubkey has zero
 *  signatures in its history, so `getSignaturesForAddress(..., { limit: 1 })`
 *  returning empty is the eligibility gate. Any prior tx (incl. a previous
 *  airdrop from us) makes the request a no-op.
 *
 *  The funder secret stays server-side in `AIRDROP_FUNDER_SECRET`. Never put
 *  this in a PUBLIC_ var — it would ship in the client bundle.
 */

const AIRDROP_LAMPORTS = 2 * LAMPORTS_PER_SOL;

const UPSTREAM_RPC =
	env.SOLANA_RPC_UPSTREAM ??
	env.PUBLIC_SOLANA_RPC ??
	'https://api.devnet.solana.com';

let funderKeypair: Keypair | null = null;
function getFunder(): Keypair {
	if (funderKeypair) return funderKeypair;
	const secret = env.AIRDROP_FUNDER_SECRET;
	if (!secret) throw error(503, 'Airdrop disabled (AIRDROP_FUNDER_SECRET unset)');
	try {
		funderKeypair = Keypair.fromSecretKey(bs58.decode(secret));
	} catch {
		throw error(500, 'AIRDROP_FUNDER_SECRET is not a valid base58 secret key');
	}
	return funderKeypair;
}

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const addressRaw = body?.address;
	if (typeof addressRaw !== 'string' || addressRaw.length < 32) {
		throw error(400, 'Missing or invalid `address`');
	}

	let destination: PublicKey;
	try {
		destination = new PublicKey(addressRaw);
	} catch {
		throw error(400, 'Invalid Solana address');
	}

	const funder = getFunder();
	const connection = new Connection(UPSTREAM_RPC, 'confirmed');

	// Eligibility gate: brand-new pubkeys have zero on-chain history. Any prior
	// signature (including a previous airdrop from us) closes the window.
	const sigs = await connection.getSignaturesForAddress(destination, { limit: 1 });
	if (sigs.length > 0) {
		return json({ sent: false, reason: 'address already used' });
	}

	const tx = new Transaction().add(
		SystemProgram.transfer({
			fromPubkey: funder.publicKey,
			toPubkey: destination,
			lamports: AIRDROP_LAMPORTS
		})
	);
	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	tx.recentBlockhash = blockhash;
	tx.feePayer = funder.publicKey;
	tx.sign(funder);

	let signature: string;
	try {
		signature = await connection.sendRawTransaction(tx.serialize(), {
			skipPreflight: false,
			maxRetries: 3
		});
	} catch (err: any) {
		console.warn('[embedded-airdrop] send failed', err?.message ?? err);
		throw error(502, 'Airdrop send failed');
	}

	return json({ sent: true, signature, lamports: AIRDROP_LAMPORTS });
};
