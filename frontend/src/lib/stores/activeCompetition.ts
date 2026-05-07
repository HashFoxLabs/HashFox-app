import { writable, get } from 'svelte/store';
import { PublicKey } from '@solana/web3.js';
import type { CompetitionView } from '$lib/competition';

export interface ActiveCompetitionState {
	pubkey: PublicKey | null;
	view: CompetitionView | null;
	loaded: boolean;
}

const EMPTY: ActiveCompetitionState = { pubkey: null, view: null, loaded: false };

/** Mirrors the user's `active_competition` field. Null when the user is not in
 * any tournament, otherwise carries the on-chain Competition account so terminals
 * can render the "tournament mode" banner and route trades to the comp_*
 * instructions. */
export const activeCompetition = writable<ActiveCompetitionState>({ ...EMPTY });

export function setActiveCompetition(s: ActiveCompetitionState) {
	activeCompetition.set(s);
}

export function clearActiveCompetition() {
	activeCompetition.set({ ...EMPTY });
}

/** Re-fetch the connected user's UserAccount + Competition (if any). Call after
 * join / claim flows so the rest of the app picks up the new mode. */
export async function refreshActiveCompetition(): Promise<ActiveCompetitionState> {
	const [{ hashfoxClient }, { fetchCompetitionByPda }] = await Promise.all([
		import('$lib/hashfoxClient'),
		import('$lib/competition')
	]);
	try {
		const wallet = hashfoxClient.connectedWallet;
		if (!wallet?.publicKey) {
			activeCompetition.set({ ...EMPTY });
			return get(activeCompetition);
		}
		const program = hashfoxClient.getProgram();
		if (!program) {
			activeCompetition.set({ ...EMPTY });
			return get(activeCompetition);
		}
		const acc = await hashfoxClient.getUserAccount();
		if (!acc) {
			activeCompetition.set({ pubkey: null, view: null, loaded: true });
			return get(activeCompetition);
		}
		const compKey: PublicKey = acc.activeCompetition;
		if (!compKey || compKey.equals(PublicKey.default)) {
			activeCompetition.set({ pubkey: null, view: null, loaded: true });
			return get(activeCompetition);
		}
		const view = await fetchCompetitionByPda(program, compKey);
		activeCompetition.set({ pubkey: compKey, view, loaded: true });
		return get(activeCompetition);
	} catch (err) {
		console.warn('[activeCompetition] refresh failed', err);
		return get(activeCompetition);
	}
}
