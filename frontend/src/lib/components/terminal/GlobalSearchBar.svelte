<script lang="ts">
	import { createEventDispatcher, onDestroy } from 'svelte';
	import { MARKETS_BY_CATEGORY, type MarketEntry } from '$lib/markets';
	import { polymarketClient, type PolyEvent } from '$lib/polymarket';

	type Hit =
		| { kind: 'market'; entry: MarketEntry }
		| { kind: 'event'; event: PolyEvent };

	const dispatch = createEventDispatcher<{
		selectMarket: MarketEntry;
		selectEvent: PolyEvent;
	}>();

	let query = '';
	let open = false;
	let searching = false;
	let marketHits: MarketEntry[] = [];
	let eventHits: PolyEvent[] = [];
	let activeIndex = -1;
	let inputEl: HTMLInputElement | null = null;
	let containerEl: HTMLDivElement | null = null;

	let cachedEvents: PolyEvent[] | null = null;
	let cachedAt = 0;
	const CACHE_MS = 60_000;

	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	$: flatHits = ([] as Hit[])
		.concat(marketHits.map((entry) => ({ kind: 'market' as const, entry })))
		.concat(eventHits.map((event) => ({ kind: 'event' as const, event })));

	async function loadAllEvents(): Promise<PolyEvent[]> {
		const now = Date.now();
		if (cachedEvents && now - cachedAt < CACHE_MS) return cachedEvents;
		const events = await polymarketClient.searchAllEvents(300);
		cachedEvents = events;
		cachedAt = now;
		return events;
	}

	function filterMarkets(q: string): MarketEntry[] {
		const needle = q.toLowerCase();
		const all = [
			...MARKETS_BY_CATEGORY.crypto,
			...MARKETS_BY_CATEGORY.traditional
		];
		return all
			.filter(
				(m) =>
					m.symbol.toLowerCase().includes(needle) ||
					m.label.toLowerCase().includes(needle) ||
					m.sub.toLowerCase().includes(needle)
			)
			.slice(0, 8);
	}

	function filterEvents(events: PolyEvent[], q: string): PolyEvent[] {
		const needle = q.toLowerCase();
		return events
			.filter((event) => {
				if (event.title?.toLowerCase().includes(needle)) return true;
				if (event.subtitle?.toLowerCase().includes(needle)) return true;
				return event.markets?.some((m) => m.question?.toLowerCase().includes(needle));
			})
			.slice(0, 12);
	}

	async function runSearch(q: string) {
		if (!q.trim()) {
			marketHits = [];
			eventHits = [];
			searching = false;
			activeIndex = -1;
			return;
		}
		searching = true;
		marketHits = filterMarkets(q);
		try {
			const events = await loadAllEvents();
			if (q !== query) return;
			eventHits = filterEvents(events, q);
		} catch (err) {
			console.warn('global search events failed', err);
			eventHits = [];
		} finally {
			if (q === query) searching = false;
			activeIndex = flatHits.length > 0 ? 0 : -1;
		}
	}

	function onInput() {
		open = true;
		if (searchTimer) clearTimeout(searchTimer);
		const snap = query;
		searchTimer = setTimeout(() => runSearch(snap), 200);
	}

	function pickHit(hit: Hit) {
		if (hit.kind === 'market') dispatch('selectMarket', hit.entry);
		else dispatch('selectEvent', hit.event);
		close();
	}

	function close() {
		open = false;
		query = '';
		marketHits = [];
		eventHits = [];
		activeIndex = -1;
	}

	function onKey(e: KeyboardEvent) {
		if (!open) return;
		if (e.key === 'Escape') {
			close();
			inputEl?.blur();
			return;
		}
		const hits = flatHits;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			activeIndex = Math.min(activeIndex + 1, hits.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
		} else if (e.key === 'Enter') {
			if (activeIndex >= 0 && hits[activeIndex]) {
				e.preventDefault();
				pickHit(hits[activeIndex]);
			}
		}
	}

	function handleDocClick(e: MouseEvent) {
		if (!containerEl) return;
		if (!containerEl.contains(e.target as Node)) open = false;
	}

	if (typeof window !== 'undefined') {
		window.addEventListener('mousedown', handleDocClick);
	}
	onDestroy(() => {
		if (typeof window !== 'undefined') {
			window.removeEventListener('mousedown', handleDocClick);
		}
		if (searchTimer) clearTimeout(searchTimer);
	});

	function fmtVol(v: number | undefined): string {
		if (!v) return '';
		if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
		if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
		return `$${v.toFixed(0)}`;
	}

	function cents(p: number | undefined): string {
		return ((p ?? 0) * 100).toFixed(0);
	}

	function topMarketPrice(ev: PolyEvent): number {
		const m = ev.markets?.slice().sort((a, b) => (b.yesPrice ?? 0) - (a.yesPrice ?? 0))[0];
		return m?.yesPrice ?? 0;
	}
</script>

