import { AnchorProvider, Program, BN, type BNType, type Idl } from '$lib/vendor/anchor';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import type { Adapter, SignerWalletAdapter } from '@solana/wallet-adapter-base';
import { HASHFOX_PROGRAM_ID, SOLANA_RPC } from './env';
import idlJson from './idl/hashfox.json';

export const PROGRAM_ID = new PublicKey(HASHFOX_PROGRAM_ID);
export const PRICE_SCALE = 1_000_000; // 6 decimals
export const USD_SCALE = 1_000_000; // 6 decimals

export type MarketCategoryVariant = 'crypto' | 'stock' | 'forex' | 'metal' | 'equity';
export type TradeModeVariant = 'spot' | 'perp';
export type DirectionVariant = 'long' | 'short';

export interface TradingPositionAccount {
	owner: PublicKey;
	positionId: BNType;
	marketCategory: any;
	pairIndex: number;
	tradeMode: any;
	direction: any;
	orderType: any;
	sizeUsd: BNType;
	marginUsd: BNType;
	leverage: number;
	entryPrice: BNType;
	limitPrice: BNType;
	takeProfitPrice: BNType;
	stopLossPrice: BNType;
	liquidationPrice: BNType;
	status: any;
	openedAt: BNType;
	filledAt: BNType;
	closedAt: BNType;
	closePrice: BNType;
	realizedPnl: BNType;
	closeReason: any;
	bump: number;
}

export interface PredictionPositionAccount {
	owner: PublicKey;
	positionId: BNType;
	marketId: string;
	predictionType: any;
	amountUsd: BNType;
	pricePerShare: BNType;
	shares: BNType;
	remainingShares: BNType;
	totalSoldShares: BNType;
	averageSellPrice: BNType;
	status: any;
	openedAt: BNType;
	closedAt: BNType;
	stopLoss: BNType;
	takeProfit: BNType;
	bump: number;
}

export interface UserAccountState {
	owner: PublicKey;
	usdBalance: BNType;
	lockedMarginUsd: BNType;
	totalTradingPositions: BNType;
	totalPredictionPositions: BNType;
	createdAt: BNType;
	bump: number;
}

/** Convenience view of the balance math done inside the program. */
export interface BalanceBreakdown {
	/** Total paper USDT credited to this wallet (inclusive of locked). */
	totalUsd: number;
	/** Currently locked by open/pending perp positions. */
	lockedUsd: number;
	/** Free balance (totalUsd − lockedUsd). */
	availableUsd: number;
}

export function decodeBalance(acc: UserAccountState | null): BalanceBreakdown {
	if (!acc) return { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };
	const total = Number(acc.usdBalance.toString()) / USD_SCALE;
	const locked = Number(acc.lockedMarginUsd.toString()) / USD_SCALE;
	return {
		totalUsd: total,
		lockedUsd: locked,
		availableUsd: Math.max(0, total - locked)
	};
}

export type EnrichedTradingPosition = {
	pubkey: string;
	positionId: number;
	marketCategory: string;
	pairIndex: number;
	pairSymbol: string;
	tradeMode: 'spot' | 'perp';
	direction: 'long' | 'short';
	orderType: 'market' | 'limit';
	status: 'pending' | 'active' | 'closed' | 'liquidated' | 'cancelled';
	sizeUsd: number;
	marginUsd: number;
	leverage: number;
	entryPrice: number;
	limitPrice: number;
	takeProfitPrice: number;
	stopLossPrice: number;
	liquidationPrice: number;
	openedAt: number;
	filledAt: number;
	closedAt: number;
	closePrice: number;
	realizedPnl: number;
	closeReason: string | null;
};

function enumKey(v: any): string {
	if (!v || typeof v !== 'object') return '';
	const k = Object.keys(v)[0];
	if (!k) return '';
	const lc = k.toLowerCase();
	// Anchor IDL variants like `PendingFill` deserialize to `pendingFill`;
	// our EnrichedTradingPosition union uses the shorter `pending` form.
	if (lc === 'pendingfill') return 'pending';
	if (lc === 'partiallysold') return 'partiallysold';
	if (lc === 'fullysold') return 'fullysold';
	return lc;
}

