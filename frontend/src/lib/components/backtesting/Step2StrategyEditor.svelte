<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import type * as MonacoType from 'monaco-editor';
	import { strategiesForType, type Strategy } from './strategies/index';

	interface PreviewResult {
		total_rows: number;
		returned_rows: number;
		columns: string[];
		rows: Record<string, unknown>[];
	}

	interface RunPayload {
		paths: string[];
		strategy_code: string;
		initial_capital: number;
		start_date: string | null;
		end_date: string | null;
	}

	let {
		paths,
		previewData,
		startDate,
		endDate,
		backtestType,
		onBack,
		onRun
	}: {
		paths: string[];
		previewData: PreviewResult | null;
		startDate: string | null;
		endDate: string | null;
		backtestType: 'highfrequency' | 'longrun';
		onBack: () => void;
		onRun: (payload: RunPayload) => void;
	} = $props();

	const FIRST_LINE = 'def strategy(row, portfolio, user_perso_parameter):';
	const LAST_LINE = '  return signal, user_perso_parameter';

	const DEFAULT_BODY = `  # ─── HashFox Strategy Sandbox ──────────────────────────────────────────
  #
  # Each tick, the engine calls your function with:
  #
  #   row["price"]      float  — last traded price
  #   row["market"]     str    — market name, e.g. "BTCUSDT"
  #   row["qty"]     float  — tick volume
  #   row["timestamp"]  int    — Unix ms  →  divide by 1000 for seconds
  #
  #   portfolio.cash            — available cash
  #   portfolio.positions       — {market: quantity} open positions
  #   portfolio.latest_prices   — last seen price per market
  #   portfolio.equity_curve    — portfolio value history (list of floats)
  #
  #   user_perso_parameter      — your persistent state across ticks
  #                               starts as None on the first tick
  #
  # Return:
  #   signal = {"action": "BUY" | "SELL" | "HOLD", "quantity": float}
  #   Updated user_perso_parameter
  #
  # No imports allowed in the sandbox.
  # ─── Select a strategy from the panel on the right, or write your own ──

  signal = {"action": "HOLD", "quantity": 0.0}`;

	let strategyBody = $state(DEFAULT_BODY);
	let initialCapital = $state(10000);
	let previewOpen = $state(true);
	let selectedStrategyId = $state<string | null>(null);

	const strategies = $derived(strategiesForType(backtestType));

	// Status bar state
	let cursorLine = $state(1);
	let cursorCol = $state(1);
	let markerCount = $state(0);
	let lastRunBody = $state('');
	const isDirty = $derived(strategyBody !== lastRunBody);

	// Monaco
	let editorContainer: HTMLDivElement | undefined = $state();
	let editor: MonacoType.editor.IStandaloneCodeEditor | null = null;
	let monacoRef: typeof MonacoType | null = null;
	let diagnosticTimer: ReturnType<typeof setTimeout> | null = null;
	const disposables: MonacoType.IDisposable[] = [];

	onMount(async () => {
		if (!browser || !editorContainer) return;

		// Set up workers before Monaco loads — Vite statically resolves `new URL(…, import.meta.url)`
		(self as unknown as Record<string, unknown>).MonacoEnvironment = {
			getWorker(_moduleId: string, _label: string) {
				return new Worker(
					new URL('monaco-editor/esm/vs/editor/editor.worker', import.meta.url),
					{ type: 'module' }
				);
			}
		};

		const monaco = await import('monaco-editor');
		monacoRef = monaco;

		// ── Theme ──────────────────────────────────────────────────────────────
		monaco.editor.defineTheme('hashfox-dark', {
			base: 'vs-dark',
			inherit: true,
			rules: [
				{ token: 'keyword', foreground: 'c792ea' },
				{ token: 'keyword.control.import', foreground: 'ef5350' },
				{ token: 'string', foreground: '98c379' },
				{ token: 'string.escape', foreground: '56b6c2' },
				{ token: 'comment', foreground: '4a5160', fontStyle: 'italic' },
				{ token: 'number', foreground: 'f78c6c' },
				{ token: 'delimiter', foreground: 'abb2bf' },
				{ token: 'identifier', foreground: 'e8e8e8' },
				{ token: 'type.identifier', foreground: 'ffcb6b' },
				{ token: 'variable', foreground: 'e8e8e8' },
				{ token: 'operator', foreground: '89ddff' },
				{ token: 'function', foreground: '82aaff' },
				{ token: 'decorator', foreground: 'ff9500' },
			],
			colors: {
				'editor.background': '#040404',
				'editor.foreground': '#e8e8e8',
				'editor.lineHighlightBackground': '#0d0d0d',
				'editor.lineHighlightBorder': '#00000000',
				'editor.selectionBackground': '#ff5a0030',
				'editor.inactiveSelectionBackground': '#ff5a0018',
				'editor.findMatchBackground': '#ff5a0044',
				'editor.findMatchHighlightBackground': '#ff5a0022',
				'editorCursor.foreground': '#ff5a00',
				'editorCursor.background': '#040404',
				'editorLineNumber.foreground': '#2e3440',
				'editorLineNumber.activeForeground': '#ff5a00',
				'editorWhitespace.foreground': '#1e1e1e',
				'editorIndentGuide.background1': '#161616',
				'editorIndentGuide.activeBackground1': '#2a2a2a',
				'editorBracketMatch.background': '#ff5a0018',
				'editorBracketMatch.border': '#ff5a0055',
				'editorBracketHighlight.foreground1': '#ff5a00',
				'editorBracketHighlight.foreground2': '#82aaff',
				'editorBracketHighlight.foreground3': '#c3e88d',
				'editorGutter.background': '#040404',
				'editorStickyScroll.background': '#060606',
				'editorStickyScrollHover.background': '#0d0d0d',
				'minimap.background': '#040404',
				'minimap.selectionHighlight': '#ff5a0044',
				'scrollbarSlider.background': '#ff5a0018',
				'scrollbarSlider.hoverBackground': '#ff5a0038',
				'scrollbarSlider.activeBackground': '#ff5a0055',
				'editorWidget.background': '#0d0d0d',
				'editorWidget.border': '#1a1a1a',
				'editorSuggestWidget.background': '#0d0d0d',
				'editorSuggestWidget.border': '#1a1a1a',
				'editorSuggestWidget.foreground': '#e8e8e8',
				'editorSuggestWidget.selectedBackground': '#ff5a0022',
				'editorSuggestWidget.selectedForeground': '#e8e8e8',
				'editorSuggestWidget.highlightForeground': '#ff5a00',
				'editorSuggestWidget.focusHighlightForeground': '#ff5a00',
				'editorHoverWidget.background': '#0d0d0d',
				'editorHoverWidget.border': '#1a1a1a',
				'editorHoverWidget.foreground': '#e8e8e8',
				'input.background': '#0a0a0a',
				'input.border': '#222222',
				'input.foreground': '#e8e8e8',
				'focusBorder': '#ff5a0055',
				'list.hoverBackground': '#ff5a0010',
				'list.activeSelectionBackground': '#ff5a0022',
				'list.inactiveSelectionBackground': '#ff5a0010',
			}
		} as MonacoType.editor.IStandaloneThemeData);

		// ── Completion provider ────────────────────────────────────────────────
		const ROW_FIELDS = [
			{ label: '"price"',     detail: '(float) Last traded price at this tick.',                     doc: 'Last traded price.' },
			{ label: '"market"',    detail: '(str) Market identifier, e.g. "BTC/USD".',                    doc: 'Market identifier.' },
			{ label: '"volume"',    detail: '(float) Tick volume.',                                         doc: 'Tick volume.' },
			{ label: '"side"',      detail: '(str) "buy" or "sell" — original trade direction.',            doc: '"buy" or "sell".' },
			{ label: '"timestamp"', detail: '(int) Unix timestamp in milliseconds.',                        doc: 'Unix ms timestamp — divide by 1000 for seconds.' },
		];
		const PORTFOLIO_FIELDS = [
			{ label: 'cash',           detail: '(float) Available cash.',                                  doc: 'Available cash in the portfolio.' },
			{ label: 'positions',      detail: '(dict) Open positions: {market: quantity}.',               doc: 'Currently open positions.' },
			{ label: 'latest_prices',  detail: '(dict) Most recent price per market.',                     doc: 'Last seen price for every market loaded.' },
			{ label: 'equity_curve',   detail: '(list[float]) Portfolio value at each tick so far.',       doc: 'Running equity curve.' },
		];
		const SNIPPETS = [
			{
				label: 'cooldown-buy',
				detail: 'Snippet: DCA with cooldown',
				insertText: [
					'if user_perso_parameter is None:',
					'  user_perso_parameter = {"last_buy_ts": 0, "budget_per_buy": 100.0}',
					'',
					'COOLDOWN = 30 * 24 * 3600  # 30 days in seconds',
					'ts_sec = row["timestamp"] / 1000',
					'signal = {"action": "HOLD", "quantity": 0.0}',
					'',
					'if ts_sec - user_perso_parameter["last_buy_ts"] >= COOLDOWN:',
					'  budget = user_perso_parameter["budget_per_buy"]',
					'  cost = row["price"] * 1.001',
					'  if portfolio.cash >= cost:',
					'    quantity = min(budget, portfolio.cash) / cost',
					'    signal = {"action": "BUY", "quantity": quantity}',
					'    user_perso_parameter["last_buy_ts"] = ts_sec',
				].join('\n'),
			},
			{
				label: 'ma-crossover',
				detail: 'Snippet: Moving average crossover',
				insertText: [
					'if user_perso_parameter is None:',
					'  user_perso_parameter = {"prices": []}',
					'',
					'user_perso_parameter["prices"].append(row["price"])',
					'prices = user_perso_parameter["prices"]',
					'signal = {"action": "HOLD", "quantity": 0.0}',
					'',
					'if len(prices) >= 10:',
					'  ma10 = sum(prices[-10:]) / 10',
					'  held = portfolio.positions.get(row["market"], 0.0)',
					'  if row["price"] > ma10 and held == 0 and portfolio.cash >= row["price"] * 1.001:',
					'    signal = {"action": "BUY", "quantity": 1.0}',
					'  elif row["price"] < ma10 and held > 0:',
					'    signal = {"action": "SELL", "quantity": held}',
				].join('\n'),
			},
			{
				label: 'trailing-stop',
				detail: 'Snippet: Trailing stop',
				insertText: [
					'if user_perso_parameter is None:',
					'  user_perso_parameter = {"entry_price": None, "peak": None}',
					'',
					'signal = {"action": "HOLD", "quantity": 0.0}',
					'held = portfolio.positions.get(row["market"], 0.0)',
					'',
					'if held == 0 and portfolio.cash >= row["price"] * 1.001:',
					'  signal = {"action": "BUY", "quantity": 1.0}',
					'  user_perso_parameter["entry_price"] = row["price"]',
					'  user_perso_parameter["peak"] = row["price"]',
					'elif held > 0:',
					'  user_perso_parameter["peak"] = max(user_perso_parameter["peak"], row["price"])',
					'  stop = user_perso_parameter["peak"] * 0.95  # 5% trailing stop',
					'  if row["price"] < stop:',
					'    signal = {"action": "SELL", "quantity": held}',
					'    user_perso_parameter["entry_price"] = None',
					'    user_perso_parameter["peak"] = None',
				].join('\n'),
			},
			{
				label: 'init-state',
				detail: 'Snippet: Initialize user_perso_parameter',
				insertText: [
					'if user_perso_parameter is None:',
					'  user_perso_parameter = {}',
				].join('\n'),
			},
		];

		disposables.push(
			monaco.languages.registerCompletionItemProvider('python', {
				triggerCharacters: ['.', '['],
				provideCompletionItems(model, position) {
					const lineText = model.getLineContent(position.lineNumber);
					const before = lineText.substring(0, position.column - 1);
					const wordInfo = model.getWordUntilPosition(position);
					const replaceRange = new monaco.Range(
						position.lineNumber, wordInfo.startColumn,
						position.lineNumber, wordInfo.endColumn
					);
					const insertRange = new monaco.Range(
						position.lineNumber, position.column,
						position.lineNumber, position.column
					);

					const suggestions: MonacoType.languages.CompletionItem[] = [];

					if (before.endsWith('row[')) {
						for (const f of ROW_FIELDS) {
							suggestions.push({
								label: f.label,
								kind: monaco.languages.CompletionItemKind.Field,
								detail: f.detail,
								documentation: { value: f.doc },
								insertText: f.label,
								range: insertRange,
							});
						}
					} else if (before.endsWith('portfolio.')) {
						for (const f of PORTFOLIO_FIELDS) {
							suggestions.push({
								label: f.label,
								kind: monaco.languages.CompletionItemKind.Field,
								detail: f.detail,
								documentation: { value: f.doc },
								insertText: f.label,
								range: insertRange,
							});
						}
					} else {
						// General snippets
						for (const s of SNIPPETS) {
							suggestions.push({
								label: s.label,
								kind: monaco.languages.CompletionItemKind.Snippet,
								detail: s.detail,
								insertText: s.insertText,
								insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
								range: replaceRange,
							});
						}
					}

					return { suggestions };
				}
			})
		);

		// ── Hover provider ─────────────────────────────────────────────────────
		disposables.push(
			monaco.languages.registerHoverProvider('python', {
				provideHover(model, position) {
					const word = model.getWordAtPosition(position);
					if (!word) return null;

					if (word.word === 'row') {
						return {
							contents: [
								{ value: '**`row`** — current market tick (dict-like)' },
								{ value: '| Key | Type | Description |\n|---|---|---|\n| `row["price"]` | `float` | Last traded price |\n| `row["market"]` | `str` | Market identifier |\n| `row["volume"]` | `float` | Tick volume |\n| `row["side"]` | `str` | `"buy"` or `"sell"` |\n| `row["timestamp"]` | `int` | Unix ms — divide by 1000 for seconds |' },
							]
						};
					}
					if (word.word === 'portfolio') {
						return {
							contents: [
								{ value: '**`portfolio`** — current portfolio state' },
								{ value: '| Attribute | Type | Description |\n|---|---|---|\n| `portfolio.cash` | `float` | Available cash |\n| `portfolio.positions` | `dict` | `{market: quantity}` |\n| `portfolio.latest_prices` | `dict` | Last price per market |\n| `portfolio.equity_curve` | `list` | Portfolio value history |' },
							]
						};
					}
					if (word.word === 'user_perso_parameter') {
						return {
							contents: [
								{ value: '**`user_perso_parameter`** — your persistent state across ticks' },
								{ value: 'Starts as `None` on the first row. Whatever you return is passed back on the next tick.\n\n```python\nif user_perso_parameter is None:\n    user_perso_parameter = {}\n```' },
							]
						};
					}
					if (word.word === 'signal') {
						return {
							contents: [
								{ value: '**`signal`** — trade instruction to return' },
								{ value: '```python\nsignal = {\n    "action": "BUY",   # "BUY" | "SELL" | "HOLD"\n    "quantity": 1.0,   # units (ignored for HOLD)\n    # "market": "AAPL"  # optional, defaults to row["market"]\n}\n```' },
							]
						};
					}
					return null;
				}
			})
		);

		// ── Create editor ──────────────────────────────────────────────────────
		editor = monaco.editor.create(editorContainer!, {
			value: strategyBody,
			language: 'python',
			theme: 'hashfox-dark',
			fontFamily: "'Fira Code', 'JetBrains Mono', 'Cascadia Code', ui-monospace, monospace",
			fontLigatures: true,
			fontSize: 13,
			lineHeight: 22,
			minimap: { enabled: true, renderCharacters: false },
			smoothScrolling: true,
			cursorBlinking: 'smooth',
			cursorSmoothCaretAnimation: 'on',
			renderWhitespace: 'selection',
			bracketPairColorization: { enabled: true },
			guides: { bracketPairs: true, indentation: true },
			stickyScroll: { enabled: true },
			scrollBeyondLastLine: false,
			padding: { top: 12, bottom: 12 },
			automaticLayout: true,
			tabSize: 2,
			insertSpaces: true,
			wordWrap: 'off',
			scrollbar: {
				verticalScrollbarSize: 8,
				horizontalScrollbarSize: 8,
			},
			suggest: {
				showSnippets: true,
				showFields: true,
				showKeywords: true,
			},
			quickSuggestions: { other: true, comments: false, strings: true },
			quickSuggestionsDelay: 80,
			acceptSuggestionOnEnter: 'smart',
		});

		// Listen for content changes
		disposables.push(
			editor.onDidChangeModelContent(() => {
				strategyBody = editor!.getValue();
				scheduleDiagnostics();
			})
		);

		// Listen for cursor position
		disposables.push(
			editor.onDidChangeCursorPosition((e) => {
				cursorLine = e.position.lineNumber;
				cursorCol = e.position.column;
			})
		);

		// Initial diagnostics run
		scheduleDiagnostics();
	});

	onDestroy(() => {
		for (const d of disposables) d.dispose();
		editor?.dispose();
		editor = null;
		monacoRef = null;
		if (diagnosticTimer) clearTimeout(diagnosticTimer);
	});

	function scheduleDiagnostics() {
		if (diagnosticTimer) clearTimeout(diagnosticTimer);
		diagnosticTimer = setTimeout(runDiagnostics, 300);
	}

	function runDiagnostics() {
		if (!editor || !monacoRef) return;
		const model = editor.getModel();
		if (!model) return;

		const markers: MonacoType.editor.IMarkerData[] = [];
		const lines = model.getLinesContent();

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			const lineNum = i + 1;

			if (/^\s*(import\s|from\s+\S+\s+import)/.test(line)) {
				markers.push({
					severity: monacoRef.MarkerSeverity.Error,
					startLineNumber: lineNum,
					startColumn: 1,
					endLineNumber: lineNum,
					endColumn: line.length + 1,
					message: 'No imports allowed in the sandbox.',
					source: 'HashFox sandbox',
				});
			}

			const dunders = /__import__|__builtins__/g;
			let match;
			while ((match = dunders.exec(line)) !== null) {
				markers.push({
					severity: monacoRef.MarkerSeverity.Error,
					startLineNumber: lineNum,
					startColumn: match.index + 1,
					endLineNumber: lineNum,
					endColumn: match.index + match[0].length + 1,
					message: 'Disallowed in sandbox.',
					source: 'HashFox sandbox',
				});
			}
		}

		monacoRef.editor.setModelMarkers(model, 'hashfox-sandbox', markers);
		markerCount = markers.length;
	}

	function loadStrategy(s: Strategy) {
		selectedStrategyId = s.id;
		strategyBody = s.code;
		lastRunBody = '';
		if (editor) {
			editor.setValue(s.code);
			editor.focus();
		}
	}

	function normalizeTabs(code: string): string {
		return code
			.split('\n')
			.map((line) => line.replace(/^\t+/, (tabs) => '  '.repeat(tabs.length)))
			.join('\n');
	}

	function run() {
		lastRunBody = strategyBody;
		const strategy_code = `${FIRST_LINE}\n${normalizeTabs(strategyBody)}\n${LAST_LINE}`;
		onRun({ paths, strategy_code, initial_capital: initialCapital, start_date: startDate, end_date: endDate });
	}

	function fmtRows(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
		if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
		return String(n);
	}
