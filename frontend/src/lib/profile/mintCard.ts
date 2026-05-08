import { getSupabase } from '$lib/supabase';
import { SOLANA_RPC } from '$lib/env';
import { buildConnection } from '$lib/hashfox';
import type { Adapter } from '@solana/wallet-adapter-base';
import type { TraderCardStats } from './traderCard';
import { formatPeriodLabel } from './traderCard';

export interface MintResult {
	mintAddress: string;
	signature: string;
	imageUrl: string;
	metadataUrl: string;
}

const STORAGE_BUCKET = 'trader-cards';

function shortAddr(addr: string): string {
	if (!addr) return '';
	return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

async function uploadFile(
	walletAddress: string,
	mintId: string,
	suffix: string,
	contentType: string,
	body: Blob | string
): Promise<string> {
	const sb = getSupabase();
	if (!sb) throw new Error('Supabase unavailable');
	const path = `${walletAddress}/${mintId}.${suffix}`;
	const blob =
		typeof body === 'string' ? new Blob([body], { type: contentType }) : body;
	const { error } = await sb.storage
		.from(STORAGE_BUCKET)
		.upload(path, blob, { upsert: true, contentType });
	if (error) throw new Error(`Storage upload failed (${suffix}): ${error.message}`);
	const { data } = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path);
	return data.publicUrl;
}

async function svgToPng(svg: string, width: number, height: number): Promise<Blob> {
	const blob = new Blob([svg], { type: 'image/svg+xml' });
	const url = URL.createObjectURL(blob);
	try {
		const img = await new Promise<HTMLImageElement>((resolve, reject) => {
			const image = new Image();
			image.onload = () => resolve(image);
			image.onerror = () => reject(new Error('Failed to render card SVG'));
			image.src = url;
		});
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas 2D not available');
		ctx.drawImage(img, 0, 0, width, height);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob(
				(b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))),
				'image/png'
			);
		});
	} finally {
		URL.revokeObjectURL(url);
	}
}

function buildMetadata(
	stats: TraderCardStats,
	imageUrl: string,
	mintIndex: number
): object {
	const period = formatPeriodLabel(stats);
	const name = `HashFox Trader Card #${mintIndex}`;
	return {
		name,
		symbol: 'HFOX',
		description: `On-chain snapshot of @${stats.username || shortAddr(stats.walletAddress)}'s lifetime paper-trading performance on HashFox. Period: ${period}.`,
		image: imageUrl,
		external_url: 'https://hashfox.app',
		attributes: [
			{ trait_type: 'Username', value: stats.username || shortAddr(stats.walletAddress) },
			{ trait_type: 'Wallet', value: stats.walletAddress },
			{ trait_type: 'Period Start', value: stats.periodStart },
			{ trait_type: 'Period End', value: stats.periodEnd },
			{ trait_type: 'Period Days', value: stats.periodDays },
			{ trait_type: 'Trades', value: stats.tradeCount },
			{ trait_type: 'Wins', value: stats.winCount },
			{ trait_type: 'Losses', value: stats.lossCount },
			{ trait_type: 'Win Rate', value: `${stats.winRate.toFixed(1)}%` },
			{ trait_type: 'Total PnL', value: `${stats.totalPnl.toFixed(2)} USD` },
			{ trait_type: 'ROI', value: `${stats.roiPercent.toFixed(2)}%` },
			{ trait_type: 'Volume', value: `${stats.totalVolume.toFixed(2)} USD` },
			{ trait_type: 'Best Trade', value: `${stats.bestTradePnl.toFixed(2)} USD` },
			{ trait_type: 'Worst Trade', value: `${stats.worstTradePnl.toFixed(2)} USD` }
		],
		properties: {
			category: 'image',
			files: [{ uri: imageUrl, type: 'image/png' }]
		}
	};
}

