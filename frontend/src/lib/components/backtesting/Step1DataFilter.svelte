<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	const LIMIT_NUMBER = 5_000_000;

	type Source = 'Polymarket' | 'Crypto' | 'CryptoMinute' | 'Stocks' | 'Forex' | 'ForexMinute' | 'StocksMinute';

	interface Market {
		source: Source;
		market: string;
		path_count: number;
		paths: string[];
	}

	interface PreviewResult {
		total_rows: number;
		returned_rows: number;
		columns: string[];
		rows: Record<string, unknown>[];
	}

	let { onNext, onBack, backtestType }: {
		onNext: (paths: string[], previewData: PreviewResult | null, startDate: string | null, endDate: string | null) => void;
		onBack: () => void;
		backtestType: 'highfrequency' | 'longrun';
	} = $props();

	const SOURCES_BY_TYPE: Record<'highfrequency' | 'longrun', Source[]> = {
		highfrequency: ['Polymarket', 'Crypto', 'Stocks', 'Forex'],
		longrun:       ['Polymarket', 'CryptoMinute', 'ForexMinute', 'StocksMinute'],
	};

	const sources = $derived(SOURCES_BY_TYPE[backtestType]);
	let activeSource: Source = $state(backtestType === 'longrun' ? 'CryptoMinute' : 'Crypto');
	let searchQuery = $state('');
	let searchTimer: ReturnType<typeof setTimeout> | null = null;

	let markets: Market[] = $state([]);
	let marketsLoading = $state(false);
	let marketsError = $state('');

	// Selected: market.market → all its paths
	let selectedPaths = $state<Set<string>>(new Set());
	let selectedMarketKeys = $state<Set<string>>(new Set());

	let rowCount: number | null = $state(null);
	let rowCountLoading = $state(false);
	let rowCountError = $state('');

	let previewData: PreviewResult | null = $state(null);
	let previewLoading = $state(false);
	let previewError = $state('');

	let proceedChecking = $state(false);

	// Date range (optional — affects row count and preview)
	let startDate = $state('');
	let endDate = $state('');

	// Derived list of all selected paths
	const allSelectedPaths = $derived(Array.from(selectedPaths));
	const overLimit = $derived(rowCount !== null && rowCount > LIMIT_NUMBER);

	function dateParams() {
		return {
			...(startDate.trim() ? { start_date: startDate.trim() } : {}),
			...(endDate.trim() ? { end_date: endDate.trim() } : {})
		};
	}

	// Sources with too many entries to load without a search term
	const SEARCH_REQUIRED: Source[] = ['Polymarket', 'Stocks', 'StocksMinute'];
	const FETCH_TIMEOUT_MS = 15_000;

	function needsSearchQuery(): boolean {
		return SEARCH_REQUIRED.includes(activeSource) && searchQuery.trim().length < 2;
	}

	async function fetchMarkets() {
		if (needsSearchQuery()) {
			markets = [];
			marketsLoading = false;
			marketsError = '';
			return;
		}

		marketsLoading = true;
		marketsError = '';
		markets = [];

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

		try {
			const params = new URLSearchParams({ source: activeSource });
			if (searchQuery.trim()) params.set('q', searchQuery.trim());
			const res = await fetch(`/api/backtest/markets?${params}`, { signal: controller.signal });
			const data = await res.json();
			if (!res.ok) throw new Error(extractEngineError(data, res.status));
			markets = data.markets ?? [];
		} catch (err: unknown) {
			if ((err as { name?: string }).name === 'AbortError') {
				marketsError = 'Request timed out — the engine may be starting up, try again.';
			} else {
				marketsError = err instanceof Error ? err.message : String(err);
			}
		} finally {
			clearTimeout(timer);
			marketsLoading = false;
		}
	}

	function handleSourceChange(s: Source) {
		activeSource = s;
		searchQuery = '';
		fetchMarkets();
	}

	function handleSearchInput(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		if (searchTimer) clearTimeout(searchTimer);
		searchTimer = setTimeout(() => fetchMarkets(), 350);
	}

	function parquetPaths(m: Market): string[] {
		return m.paths.filter((p) => p.endsWith('.parquet'));
	}

	function toggleMarket(m: Market) {
		const validPaths = parquetPaths(m);
		if (validPaths.length === 0) return; // market has no resolvable parquet files — ignore click
		const key = `${m.source}::${m.market}`;
		const newKeys = new Set(selectedMarketKeys);
		const newPaths = new Set(selectedPaths);
		if (newKeys.has(key)) {
			newKeys.delete(key);
			for (const p of validPaths) newPaths.delete(p);
		} else {
			newKeys.add(key);
			for (const p of validPaths) newPaths.add(p);
		}
		selectedMarketKeys = newKeys;
		selectedPaths = newPaths;
		// reset derived state
		rowCount = null;
		previewData = null;
		rowCountError = '';
		previewError = '';
	}

	function isSelected(m: Market): boolean {
		return selectedMarketKeys.has(`${m.source}::${m.market}`);
	}

	function isSelectable(m: Market): boolean {
		return parquetPaths(m).length > 0;
	}

	function extractEngineError(data: Record<string, unknown>, status: number): string {
		if (typeof data.error === 'string') return data.error;
		if (data.detail) {
			if (typeof data.detail === 'string') return data.detail;
			if (Array.isArray(data.detail)) return (data.detail as { msg?: string }[]).map((e) => e.msg ?? '').filter(Boolean).join('; ');
		}
		return `Engine returned status ${status}`;
	}

	async function fetchRowCount(): Promise<number> {
		const rcRes = await fetch('/api/backtest/row-count', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ paths: allSelectedPaths, ...dateParams() })
		});
		const rcData = await rcRes.json();
		if (!rcRes.ok) throw new Error(extractEngineError(rcData, rcRes.status));
		return rcData.total_rows as number;
	}

	async function visualizeData() {
		if (allSelectedPaths.length === 0) return;
		rowCountLoading = true;
		rowCountError = '';
		previewError = '';
		previewData = null;
		rowCount = null;

		try {
			rowCount = await fetchRowCount();
			rowCountLoading = false;

			if (rowCount <= LIMIT_NUMBER) {
				previewLoading = true;
				const pvRes = await fetch('/api/backtest/preview', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ paths: allSelectedPaths, ...dateParams() })
				});
				const pvData = await pvRes.json();
				if (!pvRes.ok) throw new Error(extractEngineError(pvData, pvRes.status));
				previewData = pvData;
				previewLoading = false;
			}
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			rowCountLoading = false;
			previewLoading = false;
			if (rowCount === null) rowCountError = msg;
			else previewError = msg;
		}
	}

	async function proceed() {
		if (allSelectedPaths.length === 0) return;
		proceedChecking = true;
		try {
			rowCount = await fetchRowCount();
			if (rowCount > LIMIT_NUMBER) return; // overLimit message already shown
			onNext(allSelectedPaths, previewData, startDate.trim() || null, endDate.trim() || null);
		} catch (err: unknown) {
			rowCountError = err instanceof Error ? err.message : String(err);
		} finally {
			proceedChecking = false;
		}
	}

	function fmtRows(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
		return String(n);
	}

	// Initial load
	fetchMarkets();