function adapterToAnchorWallet(adapter: Adapter) {
	const signer = adapter as SignerWalletAdapter;
	return {
		publicKey: adapter.publicKey!,
		signTransaction: async <T extends Transaction>(tx: T) => signer.signTransaction(tx as any) as Promise<T>,
		signAllTransactions: async <T extends Transaction>(txs: T[]) =>
			signer.signAllTransactions(txs as any) as Promise<T[]>
	};
}

export function buildConnection(): Connection {
	return new Connection(SOLANA_RPC, 'confirmed');
}

export function buildProgram(connection: Connection, adapter: Adapter): any {
	const wallet = adapterToAnchorWallet(adapter);
	const provider = new AnchorProvider(connection, wallet as any, { commitment: 'confirmed' });
	return new Program(idlJson as Idl, provider);
}

/** Build a Program where the given Keypair signs every transaction.
 * Used for fast-trade flows: when a session keypair is active, we sign with it
 * locally so trades don't pop up the wallet adapter. */
export function buildKeypairProgram(connection: Connection, keypair: Keypair): any {
	const wallet = {
		publicKey: keypair.publicKey,
		signTransaction: async <T extends Transaction>(tx: T) => {
			tx.partialSign(keypair);
			return tx;
		},
		signAllTransactions: async <T extends Transaction>(txs: T[]) => {
			for (const tx of txs) tx.partialSign(keypair);
			return txs;
		}
	};
	const provider = new AnchorProvider(connection, wallet as any, {
		commitment: 'confirmed',
		preflightCommitment: 'confirmed'
	});
	return new Program(idlJson as Idl, provider);
}

export function findConfigPda(): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
}

export function findUserPda(owner: PublicKey): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([Buffer.from('user'), owner.toBuffer()], PROGRAM_ID);
}

/** Trade PDAs are now seeded by the user_account PDA (not the wallet) so the
 * same trading instructions can target either the normal account or a per-
 * competition account without ID collisions. Callers that already have the
 * wallet can pass `findUserPda(wallet)[0]` (or the comp_user PDA) here. */
export function findTradePda(userAccount: PublicKey, positionId: BNType): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('trade'), userAccount.toBuffer(), positionId.toArrayLike(Buffer, 'le', 8)],
		PROGRAM_ID
	);
}

export function findPredPda(userAccount: PublicKey, positionId: BNType): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('pred'), userAccount.toBuffer(), positionId.toArrayLike(Buffer, 'le', 8)],
		PROGRAM_ID
	);
}

function marketCategoryEnum(cat: MarketCategoryVariant) {
	return { [cat]: {} } as any;
}
function tradeModeEnum(m: TradeModeVariant) {
	return { [m]: {} } as any;
}
function directionEnum(d: DirectionVariant) {
	return { [d]: {} } as any;
}

export function usd(n: number): BNType {
	return new BN(Math.floor(n * USD_SCALE));
}
export function priceScaled(n: number): BNType {
	return new BN(Math.floor(n * PRICE_SCALE));
}

export async function getUserAccount(
	program: any,
	owner: PublicKey
): Promise<UserAccountState | null> {
	const [pda] = findUserPda(owner);
	try {
		return (await (program.account as any).userAccount.fetch(pda)) as UserAccountState;
	} catch {
		return null;
	}
}

