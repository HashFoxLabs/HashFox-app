import {
	Connection,
	PublicKey,
	LAMPORTS_PER_SOL,
	SystemProgram
} from '@solana/web3.js';
import { AnchorProvider, BN, Program, type Idl } from '$lib/vendor/anchor';
import type { Adapter, SignerWalletAdapter } from '@solana/wallet-adapter-base';
import { SOLANA_RPC, MAGICBLOCK_RPC, HASHFOX_PROGRAM_ID } from '$lib/env';
import { patchConnection } from '$lib/solana/connection';
import hashfoxIdl from '$lib/idl/hashfox.json';
import { sessionKeyManager } from '$lib/solana/session-keys';
import {
	enrichTradingPosition,
	decodeBalance,
	priceScaled,
	type BalanceBreakdown,
	type EnrichedTradingPosition,
	type TradingPositionAccount
} from '$lib/hashfox';
import { ALL_MARKETS } from '$lib/markets';

export const HASHFOX_PROGRAM_PUBKEY = new PublicKey(HASHFOX_PROGRAM_ID);

const PAIR_INDEX_TO_SYMBOL: Record<string, Record<number, string>> = {};
for (const m of ALL_MARKETS) {
	if (!PAIR_INDEX_TO_SYMBOL[m.sub]) PAIR_INDEX_TO_SYMBOL[m.sub] = {};
	PAIR_INDEX_TO_SYMBOL[m.sub][m.pairIndex] = m.symbol;
}

function pairSymbolFromIndex(idx: number, category: string = ''): string {
	const bySub = PAIR_INDEX_TO_SYMBOL[category]?.[idx];
	if (bySub) return bySub;
	if (category === 'crypto') {
		for (const m of ALL_MARKETS) {
			if (m.category === 'crypto' && m.pairIndex === idx) return m.symbol;
		}
	}
	if (category === 'stock' || category === 'forex' || category === 'metal' || category === 'equity') {
		for (const m of ALL_MARKETS) {
			if (m.category === 'traditional' && m.sub === category && m.pairIndex === idx) return m.symbol;
		}
	}
	// Best-effort fallback
	for (const m of ALL_MARKETS) {
		if (m.pairIndex === idx) return m.symbol;
	}
	return `P${idx}`;
}

function userPda(owner: PublicKey): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('user'), owner.toBuffer()],
		HASHFOX_PROGRAM_PUBKEY
	);
}
function configPda(): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([Buffer.from('config')], HASHFOX_PROGRAM_PUBKEY);
}

class HashfoxClient {
	connection: Connection;
	/** Devnet mainline RPC (used for SOL balance + airdrop, since MagicBlock RPC is ER). */
	solanaConnection: Connection;
	connectedWallet: Adapter | null = null;
	private program: any | null = null;

	constructor() {
		this.connection = patchConnection(new Connection(MAGICBLOCK_RPC, 'confirmed'));
		this.solanaConnection = patchConnection(new Connection(SOLANA_RPC, 'confirmed'));
	}

	setConnectedWallet(wallet: Adapter | null) {
		this.connectedWallet = wallet;
		this.program = null;
		if (wallet?.connected && wallet.publicKey) {
			try {
				this.program = new Program(hashfoxIdl as Idl, this.getProviderForAdapter(wallet));
			} catch {
				this.program = null;
			}
			// Hydrate the sessionKey store from localStorage so terminals know
			// fast-trade is active without waiting for a fresh createSession.
			if (sessionKeyManager.isSessionForWallet(wallet.publicKey)) {
				sessionKeyManager.publishToStore();
			} else {
				sessionKeyManager.resetStore();
			}
		} else {
			sessionKeyManager.resetStore();
		}
	}

	private getProviderForAdapter(adapter: Adapter): any {
		const signer = adapter as SignerWalletAdapter;
		if (!adapter.publicKey || !signer.signTransaction) {
			throw new Error('Wallet cannot sign transactions');
		}
		const w = {
			publicKey: adapter.publicKey,
			signTransaction: signer.signTransaction.bind(signer),
			signAllTransactions: signer.signAllTransactions?.bind(signer)
		};
		return new AnchorProvider(this.solanaConnection, w as any, {
			commitment: 'confirmed',
			preflightCommitment: 'confirmed'
		});
	}

	getProgram(): any | null {
		return this.program;
	}

	/** SOL balance of the connected wallet on devnet. */
	async getBalance(): Promise<number> {
		if (!this.connectedWallet?.publicKey) return 0;
		try {
			const lamports = await this.solanaConnection.getBalance(
				this.connectedWallet.publicKey,
				'confirmed'
			);
			return lamports / LAMPORTS_PER_SOL;
		} catch {
			return 0;
		}
	}

