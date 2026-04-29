<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import {
		binanceOrderBook,
		binanceTrades,
		binanceStatus,
		connectBinance,
		disconnectBinance,
		type OrderBookRow,
		type TradeRow
	} from '$lib/stores/binanceOrderbook';

	export let symbol: string = 'SOL';

	let book = $binanceOrderBook;
	let trades = $binanceTrades;
	let status = $binanceStatus;

	let view: 'book' | 'trades' = 'book';

	onMount(() => {
		connectBinance(symbol);
	});

	$: if (symbol) {
		connectBinance(symbol);
	}

	onDestroy(() => {
		disconnectBinance();
	});

	function fmt(p: number): string {
		if (!Number.isFinite(p)) return '—';
		if (p >= 1000) return p.toFixed(2);
		if (p >= 10) return p.toFixed(3);
		return p.toFixed(5);
	}
</script>

<div class="panel">
	<div class="head">
		<div class="title">ORDERBOOK</div>
		<div class="meta">
			<span class="pill">{symbol}/USDT</span>
			<span class="pill dim">{status}</span>
			{#if book.spreadAbs > 0}
				<span class="pill dim">SPREAD {fmt(book.spreadAbs)} ({book.spreadPct.toFixed(2)}%)</span>
			{/if}
		</div>
		<div class="tabs">
			<button class="t" class:active={view === 'book'} on:click={() => (view = 'book')}>BOOK</button>
			<button class="t" class:active={view === 'trades'} on:click={() => (view = 'trades')}>TRADES</button>
		</div>
	</div>

	{#if view === 'book'}
		<div class="grid">
			<div class="side asks">
				<div class="row headrow"><span>ASK</span><span>SIZE</span><span>TOTAL</span></div>
				{#each book.asks as r (r.price)}
					<div class="row ask">
						<span class="p">{fmt(r.price)}</span>
						<span class="s">{r.size.toFixed(4)}</span>
						<span class="t">{r.total.toFixed(4)}</span>
					</div>
				{/each}
			</div>
			<div class="side bids">
				<div class="row headrow"><span>BID</span><span>SIZE</span><span>TOTAL</span></div>
				{#each book.bids as r (r.price)}
					<div class="row bid">
						<span class="p">{fmt(r.price)}</span>
						<span class="s">{r.size.toFixed(4)}</span>
						<span class="t">{r.total.toFixed(4)}</span>
					</div>
				{/each}
			</div>
		</div>
	{:else}
		<div class="trades">
			<div class="row headrow"><span>TIME</span><span>SIDE</span><span>PRICE</span><span>SIZE</span></div>
			{#each trades as tr (tr.t + ':' + tr.price)}
				<div class={"row tr " + (tr.side === 'buy' ? 'buy' : 'sell')}>
					<span class="tm">{tr.t}</span>
					<span class="sd">{tr.side.toUpperCase()}</span>
					<span class="p">{fmt(tr.price)}</span>
					<span class="s">{tr.size.toFixed(4)}</span>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.panel {
		border: 1px solid #333;
		background: #0a0a0a;
		border-radius: 12px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		min-height: 420px;
	}
	.head {
		padding: 10px 12px;
		border-bottom: 1px solid #222;
		background: #000;
		display: grid;
		grid-template-columns: 1fr;
		gap: 8px;
	}
	.title {
		color: #ff5a00;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		letter-spacing: 0.18em;
		font-weight: 900;
	}
	.meta { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
	.pill {
		border: 1px solid #222;
		background: rgba(255,255,255,0.03);
		color: #cfcfcf;
		padding: 4px 8px;
		border-radius: 999px;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		letter-spacing: 0.06em;
		font-weight: 800;
	}
	.pill.dim { color: #888; }
	.tabs { display: flex; gap: 6px; }
	.t {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 6px 10px;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: 900;
		letter-spacing: 0.12em;
		cursor: pointer;
	}
	.t.active { border-color: #ff5a00; color: #ff5a00; background: rgba(255, 90, 0,0.06); }
	.t:hover { border-color: #444; color: #ccc; }

	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		min-height: 0;
		flex: 1;
	}
	.side { padding: 10px 10px 12px; overflow: auto; }
	.side.asks { border-right: 1px solid #1a1a1a; }
	.row {
		display: grid;
		grid-template-columns: 1.1fr 1fr 1fr;
		gap: 10px;
		padding: 6px 0;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		color: #aaa;
		border-bottom: 1px solid rgba(255,255,255,0.05);
	}
	.row.headrow {
		color: #666;
		font-size: 10px;
		letter-spacing: 0.12em;
		font-weight: 900;
		border-bottom: 1px solid #222;
		padding-top: 0;
	}
	.ask .p { color: #ff6b6b; font-weight: 900; }
	.bid .p { color: #00ff66; font-weight: 900; }
	.s, .t { color: #cfcfcf; }

	.trades { padding: 10px 10px 12px; overflow: auto; flex: 1; }
	.row.tr { grid-template-columns: 1fr 0.7fr 1.1fr 1fr; }
	.row.tr.buy .p { color: #00ff66; font-weight: 900; }
	.row.tr.sell .p { color: #ff6b6b; font-weight: 900; }
	.tm { color: #888; }
	.sd { color: #aaa; font-weight: 900; letter-spacing: 0.08em; font-size: 10px; }

	@media (max-width: 1100px) {
		.grid { grid-template-columns: 1fr; }
		.side.asks { border-right: none; border-bottom: 1px solid #1a1a1a; }
	}
</style>

