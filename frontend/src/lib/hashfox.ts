import { AnchorProvider, Program, BN, type BNType, type Idl } from '$lib/vendor/anchor';
import { Connection, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
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
	return k ? k.toLowerCase() : '';
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

export function findConfigPda(): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID);
}

export function findUserPda(owner: PublicKey): [PublicKey, number] {
	return PublicKey.findProgramAddressSync([Buffer.from('user'), owner.toBuffer()], PROGRAM_ID);
}

export function findTradePda(owner: PublicKey, positionId: BNType): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('trade'), owner.toBuffer(), positionId.toArrayLike(Buffer, 'le', 8)],
		PROGRAM_ID
	);
}

export function findPredPda(owner: PublicKey, positionId: BNType): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('pred'), owner.toBuffer(), positionId.toArrayLike(Buffer, 'le', 8)],
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

export async function openMarketPosition(
	program: any,
	user: PublicKey,
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
	}
): Promise<string> {
	const [userPda] = findUserPda(user);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalTradingPositions;
	const [positionPda] = findTradePda(user, positionId);

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
			user,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function openLimitOrder(
	program: any,
	user: PublicKey,
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
	}
): Promise<string> {
	const [userPda] = findUserPda(user);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalTradingPositions;
	const [positionPda] = findTradePda(user, positionId);

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
			user,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function closeTradingPosition(
	program: any,
	user: PublicKey,
	positionId: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null
): Promise<string> {
	const [userPda] = findUserPda(user);
	const [positionPda] = findTradePda(user, positionId);
	return await program.methods
		.closeTradingPosition(currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user, sessionToken })
		.rpc();
}

export async function cancelLimitOrder(
	program: any,
	user: PublicKey,
	positionId: BNType,
	sessionToken: PublicKey | null = null
): Promise<string> {
	const [userPda] = findUserPda(user);
	const [positionPda] = findTradePda(user, positionId);
	return await program.methods
		.cancelLimitOrder()
		.accounts(<any>{ userAccount: userPda, position: positionPda, user, sessionToken })
		.rpc();
}

export async function buyYes(
	program: any,
	user: PublicKey,
	params: {
		marketId: string;
		amountUsd: BNType;
		pricePerShare: BNType;
		stopLoss: BNType;
		takeProfit: BNType;
		sessionToken?: PublicKey | null;
	}
): Promise<string> {
	const [userPda] = findUserPda(user);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalPredictionPositions;
	const [positionPda] = findPredPda(user, positionId);
	return await program.methods
		.buyYes(params.marketId, params.amountUsd, params.pricePerShare, params.stopLoss, params.takeProfit)
		.accounts(<any>{
			userAccount: userPda,
			position: positionPda,
			sessionToken: params.sessionToken ?? null,
			user,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function buyNo(
	program: any,
	user: PublicKey,
	params: {
		marketId: string;
		amountUsd: BNType;
		pricePerShare: BNType;
		stopLoss: BNType;
		takeProfit: BNType;
		sessionToken?: PublicKey | null;
	}
): Promise<string> {
	const [userPda] = findUserPda(user);
	const account = await (program.account as any).userAccount.fetch(userPda);
	const positionId: BNType = account.totalPredictionPositions;
	const [positionPda] = findPredPda(user, positionId);
	return await program.methods
		.buyNo(params.marketId, params.amountUsd, params.pricePerShare, params.stopLoss, params.takeProfit)
		.accounts(<any>{
			userAccount: userPda,
			position: positionPda,
			sessionToken: params.sessionToken ?? null,
			user,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function sellYes(
	program: any,
	user: PublicKey,
	positionId: BNType,
	sharesToSell: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null
): Promise<string> {
	const [userPda] = findUserPda(user);
	const [positionPda] = findPredPda(user, positionId);
	return await program.methods
		.sellYes(sharesToSell, currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user, sessionToken })
		.rpc();
}

export async function sellNo(
	program: any,
	user: PublicKey,
	positionId: BNType,
	sharesToSell: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null
): Promise<string> {
	const [userPda] = findUserPda(user);
	const [positionPda] = findPredPda(user, positionId);
	return await program.methods
		.sellNo(sharesToSell, currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user, sessionToken })
		.rpc();
}

export async function closePredictionPosition(
	program: any,
	user: PublicKey,
	positionId: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null
): Promise<string> {
	const [userPda] = findUserPda(user);
	const [positionPda] = findPredPda(user, positionId);
	return await program.methods
		.closePredictionPosition(currentPrice)
		.accounts(<any>{ userAccount: userPda, position: positionPda, user, sessionToken })
		.rpc();
}

export async function fetchAllTradingPositions(
	program: any,
	owner: PublicKey
): Promise<Array<{ pubkey: PublicKey; account: TradingPositionAccount }>> {
	const all = await (program.account as any).tradingPosition.all([
		{ memcmp: { offset: 8, bytes: owner.toBase58() } }
	]);
	return all;
}

export async function fetchAllPredictionPositions(
	program: any,
	owner: PublicKey
): Promise<Array<{ pubkey: PublicKey; account: PredictionPositionAccount }>> {
	const all = await (program.account as any).predictionPosition.all([
		{ memcmp: { offset: 8, bytes: owner.toBase58() } }
	]);
	return all;
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
