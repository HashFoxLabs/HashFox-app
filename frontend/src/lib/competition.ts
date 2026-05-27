import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { BN, type BNType } from '$lib/vendor/anchor';
import {
	PROGRAM_ID,
	USD_SCALE,
	findConfigPda,
	findUserPda,
	findTradePda,
	findPredPda,
	enrichTradingPosition,
	type EnrichedTradingPosition,
	type TradingPositionAccount,
	type MarketCategoryVariant,
	type TradeModeVariant,
	type DirectionVariant
} from '$lib/hashfox';
import { ALL_MARKETS } from '$lib/markets';

export const COMP_NAME_MAX_LEN = 32;
export const COMP_MIN_DURATION_SECS = 3_600;
export const COMP_MAX_DURATION_SECS = 21 * 86_400;
export const COMP_MIN_PARTICIPANTS = 3;
export const COMP_MAX_PARTICIPANTS = 10_000;

export type CompetitionStatus = 'pending' | 'active' | 'settled';

export interface LeaderEntryView {
	participant: string;
	balanceUsd: number;
}

export interface CompetitionView {
	pubkey: string;
	creator: string;
	name: string;
	status: CompetitionStatus;
	entryTicketSol: number;
	targetSol: number;
	prizePoolSol: number;
	durationSecs: number;
	startTs: number;
	endTs: number;
	participantCount: number;
	maxParticipants: number;
	createdAt: number;
	top: LeaderEntryView[];
}

export function findCompetitionPda(creator: PublicKey, name: string): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('comp'), creator.toBuffer(), Buffer.from(name)],
		PROGRAM_ID
	);
}

export function findCompetitionVaultPda(competition: PublicKey): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('comp_vault'), competition.toBuffer()],
		PROGRAM_ID
	);
}

export function findCompUserPda(competition: PublicKey, owner: PublicKey): [PublicKey, number] {
	return PublicKey.findProgramAddressSync(
		[Buffer.from('comp_user'), competition.toBuffer(), owner.toBuffer()],
		PROGRAM_ID
	);
}

function statusKey(s: any): CompetitionStatus {
	if (!s || typeof s !== 'object') return 'pending';
	const k = Object.keys(s)[0]?.toLowerCase() ?? 'pending';
	if (k === 'active') return 'active';
	if (k === 'settled') return 'settled';
	return 'pending';
}

export function decodeCompetitionName(raw: any, len: any): string {
	const arr: number[] =
		raw instanceof Uint8Array
			? Array.from(raw)
			: Array.isArray(raw)
				? (raw as number[])
				: Object.values(raw ?? {}) as number[];
	const l = typeof len === 'number' ? len : Number(len ?? arr.length);
	const trimmed = arr.slice(0, l).filter((b) => b !== 0);
	try {
		return new TextDecoder().decode(new Uint8Array(trimmed));
	} catch {
		return '';
	}
}

export function viewCompetition(pubkey: PublicKey, acc: any): CompetitionView {
	const top: LeaderEntryView[] = (acc.top ?? []).map((e: any) => ({
		participant: (e.participant as PublicKey).toBase58(),
		balanceUsd: Number((e.balance as BNType).toString()) / USD_SCALE
	}));
	return {
		pubkey: pubkey.toBase58(),
		creator: (acc.creator as PublicKey).toBase58(),
		name: decodeCompetitionName(acc.name, acc.nameLen),
		status: statusKey(acc.status),
		entryTicketSol: Number((acc.entryTicketLamports as BNType).toString()) / LAMPORTS_PER_SOL,
		targetSol: Number((acc.targetLamports as BNType).toString()) / LAMPORTS_PER_SOL,
		prizePoolSol: Number((acc.prizePool as BNType).toString()) / LAMPORTS_PER_SOL,
		durationSecs: Number((acc.durationSecs as BNType).toString()),
		startTs: Number((acc.startTs as BNType).toString()),
		endTs: Number((acc.endTs as BNType).toString()),
		participantCount: Number((acc.participantCount as BNType).toString()),
		maxParticipants: Number((acc.maxParticipants as BNType).toString()),
		createdAt: Number((acc.createdAt as BNType).toString()),
		top
	};
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolve(v);
			},
			(e) => {
				clearTimeout(t);
				reject(e);
			}
		);
	});
}

