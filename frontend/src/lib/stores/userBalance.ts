import { writable, get } from 'svelte/store';
import type { BalanceBreakdown } from '$lib/hashfox';

const ZERO: BalanceBreakdown = { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };

/** Shared on-chain USDT balance used by the navbar and trade panels.
 *  Trade actions push fresh values via `refreshUserBalance()` so every
 *  consumer updates instantly without waiting for the next poll tick. */
export const userBalance = writable<BalanceBreakdown>({ ...ZERO });

export function setUserBalance(b: BalanceBreakdown) {
	userBalance.set(b);
}

export function clearUserBalance() {
	userBalance.set({ ...ZERO });
}

/** Pull the latest breakdown from the hashfox client and broadcast it. */
export async function refreshUserBalance(): Promise<BalanceBreakdown> {
	const { hashfoxClient } = await import('$lib/hashfoxClient');
	try {
		if (!hashfoxClient.connectedWallet?.publicKey) {
			userBalance.set({ ...ZERO });
			return get(userBalance);
		}
		const breakdown = await hashfoxClient.getBalanceBreakdown();
		userBalance.set(breakdown);
		return breakdown;
	} catch {
		return get(userBalance);
	}
}
