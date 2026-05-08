import { browser } from '$app/environment';
import { writable } from 'svelte/store';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import type { Adapter, WalletName, SignerWalletAdapter } from '@solana/wallet-adapter-base';
import { MAGICBLOCK_RPC } from '$lib/env';
import { patchConnection } from '$lib/solana/connection';
import { fetchProfile } from '$lib/supabase';

export const EMBEDDED_WALLET_NAME = 'Web3Auth';

// Wallet state store
export const walletStore = writable<{
	adapter: Adapter | null;
	connected: boolean;
	connecting: boolean;
	publicKey: PublicKey | null;
	wallet: Adapter | null;
	username: string | null;
	avatarUrl: string | null;
	bannerUrl: string | null;
	isEmbedded: boolean;
	embeddedEmail: string | null;
	embeddedName: string | null;
	embeddedImage: string | null;
	profileHydrated: boolean;
}>({
	adapter: null,
	connected: false,
	connecting: false,
	publicKey: null,
	wallet: null,
	username: null,
	avatarUrl: null,
	bannerUrl: null,
	isEmbedded: false,
	embeddedEmail: null,
	embeddedName: null,
	embeddedImage: null,
	profileHydrated: false
});

export function setWalletUsername(username: string) {
	walletStore.update((s) => ({ ...s, username }));
}

export const connectionStore = writable<Connection | null>(null);

let extensionWalletsReady: Promise<void> | null = null;

/** Loads Phantom/Solflare only in the browser (skipped on Cloudflare SSR / Workers). */
export function registerBrowserWalletAdapters(): Promise<void> {
	if (!browser) return Promise.resolve();
	if (!extensionWalletsReady) {
		extensionWalletsReady = walletManager.installExtensionWallets();
	}
	return extensionWalletsReady;
}

class WalletManager {
	private connection: Connection;
	private wallets: Adapter[] = [];
	private selectedWallet: Adapter | null = null;

	constructor() {
		const endpoint = MAGICBLOCK_RPC;
		this.connection = patchConnection(new Connection(endpoint, 'confirmed'));
		connectionStore.set(this.connection);
	}

	async installExtensionWallets(): Promise<void> {
		if (!browser || this.wallets.length > 0) return;
		const { PhantomWalletAdapter, SolflareWalletAdapter } = await import('@solana/wallet-adapter-wallets');
		this.wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
	}

	private async ensureExtensionWallets(): Promise<void> {
		if (!browser) return;
		if (this.wallets.length > 0) return;
		await registerBrowserWalletAdapters();
	}

	getWallets() {
		return this.wallets;
	}

	async connect(walletName?: WalletName | string) {
		if (walletName === EMBEDDED_WALLET_NAME) {
			return this.connectEmbedded();
		}

		try {
			await this.ensureExtensionWallets();

			walletStore.update((state) => ({ ...state, connecting: true }));

			let adapter: Adapter;
			if (walletName) {
				const found = this.wallets.find((w) => w.name === walletName);
				if (!found) throw new Error(`Wallet ${walletName} not found`);
				adapter = found;
			} else {
				adapter = this.wallets.find((w) => w.name === 'Phantom') || this.wallets[0];
			}

			if (!adapter) {
				throw new Error('Browser wallets are not ready yet. Please try again.');
			}

			if (adapter.readyState === 'NotDetected') {
				throw new Error(
					`${adapter.name} wallet is not installed. Please install it from your browser's extension store.`
				);
			}

			if (this.selectedWallet && this.selectedWallet !== adapter) {
				await this.disconnect();
			}

			this.selectedWallet = adapter;

			const handleConnect = () => {
				walletStore.update((state) => ({
					...state,
					adapter,
					connected: true,
					connecting: false,
					publicKey: adapter.publicKey,
					wallet: adapter,
					isEmbedded: false,
					profileHydrated: false
				}));
				localStorage.setItem('solana-wallet', adapter.name);
				if (adapter.publicKey) {
					void hydrateProfile(adapter.publicKey.toBase58());
				}
			};

			const handleDisconnect = () => {
				walletStore.update((state) => ({
					...state,
					adapter: null,
					connected: false,
					connecting: false,
					publicKey: null,
					wallet: null,
					username: null,
					avatarUrl: null,
					bannerUrl: null,
					isEmbedded: false,
					embeddedEmail: null,
					embeddedName: null,
					embeddedImage: null,
					profileHydrated: false
				}));
				localStorage.removeItem('solana-wallet');
			};

			const handleError = () => {
				walletStore.update((state) => ({ ...state, connecting: false }));
			};

			adapter.removeAllListeners();
			adapter.on('connect', handleConnect);
			adapter.on('disconnect', handleDisconnect);
			adapter.on('error', handleError);

			try {
				if (!adapter.connected) {
					await adapter.connect();
				} else {
					handleConnect();
				}
			} catch (connectError: any) {
				walletStore.update((state) => ({ ...state, connecting: false }));
				if (connectError?.message?.includes('The source')) {
					throw new Error('not been authorized');
				}
				if (connectError?.message?.includes('User rejected')) {
					throw new Error('User rejected the connection request');
				}
				throw connectError;
			}
		} catch (error) {
			walletStore.update((state) => ({ ...state, connecting: false }));
			throw error;
		}
	}