export async function fetchAllCompetitions(program: any): Promise<CompetitionView[]> {
	// Devnet `getProgramAccounts` is heavily throttled — it sometimes hangs
	// indefinitely. Wrap in a 12s timeout and retry once before giving up.
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const all = await withTimeout<any[]>(
				(program.account as any).competition.all(),
				12_000,
				'fetchAllCompetitions'
			);
			return all.map((a: any) => viewCompetition(a.publicKey ?? a.pubkey, a.account));
		} catch (err) {
			console.warn(`[competition] fetch all attempt ${attempt + 1} failed`, err);
			if (attempt === 1) return [];
		}
	}
	return [];
}

export async function fetchCompetitionByPda(
	program: any,
	pda: PublicKey
): Promise<CompetitionView | null> {
	try {
		const acc = await (program.account as any).competition.fetch(pda);
		return viewCompetition(pda, acc);
	} catch {
		return null;
	}
}

export interface CompUserView {
	pubkey: string;
	owner: string;
	totalUsd: number;
	lockedUsd: number;
	totalTradingPositions: number;
	totalPredictionPositions: number;
}

export async function fetchCompUserAccount(
	program: any,
	competition: PublicKey,
	owner: PublicKey
): Promise<CompUserView | null> {
	const [pda] = findCompUserPda(competition, owner);
	try {
		const acc = await (program.account as any).userAccount.fetch(pda);
		const total = Number((acc.usdBalance as BNType).toString()) / USD_SCALE;
		const locked = Number((acc.lockedMarginUsd as BNType).toString()) / USD_SCALE;
		return {
			pubkey: pda.toBase58(),
			owner: (acc.owner as PublicKey).toBase58(),
			totalUsd: total,
			lockedUsd: locked,
			totalTradingPositions: Number((acc.totalTradingPositions as BNType).toString()),
			totalPredictionPositions: Number((acc.totalPredictionPositions as BNType).toString())
		};
	} catch {
		return null;
	}
}

/** Fetch every comp_user account for a given competition. Used by the comp
 * detail panel to render the live ranking and by the report-score keepalive
 * to push balances into the on-chain top-3.
 *
 * The memcmp on `active_competition` matches BOTH the per-cup `comp_user`
 * account AND the participant's main `user` account (which also stores the
 * pubkey of the cup they're currently in). We filter to only the comp_user
 * accounts by re-deriving the expected PDA — this also stops duplicate-key
 * errors on the rendered list. */
export async function fetchCompetitionParticipants(
	program: any,
	competition: PublicKey
): Promise<CompUserView[]> {
	// Layout: 8 (discriminator) + 32 (owner) + 8 (usd_balance) + 8 (locked_margin_usd)
	// + 8 (total_trading_positions) + 8 (total_prediction_positions)
	// + 8 (created_at) + 1 (bump) = 81. active_competition starts at 81.
	const ACTIVE_COMP_OFFSET = 81;
	try {
		const all = await (program.account as any).userAccount.all([
			{ memcmp: { offset: ACTIVE_COMP_OFFSET, bytes: competition.toBase58() } }
		]);
		const dedup = new Map<string, CompUserView>();
		for (const a of all) {
			const pda: PublicKey = a.publicKey ?? a.pubkey;
			const acc = a.account;
			const owner = acc.owner as PublicKey;
			const [expected] = findCompUserPda(competition, owner);
			if (!pda.equals(expected)) continue; // skip the main user PDA
			const ownerB58 = owner.toBase58();
			if (dedup.has(ownerB58)) continue;
			const total = Number((acc.usdBalance as BNType).toString()) / USD_SCALE;
			const locked = Number((acc.lockedMarginUsd as BNType).toString()) / USD_SCALE;
			dedup.set(ownerB58, {
				pubkey: pda.toBase58(),
				owner: ownerB58,
				totalUsd: total,
				lockedUsd: locked,
				totalTradingPositions: Number((acc.totalTradingPositions as BNType).toString()),
				totalPredictionPositions: Number((acc.totalPredictionPositions as BNType).toString())
			});
		}
		return Array.from(dedup.values());
	} catch (err) {
		console.warn('[competition] fetchParticipants failed', err);
		return [];
	}
}