export async function initializeUserAccount(
	program: any,
	user: PublicKey,
	entryFee: BNType
): Promise<string> {
	const [userPda] = findUserPda(user);
	const [configPda] = findConfigPda();
	const config = await (program.account as any).programConfig.fetch(configPda);
	return await program.methods
		.initializeUserAccount(entryFee)
		.accounts(<any>{
			userAccount: userPda,
			config: configPda,
			user,
			treasury: config.treasury,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

/** One-time migration for `UserAccount`s created before the
 * `active_competition` field was added. Reallocs the account by 32 bytes and
 * leaves them zero (= `Pubkey::default()`). Idempotent — safe to call on a
 * post-migration account, contract returns Ok early. */
export async function migrateUserAccount(
	program: any,
	user: PublicKey,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? user;
	const [userPda] = findUserPda(user);
	return await program.methods
		.migrateUserAccount()
		.accounts(<any>{
			userAccount: userPda,
			user: txSigner,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

/** Returns true if the on-chain `UserAccount` predates the competition
 * upgrade (data length < new layout). Lets callers prompt or auto-migrate. */
export async function isUserAccountStale(
	connection: any,
	owner: PublicKey
): Promise<boolean> {
	const [pda] = findUserPda(owner);
	const info = await connection.getAccountInfo(pda);
	if (!info) return false;
	// Discriminator (8) + owner (32) + 4 × u64 (32) + i64 (8) + bump (1) +
	// active_competition (32) = 113 bytes. Older layout was 81 bytes.
	const NEW_MIN = 113;
	return info.data.length < NEW_MIN;
}

export async function openMarketPosition(
	program: any,
	authority: PublicKey,
	params: {
		marketCategory: MarketCategoryVariant;
		pairIndex: number;
		tradeMode: TradeModeVariant;
		direction: DirectionVariant;
		marginUsd: BNType;
		leverage: number;
		takeProfitPrice: BNType;
		stopLossPrice: BNType;
		entryPrice: BNType;
		sessionToken?: PublicKey | null;
		/** Tx signer; defaults to authority. Used by fast-trade session keys. */
		signer?: PublicKey;
	}
): Promise<string> {
	const signer = params.signer ?? authority;
	const [userPda] = findUserPda(authority);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalTradingPositions;
	const [positionPda] = findTradePda(userPda, positionId);

	return await program.methods
		.openMarketPosition(
			marketCategoryEnum(params.marketCategory),
			params.pairIndex,
			tradeModeEnum(params.tradeMode),
			directionEnum(params.direction),
			params.marginUsd,
			params.leverage,
			params.takeProfitPrice,
			params.stopLossPrice,
			params.entryPrice
		)
		.accounts(<any>{
			userAccount: userPda,
			position: positionPda,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function openLimitOrder(
	program: any,
	authority: PublicKey,
	params: {
		marketCategory: MarketCategoryVariant;
		pairIndex: number;
		tradeMode: TradeModeVariant;
		direction: DirectionVariant;
		marginUsd: BNType;
		leverage: number;
		limitPrice: BNType;
		takeProfitPrice: BNType;
		stopLossPrice: BNType;
		sessionToken?: PublicKey | null;
		signer?: PublicKey;
	}
): Promise<string> {
	const signer = params.signer ?? authority;
	const [userPda] = findUserPda(authority);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalTradingPositions;
	const [positionPda] = findTradePda(userPda, positionId);

	return await program.methods
		.openLimitOrder(
			marketCategoryEnum(params.marketCategory),
			params.pairIndex,
			tradeModeEnum(params.tradeMode),
			directionEnum(params.direction),
			params.marginUsd,
			params.leverage,
			params.limitPrice,
			params.takeProfitPrice,
			params.stopLossPrice
		)
		.accounts(<any>{
			userAccount: userPda,
			position: positionPda,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function closeTradingPosition(
	program: any,
	authority: PublicKey,
	positionId: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? authority;
	const [userPda] = findUserPda(authority);
	const [positionPda] = findTradePda(userPda, positionId);
	return await program.methods
		.closeTradingPosition(currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user: txSigner, sessionToken })
		.rpc();
}

export async function cancelLimitOrder(
	program: any,
	authority: PublicKey,
	positionId: BNType,
	sessionToken: PublicKey | null = null,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? authority;
	const [userPda] = findUserPda(authority);
	const [positionPda] = findTradePda(userPda, positionId);
	return await program.methods
		.cancelLimitOrder()
		.accounts(<any>{ userAccount: userPda, position: positionPda, user: txSigner, sessionToken })
		.rpc();
}

export async function buyYes(
	program: any,
	authority: PublicKey,
	params: {
		marketId: string;
		amountUsd: BNType;
		pricePerShare: BNType;
		stopLoss: BNType;
		takeProfit: BNType;
		sessionToken?: PublicKey | null;
		signer?: PublicKey;
	}
): Promise<string> {
	const signer = params.signer ?? authority;
	const [userPda] = findUserPda(authority);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalPredictionPositions;
	const [positionPda] = findPredPda(userPda, positionId);
	return await program.methods
		.buyYes(params.marketId, params.amountUsd, params.pricePerShare, params.stopLoss, params.takeProfit)
		.accounts(<any>{
			userAccount: userPda,
			position: positionPda,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function buyNo(
	program: any,
	authority: PublicKey,
	params: {
		marketId: string;
		amountUsd: BNType;
		pricePerShare: BNType;
		stopLoss: BNType;
		takeProfit: BNType;
		sessionToken?: PublicKey | null;
		signer?: PublicKey;
	}
): Promise<string> {
	const signer = params.signer ?? authority;
	const [userPda] = findUserPda(authority);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalPredictionPositions;
	const [positionPda] = findPredPda(userPda, positionId);
	return await program.methods
		.buyNo(params.marketId, params.amountUsd, params.pricePerShare, params.stopLoss, params.takeProfit)
		.accounts(<any>{
			userAccount: userPda,
			position: positionPda,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function sellYes(
	program: any,
	authority: PublicKey,
	positionId: BNType,
	sharesToSell: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? authority;
	const [userPda] = findUserPda(authority);
	const [positionPda] = findPredPda(userPda, positionId);
	return await program.methods
		.sellYes(sharesToSell, currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user: txSigner, sessionToken })
		.rpc();
}

export async function sellNo(
	program: any,
	authority: PublicKey,
	positionId: BNType,
	sharesToSell: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? authority;
	const [userPda] = findUserPda(authority);
	const [positionPda] = findPredPda(userPda, positionId);
	return await program.methods
		.sellNo(sharesToSell, currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user: txSigner, sessionToken })
		.rpc();
}

export async function closePredictionPosition(
	program: any,
	authority: PublicKey,
	positionId: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? authority;
	const [userPda] = findUserPda(authority);
	const [positionPda] = findPredPda(userPda, positionId);
	return await program.methods
		.closePredictionPosition(currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user: txSigner, sessionToken })
		.rpc();
}

/** Derive position PDAs from the user_account counter and fetch in one batch.
 * This avoids `getProgramAccounts`, which devnet throttles aggressively. */
async function fetchPositionsByCounter<T>(
	program: any,
	userAccountPda: PublicKey,
	seed: 'trade' | 'pred',
	count: number,
	accountKey: 'tradingPosition' | 'predictionPosition'
): Promise<Array<{ pubkey: PublicKey; account: T }>> {
	if (count <= 0) return [];
	const pdas: PublicKey[] = [];
	for (let i = 0; i < count; i++) {
		const [pda] = PublicKey.findProgramAddressSync(
			[Buffer.from(seed), userAccountPda.toBuffer(), new BN(i).toArrayLike(Buffer, 'le', 8)],
			PROGRAM_ID
		);
		pdas.push(pda);
	}
	const fetched = await (program.account as any)[accountKey].fetchMultiple(pdas);
	const out: Array<{ pubkey: PublicKey; account: T }> = [];
	for (let i = 0; i < pdas.length; i++) {
		if (fetched[i]) out.push({ pubkey: pdas[i], account: fetched[i] as T });
	}
	return out;
}

export async function fetchAllTradingPositions(
	program: any,
	owner: PublicKey
): Promise<Array<{ pubkey: PublicKey; account: TradingPositionAccount }>> {
	const [userPda] = findUserPda(owner);
	try {
		const userAcc = await getUserAccount(program, owner);
		const total = userAcc ? Number(userAcc.totalTradingPositions.toString()) : 0;
		const byCounter = await fetchPositionsByCounter<TradingPositionAccount>(
			program,
			userPda,
			'trade',
			total,
			'tradingPosition'
		);
		if (byCounter.length > 0) return byCounter;
	} catch {
		/* fall through to getProgramAccounts */
	}
	// Anchor's `.all()` returns `{publicKey, account}` — normalize to `pubkey`
	// to match the counter path so downstream consumers work uniformly.
	const all = await (program.account as any).tradingPosition.all([
		{ memcmp: { offset: 8, bytes: owner.toBase58() } }
	]);
	return all.map((a: any) => ({ pubkey: a.publicKey ?? a.pubkey, account: a.account }));
}

export async function fetchAllPredictionPositions(
	program: any,
	owner: PublicKey
): Promise<Array<{ pubkey: PublicKey; account: PredictionPositionAccount }>> {
	const [userPda] = findUserPda(owner);
	try {
		const userAcc = await getUserAccount(program, owner);
		const total = userAcc ? Number(userAcc.totalPredictionPositions.toString()) : 0;
		const byCounter = await fetchPositionsByCounter<PredictionPositionAccount>(
			program,
			userPda,
			'pred',
			total,
			'predictionPosition'
		);
		if (byCounter.length > 0) return byCounter;
	} catch {
		/* fall through to getProgramAccounts */
	}
	const all = await (program.account as any).predictionPosition.all([
		{ memcmp: { offset: 8, bytes: owner.toBase58() } }
	]);
	return all.map((a: any) => ({ pubkey: a.publicKey ?? a.pubkey, account: a.account }));
}

export interface UnifiedHistoryEntry {
	kind: 'trading' | 'prediction';
	pubkey: string;
	openedAt: number;
	data: TradingPositionAccount | PredictionPositionAccount;
}

const PAIR_LOOKUP_FALLBACK: Record<number, string> = {};

export function enrichTradingPosition(
	pubkey: PublicKey,
	acc: TradingPositionAccount,
	pairSymbolFromIndex: (idx: number, category: string) => string
): EnrichedTradingPosition {
	const sizeUsd = Number(acc.sizeUsd.toString()) / USD_SCALE;
	const marginUsd = Number(acc.marginUsd.toString()) / USD_SCALE;
	const category = enumKey(acc.marketCategory);
	return {
		pubkey: pubkey.toBase58(),
		positionId: Number(acc.positionId.toString()),
		marketCategory: category,
		pairIndex: acc.pairIndex,
		pairSymbol: pairSymbolFromIndex(acc.pairIndex, category) || PAIR_LOOKUP_FALLBACK[acc.pairIndex] || `P${acc.pairIndex}`,
		tradeMode: (enumKey(acc.tradeMode) as 'spot' | 'perp') || 'spot',
		direction: (enumKey(acc.direction) as 'long' | 'short') || 'long',
		orderType: (enumKey(acc.orderType) as 'market' | 'limit') || 'market',
		status: (enumKey(acc.status) as EnrichedTradingPosition['status']) || 'pending',
		sizeUsd,
		marginUsd,
		leverage: acc.leverage,
		entryPrice: Number(acc.entryPrice.toString()) / PRICE_SCALE,
		limitPrice: Number(acc.limitPrice.toString()) / PRICE_SCALE,
		takeProfitPrice: Number(acc.takeProfitPrice.toString()) / PRICE_SCALE,
		stopLossPrice: Number(acc.stopLossPrice.toString()) / PRICE_SCALE,
		liquidationPrice: Number(acc.liquidationPrice.toString()) / PRICE_SCALE,
		openedAt: Number(acc.openedAt.toString()),
		filledAt: Number(acc.filledAt.toString()),
		closedAt: Number(acc.closedAt.toString()),
		closePrice: Number(acc.closePrice.toString()) / PRICE_SCALE,
		realizedPnl: Number(acc.realizedPnl.toString()) / USD_SCALE,
		closeReason: enumKey(acc.closeReason) || null
	};
}

export async function fetchUnifiedHistory(
	program: any,
	owner: PublicKey
): Promise<UnifiedHistoryEntry[]> {
	const [trades, preds] = await Promise.all([
		fetchAllTradingPositions(program, owner),
		fetchAllPredictionPositions(program, owner)
	]);
	const entries: UnifiedHistoryEntry[] = [
		...trades.map((t) => ({
			kind: 'trading' as const,
			pubkey: t.pubkey.toBase58(),
			openedAt: (t.account.openedAt as BNType).toNumber(),
			data: t.account
		})),
		...preds.map((p) => ({
			kind: 'prediction' as const,
			pubkey: p.pubkey.toBase58(),
			openedAt: (p.account.openedAt as BNType).toNumber(),
			data: p.account
		}))
	];
	return entries.sort((a, b) => b.openedAt - a.openedAt);
}
