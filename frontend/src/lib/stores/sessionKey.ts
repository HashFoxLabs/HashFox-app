import { writable } from 'svelte/store';
import { PublicKey } from '@solana/web3.js';

export interface SessionKeyState {
	active: boolean;
	signer: PublicKey | null;
	token: PublicKey | null;
	validUntil: number;
}

export const sessionKey = writable<SessionKeyState>({
	active: false,
	signer: null,
	token: null,
	validUntil: 0
});

export function endSession() {
	sessionKey.set({ active: false, signer: null, token: null, validUntil: 0 });
}