export async function createCompetition(
	program: any,
	creator: PublicKey,
	params: {
		name: string;
		entryTicketSol: number;
		maxParticipants: number;
		durationSecs: number;
	}
): Promise<{ signature: string; competition: PublicKey }> {
	const name = params.name.trim();
	if (!name) throw new Error('Name required');
	if (name.length > COMP_NAME_MAX_LEN) throw new Error(`Name must be ≤ ${COMP_NAME_MAX_LEN} bytes`);

	const entryTicketLamports = new BN(Math.floor(params.entryTicketSol * LAMPORTS_PER_SOL));
	const maxParticipants = new BN(Math.floor(params.maxParticipants));
	const durationSecs = new BN(Math.floor(params.durationSecs));

	const [competition] = findCompetitionPda(creator, name);
	const [vault] = findCompetitionVaultPda(competition);

	const sig = await program.methods
		.createCompetition(name, entryTicketLamports, maxParticipants, durationSecs)
		.accounts(<any>{
			competition,
			vault,
			creator,
			systemProgram: SystemProgram.programId
		})
		.rpc();
	return { signature: sig, competition };
}

export async function joinCompetition(
	program: any,
	user: PublicKey,
	competition: PublicKey
): Promise<string> {
	const [vault] = findCompetitionVaultPda(competition);
	const [userAccount] = findUserPda(user);
	const [compUserAccount] = findCompUserPda(competition, user);
	return await program.methods
		.joinCompetition()
		.accounts(<any>{
			competition,
			vault,
			userAccount,
			compUserAccount,
			user,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function reportScore(
	program: any,
	caller: PublicKey,
	competition: PublicKey,
	participantOwner: PublicKey
): Promise<string> {
	const [compUserAccount] = findCompUserPda(competition, participantOwner);
	return await program.methods
		.reportScore()
		.accounts(<any>{ competition, compUserAccount, caller })
		.rpc();
}

export async function settleCompetition(
	program: any,
	caller: PublicKey,
	competition: PublicKey,
	podium: { first: PublicKey; second: PublicKey; third: PublicKey }
): Promise<string> {
	const [config] = findConfigPda();
	const cfg = await (program.account as any).programConfig.fetch(config);
	const [vault] = findCompetitionVaultPda(competition);
	return await program.methods
		.settleCompetition()
		.accounts(<any>{
			config,
			competition,
			vault,
			firstPlace: podium.first,
			secondPlace: podium.second,
			thirdPlace: podium.third,
			treasury: cfg.treasury,
			caller,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function claimCompetitionExit(
	program: any,
	user: PublicKey,
	competition: PublicKey
): Promise<string> {
	const [userAccount] = findUserPda(user);
	return await program.methods
		.claimCompetitionExit()
		.accounts(<any>{
			competition,
			userAccount,
			owner: user,
			user
		})
		.rpc();
}

// ───── Competition-scoped trading ─────

function marketCategoryEnum(cat: MarketCategoryVariant) { return { [cat]: {} } as any; }
function tradeModeEnum(m: TradeModeVariant) { return { [m]: {} } as any; }
function directionEnum(d: DirectionVariant) { return { [d]: {} } as any; }

export async function compOpenMarketPosition(
	program: any,
	authority: PublicKey,
	competition: PublicKey,
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
		signer?: PublicKey;
	}
): Promise<string> {
	const signer = params.signer ?? authority;
	const [userAccount] = findCompUserPda(competition, authority);
	const acc = await (program.account as any).userAccount.fetch(userAccount);
	const positionId: BNType = acc.totalTradingPositions;
	const [position] = findTradePda(userAccount, positionId);
	return await program.methods
		.compOpenMarketPosition(
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
			competition,
			userAccount,
			position,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function compOpenLimitOrder(
	program: any,
	authority: PublicKey,
	competition: PublicKey,
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
	const [userAccount] = findCompUserPda(competition, authority);
	const acc = await (program.account as any).userAccount.fetch(userAccount);
	const positionId: BNType = acc.totalTradingPositions;
	const [position] = findTradePda(userAccount, positionId);
	return await program.methods
		.compOpenLimitOrder(
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
			competition,
			userAccount,
			position,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function compCloseTradingPosition(
	program: any,
	authority: PublicKey,
	competition: PublicKey,
	positionId: BNType,
	currentPrice: BNType,
	sessionToken: PublicKey | null = null,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? authority;
	const [userAccount] = findCompUserPda(competition, authority);
	const [position] = findTradePda(userAccount, positionId);
	return await program.methods
		.compCloseTradingPosition(currentPrice)
		.accounts(<any>{ userAccount, position, user: txSigner, sessionToken })
		.rpc();
}

export async function compCancelLimitOrder(
	program: any,
	authority: PublicKey,
	competition: PublicKey,
	positionId: BNType,
	sessionToken: PublicKey | null = null,
	signer?: PublicKey
): Promise<string> {
	const txSigner = signer ?? authority;
	const [userAccount] = findCompUserPda(competition, authority);
	const [position] = findTradePda(userAccount, positionId);
	return await program.methods
		.compCancelLimitOrder()
		.accounts(<any>{ userAccount, position, user: txSigner, sessionToken })
		.rpc();
}

export async function compBuyYes(
	program: any,
	authority: PublicKey,
	competition: PublicKey,
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
	const [userAccount] = findCompUserPda(competition, authority);
	const acc = await (program.account as any).userAccount.fetch(userAccount);
	const positionId: BNType = acc.totalPredictionPositions;
	const [position] = findPredPda(userAccount, positionId);
	return await program.methods
		.compBuyYes(params.marketId, params.amountUsd, params.pricePerShare, params.stopLoss, params.takeProfit)
		.accounts(<any>{
			competition,
			userAccount,
			position,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

export async function compBuyNo(
	program: any,
	authority: PublicKey,
	competition: PublicKey,
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
	const [userAccount] = findCompUserPda(competition, authority);
	const acc = await (program.account as any).userAccount.fetch(userAccount);
	const positionId: BNType = acc.totalPredictionPositions;
	const [position] = findPredPda(userAccount, positionId);
	return await program.methods
		.compBuyNo(params.marketId, params.amountUsd, params.pricePerShare, params.stopLoss, params.takeProfit)
		.accounts(<any>{
			competition,
			userAccount,
			position,
			sessionToken: params.sessionToken ?? null,
			user: signer,
			systemProgram: SystemProgram.programId
		})
		.rpc();
}

const PAIR_INDEX_TO_SYMBOL: Record<string, Record<number, string>> = {};
for (const m of ALL_MARKETS) {
	if (!PAIR_INDEX_TO_SYMBOL[m.sub]) PAIR_INDEX_TO_SYMBOL[m.sub] = {};
	PAIR_INDEX_TO_SYMBOL[m.sub][m.pairIndex] = m.symbol;
}
function pairSymbolFromIndex(idx: number, category: string = ''): string {
	const bySub = PAIR_INDEX_TO_SYMBOL[category]?.[idx];
	if (bySub) return bySub;
	for (const m of ALL_MARKETS) {
		if (m.pairIndex === idx) return m.symbol;
	}
	return `P${idx}`;
}

/** Fetch the connected user's open trading positions inside the given
 * competition. Comp positions are seeded by the per-comp UserAccount PDA, not
 * the main one — fetchTradingPositions on hashfoxClient won't pick them up. */
export async function fetchCompTradingPositions(
	program: any,
	competition: PublicKey,
	owner: PublicKey
): Promise<EnrichedTradingPosition[]> {
	try {
		const [compUserPda] = findCompUserPda(competition, owner);
		const compUserAcc = await (program.account as any).userAccount.fetch(compUserPda);
		const total = Number((compUserAcc.totalTradingPositions as BNType).toString());
		if (total <= 0) return [];
		const pdas: PublicKey[] = [];
		for (let i = 0; i < total; i++) {
			const [pda] = findTradePda(compUserPda, new BN(i));
			pdas.push(pda);
		}
		const fetched = await (program.account as any).tradingPosition.fetchMultiple(pdas);
		const out: EnrichedTradingPosition[] = [];
		for (let i = 0; i < pdas.length; i++) {
			if (!fetched[i]) continue;
			out.push(
				enrichTradingPosition(pdas[i], fetched[i] as TradingPositionAccount, pairSymbolFromIndex)
			);
		}
		return out;
	} catch (err) {
		console.warn('[competition] fetchCompTradingPositions failed', err);
		return [];
	}
}

export function isCompetitionJoinable(comp: CompetitionView): boolean {
	return comp.status === 'pending' && comp.participantCount < comp.maxParticipants;
}

export function competitionTotalPoolSol(comp: CompetitionView): number {
	// Display target as the *advertised* pool until the comp fills.
	return comp.status === 'pending' ? comp.targetSol : comp.prizePoolSol;
}

export function fmtCountdown(targetTs: number): string {
	const ms = targetTs * 1000 - Date.now();
	if (Number.isNaN(ms) || ms <= 0) return '—';
	const sec = Math.floor(ms / 1000);
	const d = Math.floor(sec / 86_400);
	const h = Math.floor((sec % 86_400) / 3600);
	const m = Math.floor((sec % 3600) / 60);
	if (d > 0) return `${d}d ${h}h ${m}m`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}