</script>

<div class="step1">
	<!-- Left: market browser -->
	<aside class="left">
		<div class="left-head">
			<button class="back-btn" onclick={onBack}>← Change type</button>
			<span class="section-label">STEP 1 · SELECT DATA</span>
		</div>

		<!-- Source tabs -->
		<div class="source-tabs">
			{#each sources as s}
				<button
					class="source-tab"
					class:active={s === activeSource}
					onclick={() => handleSourceChange(s)}
				>{s}</button>
			{/each}
		</div>

		<!-- Search -->
		<div class="search-wrap">
			<input
				class="search"
				type="text"
				placeholder={SEARCH_REQUIRED.includes(activeSource) ? `Search ${activeSource} markets (min. 2 chars)…` : `Search ${activeSource} markets…`}
				value={searchQuery}
				oninput={handleSearchInput}
			/>
		</div>

		<!-- Market list -->
		<div class="market-list">
			{#if marketsLoading}
				<div class="state-msg">Loading markets...</div>
			{:else if needsSearchQuery()}
				<div class="state-msg dim">Type at least 2 characters to search {activeSource} markets.</div>
			{:else if marketsError}
				<div class="state-msg error">{marketsError}</div>
			{:else if markets.length === 0}
				<div class="state-msg dim">No markets found.</div>
			{:else}
				{#each markets as m}
					<button
						class="market-item"
						class:selected={isSelected(m)}
						class:unavailable={!isSelectable(m)}
						onclick={() => toggleMarket(m)}
						title={!isSelectable(m) ? 'No direct .parquet files available for this market' : ''}
					>
						<span class="market-name">{m.market}</span>
						<span class="market-meta">
							{#if !isSelectable(m)}
								unavailable
							{:else}
								{parquetPaths(m).length} file{parquetPaths(m).length !== 1 ? 's' : ''}
							{/if}
						</span>
					</button>
				{/each}
			{/if}
		</div>
	</aside>

	<!-- Right: selection + preview -->
	<section class="right">
		<div class="right-head">
			<span class="section-label">SELECTED DATA</span>
			<div class="head-actions">
				<div class="date-filters">
					<label class="date-label">
						<span>Start date</span>
						<input class="date-input" type="text" placeholder="YYYY-MM-DD" bind:value={startDate}
							oninput={() => { rowCount = null; previewData = null; }} />
					</label>
					<label class="date-label">
						<span>End date</span>
						<input class="date-input" type="text" placeholder="YYYY-MM-DD" bind:value={endDate}
							oninput={() => { rowCount = null; previewData = null; }} />
					</label>
				</div>
				<button
					class="btn visualize"
					onclick={visualizeData}
					disabled={allSelectedPaths.length === 0 || rowCountLoading || previewLoading}
				>
					{rowCountLoading || previewLoading ? 'Loading...' : 'Visualize data'}
				</button>
				<button
					class="btn proceed"
					onclick={proceed}
					disabled={allSelectedPaths.length === 0 || overLimit || proceedChecking}
				>
					{proceedChecking ? 'Checking...' : 'Continue to strategy →'}
				</button>
			</div>
		</div>

		<!-- Selection summary -->
		<div class="summary">
			{#if selectedMarketKeys.size === 0}
				<p class="dim">No markets selected. Pick one or more from the list on the left.</p>
			{:else}
				<div class="chips">
					{#each Array.from(selectedMarketKeys) as key}
						<span class="chip">{key.split('::')[1]}</span>
					{/each}
				</div>
				<div class="path-count">{allSelectedPaths.length} parquet file{allSelectedPaths.length !== 1 ? 's' : ''} selected</div>
			{/if}

			{#if rowCount !== null}
				{#if overLimit}
					<div class="over-limit-msg">
						The selected markets contain <strong>{rowCount.toLocaleString()}</strong> trades in total,
						the current limit is <strong>{LIMIT_NUMBER.toLocaleString()}</strong>.
						Please remove some markets to continue.
					</div>
				{:else}
					<div class="row-count-ok">
						<span class="rc-label">Row count:</span>
						<span class="rc-val">{rowCount.toLocaleString()}</span>
					</div>
				{/if}
			{/if}
			{#if rowCountError}
				<div class="err-msg">{rowCountError}</div>
			{/if}
		</div>

		<!-- Preview table -->
		{#if previewLoading}
			<div class="preview-state">Loading preview...</div>
		{:else if previewError}
			<div class="preview-state error">{previewError}</div>
		{:else if previewData}
			<div class="preview-wrap">
				<div class="preview-meta">
					Showing {previewData.returned_rows} of {fmtRows(previewData.total_rows)} rows
				</div>
				<div class="table-scroll">
					<table class="preview-tbl">
						<thead>
							<tr>
								{#each previewData.columns as col}
									<th>{col}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each previewData.rows as row}
								<tr>
									{#each previewData.columns as col}
										<td>{row[col] ?? ''}</td>
									{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</div>
		{:else if allSelectedPaths.length > 0}
			<div class="preview-state dim">Click "Visualize data" to preview the first 100 rows.</div>
		{/if}
	</section>
</div>

<style>
	.step1 {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 300px 1fr;
		background: #000;
		overflow: hidden;
	}

	/* Left */
	.left {
		border-right: 1px solid #1a1a1a;
		background: #060606;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.left-head {
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.back-btn {
		background: transparent;
		border: 1px solid #333;
		color: #bdbdbd;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-family: 'Share Tech Mono', monospace;
		cursor: pointer;
		white-space: nowrap;
	}
	.back-btn:hover { border-color: rgba(255, 149, 0, 0.5); color: #ff9500; }
	.section-label {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.12em;
		font-size: 11px;
		color: #ff9500;
	}

	.source-tabs {
		display: flex;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}
	.source-tab {
		flex: 1;
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		color: #777;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		letter-spacing: 0.08em;
		padding: 8px 4px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s;
	}
	.source-tab.active {
		color: #ff9500;
		border-bottom-color: #ff9500;
	}
	.source-tab:hover:not(.active) { color: #ccc; }

	.search-wrap {
		padding: 8px 10px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}
	.search {
		width: 100%;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 8px;
		padding: 7px 10px;
		color: #e8e8e8;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		outline: none;
		box-sizing: border-box;
	}
	.search:focus { border-color: rgba(255,149,0,0.5); }
	.search::placeholder { color: #444; }

	.market-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		scrollbar-width: thin;
		scrollbar-color: rgba(255,149,0,0.3) transparent;
	}
	.market-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: #0a0a0a;
		border: 1px solid #1c1c1c;
		border-radius: 8px;
		padding: 8px 10px;
		cursor: pointer;
		text-align: left;
		color: #e8e8e8;
		transition: border-color 0.12s, background 0.12s;
	}
	.market-item:hover:not(.unavailable) { border-color: #333; background: #111; }
	.market-item.selected { border-color: rgba(255,149,0,0.6); background: rgba(255,149,0,0.05); }
	.market-item.unavailable { opacity: 0.35; cursor: not-allowed; }
	.market-name { font-size: 12px; font-weight: 600; }
	.market-meta { font-size: 10px; color: #555; font-family: 'Share Tech Mono', monospace; }
	.market-item.selected .market-meta { color: rgba(255,149,0,0.6); }

	.state-msg { padding: 14px 8px; font-size: 12px; color: #666; font-family: 'Share Tech Mono', monospace; }
	.state-msg.error { color: #ef5350; }
	.state-msg.dim { color: #444; }

	/* Right */
	.right {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.right-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-bottom: 1px solid #1a1a1a;
		background: #000;
		flex-shrink: 0;
		gap: 10px;
	}
	.head-actions { display: flex; align-items: flex-end; gap: 8px; flex-wrap: wrap; }
	.date-filters { display: flex; gap: 8px; }
	.date-label {
		display: flex;
		flex-direction: column;
		gap: 3px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #666;
	}
	.date-input {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8e8;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		outline: none;
		width: 110px;
	}
	.date-input:focus { border-color: rgba(255,149,0,0.4); }
	.date-input::placeholder { color: #444; }

	.btn {
		background: #111;
		border: 1px solid #333;
		color: #e8e8e8;
		padding: 7px 12px;
		border-radius: 8px;
		font-size: 12px;
		cursor: pointer;
		font-family: 'Share Tech Mono', monospace;
		transition: border-color 0.12s;
	}
	.btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn.visualize:not(:disabled):hover { border-color: rgba(255,255,255,0.3); }
	.btn.proceed {
		background: linear-gradient(180deg, rgba(249,115,22,0.95), rgba(249,115,22,0.72));
		border-color: rgba(249,115,22,0.6);
		color: #000;
		font-weight: 700;
	}
	.btn.proceed:not(:disabled):hover { filter: brightness(1.1); }

	.summary {
		padding: 12px 14px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.dim { color: #555; font-size: 12px; font-family: 'Share Tech Mono', monospace; margin: 0; }
	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip {
		background: rgba(255,149,0,0.1);
		border: 1px solid rgba(255,149,0,0.4);
		border-radius: 999px;
		padding: 3px 10px;
		font-size: 11px;
		font-family: 'Share Tech Mono', monospace;
		color: #ff9500;
	}
	.path-count { font-size: 11px; color: #666; font-family: 'Share Tech Mono', monospace; }

	.row-count-ok {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
	}
	.rc-label { color: #666; }
	.rc-val { color: #26a65b; font-weight: 700; }

	.over-limit-msg {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #ef5350;
		line-height: 1.5;
		padding: 8px 10px;
		background: rgba(239, 83, 80, 0.08);
		border: 1px solid rgba(239, 83, 80, 0.3);
		border-radius: 6px;
	}
	.over-limit-msg strong { color: #ff6b6b; }

	.err-msg { color: #ef5350; font-size: 11px; font-family: 'Share Tech Mono', monospace; }

	.preview-state {
		padding: 20px 14px;
		font-size: 12px;
		font-family: 'Share Tech Mono', monospace;
		color: #555;
	}
	.preview-state.error { color: #ef5350; }
	.preview-state.dim { color: #444; }

	.preview-wrap {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.preview-meta {
		padding: 6px 14px;
		font-size: 10px;
		font-family: 'Share Tech Mono', monospace;
		color: #555;
		border-bottom: 1px solid #111;
		flex-shrink: 0;
	}
	.table-scroll {
		flex: 1;
		overflow: auto;
		scrollbar-width: thin;
		scrollbar-color: rgba(255,149,0,0.3) transparent;
	}
	.preview-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 11px;
		font-family: 'Share Tech Mono', monospace;
	}
	.preview-tbl th {
		position: sticky;
		top: 0;
		background: #000;
		color: #ff9500;
		padding: 8px 10px;
		text-align: left;
		border-bottom: 1px solid #1a1a1a;
		letter-spacing: 0.06em;
		white-space: nowrap;
	}
	.preview-tbl td {
		padding: 6px 10px;
		border-bottom: 1px solid rgba(255,255,255,0.04);
		color: #bdbdbd;
		white-space: nowrap;
	}
	.preview-tbl tbody tr:hover td { background: rgba(255,255,255,0.02); }

	@media (max-width: 900px) {
		.step1 { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
		.left { border-right: none; border-bottom: 1px solid #1a1a1a; max-height: 260px; }
	}
</style>
