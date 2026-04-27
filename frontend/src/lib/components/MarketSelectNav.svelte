<script lang="ts">
	import { createEventDispatcher, onDestroy, tick } from 'svelte';
	import { ALL_MARKETS, type MarketEntry, type MarketCategory } from '$lib/markets';

	const dispatch = createEventDispatcher<{ select: { market: MarketEntry } }>();

	export let selectedSymbol: string;

	let query = '';
	let open = false;
	let inputEl: HTMLInputElement;
	let wrapEl: HTMLDivElement;
	let activeIdx = -1;
	let filterCat: 'all' | MarketCategory = 'all';
	const FILTER_OPTIONS: Array<'all' | MarketCategory> = ['all', 'crypto', 'traditional', 'prediction'];

	let dropTop = 0;
	let dropLeft = 0;
	let dropWidth = 0;

	$: filtered = ALL_MARKETS.filter((m) => {
		if (filterCat !== 'all' && m.category !== filterCat) return false;
		if (query.trim() === '') return true;
		const q = query.trim().toLowerCase();
		return m.symbol.toLowerCase().includes(q) || m.label.toLowerCase().includes(q);
	});

	$: if (open) activeIdx = -1;

	function calcDropdownPos() {
		if (!wrapEl || typeof window === 'undefined') return;
		const r = wrapEl.getBoundingClientRect();
		dropTop = r.bottom + 4;
		dropLeft = r.left;
		dropWidth = Math.max(r.width, 320);
	}

	async function openDropdown() {
		open = true;
		await tick();
		calcDropdownPos();
		window.addEventListener('scroll', calcDropdownPos, true);
		window.addEventListener('resize', calcDropdownPos);
	}

	function closeDropdown() {
		open = false;
		query = '';
		activeIdx = -1;
		window.removeEventListener('scroll', calcDropdownPos, true);
		window.removeEventListener('resize', calcDropdownPos);
	}

	function pick(m: MarketEntry) {
		dispatch('select', { market: m });
		closeDropdown();
	}

	function onKeydown(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIdx = Math.min(activeIdx + 1, filtered.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIdx = Math.max(activeIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (activeIdx >= 0 && filtered[activeIdx]) pick(filtered[activeIdx]);
		} else if (e.key === 'Escape') {
			closeDropdown();
			inputEl?.blur();
		}
	}

	function onDocClick(e: MouseEvent) {
		if (!open || !wrapEl) return;
		const target = e.target as Node;
		const portalEl = document.getElementById('market-search-portal');
		if (!wrapEl.contains(target) && !portalEl?.contains(target)) closeDropdown();
	}

	$: if (typeof document !== 'undefined') {
		if (open) document.addEventListener('mousedown', onDocClick, true);
		else document.removeEventListener('mousedown', onDocClick, true);
	}

	onDestroy(() => {
		if (typeof window === 'undefined') return;
		document.removeEventListener('mousedown', onDocClick, true);
		window.removeEventListener('scroll', calcDropdownPos, true);
		window.removeEventListener('resize', calcDropdownPos);
	});
</script>

<div class="market-search" bind:this={wrapEl}>
	<div class="market-search-input-wrap" class:open>
		<span class="market-search-icon">⌕</span>
		<input
			bind:this={inputEl}
			type="text"
			class="market-search-input"
			placeholder="Search market…"
			autocomplete="off"
			spellcheck="false"
			bind:value={query}
			on:focus={openDropdown}
			on:input={() => { open = true; calcDropdownPos(); activeIdx = -1; }}
			on:keydown={onKeydown}
		/>
		<span class="market-search-active">{selectedSymbol}</span>
	</div>
</div>

{#if open}
	<div
		id="market-search-portal"
		class="market-search-dropdown"
		style="top:{dropTop}px; left:{dropLeft}px; min-width:{dropWidth}px;"
	>
		<div class="cat-tabs">
			{#each FILTER_OPTIONS as c}
				<button
					type="button"
					class="cat-tab"
					class:active={filterCat === c}
					on:mousedown|preventDefault={() => (filterCat = c)}
				>
					{c.toUpperCase()}
				</button>
			{/each}
		</div>

		{#if filtered.length === 0}
			<div class="empty">No markets match.</div>
		{:else}
			{#each filtered as m, i (m.symbol)}
				<button
					type="button"
					class="market-search-option"
					class:active={m.symbol === selectedSymbol}
					class:highlighted={i === activeIdx}
					on:mousedown|preventDefault={() => pick(m)}
				>
					<span class="opt-cat opt-cat-{m.category}">{m.category[0].toUpperCase()}</span>
					<span class="opt-sym">{m.symbol}</span>
					<span class="opt-label">{m.label}</span>
					<span class="opt-pair">/ {m.quote}</span>
				</button>
			{/each}
		{/if}
	</div>
{/if}

<style>
	.market-search {
		position: relative;
		flex: 0 0 auto;
		display: flex;
		align-items: center;
	}

	.market-search-input-wrap {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		background: #000;
		border: 1px solid #333;
		transition: border-color 0.15s ease;
		min-width: 200px;
	}

	.market-search-input-wrap.open {
		border-color: #ff5a00;
	}

	.market-search-icon {
		color: #555;
		font-size: 13px;
		flex-shrink: 0;
	}

	.market-search-input {
		background: transparent;
		border: none;
		outline: none;
		color: #ccc;
		font-family: 'Courier New', 'Lucida Console', monospace;
		font-size: 12px;
		font-weight: bold;
		letter-spacing: 0.04em;
		width: 100px;
	}

	.market-search-input::placeholder {
		color: #444;
		font-weight: normal;
	}

	.market-search-active {
		color: #00ff00;
		font-family: 'Courier New', 'Lucida Console', monospace;
		font-size: 12px;
		font-weight: bold;
		letter-spacing: 0.04em;
		flex-shrink: 0;
	}

	:global(.market-search-dropdown) {
		position: fixed;
		z-index: 12000;
		background: #0a0a0a;
		border: 1px solid #333;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8);
		max-height: 340px;
		overflow-y: auto;
		scrollbar-width: thin;
		scrollbar-color: #ff5a00 #111;
	}

	:global(.market-search-dropdown::-webkit-scrollbar) { width: 5px; }
	:global(.market-search-dropdown::-webkit-scrollbar-track) { background: #111; }
	:global(.market-search-dropdown::-webkit-scrollbar-thumb) { background: #ff5a00; }

	:global(.cat-tabs) {
		display: flex;
		gap: 2px;
		padding: 4px;
		background: #050505;
		border-bottom: 1px solid #222;
		position: sticky;
		top: 0;
		z-index: 1;
	}
	:global(.cat-tab) {
		flex: 1;
		background: transparent;
		border: 1px solid #222;
		color: #666;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: bold;
		padding: 4px 6px;
		cursor: pointer;
		letter-spacing: 0.08em;
	}
	:global(.cat-tab:hover) { color: #ccc; }
	:global(.cat-tab.active) { color: #ff5a00; border-color: #ff5a00; }

	:global(.empty) {
		padding: 16px;
		color: #555;
		font-family: 'Courier New', monospace;
		font-size: 12px;
		text-align: center;
	}

	:global(.market-search-option) {
		display: grid;
		grid-template-columns: 18px 70px 1fr auto;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 12px;
		border: none;
		background: transparent;
		color: #ccc;
		font-family: 'Courier New', 'Lucida Console', monospace;
		font-size: 12px;
		font-weight: bold;
		text-align: left;
		cursor: pointer;
	}

	:global(.market-search-option:hover),
	:global(.market-search-option.highlighted) {
		background: rgba(255, 90, 0, 0.1);
		color: #fff;
	}

	:global(.market-search-option.active) {
		color: #ff5a00;
		background: rgba(255, 90, 0, 0.06);
	}

	:global(.opt-cat) {
		display: inline-block;
		width: 16px;
		height: 16px;
		border-radius: 2px;
		text-align: center;
		line-height: 16px;
		font-size: 9px;
		font-weight: bold;
	}
	:global(.opt-cat-crypto) { background: rgba(255, 90, 0, 0.2); color: #ff5a00; }
	:global(.opt-cat-traditional) { background: rgba(0, 200, 255, 0.15); color: #00c8ff; }
	:global(.opt-cat-prediction) { background: rgba(0, 255, 100, 0.15); color: #00ff64; }

	:global(.opt-sym) { font-size: 12px; }
	:global(.opt-label) { font-size: 11px; color: #777; font-weight: normal; }
	:global(.opt-pair) { font-size: 10px; font-weight: normal; color: #555; }
</style>