	/** Returns the on-chain UserAccount struct or null if not initialized.
	 * Auto-migrates pre-competition layouts (32 bytes shorter than the new
	 * struct) the first time they're encountered, so existing devnet users
	 * don't have to do anything manually. */
	async getUserAccount(): Promise<any | null> {
		if (!this.program || !this.connectedWallet?.publicKey) return null;
		const [pda] = userPda(this.connectedWallet.publicKey);
		try {
			return await (this.program.account as any).userAccount.fetch(pda);
		} catch (err: any) {
			if (await this.tryAutoMigrateUserAccount(pda)) {
				try {
					return await (this.program.account as any).userAccount.fetch(pda);
				} catch {
					return null;
				}
			}
			return null;
		}
	}

	/** Detect + run the one-time UserAccount realloc migration. Returns true
	 * if a migration tx was actually sent. Idempotent: safe to call repeatedly. */
	async tryAutoMigrateUserAccount(pdaArg?: PublicKey): Promise<boolean> {
		if (!this.program || !this.connectedWallet?.publicKey) return false;
		const adapter = this.connectedWallet as SignerWalletAdapter | null;
		if (!adapter?.signTransaction) return false;
		const [pda] = pdaArg ? [pdaArg] : userPda(this.connectedWallet.publicKey);
		const info = await this.solanaConnection.getAccountInfo(pda);
		if (!info) return false;
		// Old layout: 81 bytes. New layout: 113 bytes (adds 32-byte
		// active_competition Pubkey).
		if (info.data.length >= 113) return false;
		try {
			await this.program.methods
				.migrateUserAccount()
				.accounts(<any>{
					userAccount: pda,
					user: this.connectedWallet.publicKey,
					systemProgram: SystemProgram.programId
				})
				.rpc();
			return true;
		} catch (e) {
			console.warn('[hashfox] migrate_user_account failed', e);
			return false;
		}
	}

	async isAccountInitialized(): Promise<boolean> {
		if (!this.connectedWallet?.publicKey) return false;
		const [pda] = userPda(this.connectedWallet.publicKey);
		const info = await this.solanaConnection.getAccountInfo(pda);
		return info !== null;
	}

	/** One-shot unified paper account init. `entryFee` is SOL charged to devnet treasury. */
	async initializeAccount(entryFee: number = 0.1): Promise<string> {
		const adapter = this.connectedWallet as SignerWalletAdapter | null;
		if (!adapter?.connected || !adapter.publicKey || !adapter.signTransaction) {
			throw new Error('Wallet not connected');
		}

		const lamportBalance = await this.solanaConnection.getBalance(adapter.publicKey);
		if (lamportBalance < 50_000_000) {
			throw new Error('Insufficient SOL balance (need > 0.05 SOL on devnet)');
		}

		const [userAccountPDA] = userPda(adapter.publicKey);
		const existing = await this.solanaConnection.getAccountInfo(userAccountPDA);
		if (existing) return 'account_already_exists';

		const [cfgPda] = configPda();
		const cfgInfo = await this.solanaConnection.getAccountInfo(cfgPda);
		if (!cfgInfo) throw new Error('Config account not initialized. Contact admin.');

		const treasury = new PublicKey(cfgInfo.data.subarray(40, 72));

		if (!this.program) {
			this.program = new Program(hashfoxIdl as Idl, this.getProviderForAdapter(adapter));
		}

		const entryFeeLamports = new BN(Math.floor(entryFee * LAMPORTS_PER_SOL));
		return await this.program.methods
			.initializeUserAccount(entryFeeLamports)
			.accounts(<any>{
				userAccount: userAccountPDA,
				config: cfgPda,
				user: adapter.publicKey,
				treasury,
				systemProgram: SystemProgram.programId
			})
			.rpc();
	}

	async requestAirdrop(sol: number = 2): Promise<string> {
		if (!this.connectedWallet?.publicKey) throw new Error('Wallet not connected');
		const sig = await this.solanaConnection.requestAirdrop(
			this.connectedWallet.publicKey,
			Math.floor(sol * LAMPORTS_PER_SOL)
		);
		await this.solanaConnection.confirmTransaction(sig, 'confirmed');
		return sig;
	}

	async createPaperTradingSession(opts?: {
		topUpSol?: number;
		expiryMinutes?: number;
	}): Promise<void> {
		const adapter = this.connectedWallet as SignerWalletAdapter | null;
		if (!adapter?.connected || !adapter.publicKey || !adapter.signTransaction) {
			throw new Error('Connect a signing wallet first');
		}
		await sessionKeyManager.createSession(
			{
				publicKey: adapter.publicKey,
				signTransaction: adapter.signTransaction.bind(adapter)
			},
			opts?.expiryMinutes ?? 60 * 24,
			opts?.topUpSol ?? 0.05
		);
	}

