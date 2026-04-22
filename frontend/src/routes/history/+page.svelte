<script lang="ts">
	import { onMount } from 'svelte';
	import { walletStore } from '$lib/wallet/stores';
	import {
		buildConnection,
		buildProgram,
		fetchUnifiedHistory,
		PRICE_SCALE,
		USD_SCALE,
		type UnifiedHistoryEntry,
		type TradingPositionAccount,
		type PredictionPositionAccount
	} from '$lib/hashfox';
	import { ALL_MARKETS } from '$lib/markets';

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	type HistoryEntry =
		| (Omit<UnifiedHistoryEntry, 'kind' | 'data'> & { kind: 'trading'; data: TradingPositionAccount })
		| (Omit<UnifiedHistoryEntry, 'kind' | 'data'> & { kind: 'prediction'; data: PredictionPositionAccount });

	let entries: HistoryEntry[] = [];
	let loading = false;
	let error = '';
	type HistoryFilter = 'all' | 'crypto' | 'traditional' | 'prediction' | 'active';
	let filter: HistoryFilter = 'all';
	const FILTER_OPTIONS = ['all', 'active', 'crypto', 'traditional', 'prediction'] as const satisfies readonly HistoryFilter[];

	async function load() {
		if (!wallet.connected || !wallet.publicKey) {
			entries = [];
			return;
		}
		loading = true;
		error = '';
		try {
			const conn = buildConnection();
			const program = buildProgram(conn, wallet.adapter);
			entries = (await fetchUnifiedHistory(program, wallet.publicKey)) as unknown as HistoryEntry[];
		} catch (err: any) {
			error = err?.message ?? 'Failed to load history';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	$: if (wallet.connected) load();

	function variantKey(v: any): string {
		if (!v || typeof v !== 'object') return '';
		return Object.keys(v)[0] ?? '';
	}

	function pairToSymbol(pairIndex: number, category: string): string {
		const m = ALL_MARKETS.find(
			(mm) => mm.pairIndex === pairIndex && matchCategory(mm.category, category)
		);
		return m?.symbol ?? `#${pairIndex}`;
	}

	function matchCategory(
		mktCat: 'crypto' | 'traditional' | 'prediction',
		contractCat: string
	): boolean {
		if (contractCat === 'crypto') return mktCat === 'crypto';
		return mktCat === 'traditional';
	}

	function tradingCategory(t: TradingPositionAccount): string {
		return variantKey(t.marketCategory);
	}

	function tradingSymbol(t: TradingPositionAccount): string {
		return pairToSymbol(t.pairIndex, tradingCategory(t));
	}

	function fmtUsd(raw: any): string {
		const n = typeof raw?.toNumber === 'function' ? raw.toNumber() : Number(raw);
		return (n / USD_SCALE).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
	}
	function fmtPrice(raw: any): string {
		const n = typeof raw?.toNumber === 'function' ? raw.toNumber() : Number(raw);
		return (n / PRICE_SCALE).toLocaleString('en-US', { maximumFractionDigits: 6 });
	}
	function fmtPnl(raw: any): { txt: string; cls: 'up' | 'down' | 'flat' } {
		const n = typeof raw?.toNumber === 'function' ? raw.toNumber() : Number(raw);
		const v = n / USD_SCALE;
		const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
		const sign = v > 0 ? '+' : '';
		return { txt: `${sign}$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, cls };
	}
	function fmtDate(ts: number): string {
		if (!ts) return '—';
		return new Date(ts * 1000).toLocaleString();
	}

	$: filtered = entries.filter((e) => {
		if (filter === 'all') return true;
		if (filter === 'active') {
			if (e.kind === 'trading') {
				const s = variantKey((e.data as TradingPositionAccount).status);
				return s === 'active' || s === 'pendingFill';
			}
			const s = variantKey((e.data as PredictionPositionAccount).status);
			return s === 'active' || s === 'partiallySold';
		}
		if (filter === 'prediction') return e.kind === 'prediction';
		if (filter === 'crypto') return e.kind === 'trading' && tradingCategory(e.data as TradingPositionAccount) === 'crypto';
		if (filter === 'traditional') return e.kind === 'trading' && tradingCategory(e.data as TradingPositionAccount) !== 'crypto';
		return true;
	});
</script>

<main class="history-page">
	<div class="inner">
		<header class="head">
			<h1>History</h1>
			<p>Every trade across crypto, traditional and prediction markets — from one account.</p>
		</header>

		{#if !wallet.connected}
			<div class="placeholder">Connect a wallet to view history.</div>
		{:else}
			<nav class="filter-nav">
				{#each FILTER_OPTIONS as f}
					<button class="fbtn" class:active={filter === f} on:click={() => (filter = f)}>
						{f.toUpperCase()}
					</button>
				{/each}
				<span class="spacer"></span>
				<button class="refresh" on:click={load} disabled={loading}>{loading ? '…' : 'REFRESH'}</button>
			</nav>

			{#if error}
				<div class="placeholder err">{error}</div>
			{:else if loading && entries.length === 0}
				<div class="placeholder">Loading positions…</div>
			{:else if filtered.length === 0}
				<div class="placeholder">No positions for this filter.</div>
			{:else}
				<div class="table">
					<div class="row head-row">
						<div>OPENED</div>
						<div>TYPE</div>
						<div>MARKET</div>
						<div>SIDE</div>
						<div>SIZE / AMOUNT</div>
						<div>ENTRY</div>
						<div>STATUS</div>
						<div>PNL</div>
					</div>
					{#each filtered as e (e.pubkey)}
						{#if e.kind === 'trading'}
							{@const t = e.data as TradingPositionAccount}
							{@const pnl = fmtPnl(t.realizedPnl)}
							<div class="row">
								<div>{fmtDate(e.openedAt)}</div>
								<div>
									<span class="tag ttype">
										{tradingCategory(t).toUpperCase()} · {variantKey(t.tradeMode).toUpperCase()} · {variantKey(t.orderType).toUpperCase()}
									</span>
								</div>
								<div><span class="mono">{tradingSymbol(t)}</span></div>
								<div>
									<span class="side {variantKey(t.direction)}">{variantKey(t.direction).toUpperCase()}</span>
									{#if variantKey(t.tradeMode) === 'perp'}<span class="lev">{t.leverage}x</span>{/if}
								</div>
								<div>${fmtUsd(t.sizeUsd)}<span class="sub">margin ${fmtUsd(t.marginUsd)}</span></div>
								<div>${fmtPrice(t.entryPrice)}</div>
								<div><span class="status s-{variantKey(t.status)}">{variantKey(t.status)}</span></div>
								<div class={pnl.cls}>{pnl.txt}</div>
							</div>
						{:else}
							{@const p = e.data as PredictionPositionAccount}
							{@const ptype = variantKey(p.predictionType)}
							<div class="row">
								<div>{fmtDate(e.openedAt)}</div>
								<div><span class="tag ttype">PREDICTION</span></div>
								<div><span class="mono" title={p.marketId}>{p.marketId.slice(0, 16)}{p.marketId.length > 16 ? '…' : ''}</span></div>
								<div><span class="side {ptype === 'yes' ? 'long' : 'short'}">{ptype.toUpperCase()}</span></div>
								<div>${fmtUsd(p.amountUsd)}<span class="sub">{(p.shares.toNumber() / USD_SCALE).toLocaleString()} shares</span></div>
								<div>${fmtPrice(p.pricePerShare)}</div>
								<div><span class="status s-{variantKey(p.status)}">{variantKey(p.status)}</span></div>
								<div class="flat">—</div>
							</div>
						{/if}
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</main>

<style>
	.history-page {
		min-height: calc(100vh - 100px);
		background: #0a0a0a;
		color: #ccc;
		font-family: 'Courier New', monospace;
	}
	.inner {
		max-width: 1400px;
		margin: 0 auto;
		padding: 24px 16px 48px;
	}
	.head { margin-bottom: 20px; }
	.head h1 { color: #ff9500; font-size: 22px; letter-spacing: 0.08em; margin-bottom: 4px; }
	.head p { color: #888; font-size: 12px; }

	.filter-nav {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 8px 0 16px;
		border-bottom: 1px solid #222;
		margin-bottom: 12px;
	}
	.fbtn {
		background: #000;
		border: 1px solid #222;
		color: #888;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
	}
	.fbtn.active { color: #ff9500; border-color: #ff9500; background: rgba(255,149,0,0.05); }
	.spacer { flex: 1; }
	.refresh {
		background: #000;
		border: 1px solid #333;
		color: #ccc;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		cursor: pointer;
	}
	.refresh:hover { border-color: #ff9500; }

	.placeholder {
		padding: 3rem 1rem;
		text-align: center;
		color: #666;
		font-size: 12px;
		background: #121212;
		border: 1px solid #222;
	}
	.placeholder.err { color: #ff6b6b; }

	.table { background: #121212; border: 1px solid #222; }
	.row {
		display: grid;
		grid-template-columns: 140px 180px 90px 110px 130px 100px 110px 110px;
		gap: 10px;
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a1a;
		font-size: 11px;
		align-items: center;
	}
	.head-row {
		color: #666;
		background: #0a0a0a;
		font-size: 10px;
		letter-spacing: 0.1em;
		font-weight: bold;
		position: sticky;
		top: 0;
	}
	.mono { color: #ff9500; font-weight: bold; }
	.tag.ttype {
		display: inline-block;
		padding: 2px 6px;
		border: 1px solid #222;
		color: #888;
		font-size: 9px;
		letter-spacing: 0.08em;
	}
	.side {
		display: inline-block;
		padding: 2px 6px;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.06em;
	}
	.side.long { color: #00ff64; }
	.side.short { color: #ff4444; }
	.lev { color: #ff9500; margin-left: 4px; font-size: 10px; }

	.sub { display: block; color: #555; font-size: 9px; margin-top: 2px; }

	.status { font-size: 10px; letter-spacing: 0.06em; color: #888; }
	.status.s-active, .status.s-partiallySold { color: #00ff64; }
	.status.s-closed, .status.s-fullySold { color: #888; }
	.status.s-liquidated { color: #ff4444; }
	.status.s-pendingFill { color: #ff9500; }
	.status.s-cancelled { color: #666; }

	.up { color: #00ff64; font-weight: bold; }
	.down { color: #ff4444; font-weight: bold; }
	.flat { color: #666; }

	@media (max-width: 1000px) {
		.row { grid-template-columns: 1fr 1fr; }
		.head-row { display: none; }
	}
</style>
