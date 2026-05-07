<script lang="ts">
	import TradingTerminalPro from '$lib/components/terminal/TradingTerminalPro.svelte';
	import PredictionTerminalPro from '$lib/components/terminal/PredictionTerminalPro.svelte';
	import GlobalSearchBar from '$lib/components/terminal/GlobalSearchBar.svelte';
	import { selectedMarket } from '$lib/stores/selectedMarket';
	import { pendingPredictionEvent } from '$lib/stores/pendingPredictionEvent';
	import { MARKETS_BY_CATEGORY, type MarketCategory, type MarketEntry } from '$lib/markets';
	import type { PolyEvent } from '$lib/polymarket';

	let category: MarketCategory = 'crypto';
	selectedMarket.subscribe((m) => {
		if (m?.category && m.category !== category) category = m.category;
	});

	function pickCategory(cat: MarketCategory) {
		if (cat === category) return;
		category = cat;
		const list = MARKETS_BY_CATEGORY[cat];
		if (list && list.length > 0) selectedMarket.set(list[0]);
	}

	function onSelectMarket(e: CustomEvent<MarketEntry>) {
		const entry = e.detail;
		category = entry.category;
		selectedMarket.set(entry);
	}

	function onSelectEvent(e: CustomEvent<PolyEvent>) {
		category = 'prediction';
		pendingPredictionEvent.set(e.detail);
	}
</script>

<main class="terminal">
	<nav class="cat-nav">
		<div class="cat-buttons">
			<button class="cat" class:active={category === 'crypto'} on:click={() => pickCategory('crypto')}>CRYPTO</button>
			<button class="cat" class:active={category === 'traditional'} on:click={() => pickCategory('traditional')}>TRADITIONAL</button>
			<button class="cat" class:active={category === 'prediction'} on:click={() => pickCategory('prediction')}>PREDICTION</button>
		</div>
		<div class="cat-search">
			<GlobalSearchBar on:selectMarket={onSelectMarket} on:selectEvent={onSelectEvent} />
		</div>
	</nav>

	<div class="content">
		{#if category === 'prediction'}
			<PredictionTerminalPro />
		{:else if category === 'traditional'}
			<TradingTerminalPro category="traditional" />
		{:else}
			<TradingTerminalPro category="crypto" />
		{/if}
	</div>
</main>

<style>
	.terminal {
		min-height: calc(100vh - 100px);
		background: #0a0a0a;
		color: #ccc;
		font-family: 'Courier New', monospace;
	}

	.cat-nav {
		display: flex;
		gap: 12px;
		align-items: center;
		padding: 10px 16px;
		background: #0a0a0a;
		border-bottom: 1px solid #1f1f1f;
	}
	.cat-buttons {
		display: flex;
		gap: 4px;
		flex-shrink: 0;
	}
	.cat-search {
		flex: 1;
		min-width: 0;
		display: flex;
	}
	.cat-search :global(.gsb) {
		flex: 1;
		min-width: 0;
		max-width: none;
	}
	.cat-search :global(.gsb-input-wrap) { width: 100%; }
	.cat {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 7px 16px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.1em;
		cursor: pointer;
	}
	.cat:hover { color: #ccc; border-color: #444; }
	.cat.active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0, 0.05); }

	.content { padding: 0; }

	@media (max-width: 720px) {
		.cat-nav { flex-wrap: wrap; }
	}
</style>
