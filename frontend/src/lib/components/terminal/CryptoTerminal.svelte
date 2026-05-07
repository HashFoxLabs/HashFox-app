<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { selectedMarket } from '$lib/stores/selectedMarket';
	import { pythPrices } from '$lib/stores/pythPrices';
	import { walletStore } from '$lib/wallet/stores';
	import { hashfoxClient } from '$lib/hashfoxClient';
	import { MARKETS_BY_CATEGORY, type MarketEntry } from '$lib/markets';
	import TradingPanel from '$lib/components/TradingPanel.svelte';
	import PythChart from '$lib/components/terminal/PythChart.svelte';
	import OrderbookPanel from '$lib/components/terminal/OrderbookPanel.svelte';

	let market: MarketEntry;
	selectedMarket.subscribe((m) => (market = m));

	let prices: Record<string, any> = {};
	pythPrices.subscribe((p) => (prices = p));

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let solBalance = 0;
	let usdBalance = 0;
	let poll: ReturnType<typeof setInterval> | null = null;

	const CRYPTO_TABS = MARKETS_BY_CATEGORY.crypto.map((m) => m.symbol);

	function pick(sym: string) {
		const m = MARKETS_BY_CATEGORY.crypto.find((x) => x.symbol === sym);
		if (m) selectedMarket.set(m);
	}

	function fmtUsd(v: number) {
		return `$${v.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
	}

	function fmtTabPrice(sym: string): string {
		const p = prices?.[sym]?.price ?? 0;
		if (!p || p <= 0) return '—';
		const decimals = p >= 100 ? 2 : p >= 1 ? 3 : 5;
		return `$${Number(p).toFixed(decimals)}`;
	}

	async function refreshBalances() {
		if (!wallet?.connected) return;
		solBalance = await hashfoxClient.getBalance();
		const acc = await hashfoxClient.getUserAccount();
		usdBalance = acc?.usdBalance ? Number(acc.usdBalance.toString()) / 1_000_000 : 0;
	}

	onMount(() => {
		void refreshBalances();
		poll = setInterval(refreshBalances, 10_000);
	});

	onDestroy(() => {
		if (poll) clearInterval(poll);
	});

	$: if (wallet?.connected) void refreshBalances();
</script>

<div class="wrap">
	<div class="pair-tabs">
		{#each CRYPTO_TABS as sym (sym)}
			<button class="pt" class:active={market?.symbol === sym} on:click={() => pick(sym)}>
				<span class="s">{sym}</span>
				<span class="p">{fmtTabPrice(sym)}</span>
			</button>
		{/each}
	</div>

	<div class="grid">
		<div class="chart">
			<PythChart symbol={market?.symbol ?? 'SOL'} />
		</div>
		<div class="book">
			<OrderbookPanel symbol={market?.symbol ?? 'SOL'} />
		</div>
		<div class="trade">
			<TradingPanel />
			<div class="balances">
				<div class="b">
					<div class="k">WALLET SOL</div>
					<div class="v">{solBalance.toFixed(4)} SOL</div>
				</div>
				<div class="b">
					<div class="k">PAPER USD</div>
					<div class="v">{fmtUsd(usdBalance)}</div>
				</div>
				<div class="b">
					<div class="k">MARKET</div>
					<div class="v">{market?.symbol ?? '—'} / USD</div>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.wrap {
		padding: 16px;
		max-width: 1500px;
		margin: 0 auto;
	}
	.pair-tabs {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 10px;
		margin-bottom: 10px;
		border-bottom: 1px solid #1f1f1f;
	}
	.pt {
		background: #000;
		border: 1px solid #222;
		color: #aaa;
		padding: 8px 10px;
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 92px;
		cursor: pointer;
		font-family: 'Courier New', monospace;
	}
	.pt:hover { border-color: #444; }
	.pt.active { border-color: #ff5a00; background: rgba(255, 90, 0,0.06); }
	.s { font-weight: 900; letter-spacing: 0.08em; font-size: 11px; color: #ff5a00; }
	.pt.active .s { color: #ff5a00; }
	.p { font-weight: 900; font-size: 11px; color: #e8e8e8; }

	.grid {
		display: grid;
		grid-template-columns: 1.4fr 0.9fr;
		grid-template-rows: auto auto;
		gap: 14px;
	}
	.chart { grid-column: 1; grid-row: 1; min-width: 0; }
	.book { grid-column: 2; grid-row: 1; min-width: 0; }
	.trade { grid-column: 1 / span 2; grid-row: 2; min-width: 0; }

	.balances {
		margin-top: 12px;
		border: 1px solid #222;
		background: #0a0a0a;
		border-radius: 12px;
		padding: 12px;
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 10px;
	}
	.b { border: 1px solid #1f1f1f; background: #000; border-radius: 10px; padding: 10px; }
	.k { color: #666; font-size: 10px; letter-spacing: 0.16em; font-weight: 900; font-family: 'Courier New', monospace; }
	.v { color: #e8e8e8; font-size: 13px; font-weight: 900; margin-top: 6px; font-family: 'Courier New', monospace; }

	@media (max-width: 1100px) {
		.grid { grid-template-columns: 1fr; grid-template-rows: auto auto auto; }
		.chart { grid-column: 1; grid-row: 1; }
		.book { grid-column: 1; grid-row: 2; }
		.trade { grid-column: 1; grid-row: 3; }
		.balances { grid-template-columns: 1fr; }
	}
</style>