	async revokePaperTradingSession(): Promise<void> {
		const adapter = this.connectedWallet as SignerWalletAdapter | null;
		if (!adapter?.connected || !adapter.publicKey || !adapter.signTransaction) {
			sessionKeyManager.clearSession();
			return;
		}
		await sessionKeyManager.revokeSession({
			publicKey: adapter.publicKey,
			signTransaction: adapter.signTransaction.bind(adapter)
		});
	}

	isPaperTradingSessionActive(): boolean {
		try {
			if (!this.connectedWallet?.publicKey) return false;
			return (
				sessionKeyManager.isSessionActive() &&
				sessionKeyManager.isSessionForWallet(this.connectedWallet.publicKey)
			);
		} catch {
			return false;
		}
	}

	async getBalanceBreakdown(): Promise<BalanceBreakdown> {
		const acc = await this.getUserAccount();
		return decodeBalance(acc);
	}

	async fetchTradingPositions(): Promise<EnrichedTradingPosition[]> {
		if (!this.program || !this.connectedWallet?.publicKey) return [];
		try {
			const owner = this.connectedWallet.publicKey;

			// Primary path: derive PDAs from user_account.total_trading_positions
			// and fetch with getMultipleAccountsInfo. This avoids
			// getProgramAccounts, which devnet throttles aggressively (often
			// returning [] silently).
			const userAcc = await this.getUserAccount();
			const total = userAcc ? Number(userAcc.totalTradingPositions.toString()) : 0;

			if (total > 0) {
				const [userAccountPda] = userPda(owner);
				const pdas: PublicKey[] = [];
				for (let i = 0; i < total; i++) {
					const [pda] = PublicKey.findProgramAddressSync(
						[
							Buffer.from('trade'),
							userAccountPda.toBuffer(),
							new BN(i).toArrayLike(Buffer, 'le', 8)
						],
						HASHFOX_PROGRAM_PUBKEY
					);
					pdas.push(pda);
				}
				const fetched = await (this.program.account as any).tradingPosition.fetchMultiple(pdas);
				const out: EnrichedTradingPosition[] = [];
				for (let i = 0; i < pdas.length; i++) {
					if (!fetched[i]) continue;
					out.push(
						enrichTradingPosition(
							pdas[i],
							fetched[i] as TradingPositionAccount,
							pairSymbolFromIndex
						)
					);
				}
				if (out.length > 0) return out;
			}

			// Fallback: getProgramAccounts (in case the counter is out-of-sync).
			// Anchor's `.all()` returns `{publicKey, account}`, so accept either shape.
			const accs = await (this.program.account as any).tradingPosition.all([
				{ memcmp: { offset: 8, bytes: owner.toBase58() } }
			]);
			return accs.map((a: any) =>
				enrichTradingPosition(a.publicKey ?? a.pubkey, a.account, pairSymbolFromIndex)
			);
		} catch (err) {
			console.warn('[hashfox] fetch trading positions failed', err);
			return [];
		}
	}

	async closeTradingPosition(positionId: number, currentPrice: number): Promise<string> {
		if (!this.program || !this.connectedWallet?.publicKey) {
			throw new Error('Wallet not connected');
		}
		const owner = this.connectedWallet.publicKey;
		const [userAccount] = userPda(owner);
		const [position] = PublicKey.findProgramAddressSync(
			[Buffer.from('trade'), userAccount.toBuffer(), new BN(positionId).toArrayLike(Buffer, 'le', 8)],
			HASHFOX_PROGRAM_PUBKEY
		);
		return await this.program.methods
			.closeTradingPosition(priceScaled(currentPrice))
			.accounts(<any>{ userAccount, position, user: owner, sessionToken: null })
			.rpc();
	}

	async cancelLimitOrder(positionId: number): Promise<string> {
		if (!this.program || !this.connectedWallet?.publicKey) {
			throw new Error('Wallet not connected');
		}
		const owner = this.connectedWallet.publicKey;
		const [userAccount] = userPda(owner);
		const [position] = PublicKey.findProgramAddressSync(
			[Buffer.from('trade'), userAccount.toBuffer(), new BN(positionId).toArrayLike(Buffer, 'le', 8)],
			HASHFOX_PROGRAM_PUBKEY
		);
		return await this.program.methods
			.cancelLimitOrder()
			.accounts(<any>{ userAccount, position, user: owner, sessionToken: null })
			.rpc();
	}

	getPaperSessionTimeRemainingSeconds(): number {
		try {
			if (!this.connectedWallet?.publicKey) return 0;
			if (
				!sessionKeyManager.isSessionActive() ||
				!sessionKeyManager.isSessionForWallet(this.connectedWallet.publicKey)
			) {
				return 0;
			}
			return sessionKeyManager.getSessionTimeRemaining();
		} catch {
			return 0;
		}
	}
}

export const hashfoxClient = new HashfoxClient();