	async connectEmbedded() {
		try {
			walletStore.update((state) => ({ ...state, connecting: true }));

			// If we're already connected to an embedded wallet, don't re-run Web3Auth connect
			// (TopChrome/WalletButton can remount across navigation).
			let alreadyEmbedded = false;
			walletStore.update((s) => {
				alreadyEmbedded = !!(s.connected && s.isEmbedded && s.publicKey);
				return s;
			});
			if (alreadyEmbedded && this.selectedWallet?.name === EMBEDDED_WALLET_NAME) {
				walletStore.update((state) => ({ ...state, connecting: false }));
				return;
			}

			if (this.selectedWallet && this.selectedWallet.name !== EMBEDDED_WALLET_NAME) {
				await this.disconnect();
			}

			const { connectWeb3Auth, createWeb3AuthWalletAdapter } = await import('./web3auth');
			const result = await connectWeb3Auth();
			if (!result) {
				walletStore.update((state) => ({ ...state, connecting: false }));
				return;
			}

			const adapter = createWeb3AuthWalletAdapter(result.wallet, result.publicKey) as Adapter;
			this.selectedWallet = adapter;

			walletStore.update((state) => ({
				...state,
				adapter,
				wallet: adapter,
				connected: true,
				connecting: false,
				publicKey: result.publicKey,
				isEmbedded: true,
				embeddedEmail: result.userInfo.email ?? null,
				embeddedName: result.userInfo.name ?? null,
				embeddedImage: result.userInfo.profileImage ?? null,
				profileHydrated: false
			}));
			localStorage.setItem('solana-wallet', EMBEDDED_WALLET_NAME);
			void hydrateProfile(result.publicKey.toBase58());
		} catch (err) {
			walletStore.update((state) => ({ ...state, connecting: false }));
			throw err;
		}
	}

	async disconnect() {
		if (!this.selectedWallet) return;
		try {
			if (this.selectedWallet.name === EMBEDDED_WALLET_NAME) {
				const { disconnectWeb3Auth } = await import('./web3auth');
				await disconnectWeb3Auth();
				walletStore.update((state) => ({
					...state,
					adapter: null,
					connected: false,
					connecting: false,
					publicKey: null,
					wallet: null,
					username: null,
					avatarUrl: null,
					bannerUrl: null,
					isEmbedded: false,
					embeddedEmail: null,
					embeddedName: null,
					embeddedImage: null,
					profileHydrated: false
				}));
				localStorage.removeItem('solana-wallet');
			} else {
				await this.selectedWallet.disconnect();
			}
		} catch (err) {
			console.error('[WALLET] Failed to disconnect:', err);
		} finally {
			this.selectedWallet = null;
		}
	}

	async signTransaction(transaction: Transaction) {
		if (!this.selectedWallet?.connected) throw new Error('Wallet not connected');
		const signerWallet = this.selectedWallet as SignerWalletAdapter;
		if (!signerWallet.signTransaction) {
			throw new Error('Wallet does not support signing transactions');
		}
		return await signerWallet.signTransaction(transaction);
	}

	async signAllTransactions(transactions: Transaction[]) {
		if (!this.selectedWallet?.connected) throw new Error('Wallet not connected');
		const signerWallet = this.selectedWallet as SignerWalletAdapter;
		if (!signerWallet.signAllTransactions) {
			throw new Error('Wallet does not support signing multiple transactions');
		}
		return await signerWallet.signAllTransactions(transactions);
	}

	async autoConnect() {
		const savedWallet = localStorage.getItem('solana-wallet');
		if (!savedWallet) return;
		try {
			await new Promise((r) => setTimeout(r, 500));
			await this.connect(savedWallet);
		} catch {
			localStorage.removeItem('solana-wallet');
		}
	}
}

async function hydrateProfile(walletAddress: string) {
	try {
		const profile = await fetchProfile(walletAddress);
		walletStore.update((s) => ({
			...s,
			username: profile?.username ?? null,
			avatarUrl: profile?.avatar_url ?? null,
			bannerUrl: profile?.banner_url ?? null,
			profileHydrated: true
		}));
	} catch (err) {
		console.warn('[WALLET] profile hydrate failed', err);
		walletStore.update((s) => ({ ...s, profileHydrated: true }));
	}
}

export const walletManager = new WalletManager();
