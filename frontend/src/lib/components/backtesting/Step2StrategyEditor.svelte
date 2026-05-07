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
  #   row["qty"]        float  — tick volume
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
  # ─── Pick a template on the left, or write your own ────────────────────

  signal = {"action": "HOLD", "quantity": 0.0}`;

	let strategyBody = $state(DEFAULT_BODY);
	let initialCapital = $state(10000);
	let selectedStrategyId = $state<string | null>(null);
	let strategyFilter = $state('');

	const strategies = $derived(strategiesForType(backtestType));
	const filteredStrategies = $derived(
		strategyFilter.trim()
			? strategies.filter((s) =>
				s.name.toLowerCase().includes(strategyFilter.toLowerCase()) ||
				s.description.toLowerCase().includes(strategyFilter.toLowerCase())
			)
			: strategies
	);

	let cursorLine = $state(1);
	let cursorCol = $state(1);
	let markerCount = $state(0);
	let lastRunBody = $state('');
	const isDirty = $derived(strategyBody !== lastRunBody);

	let editorContainer: HTMLDivElement | undefined = $state();
	let editor: MonacoType.editor.IStandaloneCodeEditor | null = null;
	let monacoRef: typeof MonacoType | null = null;
	let diagnosticTimer: ReturnType<typeof setTimeout> | null = null;
	const disposables: MonacoType.IDisposable[] = [];

	const STEPS = [
		{ id: 1, label: 'Granularity', active: false, done: true  },
		{ id: 2, label: 'Data',        active: false, done: true  },
		{ id: 3, label: 'Strategy',    active: true,  done: false },
		{ id: 4, label: 'Results',     active: false, done: false }
	];

	onMount(async () => {
		if (!browser || !editorContainer) return;

		const EditorWorker = (await import('monaco-editor/esm/vs/editor/editor.worker?worker')).default;
		(self as unknown as Record<string, unknown>).MonacoEnvironment = {
			getWorker() {
				return new EditorWorker();
			}
		};

		const monaco = await import('monaco-editor');
		monacoRef = monaco;

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

		const ROW_FIELDS = [
			{ label: '"price"',     detail: '(float) Last traded price at this tick.', doc: 'Last traded price.' },
			{ label: '"market"',    detail: '(str) Market identifier, e.g. "BTC/USD".', doc: 'Market identifier.' },
			{ label: '"volume"',    detail: '(float) Tick volume.', doc: 'Tick volume.' },
			{ label: '"side"',      detail: '(str) "buy" or "sell" — original trade direction.', doc: '"buy" or "sell".' },
			{ label: '"timestamp"', detail: '(int) Unix timestamp in milliseconds.', doc: 'Unix ms timestamp — divide by 1000 for seconds.' },
		];
		const PORTFOLIO_FIELDS = [
			{ label: 'cash',          detail: '(float) Available cash.', doc: 'Available cash in the portfolio.' },
			{ label: 'positions',     detail: '(dict) Open positions: {market: quantity}.', doc: 'Currently open positions.' },
			{ label: 'latest_prices', detail: '(dict) Most recent price per market.', doc: 'Last seen price for every market loaded.' },
			{ label: 'equity_curve',  detail: '(list[float]) Portfolio value at each tick so far.', doc: 'Running equity curve.' },
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
				insertText: ['if user_perso_parameter is None:', '  user_perso_parameter = {}'].join('\n'),
			},
		];

		disposables.push(
			monaco.languages.registerCompletionItemProvider('python', {
				triggerCharacters: ['.', '['],
				provideCompletionItems(model, position) {
					const lineText = model.getLineContent(position.lineNumber);
					const before = lineText.substring(0, position.column - 1);
					const wordInfo = model.getWordUntilPosition(position);
					const replaceRange = new monaco.Range(position.lineNumber, wordInfo.startColumn, position.lineNumber, wordInfo.endColumn);
					const insertRange  = new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column);
					const suggestions: MonacoType.languages.CompletionItem[] = [];

					if (before.endsWith('row[')) {
						for (const f of ROW_FIELDS) suggestions.push({
							label: f.label,
							kind: monaco.languages.CompletionItemKind.Field,
							detail: f.detail,
							documentation: { value: f.doc },
							insertText: f.label,
							range: insertRange,
						});
					} else if (before.endsWith('portfolio.')) {
						for (const f of PORTFOLIO_FIELDS) suggestions.push({
							label: f.label,
							kind: monaco.languages.CompletionItemKind.Field,
							detail: f.detail,
							documentation: { value: f.doc },
							insertText: f.label,
							range: insertRange,
						});
					} else {
						for (const s of SNIPPETS) suggestions.push({
							label: s.label,
							kind: monaco.languages.CompletionItemKind.Snippet,
							detail: s.detail,
							insertText: s.insertText,
							insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
							range: replaceRange,
						});
					}
					return { suggestions };
				}
			})
		);

		disposables.push(
			monaco.languages.registerHoverProvider('python', {
				provideHover(model, position) {
					const word = model.getWordAtPosition(position);
					if (!word) return null;
					if (word.word === 'row') return {
						contents: [
							{ value: '**`row`** — current market tick (dict-like)' },
							{ value: '| Key | Type | Description |\n|---|---|---|\n| `row["price"]` | `float` | Last traded price |\n| `row["market"]` | `str` | Market identifier |\n| `row["volume"]` | `float` | Tick volume |\n| `row["side"]` | `str` | `"buy"` or `"sell"` |\n| `row["timestamp"]` | `int` | Unix ms — divide by 1000 for seconds |' },
						]
					};
					if (word.word === 'portfolio') return {
						contents: [
							{ value: '**`portfolio`** — current portfolio state' },
							{ value: '| Attribute | Type | Description |\n|---|---|---|\n| `portfolio.cash` | `float` | Available cash |\n| `portfolio.positions` | `dict` | `{market: quantity}` |\n| `portfolio.latest_prices` | `dict` | Last price per market |\n| `portfolio.equity_curve` | `list` | Portfolio value history |' },
						]
					};
					if (word.word === 'user_perso_parameter') return {
						contents: [
							{ value: '**`user_perso_parameter`** — your persistent state across ticks' },
							{ value: 'Starts as `None` on the first row. Whatever you return is passed back on the next tick.\n\n```python\nif user_perso_parameter is None:\n    user_perso_parameter = {}\n```' },
						]
					};
					if (word.word === 'signal') return {
						contents: [
							{ value: '**`signal`** — trade instruction to return' },
							{ value: '```python\nsignal = {\n    "action": "BUY",   # "BUY" | "SELL" | "HOLD"\n    "quantity": 1.0,   # units (ignored for HOLD)\n    # "market": "AAPL"  # optional, defaults to row["market"]\n}\n```' },
						]
					};
					return null;
				}
			})
		);

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
			scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
			suggest: { showSnippets: true, showFields: true, showKeywords: true },
			quickSuggestions: { other: true, comments: false, strings: true },
			quickSuggestionsDelay: 80,
			acceptSuggestionOnEnter: 'smart',
		});

		disposables.push(editor.onDidChangeModelContent(() => {
			strategyBody = editor!.getValue();
			scheduleDiagnostics();
		}));
		disposables.push(editor.onDidChangeCursorPosition((e) => {
			cursorLine = e.position.lineNumber;
			cursorCol = e.position.column;
		}));

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
					startLineNumber: lineNum, startColumn: 1,
					endLineNumber: lineNum, endColumn: line.length + 1,
					message: 'No imports allowed in the sandbox.',
					source: 'HashFox sandbox',
				});
			}
			const dunders = /__import__|__builtins__/g;
			let match;
			while ((match = dunders.exec(line)) !== null) {
				markers.push({
					severity: monacoRef.MarkerSeverity.Error,
					startLineNumber: lineNum, startColumn: match.index + 1,
					endLineNumber: lineNum, endColumn: match.index + match[0].length + 1,
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
		if (markerCount > 0) return;
		lastRunBody = strategyBody;
		const strategy_code = `${FIRST_LINE}\n${normalizeTabs(strategyBody)}\n${LAST_LINE}`;
		onRun({ paths, strategy_code, initial_capital: initialCapital, start_date: startDate, end_date: endDate });
	}

	function fmtRange(): string {
		if (!startDate && !endDate) return 'all time';
		return `${startDate ?? 'beginning'} → ${endDate ?? 'today'}`;
	}

	// Avoid unused-prop warning while keeping API stable
	previewData;
</script>

<div class="step2">
	<!-- Top bar -->
	<header class="topbar">
		<button class="back-btn" onclick={onBack}>← Data</button>

		<div class="stepper">
			{#each STEPS as s, i}
				<div class="step" class:active={s.active} class:done={s.done}>
					<span class="step-num">{s.done ? '✓' : s.id}</span>
					<span class="step-name">{s.label}</span>
				</div>
				{#if i < STEPS.length - 1}<span class="step-bar" class:done={s.done}></span>{/if}
			{/each}
		</div>

		<button class="btn run" onclick={run} disabled={markerCount > 0}>
			<span class="run-icon">▶</span> Run Backtest
		</button>
	</header>

	<!-- Context strip: paths + dates + capital -->
	<div class="ctx-strip">
		<div class="ctx-item">
			<span class="ctx-label">Files</span>
			<span class="ctx-val">{paths.length}</span>
		</div>
		<span class="ctx-sep"></span>
		<div class="ctx-item">
			<span class="ctx-label">Range</span>
			<span class="ctx-val">{fmtRange()}</span>
		</div>
		<span class="ctx-sep"></span>
		<div class="ctx-item ctx-capital">
			<span class="ctx-label">Initial capital</span>
			<div class="capital-input-wrap">
				<span class="capital-prefix">$</span>
				<input class="capital-input" type="number" min="1" bind:value={initialCapital} />
			</div>
		</div>
		<span class="ctx-sep"></span>
		<div class="ctx-item">
			<span class="ctx-label">Mode</span>
			<span class="ctx-pill {backtestType}">{backtestType === 'longrun' ? 'Long-Run' : 'High-Frequency'}</span>
		</div>
		{#if isDirty && lastRunBody}
			<div class="dirty-flag" title="Unsaved changes since last run">● unsaved</div>
		{/if}
	</div>

	<div class="body">
		<!-- Left: strategy gallery -->
		<aside class="gallery">
			<div class="gallery-head">
				<span class="gallery-title">TEMPLATES</span>
				<span class="gallery-count">{filteredStrategies.length}</span>
			</div>
			<div class="gallery-search-wrap">
				<svg class="gallery-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<circle cx="11" cy="11" r="7"/>
					<path d="m21 21-4.3-4.3"/>
				</svg>
				<input
					class="gallery-search"
					type="text"
					placeholder="Filter templates…"
					bind:value={strategyFilter}
				/>
			</div>
			<div class="gallery-list">
				{#each filteredStrategies as s}
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
				{:else}
					<div class="gallery-empty">No templates match.</div>
				{/each}
			</div>
		</aside>

		<!-- Right: editor -->
		<section class="editor-pane">
			<div class="editor-wrap">
				<div class="fixed-line first-line">{FIRST_LINE}</div>
				<div class="monaco-host" bind:this={editorContainer}></div>
				<div class="fixed-line last-line">{LAST_LINE}</div>

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
					<span class="sb-spacer"></span>
					{#if isDirty && lastRunBody}<span class="sb-dot" title="Unsaved changes"></span>{/if}
				</div>
			</div>
		</section>
	</div>
</div>

<style>
	.step2 {
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
		display: flex; align-items: center; gap: 7px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px; color: #555;
	}
	.step-num {
		display: inline-flex; align-items: center; justify-content: center;
		width: 18px; height: 18px;
		border-radius: 50%;
		border: 1px solid #2a2a2a;
		font-size: 10px; color: #555;
		background: #050505;
	}
	.step.active { color: #ff5a00; }
	.step.active .step-num {
		border-color: rgba(255,90,0,0.55); color: #ff5a00;
		background: rgba(255,90,0,0.08);
		box-shadow: 0 0 10px rgba(255,90,0,0.25);
	}
	.step.done { color: #777; }
	.step.done .step-num {
		border-color: #26a65b; color: #26a65b;
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
		display: inline-flex;
		align-items: center;
		gap: 8px;
		white-space: nowrap;
	}
	.btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn.run {
		background: linear-gradient(180deg, rgba(255, 90, 0, 0.95), rgba(255, 90, 0, 0.72));
		border-color: rgba(255, 90, 0, 0.6);
		color: #000;
		font-weight: 700;
		letter-spacing: 0.04em;
	}
	.btn.run:not(:disabled):hover { filter: brightness(1.08); }
	.run-icon { font-size: 9px; }

	/* Context strip */
	.ctx-strip {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 8px 16px;
		background: #050505;
		border-bottom: 1px solid #131313;
		flex-shrink: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.ctx-strip::-webkit-scrollbar { display: none; }
	.ctx-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
	}
	.ctx-label {
		color: #555;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		font-size: 9px;
	}
	.ctx-val { color: #d8d8d8; }
	.ctx-sep {
		width: 1px; height: 16px;
		background: #1f1f1f;
		flex-shrink: 0;
	}
	.ctx-pill {
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 10px;
		font-family: 'Share Tech Mono', monospace;
	}
	.ctx-pill.highfrequency {
		background: rgba(255,90,0,0.1);
		border: 1px solid rgba(255,90,0,0.3);
		color: #ff5a00;
	}
	.ctx-pill.longrun {
		background: rgba(99,179,237,0.1);
		border: 1px solid rgba(99,179,237,0.3);
		color: #63b3ed;
	}
	.ctx-capital { gap: 6px; }
	.capital-input-wrap {
		position: relative;
		display: flex;
		align-items: center;
	}
	.capital-prefix {
		position: absolute;
		left: 8px;
		color: #555;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		pointer-events: none;
	}
	.capital-input {
		background: #0a0a0a;
		border: 1px solid #1f1f1f;
		border-radius: 6px;
		padding: 4px 8px 4px 18px;
		color: #e8e8e8;
		outline: none;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		width: 90px;
	}
	.capital-input:focus { border-color: rgba(255, 90, 0,0.4); }
	.dirty-flag {
		margin-left: auto;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #ff5a00;
		opacity: 0.8;
	}

	/* Body */
	.body {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 280px 1fr;
		overflow: hidden;
	}

	/* Gallery */
	.gallery {
		background: #060606;
		border-right: 1px solid #1a1a1a;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.gallery-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}
	.gallery-title {
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		letter-spacing: 0.14em;
		color: #ff5a00;
	}
	.gallery-count {
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #555;
		background: #0d0d0d;
		border: 1px solid #1f1f1f;
		border-radius: 999px;
		padding: 1px 8px;
	}
	.gallery-search-wrap {
		position: relative;
		padding: 8px 10px;
		border-bottom: 1px solid #131313;
		flex-shrink: 0;
	}
	.gallery-search-icon {
		position: absolute;
		left: 18px; top: 50%;
		transform: translateY(-50%);
		width: 11px; height: 11px;
		color: #555;
		pointer-events: none;
	}
	.gallery-search {
		width: 100%;
		background: #0a0a0a;
		border: 1px solid #1c1c1c;
		border-radius: 6px;
		padding: 6px 10px 6px 26px;
		color: #e8e8e8;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		outline: none;
		box-sizing: border-box;
	}
	.gallery-search:focus { border-color: rgba(255, 90, 0,0.4); }
	.gallery-search::placeholder { color: #444; }

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
	.gallery-empty {
		padding: 16px 8px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #444;
		text-align: center;
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
	.sc-badge--intermediate { background: rgba(255, 90, 0,0.12); color: #ff5a00; border: 1px solid rgba(255, 90, 0,0.3); }
	.sc-badge--advanced     { background: rgba(239,83,80,0.1);   color: #ef5350; border: 1px solid rgba(239,83,80,0.25); }
	.sc-desc {
		margin: 0;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #555;
		line-height: 1.5;
	}
	.strategy-card.active .sc-desc { color: #777; }

	/* Editor pane */
	.editor-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}
	.editor-wrap {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.fixed-line {
		background: #040404;
		padding: 5px 14px 5px 74px;
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
	.monaco-host :global(.monaco-editor) { height: 100%; }
	.monaco-host :global(.monaco-editor .overflow-guard) { height: 100% !important; }

	.status-bar {
		height: 24px;
		background: #060606;
		border-top: 1px solid #111;
		display: flex;
		align-items: center;
		padding: 0 14px;
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
	.sb-spacer { flex: 1; }
	.sb-dot {
		width: 6px; height: 6px;
		border-radius: 50%;
		background: #ff5a00;
		flex-shrink: 0;
		box-shadow: 0 0 6px rgba(255, 90, 0,0.5);
	}

	@media (max-width: 1000px) {
		.body { grid-template-columns: 1fr; }
		.gallery { border-right: none; border-bottom: 1px solid #1a1a1a; max-height: 220px; }
		.step-name { display: none; }
	}
</style>