</script>

<div class="step2">
	<!-- Left: data preview panel -->
	<aside class="left">
		<div class="left-head">
			<button class="back-btn" onclick={onBack}>← Back</button>
			<span class="section-label">DATA PREVIEW</span>
			<button class="toggle-btn" onclick={() => (previewOpen = !previewOpen)}>
				{previewOpen ? '▲' : '▼'}
			</button>
		</div>

		{#if previewOpen}
			{#if previewData}
				<div class="preview-meta">{previewData.returned_rows} rows · {fmtRows(previewData.total_rows)} total</div>
				<div class="preview-scroll">
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
			{:else}
				<div class="preview-empty">No preview — go back and click "Visualize data" first.</div>
			{/if}
		{/if}

		<div class="paths-info">
			<span class="pi-label">Paths:</span>
			<span class="pi-val">{paths.length} file{paths.length !== 1 ? 's' : ''}</span>
		</div>
	</aside>

	<!-- Right: strategy editor + gallery -->
	<section class="right">
		<div class="right-head">
			<span class="section-label">STEP 2 · WRITE STRATEGY</span>
			<button class="btn run" onclick={run}>Run Backtest →</button>
		</div>

		<div class="right-body">
			<!-- Editor column -->
			<div class="editor-col">
				<div class="editor-wrap">
					<!-- Fixed first line -->
					<div class="fixed-line first-line">{FIRST_LINE}</div>

					<!-- Monaco editor -->
					<div class="monaco-host" bind:this={editorContainer}></div>

					<!-- Fixed last line -->
					<div class="fixed-line last-line">{LAST_LINE}</div>

					<!-- Status bar -->
					<div class="status-bar">
						<span class="sb-item">Ln {cursorLine}, Col {cursorCol}</span>
						<span class="sb-sep">·</span>
						<span class="sb-item">Spaces: 2</span>
						<span class="sb-sep">·</span>
						<span class="sb-item sb-lang">Python · sandboxed</span>
						{#if markerCount > 0}
							<span class="sb-sep">·</span>
							<span class="sb-item sb-errors">⊘ {markerCount} error{markerCount !== 1 ? 's' : ''}</span>
						{/if}
						{#if isDirty}
							<span class="sb-dot"></span>
						{/if}
					</div>
				</div>

				<!-- Run parameters -->
				<div class="params">
					<div class="params-head">RUN PARAMETERS</div>
					<div class="params-grid">
						<label>
							<span>Initial capital ($)</span>
							<input type="number" min="1" bind:value={initialCapital} />
						</label>
						<div class="date-info">
							<span class="di-label">Date range</span>
							<span class="di-val">{startDate ?? 'all time'} → {endDate ?? 'all time'}</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Strategy gallery -->
			<aside class="gallery">
				<div class="gallery-head">POPULAR STRATEGIES</div>
				<div class="gallery-list">
					{#each strategies as s}
						<button
							class="strategy-card"
							class:active={selectedStrategyId === s.id}
							onclick={() => loadStrategy(s)}
						>
							<div class="sc-top">
								<span class="sc-name">{s.name}</span>
								<span class="sc-badge sc-badge--{s.difficulty.toLowerCase()}">{s.difficulty}</span>
							</div>
							<p class="sc-desc">{s.description}</p>
						</button>
					{/each}
				</div>
			</aside>
		</div>
	</section>
</div>

<style>
	.step2 {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 340px 1fr;
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
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
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
	}
	.back-btn:hover { border-color: rgba(255, 90, 0,0.5); color: #ff5a00; }
	.section-label {
		flex: 1;
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.1em;
		font-size: 10px;
		color: #ff5a00;
		text-align: center;
	}
	.toggle-btn {
		background: transparent;
		border: none;
		color: #555;
		font-size: 10px;
		cursor: pointer;
		padding: 2px 4px;
	}
	.preview-meta {
		padding: 5px 10px;
		font-size: 10px;
		font-family: 'Share Tech Mono', monospace;
		color: #555;
		border-bottom: 1px solid #111;
		flex-shrink: 0;
	}
	.preview-scroll {
		flex: 1;
		overflow: auto;
		min-height: 0;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 90, 0,0.25) transparent;
	}
	.preview-tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 10px;
		font-family: 'Share Tech Mono', monospace;
	}
	.preview-tbl th {
		position: sticky;
		top: 0;
		background: #060606;
		color: #ff5a00;
		padding: 6px 8px;
		text-align: left;
		border-bottom: 1px solid #1a1a1a;
		white-space: nowrap;
		letter-spacing: 0.05em;
	}
	.preview-tbl td {
		padding: 4px 8px;
		border-bottom: 1px solid rgba(255,255,255,0.03);
		color: #9a9a9a;
		white-space: nowrap;
	}
	.preview-empty {
		padding: 16px 12px;
		font-size: 11px;
		font-family: 'Share Tech Mono', monospace;
		color: #444;
	}
	.paths-info {
		padding: 8px 12px;
		border-top: 1px solid #1a1a1a;
		flex-shrink: 0;
		display: flex;
		gap: 6px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
	}
	.pi-label { color: #555; }
	.pi-val { color: #888; }

	/* Right */
	.right {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.right-body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 1fr 240px;
		overflow: hidden;
	}
	.editor-col {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
		border-right: 1px solid #1a1a1a;
	}

	/* Gallery */
	.gallery {
		background: #060606;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.gallery-head {
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a1a;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		letter-spacing: 0.12em;
		color: #ff5a00;
		flex-shrink: 0;
	}
	.gallery-list {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 90, 0,0.25) transparent;
	}
	.strategy-card {
		background: #0a0a0a;
		border: 1px solid #1c1c1c;
		border-radius: 8px;
		padding: 10px 12px;
		text-align: left;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 6px;
		transition: border-color 0.12s, background 0.12s;
		color: inherit;
	}
	.strategy-card:hover {
		border-color: #333;
		background: #111;
	}
	.strategy-card.active {
		border-color: rgba(255, 90, 0,0.55);
		background: rgba(255, 90, 0,0.04);
	}
	.sc-top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.sc-name {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #e8e8e8;
		line-height: 1.3;
	}
	.strategy-card.active .sc-name { color: #ff5a00; }
	.sc-badge {
		font-family: 'Share Tech Mono', monospace;
		font-size: 9px;
		padding: 2px 6px;
		border-radius: 999px;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.sc-badge--beginner     { background: rgba(38,166,91,0.12);  color: #26a65b; border: 1px solid rgba(38,166,91,0.3); }
	.sc-badge--intermediate { background: rgba(255, 90, 0,0.12);  color: #ff5a00; border: 1px solid rgba(255, 90, 0,0.3); }
	.sc-badge--advanced     { background: rgba(239,83,80,0.1);   color: #ef5350; border: 1px solid rgba(239,83,80,0.25); }
	.sc-desc {
		margin: 0;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #555;
		line-height: 1.5;
	}
	.strategy-card.active .sc-desc { color: #777; }

	.right-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-bottom: 1px solid #1a1a1a;
		background: #000;
		flex-shrink: 0;
	}
	.btn.run {
		background: linear-gradient(180deg, rgba(255, 90, 0, 0.95), rgba(255, 90, 0, 0.72));
		border: 1px solid rgba(255, 90, 0, 0.6);
		color: #000;
		font-weight: 700;
		padding: 7px 14px;
		border-radius: 8px;
		font-size: 12px;
		font-family: 'Share Tech Mono', monospace;
		cursor: pointer;
		letter-spacing: 0.05em;
	}
	.btn.run:hover { filter: brightness(1.08); }

	.editor-wrap {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.fixed-line {
		background: #040404;
		padding: 5px 14px 5px 74px; /* 74px aligns with Monaco's default gutter */
		font-family: 'Fira Code', 'JetBrains Mono', ui-monospace, monospace;
		font-size: 13px;
		line-height: 22px;
		color: #ff5a00;
		flex-shrink: 0;
		user-select: none;
	}
	.first-line { border-bottom: 1px solid #0a0a0a; }
	.last-line { border-top: 1px solid #0a0a0a; }

	.monaco-host {
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}
	.monaco-host :global(.monaco-editor) {
		height: 100%;
	}
	.monaco-host :global(.monaco-editor .overflow-guard) {
		height: 100% !important;
	}

	/* Status bar */
	.status-bar {
		height: 22px;
		background: #060606;
		border-top: 1px solid #111;
		display: flex;
		align-items: center;
		padding: 0 12px;
		gap: 6px;
		flex-shrink: 0;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #555;
		overflow: hidden;
	}
	.sb-item { color: #666; white-space: nowrap; }
	.sb-sep { color: #2a2a2a; }
	.sb-lang { color: #ff5a00; opacity: 0.7; }
	.sb-errors { color: #ef5350; }
	.sb-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #ff5a00;
		flex-shrink: 0;
		margin-left: auto;
		box-shadow: 0 0 6px rgba(255, 90, 0,0.5);
	}

	/* Params */
	.params {
		background: #060606;
		border-top: 1px solid #1a1a1a;
		padding: 10px 14px 14px;
		flex-shrink: 0;
	}
	.params-head {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.12em;
		font-size: 10px;
		color: #777;
		margin-bottom: 10px;
	}
	.params-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		align-items: end;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 11px;
		color: #bdbdbd;
		font-family: 'Share Tech Mono', monospace;
	}
	input {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 8px;
		padding: 7px 10px;
		color: #e8e8e8;
		outline: none;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
	}
	input:focus { border-color: rgba(255, 90, 0,0.4); }

	.date-info {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
	}
	.di-label { color: #666; }
	.di-val { color: #bdbdbd; }

	@media (max-width: 1200px) {
		.right-body { grid-template-columns: 1fr 200px; }
	}
	@media (max-width: 1000px) {
		.step2 { grid-template-columns: 1fr; }
		.left { border-right: none; border-bottom: 1px solid #1a1a1a; max-height: 220px; }
		.right-body { grid-template-columns: 1fr; }
		.gallery { border-top: 1px solid #1a1a1a; max-height: 200px; }
		.params-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>