<div class="gsb" bind:this={containerEl}>
	<div class="gsb-input-wrap" class:focused={open}>
		<span class="gsb-icon">⌕</span>
		<input
			bind:this={inputEl}
			bind:value={query}
			on:input={onInput}
			on:focus={() => (open = true)}
			on:keydown={onKey}
			type="text"
			placeholder="Search markets · crypto · stocks · prediction"
			class="gsb-input"
			autocomplete="off"
			spellcheck="false"
		/>
		{#if query}
			<button class="gsb-clear" on:click={close} aria-label="Clear search">×</button>
		{/if}
	</div>

	{#if open && query}
		<div class="gsb-dropdown">
			{#if searching && flatHits.length === 0}
				<div class="gsb-loading">
					<div class="gsb-spinner"></div>
					<span>Searching…</span>
				</div>
			{:else if flatHits.length === 0}
				<div class="gsb-empty">No matches for "{query}"</div>
			{:else}
				{#if marketHits.length > 0}
					<div class="gsb-section-label">Markets</div>
					{#each marketHits as entry, i}
						{@const idx = i}
						<button
							class="gsb-row"
							class:active={activeIndex === idx}
							on:click={() => pickHit({ kind: 'market', entry })}
							on:mouseenter={() => (activeIndex = idx)}
						>
							<span class="gsb-tag gsb-tag-{entry.category}">{entry.category === 'crypto' ? 'CRYPTO' : entry.sub.toUpperCase()}</span>
							<span class="gsb-sym">{entry.symbol}</span>
							<span class="gsb-name">{entry.label}</span>
							<span class="gsb-quote">· {entry.quote}</span>
						</button>
					{/each}
				{/if}

				{#if eventHits.length > 0}
					<div class="gsb-section-label">Prediction events</div>
					{#each eventHits as event, i}
						{@const idx = marketHits.length + i}
						<button
							class="gsb-row gsb-event-row"
							class:active={activeIndex === idx}
							on:click={() => pickHit({ kind: 'event', event })}
							on:mouseenter={() => (activeIndex = idx)}
						>
							<span class="gsb-tag gsb-tag-prediction">PRED</span>
							{#if event.image}
								<img src={event.image} alt="" class="gsb-img" />
							{/if}
							<span class="gsb-ev-title">{event.title}</span>
							<span class="gsb-ev-price">{cents(topMarketPrice(event))}¢</span>
							{#if event.volume}
								<span class="gsb-ev-vol">{fmtVol(event.volume)}</span>
							{/if}
						</button>
					{/each}
				{/if}

				{#if searching}
					<div class="gsb-foot">
						<div class="gsb-spinner"></div>
						<span>Still searching…</span>
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.gsb {
		position: relative;
		flex: 1;
		min-width: 220px;
		max-width: 560px;
		font-family: 'Courier New', monospace;
	}
	.gsb-input-wrap {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #000;
		border: 1px solid #222;
		border-radius: 8px;
		padding: 0 10px;
		transition: border-color 0.15s;
	}
	.gsb-input-wrap.focused { border-color: #ff5a00; }
	.gsb-icon { color: #666; font-size: 14px; }
	.gsb-input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #fff;
		padding: 8px 4px;
		font-family: inherit;
		font-size: 12px;
		letter-spacing: 0.03em;
		min-width: 0;
	}
	.gsb-input::placeholder { color: #fff; opacity: 0.75; }
	.gsb-clear {
		background: transparent;
		border: none;
		color: #666;
		font-size: 16px;
		cursor: pointer;
		padding: 2px 6px;
		line-height: 1;
	}
	.gsb-clear:hover { color: #ff5a00; }

	.gsb-dropdown {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		right: 0;
		background: #050505;
		border: 1px solid #1f1f1f;
		border-radius: 8px;
		max-height: 440px;
		overflow-y: auto;
		z-index: 1000;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
	}
	.gsb-section-label {
		padding: 8px 12px 4px;
		font-size: 9px;
		font-weight: 900;
		letter-spacing: 0.14em;
		color: #ff5a00;
		text-transform: uppercase;
		background: #050505;
		position: sticky;
		top: 0;
		z-index: 1;
		border-bottom: 1px solid #141414;
	}
	.gsb-row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		background: transparent;
		border: none;
		border-bottom: 1px solid #111;
		color: #ccc;
		padding: 9px 12px;
		cursor: pointer;
		text-align: left;
		font-family: inherit;
		font-size: 11px;
	}
	.gsb-row.active { background: rgba(255, 90, 0, 0.08); }
	.gsb-row:hover { background: rgba(255, 90, 0, 0.06); }
	.gsb-tag {
		font-size: 9px;
		font-weight: 900;
		letter-spacing: 0.1em;
		padding: 2px 6px;
		border-radius: 4px;
		background: #111;
		color: #888;
		flex-shrink: 0;
	}
	.gsb-tag-crypto { background: rgba(255, 90, 0, 0.15); color: #ff5a00; }
	.gsb-tag-traditional { background: rgba(59, 130, 246, 0.15); color: #3b82f6; }
	.gsb-tag-prediction { background: rgba(0, 255, 100, 0.12); color: #00ff64; }
	.gsb-sym {
		color: #eaecef;
		font-weight: 900;
		font-size: 12px;
		min-width: 54px;
	}
	.gsb-name {
		color: #aaa;
		flex: 1;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.gsb-quote { color: #555; font-size: 10px; }

	.gsb-event-row .gsb-img {
		width: 20px;
		height: 20px;
		border-radius: 4px;
		object-fit: cover;
		flex-shrink: 0;
	}
	.gsb-ev-title {
		flex: 1;
		color: #eaecef;
		font-weight: 700;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.gsb-ev-price {
		color: #00ff64;
		font-weight: 900;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.gsb-ev-vol {
		color: #888;
		font-size: 10px;
		font-variant-numeric: tabular-nums;
	}

	.gsb-empty,
	.gsb-loading {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 18px;
		color: #666;
		font-size: 11px;
	}
	.gsb-foot {
		display: flex;
		align-items: center;
		gap: 8px;
		justify-content: center;
		padding: 8px;
		font-size: 10px;
		color: #666;
		border-top: 1px solid #111;
	}
	.gsb-spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #222;
		border-top-color: #ff5a00;
		border-radius: 50%;
		animation: gsb-spin 0.7s linear infinite;
	}
	@keyframes gsb-spin { to { transform: rotate(360deg); } }

	@media (max-width: 640px) {
		.gsb { max-width: none; }
		.gsb-name { display: none; }
	}
</style>