async function nextMintIndex(walletAddress: string): Promise<number> {
	const sb = getSupabase();
	if (!sb) return 1;
	const { data } = await sb
		.from('trader_card_mints')
		.select('mint_index')
		.eq('wallet_address', walletAddress)
		.order('mint_index', { ascending: false })
		.limit(1)
		.maybeSingle();
	const last = (data as any)?.mint_index ?? 0;
	return Number(last) + 1;
}

async function recordMint(
	walletAddress: string,
	mintIndex: number,
	stats: TraderCardStats,
	result: MintResult
) {
	const sb = getSupabase();
	if (!sb) return;
	await sb.from('trader_card_mints').insert({
		wallet_address: walletAddress,
		mint_index: mintIndex,
		mint_address: result.mintAddress,
		signature: result.signature,
		image_url: result.imageUrl,
		metadata_url: result.metadataUrl,
		period_start: stats.periodStart,
		period_end: stats.periodEnd,
		trade_count: stats.tradeCount,
		total_pnl: stats.totalPnl,
		roi_percent: stats.roiPercent,
		win_rate: stats.winRate
	});
}

export async function mintTraderCardNft(args: {
	walletAddress: string;
	adapter: Adapter | null;
	stats: TraderCardStats;
	cardSvg: string;
	width: number;
	height: number;
}): Promise<MintResult> {
	const { walletAddress, adapter, stats, cardSvg, width, height } = args;
	if (!adapter || !adapter.publicKey) {
		throw new Error('Connect a wallet before minting');
	}

	// Lazy-load the heavy Metaplex bundle so the rest of the app doesn't pay
	// for it on first paint.
	const [
		{ createUmi },
		mplTm,
		{ walletAdapterIdentity },
		umiCore
	] = await Promise.all([
		import('@metaplex-foundation/umi-bundle-defaults'),
		import('@metaplex-foundation/mpl-token-metadata'),
		import('@metaplex-foundation/umi-signer-wallet-adapters'),
		import('@metaplex-foundation/umi')
	]);

	const mintIndex = await nextMintIndex(walletAddress);
	const tempMintId = `${Date.now()}-${mintIndex}`;

	const png = await svgToPng(cardSvg, width, height);
	const imageUrl = await uploadFile(walletAddress, tempMintId, 'png', 'image/png', png);
	const metadata = buildMetadata(stats, imageUrl, mintIndex);
	const metadataUrl = await uploadFile(
		walletAddress,
		tempMintId,
		'json',
		'application/json',
		JSON.stringify(metadata, null, 2)
	);

	const umi = createUmi(SOLANA_RPC).use(mplTm.mplTokenMetadata());
	umi.use(walletAdapterIdentity(adapter));

	const mintSigner = umiCore.generateSigner(umi);
	const builder = mplTm.createNft(umi, {
		mint: mintSigner,
		name: (metadata as any).name,
		symbol: (metadata as any).symbol,
		uri: metadataUrl,
		sellerFeeBasisPoints: umiCore.percentAmount(0)
	});

	// Umi's default RPC opens a WebSocket subscription for confirmation. Our
	// production RPC sits behind a same-origin HTTP proxy that doesn't speak
	// WS, so sendAndConfirm hangs and the blockhash expires. Split it: let
	// Umi sign and submit, then confirm via the patched Connection that uses
	// HTTP polling for `getSignatureStatuses`.
	const signature = await builder.send(umi);
	const sigStr = (umiCore as any).base58.deserialize(signature)[0] as string;
	const conn = buildConnection();
	await conn.confirmTransaction(sigStr, 'confirmed');

	const result: MintResult = {
		mintAddress: mintSigner.publicKey.toString(),
		signature: String(sigStr),
		imageUrl,
		metadataUrl
	};

	try {
		await recordMint(walletAddress, mintIndex, stats, result);
	} catch (err) {
		console.warn('[mintCard] failed to record mint row', err);
	}

	return result;
}

export { shortAddr };
