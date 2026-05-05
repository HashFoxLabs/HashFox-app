<script lang="ts">
	import { onMount } from 'svelte';
	import { walletStore } from '$lib/wallet/stores';
	import {
		fetchTraderCardStats,
		formatPeriodLabel,
		type TraderCardStats
	} from './traderCard';
	import { mintTraderCardNft } from './mintCard';

	export let open = false;
	export let onClose: () => void = () => {};

	const CARD_W = 800;
	const CARD_H = 1120;

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let stats: TraderCardStats | null = null;
	let avatarDataUrl: string | null = null;
	let loading = false;
	let minting = false;
	let error = '';
	let success: { mintAddress: string; signature: string; imageUrl: string } | null = null;

	async function fetchAvatarAsDataUrl(url: string): Promise<string | null> {
		try {
			const res = await fetch(url, { mode: 'cors', cache: 'no-store' });
			if (!res.ok) return null;
			const blob = await res.blob();
			return await new Promise<string | null>((resolve) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
				reader.onerror = () => resolve(null);
				reader.readAsDataURL(blob);
			});
		} catch {
			return null;
		}
	}

	function walletAddress(): string {
		return (
			wallet?.publicKey?.toBase58 ? wallet.publicKey.toBase58() : wallet?.publicKey?.toString?.() || ''
		);
	}

	async function load() {
		const addr = walletAddress();
		if (!addr) return;
		loading = true;
		error = '';
		success = null;
		try {
			stats = await fetchTraderCardStats(addr);
			if (!stats) {
				error = 'No profile or trades found yet.';
			} else if (stats.avatarUrl) {
				avatarDataUrl = await fetchAvatarAsDataUrl(stats.avatarUrl);
			} else {
				avatarDataUrl = null;
			}
		} catch (err: any) {
			error = err?.message ?? 'Failed to load stats';
		} finally {
			loading = false;
		}
	}

	$: if (open) void load();

	function fmtUsd(v: number): string {
		const sign = v >= 0 ? '+' : '-';
		const abs = Math.abs(v);
		const formatted =
			abs >= 1000 ? abs.toLocaleString('en-US', { maximumFractionDigits: 0 }) : abs.toFixed(2);
		return `${sign}$${formatted}`;
	}

	function fmtPct(v: number): string {
		const sign = v >= 0 ? '+' : '';
		return `${sign}${v.toFixed(2)}%`;
	}

	function shortAddr(addr: string): string {
		if (!addr) return '';
		return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
	}

	$: cardSvg = stats ? renderCardSvg(stats, avatarDataUrl) : '';

	function renderCardSvg(s: TraderCardStats, avatarHref: string | null): string {
		const handle = s.username ? `@${s.username}` : shortAddr(s.walletAddress);
		const period = formatPeriodLabel(s);
		const pnlColor = s.totalPnl >= 0 ? '#22c55e' : '#ef4444';
		const roiColor = s.roiPercent >= 0 ? '#22c55e' : '#ef4444';
		// Note: SVG <text> escapes are minimal; usernames are validated upstream.
		const safe = (v: string) =>
			v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

		const avatarCx = 130;
		const avatarCy = 215;
		const avatarR = 70;
		const initial = (s.username?.[0] || s.walletAddress?.[0] || '?').toUpperCase();
		const avatarBlock = avatarHref
			? `
  <defs>
    <clipPath id="avatarClip">
      <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}"/>
    </clipPath>
  </defs>
  <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR + 4}" fill="#000" stroke="#ff5a00" stroke-width="3"/>
  <image href="${avatarHref}" x="${avatarCx - avatarR}" y="${avatarCy - avatarR}" width="${avatarR * 2}" height="${avatarR * 2}" clip-path="url(#avatarClip)" preserveAspectRatio="xMidYMid slice"/>`
			: `
  <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR + 4}" fill="#000" stroke="#ff5a00" stroke-width="3"/>
  <circle cx="${avatarCx}" cy="${avatarCy}" r="${avatarR}" fill="#ff5a00"/>
  <text x="${avatarCx}" y="${avatarCy + 24}" text-anchor="middle" font-family="Courier New, monospace" font-size="64" font-weight="900" fill="#000">${safe(initial)}</text>`;

		return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CARD_W} ${CARD_H}" width="${CARD_W}" height="${CARD_H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#1a0e05"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.2" cy="0.15" r="0.7">
      <stop offset="0%" stop-color="#ff5a00" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="#ff5a00" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
  <rect width="${CARD_W}" height="${CARD_H}" fill="url(#glow)"/>
  <rect x="20" y="20" width="${CARD_W - 40}" height="${CARD_H - 40}" rx="24"
        fill="none" stroke="#ff5a00" stroke-width="2" stroke-opacity="0.6"/>

  <!-- Header -->
  <text x="60" y="80" font-family="Courier New, monospace" font-size="22" fill="#ff5a00" letter-spacing="4">HASHFOX</text>
  <text x="60" y="110" font-family="Courier New, monospace" font-size="14" fill="#888" letter-spacing="3">TRADER CARD</text>

  <text x="${CARD_W - 60}" y="80" text-anchor="end" font-family="Courier New, monospace" font-size="14" fill="#666" letter-spacing="2">SOLANA · NFT</text>
  <text x="${CARD_W - 60}" y="110" text-anchor="end" font-family="Courier New, monospace" font-size="12" fill="#666">${safe(period)}</text>

  <!-- Avatar + Identity -->
  ${avatarBlock}
  <text x="230" y="210" font-family="Courier New, monospace" font-size="42" font-weight="900" fill="#ffffff">${safe(handle)}</text>
  <text x="230" y="244" font-family="Courier New, monospace" font-size="14" fill="#777">${safe(shortAddr(s.walletAddress))} · ${s.periodDays} day${s.periodDays === 1 ? '' : 's'}</text>

  <line x1="60" y1="310" x2="${CARD_W - 60}" y2="310" stroke="#222" stroke-width="1"/>

  <!-- Hero PnL -->
  <text x="60" y="340" font-family="Courier New, monospace" font-size="13" fill="#888" letter-spacing="2">TOTAL PNL</text>
  <text x="60" y="430" font-family="Courier New, monospace" font-size="86" font-weight="900" fill="${pnlColor}">${safe(fmtUsd(s.totalPnl))}</text>

  <text x="${CARD_W - 60}" y="340" text-anchor="end" font-family="Courier New, monospace" font-size="13" fill="#888" letter-spacing="2">ROI</text>
  <text x="${CARD_W - 60}" y="430" text-anchor="end" font-family="Courier New, monospace" font-size="86" font-weight="900" fill="${roiColor}">${safe(fmtPct(s.roiPercent))}</text>

  <line x1="60" y1="480" x2="${CARD_W - 60}" y2="480" stroke="#222" stroke-width="1"/>

  <!-- Stat grid -->
  ${statBlock(60, 540, 'TRADES', String(s.tradeCount))}
  ${statBlock(280, 540, 'WIN RATE', `${s.winRate.toFixed(1)}%`)}
  ${statBlock(500, 540, 'VOLUME', fmtUsd(s.totalVolume).replace('+', ''))}

  ${statBlock(60, 680, 'WINS', String(s.winCount), '#22c55e')}
  ${statBlock(280, 680, 'LOSSES', String(s.lossCount), '#ef4444')}
  ${statBlock(500, 680, 'AVG TRADE', fmtUsd(s.avgTradePnl))}

  ${statBlock(60, 820, 'BEST TRADE', fmtUsd(s.bestTradePnl), '#22c55e')}
  ${statBlock(280, 820, 'WORST TRADE', fmtUsd(s.worstTradePnl), '#ef4444')}
  ${statBlock(500, 820, 'PERIOD', `${s.periodDays}d`)}

  <line x1="60" y1="960" x2="${CARD_W - 60}" y2="960" stroke="#222" stroke-width="1"/>

  <!-- Footer -->
  <text x="60" y="1010" font-family="Courier New, monospace" font-size="11" fill="#666" letter-spacing="2">PERIOD</text>
  <text x="60" y="1035" font-family="Courier New, monospace" font-size="14" fill="#aaa">${safe(period)}</text>

  <text x="${CARD_W - 60}" y="1010" text-anchor="end" font-family="Courier New, monospace" font-size="11" fill="#666" letter-spacing="2">MINTED</text>
  <text x="${CARD_W - 60}" y="1035" text-anchor="end" font-family="Courier New, monospace" font-size="14" fill="#aaa">${new Date().toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}</text>

  <text x="${CARD_W / 2}" y="1080" text-anchor="middle" font-family="Courier New, monospace" font-size="10" fill="#444" letter-spacing="3">HASHFOX.APP · LIFETIME PERFORMANCE SNAPSHOT</text>
</svg>`;
	}

	function statBlock(
		x: number,
		y: number,
		label: string,
		value: string,
		color: string = '#ffffff'
	): string {
		const safe = (v: string) =>
			v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return `
  <text x="${x}" y="${y}" font-family="Courier New, monospace" font-size="12" fill="#888" letter-spacing="2">${safe(label)}</text>
  <text x="${x}" y="${y + 40}" font-family="Courier New, monospace" font-size="34" font-weight="900" fill="${color}">${safe(value)}</text>`;
	}

	async function handleMint() {
		if (!stats) return;
		const addr = walletAddress();
		if (!addr) {
			error = 'Connect a wallet first';
			return;
		}
		minting = true;
		error = '';
		try {
			const res = await mintTraderCardNft({
				walletAddress: addr,
				adapter: wallet?.adapter ?? null,
				stats,
				cardSvg,
				width: CARD_W,
				height: CARD_H
			});
			success = {
				mintAddress: res.mintAddress,
				signature: res.signature,
				imageUrl: res.imageUrl
			};
		} catch (err: any) {
			error = err?.message ?? 'Mint failed';
		} finally {
			minting = false;
		}
	}

	function handleClose() {
		if (minting) return;
		onClose();
	}
</script>

{#if open}
	<div class="overlay" on:click={handleClose} role="presentation">
		<div class="modal" on:click|stopPropagation role="dialog" aria-modal="true">
			<div class="head">
				<div class="title">MINT TRADER CARD</div>
				<button class="x" on:click={handleClose} disabled={minting}>×</button>
			</div>

			{#if loading}
				<div class="placeholder">Loading stats…</div>
			{:else if !stats}
				<div class="placeholder err">{error || 'No data'}</div>
			{:else}
				<div class="card-wrap">
					{@html cardSvg}
				</div>

				{#if success}
					<div class="success">
						<div class="row"><span class="k">Mint</span><span class="v mono">{success.mintAddress}</span></div>
						<div class="row"><span class="k">Signature</span>
							<a class="v mono" href={`https://solscan.io/tx/${success.signature}?cluster=devnet`} target="_blank" rel="noopener">{success.signature.slice(0, 24)}…</a>
						</div>
						<div class="row"><span class="k">Image</span>
							<a class="v mono" href={success.imageUrl} target="_blank" rel="noopener">view</a>
						</div>
					</div>
				{:else if error}
					<div class="placeholder err">{error}</div>
				{/if}

				<div class="actions">
					<button class="ghost" on:click={handleClose} disabled={minting}>CLOSE</button>
					{#if !success}
						<button class="primary" on:click={handleMint} disabled={minting}>
							{minting ? 'MINTING…' : 'MINT OUR CARD'}
						</button>
					{:else}
						<button class="primary" on:click={() => { success = null; void load(); }}>MINT ANOTHER</button>
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.78);
		z-index: 9999;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 20px;
		overflow-y: auto;
	}
	.modal {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 14px;
		max-width: 720px;
		width: 100%;
		font-family: 'Courier New', monospace;
		color: #ccc;
		max-height: 92vh;
		overflow-y: auto;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
		border-bottom: 1px solid #222;
	}
	.title {
		color: #ff5a00;
		font-size: 12px;
		letter-spacing: 0.18em;
		font-weight: bold;
	}
	.x {
		background: transparent;
		border: none;
		color: #888;
		font-size: 22px;
		cursor: pointer;
		padding: 0 6px;
	}
	.x:hover { color: #ff5a00; }
	.x:disabled { opacity: 0.4; cursor: not-allowed; }

	.card-wrap {
		padding: 18px;
		display: flex;
		justify-content: center;
		background: #050505;
	}
	.card-wrap :global(svg) {
		max-width: 100%;
		height: auto;
		border-radius: 14px;
		box-shadow: 0 12px 40px rgba(255, 90, 0, 0.18);
	}

	.placeholder {
		padding: 2rem 1rem;
		text-align: center;
		color: #666;
		font-size: 12px;
	}
	.placeholder.err { color: #ff6b6b; }

	.success {
		padding: 14px 18px;
		border-top: 1px solid #222;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
	}
	.row { display: flex; gap: 12px; align-items: baseline; }
	.k { color: #888; min-width: 80px; letter-spacing: 0.1em; }
	.v { color: #ccc; word-break: break-all; }
	.v.mono { font-family: inherit; }
	a.v { color: #ff5a00; text-decoration: none; }
	a.v:hover { text-decoration: underline; }

	.actions {
		display: flex;
		gap: 10px;
		justify-content: flex-end;
		padding: 14px 18px 18px;
		border-top: 1px solid #222;
	}
	.ghost, .primary {
		font-family: inherit;
		font-size: 11px;
		letter-spacing: 0.14em;
		font-weight: bold;
		padding: 10px 16px;
		border-radius: 6px;
		cursor: pointer;
	}
	.ghost {
		background: transparent;
		border: 1px solid #333;
		color: #aaa;
	}
	.ghost:hover:not(:disabled) { color: #ff5a00; border-color: #ff5a00; }
	.primary {
		background: #ff5a00;
		border: 1px solid #ff5a00;
		color: #000;
	}
	.primary:hover:not(:disabled) { background: #ff7a2c; border-color: #ff7a2c; }
	.ghost:disabled, .primary:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
