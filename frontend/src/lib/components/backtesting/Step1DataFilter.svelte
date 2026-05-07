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

	let selectedPaths = $state<Set<string>>(new Set());
	let selectedMarketKeys = $state<Set<string>>(new Set());

	let rowCount: number | null = $state(null);
	let rowCountLoading = $state(false);
	let rowCountError = $state('');

	let previewData: PreviewResult | null = $state(null);
	let previewLoading = $state(false);
	let previewError = $state('');

	let proceedChecking = $state(false);

	// Date range — today is always the max allowed date
	const today = new Date().toISOString().slice(0, 10);
	const MAX_DATE = today;
	let startDate = $state('');
	let endDate = $state('');

	const allSelectedPaths = $derived(Array.from(selectedPaths));
	const overLimit = $derived(rowCount !== null && rowCount > LIMIT_NUMBER);
	const isVisualizing = $derived(rowCountLoading || previewLoading);

	function dateParams() {
		return {
			...(startDate.trim() ? { start_date: startDate.trim() } : {}),
			...(endDate.trim()   ? { end_date:   endDate.trim()   } : {})
		};
	}

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
		if (validPaths.length === 0) return;
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
		rowCount = null;
		previewData = null;
		rowCountError = '';
		previewError = '';
	}

	function removeMarketByKey(key: string) {
		const m = markets.find((x) => `${x.source}::${x.market}` === key);
		if (m) { toggleMarket(m); return; }
		// fallback: just drop the key + matching paths
		const newKeys = new Set(selectedMarketKeys); newKeys.delete(key);
		selectedMarketKeys = newKeys;
		selectedPaths = new Set(Array.from(selectedPaths).filter((p) => !p.includes(key.split('::')[1])));
		rowCount = null; previewData = null;
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
			if (rowCount > LIMIT_NUMBER) return;
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

	// Auto-fit: shrink the date range proportionally to bring rowCount under the limit.
	function autoFitDateRange() {
		if (rowCount === null || rowCount <= LIMIT_NUMBER) return;
		const factor = (LIMIT_NUMBER / rowCount) * 0.9; // 10% safety margin

		const end = endDate.trim() ? new Date(endDate.trim()) : new Date(today);
		let start: Date;
		if (startDate.trim()) {
			const curStart = new Date(startDate.trim());
			const ms = end.getTime() - curStart.getTime();
			start = new Date(end.getTime() - ms * factor);
		} else {
			// no start date set — assume ~5 years of historical data as a starting point
			const fallbackMs = 5 * 365 * 24 * 3600 * 1000;
			start = new Date(end.getTime() - fallbackMs * factor);
		}
		startDate = start.toISOString().slice(0, 10);
		endDate = end.toISOString().slice(0, 10);
		rowCount = null;
		previewData = null;
		// re-run visualization with the new range
		visualizeData();
	}

	function clearSelection() {
		selectedMarketKeys = new Set();
		selectedPaths = new Set();
		rowCount = null;
		previewData = null;
	}

	const STEPS = [
		{ id: 1, label: 'Granularity', active: false, done: true  },
		{ id: 2, label: 'Data',        active: true,  done: false },
		{ id: 3, label: 'Strategy',    active: false, done: false },
		{ id: 4, label: 'Results',     active: false, done: false }
	];

	fetchMarkets();
</script>

<div class="step1">
	<!-- Top bar with stepper + actions -->
	<header class="topbar">
		<button class="back-btn" onclick={onBack}>← Granularity</button>

		<div class="stepper">
			{#each STEPS as s, i}
				<div class="step" class:active={s.active} class:done={s.done}>
					<span class="step-num">{s.done ? '✓' : s.id}</span>
					<span class="step-name">{s.label}</span>
				</div>
				{#if i < STEPS.length - 1}<span class="step-bar" class:done={s.done}></span>{/if}
			{/each}
		</div>

		<button
			class="btn proceed"
			onclick={proceed}
			disabled={allSelectedPaths.length === 0 || overLimit || proceedChecking}
		>
			{proceedChecking ? 'Checking...' : 'Continue →'}
		</button>
	</header>

	<div class="body">
		<!-- Left: market browser -->
		<aside class="left">
			<div class="left-head">
				<span class="section-label">Markets · <span class="muted">{backtestType === 'longrun' ? 'long-run' : 'high-frequency'}</span></span>
			</div>

			<div class="source-tabs">
				{#each sources as s}
					<button
						class="source-tab"
						class:active={s === activeSource}
						onclick={() => handleSourceChange(s)}
					>{s}</button>
				{/each}
			</div>

			<div class="search-wrap">
				<svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<circle cx="11" cy="11" r="7"/>
					<path d="m21 21-4.3-4.3"/>
				</svg>
				<input
					class="search"
					type="text"
					placeholder={SEARCH_REQUIRED.includes(activeSource) ? `Search ${activeSource} (min. 2 chars)…` : `Search ${activeSource}…`}
					value={searchQuery}
					oninput={handleSearchInput}
				/>
			</div>

			<div class="market-list">
				{#if marketsLoading}
					<div class="state-msg"><span class="dot-spinner"></span> Loading markets…</div>
				{:else if needsSearchQuery()}
					<div class="state-msg dim">Type at least 2 characters to search {activeSource}.</div>
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
							<span class="check" aria-hidden="true">{isSelected(m) ? '✓' : ''}</span>
							<span class="market-name">{m.market}</span>
							<span class="market-meta">
								{#if !isSelectable(m)}unavailable
								{:else}{parquetPaths(m).length} file{parquetPaths(m).length !== 1 ? 's' : ''}{/if}
							</span>
						</button>
					{/each}
				{/if}
			</div>
		</aside>

		<!-- Right: selection + preview -->
		<section class="right">
			<!-- Date filters -->
			<div class="filters-row">
				<div class="filter-group">
					<div class="filter-head">
						<span class="filter-label">Time range</span>
						<span class="filter-hint">Optional · max {MAX_DATE}</span>
					</div>
					<div class="dates">
						<label class="date-label">
							<span>From</span>
							<input
								class="date-input"
								type="date"
								max={MAX_DATE}
								bind:value={startDate}
								oninput={() => { rowCount = null; previewData = null; }}
							/>
						</label>
						<span class="date-arrow">→</span>
						<label class="date-label">
							<span>To</span>
							<input
								class="date-input"
								type="date"
								max={MAX_DATE}
								bind:value={endDate}
								oninput={() => { rowCount = null; previewData = null; }}
							/>
						</label>
						{#if startDate || endDate}
							<button class="clear-link" onclick={() => { startDate = ''; endDate = ''; rowCount = null; previewData = null; }}>
								clear
							</button>
						{/if}
					</div>
				</div>

				<div class="filter-actions">
					<button
						class="btn visualize"
						onclick={visualizeData}
						disabled={allSelectedPaths.length === 0 || isVisualizing}
					>
						{#if isVisualizing}
							<span class="dot-spinner small"></span> Loading…
						{:else}
							Visualize data
						{/if}
					</button>
				</div>
			</div>

			<!-- Selection summary -->
			<div class="summary">
				<div class="summary-line">
					<span class="summary-count">{selectedMarketKeys.size}</span>
					<span class="summary-text">market{selectedMarketKeys.size !== 1 ? 's' : ''} selected</span>
					{#if allSelectedPaths.length > 0}
						<span class="summary-sep">·</span>
						<span class="summary-files">{allSelectedPaths.length} parquet file{allSelectedPaths.length !== 1 ? 's' : ''}</span>
					{/if}
					{#if selectedMarketKeys.size > 0}
						<button class="clear-all" onclick={clearSelection}>clear all</button>
					{/if}
				</div>

				{#if selectedMarketKeys.size > 0}
					<div class="chips">
						{#each Array.from(selectedMarketKeys) as key}
							<span class="chip">
								{key.split('::')[1]}
								<button class="chip-x" onclick={() => removeMarketByKey(key)} aria-label="Remove">×</button>
							</span>
						{/each}
					</div>
				{/if}

				{#if rowCount !== null && !overLimit}
					<div class="row-count-ok">
						<span class="rc-label">Total rows:</span>
						<span class="rc-val">{rowCount.toLocaleString()}</span>
						<span class="rc-bar-wrap" title="{Math.round((rowCount / LIMIT_NUMBER) * 100)}% of {LIMIT_NUMBER.toLocaleString()} limit">
							<span class="rc-bar" style="width: {Math.min(100, (rowCount / LIMIT_NUMBER) * 100)}%"></span>
						</span>
					</div>
				{/if}

				{#if rowCountError}
					<div class="err-msg">{rowCountError}</div>
				{/if}
			</div>

			<!-- Over-limit banner -->
			{#if overLimit && rowCount !== null}
				<div class="over-limit">
					<div class="over-limit-head">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
							<path d="M12 9v4M12 17h.01"/>
							<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
						</svg>
						<div>
							<div class="ol-title">Selection exceeds the {fmtRows(LIMIT_NUMBER)} row limit</div>
							<div class="ol-sub">{rowCount.toLocaleString()} rows · {Math.round((rowCount / LIMIT_NUMBER) * 100)}% over limit</div>
						</div>
					</div>
					<div class="ol-bar-wrap">
						<span class="ol-bar" style="width: 100%"></span>
						<span class="ol-bar-mark" style="left: {Math.min(99, (LIMIT_NUMBER / rowCount) * 100)}%" title="Limit"></span>
					</div>
					<div class="ol-actions">
						<button class="btn fix" onclick={autoFitDateRange}>
							✦ Auto-fit date range
						</button>
						<span class="ol-or">or</span>
						<span class="ol-suggest">remove markets · narrow your time range</span>
					</div>
				</div>
			{/if}

			<!-- Preview area -->
			<div class="preview-area">
				{#if isVisualizing}
					<div class="loader-overlay">
						<div class="loader">
							<svg viewBox="0 0 50 50">
								<circle cx="25" cy="25" r="20" fill="none" stroke="#1a1a1a" stroke-width="3"/>
								<circle cx="25" cy="25" r="20" fill="none" stroke="#ff5a00" stroke-width="3"
									stroke-dasharray="31.4 94.2" stroke-linecap="round" class="loader-arc"/>
							</svg>
							<div class="loader-label">{rowCountLoading ? 'Counting rows…' : 'Loading preview…'}</div>
						</div>
					</div>
				{:else if previewError}
					<div class="state-msg error pad">{previewError}</div>
				{:else if previewData}
					<div class="preview-meta">
						<span>Preview · first {previewData.returned_rows} of {fmtRows(previewData.total_rows)} rows</span>
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
				{:else if allSelectedPaths.length > 0}
					<div class="empty-preview">
						<div class="empty-illu">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
								<path d="M3 3h18v18H3z"/>
								<path d="M3 9h18M9 3v18"/>
							</svg>
						</div>
						<div class="empty-title">Click <strong>Visualize data</strong> to preview the first 100 rows.</div>
						<div class="empty-sub">{allSelectedPaths.length} parquet file{allSelectedPaths.length !== 1 ? 's' : ''} ready</div>
					</div>
				{:else}
					<div class="empty-preview">
						<div class="empty-illu">
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
								<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
							</svg>
						</div>
						<div class="empty-title">Pick markets from the list to start.</div>
						<div class="empty-sub">You can select multiple sources and refine with a date range.</div>
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>

<style>
	.step1 {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: #000;
		overflow: hidden;
	}

	/* Top bar */
	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 10px 16px;
		border-bottom: 1px solid #1a1a1a;
		background: rgba(8,8,8,0.85);
		backdrop-filter: blur(6px);
		gap: 14px;
		flex-shrink: 0;
	}
	.back-btn {
		background: transparent;
		border: 1px solid #2a2a2a;
		color: #bdbdbd;
		padding: 6px 12px;
		border-radius: 8px;
		font-size: 11px;
		font-family: 'Share Tech Mono', monospace;
		cursor: pointer;
		white-space: nowrap;
	}
	.back-btn:hover { border-color: rgba(255, 90, 0, 0.5); color: #ff5a00; }

	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		justify-content: center;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 7px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #555;
	}
	.step-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px; height: 18px;
		border-radius: 50%;
		border: 1px solid #2a2a2a;
		font-size: 10px;
		color: #555;
		background: #050505;
	}
	.step.active { color: #ff5a00; }
	.step.active .step-num {
		border-color: rgba(255,90,0,0.55);
		color: #ff5a00;
		background: rgba(255,90,0,0.08);
		box-shadow: 0 0 10px rgba(255,90,0,0.25);
	}
	.step.done { color: #777; }
	.step.done .step-num {
		border-color: #26a65b;
		color: #26a65b;
		background: rgba(38,166,91,0.06);
	}
	.step-bar { width: 18px; height: 1px; background: #1f1f1f; }
	.step-bar.done { background: #26a65b55; }

	.btn {
		background: #111;
		border: 1px solid #2a2a2a;
		color: #e8e8e8;
		padding: 7px 14px;
		border-radius: 8px;
		font-size: 12px;
		cursor: pointer;
		font-family: 'Share Tech Mono', monospace;
		transition: border-color 0.12s, filter 0.12s, background 0.12s;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}
	.btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn.visualize:not(:disabled):hover { border-color: rgba(255,255,255,0.3); background: #161616; }
	.btn.proceed {
		background: linear-gradient(180deg, rgba(255, 90, 0, 0.95), rgba(255, 90, 0, 0.72));
		border-color: rgba(255, 90, 0, 0.6);
		color: #000;
		font-weight: 700;
	}
	.btn.proceed:not(:disabled):hover { filter: brightness(1.1); }
	.btn.fix {
		background: rgba(255,90,0,0.1);
		border-color: rgba(255,90,0,0.4);
		color: #ff5a00;
	}
	.btn.fix:hover { background: rgba(255,90,0,0.18); }

	/* Body grid */
	.body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 320px 1fr;
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
		padding: 12px 14px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}
	.section-label {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.1em;
		font-size: 11px;
		color: #ff5a00;
	}
	.muted { color: #555; }
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
		letter-spacing: 0.06em;
		padding: 9px 4px;
		cursor: pointer;
		transition: color 0.15s, border-color 0.15s, background 0.12s;
	}
	.source-tab.active {
		color: #ff5a00;
		border-bottom-color: #ff5a00;
		background: rgba(255,90,0,0.04);
	}
	.source-tab:hover:not(.active) { color: #ccc; background: rgba(255,255,255,0.02); }

	.search-wrap {
		padding: 8px 10px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
		position: relative;
	}
	.search-icon {
		position: absolute;
		left: 18px; top: 50%;
		transform: translateY(-50%);
		width: 12px; height: 12px;
		color: #555;
		pointer-events: none;
	}
	.search {
		width: 100%;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 8px;
		padding: 7px 10px 7px 28px;
		color: #e8e8e8;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		outline: none;
		box-sizing: border-box;
	}
	.search:focus { border-color: rgba(255, 90, 0,0.5); }
	.search::placeholder { color: #444; }

	.market-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 90, 0,0.3) transparent;
	}
	.market-item {
		display: grid;
		grid-template-columns: 20px 1fr auto;
		align-items: center;
		gap: 8px;
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
	.market-item.selected {
		border-color: rgba(255, 90, 0,0.55);
		background: rgba(255, 90, 0,0.06);
	}
	.market-item.unavailable { opacity: 0.35; cursor: not-allowed; }
	.check {
		width: 16px; height: 16px;
		border-radius: 4px;
		border: 1px solid #2a2a2a;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		font-size: 10px;
		color: #ff5a00;
	}
	.market-item.selected .check {
		background: #ff5a00;
		border-color: #ff5a00;
		color: #000;
	}
	.market-name { font-size: 12px; font-weight: 600; }
	.market-meta { font-size: 10px; color: #555; font-family: 'Share Tech Mono', monospace; }
	.market-item.selected .market-meta { color: rgba(255, 90, 0,0.7); }

	.state-msg {
		padding: 14px 12px;
		font-size: 12px;
		color: #666;
		font-family: 'Share Tech Mono', monospace;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.state-msg.error { color: #ef5350; }
	.state-msg.dim { color: #444; }
	.state-msg.pad { padding: 24px; }

	.dot-spinner {
		display: inline-block;
		width: 10px; height: 10px;
		border-radius: 50%;
		border: 2px solid rgba(255,90,0,0.25);
		border-top-color: #ff5a00;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}
	.dot-spinner.small { width: 9px; height: 9px; border-width: 2px; }
	@keyframes spin { to { transform: rotate(360deg); } }

	/* Right */
	.right {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	/* Filters row */
	.filters-row {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 14px;
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		background: #050505;
		flex-shrink: 0;
		flex-wrap: wrap;
	}
	.filter-group { display: flex; flex-direction: column; gap: 6px; }
	.filter-head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.filter-label {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #bdbdbd;
		letter-spacing: 0.06em;
	}
	.filter-hint {
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #555;
	}
	.dates {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.date-label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 9px;
		color: #555;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.date-input {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8e8;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		outline: none;
		min-width: 140px;
		color-scheme: dark;
	}
	.date-input:focus { border-color: rgba(255, 90, 0,0.5); }
	.date-arrow {
		color: #444;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		padding-top: 16px;
	}
	.clear-link {
		background: transparent;
		border: none;
		color: #666;
		font-size: 10px;
		font-family: 'Share Tech Mono', monospace;
		text-decoration: underline;
		cursor: pointer;
		padding-top: 16px;
	}
	.clear-link:hover { color: #ff5a00; }

	.filter-actions { display: flex; align-items: flex-end; }

	/* Summary */
	.summary {
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.summary-line {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
	}
	.summary-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(255,90,0,0.1);
		border: 1px solid rgba(255,90,0,0.3);
		color: #ff5a00;
		font-weight: 700;
		font-size: 11px;
	}
	.summary-text { color: #ccc; }
	.summary-sep { color: #2a2a2a; }
	.summary-files { color: #777; }
	.clear-all {
		margin-left: auto;
		background: transparent;
		border: none;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #555;
		text-decoration: underline;
		cursor: pointer;
	}
	.clear-all:hover { color: #ef5350; }

	.chips { display: flex; flex-wrap: wrap; gap: 6px; }
	.chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: rgba(255, 90, 0,0.08);
		border: 1px solid rgba(255, 90, 0,0.35);
		border-radius: 999px;
		padding: 3px 4px 3px 10px;
		font-size: 11px;
		font-family: 'Share Tech Mono', monospace;
		color: #ff5a00;
	}
	.chip-x {
		background: transparent;
		border: none;
		color: #ff5a00;
		font-size: 14px;
		line-height: 1;
		cursor: pointer;
		padding: 0 6px;
		border-radius: 999px;
		opacity: 0.6;
	}
	.chip-x:hover { opacity: 1; background: rgba(255,90,0,0.15); }

	.row-count-ok {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
	}
	.rc-label { color: #666; }
	.rc-val { color: #26a65b; font-weight: 700; }
	.rc-bar-wrap {
		flex: 1;
		max-width: 240px;
		height: 4px;
		background: #131313;
		border-radius: 999px;
		overflow: hidden;
		position: relative;
	}
	.rc-bar {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, #26a65b, #4dd587);
		border-radius: 999px;
		transition: width 0.4s ease;
	}

	.err-msg { color: #ef5350; font-size: 11px; font-family: 'Share Tech Mono', monospace; }

	/* Over-limit banner */
	.over-limit {
		margin: 12px 16px 0;
		padding: 14px 16px;
		background: linear-gradient(180deg, rgba(239,83,80,0.06), rgba(239,83,80,0.02));
		border: 1px solid rgba(239,83,80,0.35);
		border-radius: 10px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.over-limit-head {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.over-limit-head svg {
		width: 22px; height: 22px;
		color: #ef5350;
		flex-shrink: 0;
	}
	.ol-title {
		font-family: 'Share Tech Mono', monospace;
		font-size: 13px;
		color: #ff8a8a;
		letter-spacing: 0.02em;
	}
	.ol-sub {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #888;
		margin-top: 2px;
	}
	.ol-bar-wrap {
		position: relative;
		height: 6px;
		background: #131313;
		border-radius: 999px;
		overflow: hidden;
	}
	.ol-bar {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, #ef5350, #ff8a8a);
		border-radius: 999px;
	}
	.ol-bar-mark {
		position: absolute;
		top: -3px;
		bottom: -3px;
		width: 2px;
		background: #ff5a00;
		box-shadow: 0 0 6px rgba(255,90,0,0.6);
	}
	.ol-actions {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}
	.ol-or {
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.ol-suggest {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #888;
	}

	/* Preview area */
	.preview-area {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		position: relative;
		overflow: hidden;
	}
	.preview-meta {
		padding: 8px 16px;
		font-size: 10px;
		font-family: 'Share Tech Mono', monospace;
		color: #666;
		border-bottom: 1px solid #111;
		flex-shrink: 0;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.loader-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0,0,0,0.6);
		backdrop-filter: blur(2px);
		z-index: 5;
	}
	.loader {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
	}
	.loader svg { width: 44px; height: 44px; }
	.loader-arc {
		transform-origin: center;
		animation: spin 1s linear infinite;
	}
	.loader-label {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #ff5a00;
		letter-spacing: 0.1em;
	}

	.empty-preview {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		padding: 40px 20px;
		text-align: center;
	}
	.empty-illu {
		width: 48px; height: 48px;
		border-radius: 12px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(255,90,0,0.04);
		border: 1px solid #1a1a1a;
		color: #444;
		margin-bottom: 4px;
	}
	.empty-illu svg { width: 24px; height: 24px; }
	.empty-title {
		font-family: 'Share Tech Mono', monospace;
		font-size: 13px;
		color: #888;
	}
	.empty-title strong { color: #ff5a00; font-weight: 600; }
	.empty-sub {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #555;
	}

	.table-scroll {
		flex: 1;
		overflow: auto;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 90, 0,0.3) transparent;
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
		color: #ff5a00;
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
		.body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
		.left { border-right: none; border-bottom: 1px solid #1a1a1a; max-height: 280px; }
		.step-name { display: none; }
	}
</style>
