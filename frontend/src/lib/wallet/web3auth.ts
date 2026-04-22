import { browser } from '$app/environment';
import { Web3Auth } from '@web3auth/modal';
import { WEB3AUTH_NETWORK } from '@web3auth/base';
import { SolanaPrivateKeyProvider, SolanaWallet } from '@web3auth/solana-provider';
import { PublicKey } from '@solana/web3.js';
import { WEB3AUTH_CLIENT_ID, SOLANA_RPC } from '$lib/env';

let web3auth: Web3Auth | null = null;
let solanaWallet: SolanaWallet | null = null;

const chainConfig = {
	chainNamespace: 'solana' as const,
	chainId: '0x67',
	rpcTarget: SOLANA_RPC || 'https://api.devnet.solana.com',
	displayName: 'Solana Devnet',
	blockExplorerUrl: 'https://explorer.solana.com',
	ticker: 'SOL',
	tickerName: 'Solana',
	logo: 'https://images.toruswallet.io/solana.svg'
};

function clearWeb3AuthState() {
	if (!browser) return;
	const keysToRemove: string[] = [];
	for (let i = 0; i < localStorage.length; i++) {
		const key = localStorage.key(i);
		if (key && (key.startsWith('Web3Auth') || key.startsWith('openlogin') || key.includes('web3auth'))) {
			keysToRemove.push(key);
		}
	}
	keysToRemove.forEach((k) => localStorage.removeItem(k));
}

export async function initWeb3Auth(): Promise<Web3Auth | null> {
	if (!browser) return null;
	if (!WEB3AUTH_CLIENT_ID) {
		console.warn('[Web3Auth] PUBLIC_WEB3AUTH_CLIENT_ID not set — embedded login disabled');
		return null;
	}
	if (web3auth && web3auth.status === 'ready') return web3auth;

	web3auth = null;
	try {
		const privateKeyProvider = new SolanaPrivateKeyProvider({ config: { chainConfig } });
		const instance = new Web3Auth({
			clientId: WEB3AUTH_CLIENT_ID,
			web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
			privateKeyProvider
		});
		await instance.initModal();

		if (instance.status === 'not_ready') {
			clearWeb3AuthState();
			const retry = new Web3Auth({
				clientId: WEB3AUTH_CLIENT_ID,
				web3AuthNetwork: WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
				privateKeyProvider: new SolanaPrivateKeyProvider({ config: { chainConfig } })
			});
			await retry.initModal();
			web3auth = retry;
		} else {
			web3auth = instance;
		}
		return web3auth;
	} catch (err) {
		console.error('[Web3Auth] Init failed:', err);
		web3auth = null;
		return null;
	}
}

export async function connectWeb3Auth(): Promise<{
	publicKey: PublicKey;
	wallet: SolanaWallet;
	userInfo: { email?: string; name?: string; profileImage?: string };
} | null> {
	if (!web3auth || web3auth.status !== 'ready') {
		await initWeb3Auth();
	}
	if (!web3auth) {
		throw new Error('Web3Auth not initialized. Check PUBLIC_WEB3AUTH_CLIENT_ID.');
	}

	try {
		await web3auth.connect();
		const provider = web3auth.provider;
		if (!provider) throw new Error('No provider after connect');

		const solWallet = new SolanaWallet(provider);
		const accounts = await solWallet.requestAccounts();
		if (!accounts || accounts.length === 0) throw new Error('No Solana accounts returned');

		solanaWallet = solWallet;
		const publicKey = new PublicKey(accounts[0]);
		const userInfo = await web3auth.getUserInfo();
		return {
			publicKey,
			wallet: solanaWallet,
			userInfo: {
				email: userInfo.email || undefined,
				name: userInfo.name || undefined,
				profileImage: userInfo.profileImage || undefined
			}
		};
	} catch (err: any) {
		if (err?.message?.includes('User closed') || err?.code === 5000) {
			return null;
		}
		throw err;
	}
}

export async function disconnectWeb3Auth(): Promise<void> {
	try {
		if (web3auth?.connected) {
			await web3auth.logout();
		}
	} catch (err) {
		console.warn('[Web3Auth] Logout error (non-fatal):', err);
	}
	solanaWallet = null;
}

export function isWeb3AuthConnected(): boolean {
	return web3auth?.connected ?? false;
}

export function getWeb3AuthSolanaWallet(): SolanaWallet | null {
	return solanaWallet;
}

type Listener = (...args: any[]) => void;

export function createWeb3AuthWalletAdapter(solWallet: SolanaWallet, pubKey: PublicKey) {
	const listeners = new Map<string, Set<Listener>>();
	const emit = (ev: string, ...args: any[]) => {
		listeners.get(ev)?.forEach((l) => {
			try {
				l(...args);
			} catch {}
		});
	};

	const adapter: any = {
		name: 'Web3Auth',
		url: 'https://web3auth.io',
		icon: '',
		readyState: 'Installed',
		publicKey: pubKey,
		connected: true,
		connecting: false,
		supportedTransactionVersions: null,

		async connect() {
			emit('connect', pubKey);
		},
		async disconnect() {
			try {
				await disconnectWeb3Auth();
			} finally {
				adapter.connected = false;
				adapter.publicKey = null;
				emit('disconnect');
			}
		},
		async signTransaction(tx: any) {
			return await solWallet.signTransaction(tx);
		},
		async signAllTransactions(txs: any[]) {
			return await solWallet.signAllTransactions(txs);
		},
		async signMessage(message: Uint8Array) {
			return await solWallet.signMessage(message);
		},
		async sendTransaction() {
			throw new Error('sendTransaction not implemented for Web3Auth adapter');
		},

		on(ev: string, cb: Listener) {
			if (!listeners.has(ev)) listeners.set(ev, new Set());
			listeners.get(ev)!.add(cb);
			return adapter;
		},
		off(ev: string, cb: Listener) {
			listeners.get(ev)?.delete(cb);
			return adapter;
		},
		removeAllListeners(ev?: string) {
			if (ev) listeners.delete(ev);
			else listeners.clear();
			return adapter;
		}
	};

	return adapter;
}
