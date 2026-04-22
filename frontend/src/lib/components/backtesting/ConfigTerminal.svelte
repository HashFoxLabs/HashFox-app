<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';

	type WizardStep =
		| 'intro'
		| 'category_select'
		| 'market_loading'
		| 'market_select'
		| 'position_filter'
		| 'time_period'
		| 'start_date'
		| 'end_date'
		| 'review'
		| 'done';

	interface EngineConfig {
		data_source: 'synthesis' | 'parquet';
		platform: string[];
		timestamp_start: string | null;
		timestamp_end: string | null;
		market_category: string[] | null;
		position: string[] | null;
	}

	interface ConfigCompletePayload {
		config: EngineConfig;
		dataSource: 'synthesis' | 'parquet';
		useTimePeriod: boolean;
		timestampStartStr: string;
		timestampEndStr: string;
		filterTitleSearch: string;
		filterVolumeInf: number | null;
		filterVolumeSup: number | null;
		filterCategories: Set<string>;
		filterOutcomesSearch: string;
		selectedMarkets: any[];
	}

	let { onConfigComplete }: { onConfigComplete?: (payload: ConfigCompletePayload) => void } = $props();

	// Wizard state
	let wizardStep: WizardStep = $state('intro');
	let dataSource: 'synthesis' | 'parquet' = $state('synthesis');
	let currentInputLine = $state('');

	// Filter state
	let useTimePeriod = $state(false);
	let timestampStartStr = $state('');
	let timestampEndStr = $state('');
	let selectedCategories: string[] = $state([]);
	let positionFilter: 'both' | 'yes' | 'no' = $state('both');

	// Market selection state
	let availableMarkets: any[] = $state([]);
	let selectedMarketsList: any[] = $state([]);

	// Header-bar clock
	let clockNow = $state(formatClock(new Date()));
	let clockTimer: ReturnType<typeof setInterval> | null = null;

	function formatClock(d: Date): string {
		const hh = String(d.getHours()).padStart(2, '0');
		const mm = String(d.getMinutes()).padStart(2, '0');
		const ss = String(d.getSeconds()).padStart(2, '0');
		return `${hh}:${mm}:${ss}`;
	}

	const stepMap: Record<WizardStep, { label: string; detail: string }> = {
		intro: { label: 'INTRO', detail: 'type "go" to begin' },
		category_select: { label: '1/5', detail: 'select categories' },
		market_loading: { label: '2/5', detail: 'fetching markets' },
		market_select: { label: '2/5', detail: 'select markets' },
		position_filter: { label: '3/5', detail: 'position filter' },
		time_period: { label: '4/5', detail: 'time period' },
		start_date: { label: '4/5', detail: 'start date' },
		end_date: { label: '4/5', detail: 'end date' },
		review: { label: '5/5', detail: 'review config' },
		done: { label: 'DONE', detail: 'launching editor' }
	};
	let stepLabel = $derived(stepMap[wizardStep].label);
	let stepDetail = $derived(stepMap[wizardStep].detail);

	function formatVolume(v: number): string {
		if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
		if (v >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
		return `$${v.toFixed(0)}`;
	}

	const availableCategories = [
		'crypto',
		'culture',
		'economy',
		'elections',
		'finance',
		'geopolitics',
		'politics',
		'sports',
		'tech',
		'world',
		'science',
		'entertainment',
		'health'
	];

	async function fetchMarketsByCategory(term: any) {
		try {
			const tagsParam = selectedCategories.join(',');
			term.writeln(`${DIM}Fetching ended markets for: ${selectedCategories.join(', ')}...${R}`);
			const response = await fetch(
				`/api/markets?limit=250&tags=${encodeURIComponent(tagsParam)}&ended=true`
			);
			if (!response.ok) throw new Error('API error');
			const markets = await response.json();
			if (Array.isArray(markets) && markets.length > 0) {
				availableMarkets = markets;
				term.writeln(`${G}✓ Found ${markets.length} ended markets${R}`);
				wizardStep = 'market_select';
				showWizardStep(term);
			} else {
				term.writeln(
					`${O}No ended markets found for these categories. Try different ones.${R}`
				);
				wizardStep = 'category_select';
				showWizardStep(term);
			}
		} catch {
			term.writeln(`${O}Failed to fetch markets. Try again.${R}`);
			wizardStep = 'category_select';
			showWizardStep(term);
		}
	}

	// Xterm state
	let xtermContainer: HTMLDivElement | undefined = $state();
	let xtermInitialized = $state(false);
	let xtermInstance: any = $state(null);

	// ANSI color constants — aligned with the rest of the app
	const O = '\x1b[38;2;255;149;0m'; // canonical orange #ff9500
	const G = '\x1b[38;5;42m';
	const CY = '\x1b[38;5;45m';
	const MAG = '\x1b[38;5;177m';
	const R = '\x1b[0m';
	const DIM = '\x1b[38;5;242m';
	const DIM2 = '\x1b[38;5;238m';
	const FG = '\x1b[38;5;252m';
	const BOLD = '\x1b[1m';
	const NORMAL = '\x1b[22m';

	function getEngineConfig(): EngineConfig {
		return {
			data_source: dataSource,
			platform: ['polymarket'],
			timestamp_start: useTimePeriod && timestampStartStr ? timestampStartStr : null,
			timestamp_end: useTimePeriod && timestampEndStr ? timestampEndStr : null,
			market_category: selectedCategories.length > 0 ? selectedCategories : null,
			position: positionFilter === 'both' ? null : [positionFilter === 'yes' ? 'Yes' : 'No']
		};
	}

	function fireConfigComplete() {
		if (onConfigComplete) {
			onConfigComplete({
				config: getEngineConfig(),
				dataSource,
				useTimePeriod,
				timestampStartStr,
				timestampEndStr,
				filterTitleSearch: '',
				filterVolumeInf: null,
				filterVolumeSup: null,
				filterCategories: new Set(selectedCategories),
				filterOutcomesSearch: '',
				selectedMarkets: selectedMarketsList
			});
		}
	}

	function prompt(term: any, newline = true) {
		if (newline) term.write('\r\n');
		term.write(`${MAG}hashfox${R}${DIM}@${R}${CY}backtest${R}${DIM}:${R}${O}~${R}${DIM}$${R} `);
		term.scrollToBottom();
	}

	function repeat(ch: string, n: number): string {
		return n > 0 ? ch.repeat(n) : '';
	}

	function sectionHeader(term: any, text: string) {
		const cols = Math.max(40, term.cols || 80);
		const inner = ` ${text} `;
		const barLen = Math.max(20, Math.min(cols - 4, 74));
		const sideLen = Math.max(3, Math.floor((barLen - inner.length) / 2));
		const left = repeat('─', sideLen);
		const right = repeat('─', barLen - sideLen - inner.length);
		term.writeln(` ${O}${left}${BOLD}${inner}${NORMAL}${right}${R}`);
	}

	function showWizardStep(term: any) {
		const step = wizardStep;
		term.writeln('');
		if (step === 'category_select') {
			sectionHeader(term, 'STEP 1/5 · SELECT CATEGORIES');
			term.writeln('');
			term.writeln(` ${DIM}Available categories:${R}`);
			term.writeln('');
			const cols = 2;
			const rows = Math.ceil(availableCategories.length / cols);
			for (let r = 0; r < rows; r++) {
				let line = ' ';
				for (let c = 0; c < cols; c++) {
					const i = c * rows + r;
					if (i >= availableCategories.length) continue;
					const idx = String(i + 1).padStart(2, ' ');
					const name = availableCategories[i].padEnd(14, ' ');
					line += ` ${O}${idx}${R} ${FG}${name}${R}  `;
				}
				term.writeln(line);
			}
			term.writeln('');
			term.writeln(
				` ${DIM}Select categories (comma-separated) — e.g.${R} ${O}1,3,5${R} ${DIM}or${R} ${O}crypto,sports${R}`
			);
			term.writeln(` ${DIM}Type${R} ${O}all${R} ${DIM}to select every category.${R}`);
		} else if (step === 'market_loading') {
			sectionHeader(term, 'STEP 2/5 · SELECT MARKETS');
			fetchMarketsByCategory(term);
			return;
		} else if (step === 'market_select') {
			term.writeln('');
			term.writeln(
				` ${DIM}Ended markets for${R} ${O}${selectedCategories.join(', ')}${R} ${DIM}(by volume):${R}`
			);
			term.writeln('');
			const displayCount = Math.min(availableMarkets.length, 30);
			for (let i = 0; i < displayCount; i++) {
				const m = availableMarkets[i];
				const idx = String(i + 1).padStart(2, ' ');
				const q = (m.question || m.title || '').slice(0, 45);
				const qPad = q.padEnd(47);
				const vol = formatVolume(m.volume || 0);
				const endDate = m.endDate
					? new Date(m.endDate).toLocaleDateString('en-US', {
							month: 'short',
							day: 'numeric',
							year: 'numeric'
						})
					: '?';
				const outcome = m.resolvedOutcome ? `${G}${m.resolvedOutcome}${R}` : `${DIM}unclear${R}`;
				term.writeln(
					` ${O}${idx}${R} ${FG}${qPad}${R} ${DIM2}Vol${R} ${DIM}${vol.padEnd(6)}${R} ${DIM2}End${R} ${DIM}${endDate}${R}  ${DIM2}→${R} ${outcome}`
				);
			}
			if (availableMarkets.length > 30) {
				term.writeln(` ${DIM}... and ${availableMarkets.length - 30} more${R}`);
			}
			term.writeln('');
			term.writeln(` ${DIM}Select markets (comma-separated) — e.g.${R} ${O}1,3,5${R}`);
			term.writeln(
				` ${DIM}Type${R} ${O}all${R} ${DIM}to select all, or${R} ${O}top <n>${R} ${DIM}for top N by volume.${R}`
			);
		} else if (step === 'position_filter') {
			sectionHeader(term, 'STEP 3/5 · POSITION FILTER');
			term.writeln('');
			term.writeln(` ${DIM}Filter trades by position side:${R}`);
			term.writeln('');
			term.writeln(`  ${O}1${R}  ${FG}Both${R}   ${DIM}— Include Yes and No trades${R}`);
			term.writeln(`  ${O}2${R}  ${FG}Yes${R}    ${DIM}— Only Yes trades${R}`);
			term.writeln(`  ${O}3${R}  ${FG}No${R}     ${DIM}— Only No trades${R}`);
			term.writeln('');
			term.writeln(
				` ${DIM}Type${R} ${O}1${R}${DIM},${R} ${O}2${R}${DIM}, or${R} ${O}3${R} ${DIM}(default: 1 — both)${R}`
			);
		} else if (step === 'time_period') {
			sectionHeader(term, 'STEP 4/5 · TIME PERIOD');
			term.writeln('');
			term.writeln(` ${DIM}Enable time-period filter?${R} (${O}yes${R}${DIM}/${R}${O}no${R})`);
			term.writeln(` ${DIM}Press ENTER for no — use all data.${R}`);
		} else if (step === 'start_date') {
			term.writeln(` ${DIM}Start date${R} (${O}YYYY-MM-DD${R})${DIM}:${R}`);
			term.writeln(` ${DIM}e.g.${R} ${O}2024-01-01${R}`);
		} else if (step === 'end_date') {
			term.writeln(` ${DIM}End date${R} (${O}YYYY-MM-DD${R})${DIM}:${R}`);
			term.writeln(` ${DIM}e.g.${R} ${O}2025-01-01${R}`);
		} else if (step === 'review') {
			sectionHeader(term, 'STEP 5/5 · REVIEW CONFIG');
			term.writeln('');
			const pairs: Array<[string, string]> = [
				['Data', `${FG}Synthesis API + Parquet dataset${R} ${DIM}(404M+ trades)${R}`],
				['Platform', `${FG}Polymarket${R}`],
				['Categories', `${FG}${selectedCategories.join(', ')}${R}`]
			];
			for (const [k, v] of pairs) {
				term.writeln(` ${O}${k.padEnd(12)}${R} ${v}`);
			}
			if (selectedMarketsList.length > 0) {
				term.writeln(` ${O}${'Markets'.padEnd(12)}${R} ${FG}${selectedMarketsList.length}${R} ${DIM}selected (ended)${R}`);
				for (const m of selectedMarketsList.slice(0, 5)) {
					term.writeln(`   ${DIM2}•${R} ${DIM}${(m.question || m.title || '').slice(0, 64)}${R}`);
				}
				if (selectedMarketsList.length > 5) {
					term.writeln(`   ${DIM}... and ${selectedMarketsList.length - 5} more${R}`);
				}
			}
			const posLabel = positionFilter === 'both'
				? 'Yes & No'
				: positionFilter === 'yes'
					? 'Yes only'
					: 'No only';
			term.writeln(` ${O}${'Position'.padEnd(12)}${R} ${FG}${posLabel}${R}`);
			const timeLabel = useTimePeriod
				? `${timestampStartStr} ${DIM2}→${R} ${timestampEndStr}`
				: `${FG}ALL TIME${R}`;
			term.writeln(` ${O}${'Time'.padEnd(12)}${R} ${timeLabel}`);
			term.writeln('');
			term.writeln(
				` ${DIM}Type${R} ${O}run${R} ${DIM}to continue or${R} ${O}back${R} ${DIM}to edit.${R}`
			);
		} else if (step === 'done') {
			term.writeln(` ${G}✓ Config complete.${R}`);
			term.writeln(` ${DIM}Launching strategy editor...${R}`);
		}
		prompt(term);
	}

	function parseCommaList(raw: string): string[] {
		return raw
			.split(',')
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function parseDateInput(raw: string): string | null {
		const t = raw.trim();
		if (!t) return null;
		if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
		const d = new Date(`${t}T00:00:00.000Z`);
		if (isNaN(d.getTime())) return null;
		return t;
	}

	function handleLine(term: any, line: string) {
		const input = line.trim();
		if (!input) return;

		if (wizardStep === 'intro') {
			if (input.toLowerCase() === 'go') {
				wizardStep = 'category_select';
				showWizardStep(term);
			} else {
				term.writeln(` ${DIM}Type${R} ${O}go${R} ${DIM}to start.${R}`);
				prompt(term);
			}
			return;
		}

		if (wizardStep === 'category_select') {
			const low = input.toLowerCase();
			if (low === 'all') {
				selectedCategories = [...availableCategories];
				wizardStep = 'market_loading';
				showWizardStep(term);
				return;
			}

			const parts = parseCommaList(input);
			const chosen: string[] = [];
			for (const p of parts) {
				const idx = Number(p);
				if (!isNaN(idx) && idx >= 1 && idx <= availableCategories.length) {
					chosen.push(availableCategories[idx - 1]);
				} else {
					const s = p.toLowerCase();
					if (availableCategories.includes(s)) chosen.push(s);
				}
			}
			selectedCategories = Array.from(new Set(chosen));
			if (selectedCategories.length === 0) {
				term.writeln(` ${O}No valid categories selected. Try again.${R}`);
				prompt(term);
				return;
			}
			wizardStep = 'market_loading';
			showWizardStep(term);
			return;
		}

		if (wizardStep === 'market_select') {
			const low = input.toLowerCase();
			if (low === 'all') {
				selectedMarketsList = availableMarkets.slice(0, 15);
				wizardStep = 'position_filter';
				showWizardStep(term);
				return;
			}
			if (low.startsWith('top ')) {
				const n = Number(low.replace('top', '').trim());
				if (!isNaN(n) && n > 0) {
					selectedMarketsList = availableMarkets.slice(0, Math.min(15, n));
					wizardStep = 'position_filter';
					showWizardStep(term);
					return;
				}
			}

			const idxs = parseCommaList(input)
				.map((s) => Number(s))
				.filter((n) => !isNaN(n) && n >= 1 && n <= availableMarkets.length);

			if (idxs.length === 0) {
				term.writeln(` ${O}No valid markets selected. Try again.${R}`);
				prompt(term);
				return;
			}

			selectedMarketsList = idxs.map((i) => availableMarkets[i - 1]).slice(0, 15);
			wizardStep = 'position_filter';
			showWizardStep(term);
			return;
		}

		if (wizardStep === 'position_filter') {
			const low = input.toLowerCase();
			if (low === '1' || low === 'both') positionFilter = 'both';
			else if (low === '2' || low === 'yes') positionFilter = 'yes';
			else if (low === '3' || low === 'no') positionFilter = 'no';
			else {
				term.writeln(` ${O}Invalid choice. Type 1, 2, or 3.${R}`);
				prompt(term);
				return;
			}
			wizardStep = 'time_period';
			showWizardStep(term);
			return;
		}

		if (wizardStep === 'time_period') {
			const low = input.toLowerCase();
			useTimePeriod = low === 'yes' || low === 'y' || low === 'true';
			if (useTimePeriod) {
				wizardStep = 'start_date';
			} else {
				timestampStartStr = '';
				timestampEndStr = '';
				wizardStep = 'review';
			}
			showWizardStep(term);
			return;
		}

		if (wizardStep === 'start_date') {
			const d = parseDateInput(input);
			if (!d) {
				term.writeln(` ${O}Invalid date format. Use YYYY-MM-DD.${R}`);
				prompt(term);
				return;
			}
			timestampStartStr = `${d}T00:00:00.000Z`;
			wizardStep = 'end_date';
			showWizardStep(term);
			return;
		}

		if (wizardStep === 'end_date') {
			const d = parseDateInput(input);
			if (!d) {
				term.writeln(` ${O}Invalid date format. Use YYYY-MM-DD.${R}`);
				prompt(term);
				return;
			}
			timestampEndStr = `${d}T23:59:59.999Z`;
			wizardStep = 'review';
			showWizardStep(term);
			return;
		}

		if (wizardStep === 'review') {
			const low = input.toLowerCase();
			if (low === 'back') {
				wizardStep = 'category_select';
				showWizardStep(term);
				return;
			}
			if (low === 'run') {
				wizardStep = 'done';
				showWizardStep(term);
				fireConfigComplete();
				return;
			}
			term.writeln(` ${DIM}Type${R} ${O}run${R} ${DIM}or${R} ${O}back${R}${DIM}.${R}`);
			prompt(term);
		}
	}

	async function initXterm() {
		if (!browser || xtermInitialized || !xtermContainer) return;
		xtermInitialized = true;

		const [{ Terminal }, { FitAddon }] = await Promise.all([
			import('@xterm/xterm'),
			import('@xterm/addon-fit')
		]);

		const term = new Terminal({
			theme: {
				background: '#000000',
				foreground: '#e8e8e8',
				cursor: '#ff9500',
				cursorAccent: '#000000',
				selectionBackground: 'rgba(255,149,0,0.28)',
				black: '#000000',
				red: '#ef4444',
				green: '#10b981',
				yellow: '#f59e0b',
				blue: '#38bdf8',
				magenta: '#c084fc',
				cyan: '#22d3ee',
				white: '#e8e8e8',
				brightBlack: '#4b5563',
				brightRed: '#f87171',
				brightGreen: '#34d399',
				brightYellow: '#fbbf24',
				brightBlue: '#60a5fa',
				brightMagenta: '#d8b4fe',
				brightCyan: '#67e8f9',
				brightWhite: '#f9fafb'
			},
			fontFamily:
				'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
			fontSize: 13,
			lineHeight: 1.2,
			letterSpacing: 0,
			cursorBlink: true,
			cursorStyle: 'block',
			cursorInactiveStyle: 'outline',
			convertEol: true,
			scrollback: 5000,
			scrollSensitivity: 3,
			fastScrollSensitivity: 10
		});
		const fit = new FitAddon();
		term.loadAddon(fit);

		term.open(xtermContainer);
		// Wait one frame so the flex box has real dimensions, then fit and prompt.
		await new Promise((r) => requestAnimationFrame(() => r(null)));
		try { fit.fit(); } catch { /* ignore */ }
		// Full terminal reset — guarantees no residual cells from a prior HMR instance.
		term.write('\x1bc');
		prompt(term, false);

		term.onData((data: string) => {
			const code = data.charCodeAt(0);
			if (code === 13) {
				const line = currentInputLine;
				currentInputLine = '';
				term.write('\r\n');
				handleLine(term, line);
				return;
			}
			if (code === 127) {
				if (currentInputLine.length > 0) {
					currentInputLine = currentInputLine.slice(0, -1);
					term.write('\b \b');
				}
				return;
			}
			// ignore arrow keys / escapes
			if (data.startsWith('\x1b')) return;
			currentInputLine += data;
			term.write(data);
		});

		const onResize = () => {
			try { fit.fit(); } catch { /* ignore */ }
		};
		window.addEventListener('resize', onResize);

		// Keep the fit in sync with the host container (flex resize, sidebar show/hide, etc.)
		let ro: ResizeObserver | null = null;
		if (typeof ResizeObserver !== 'undefined' && xtermContainer) {
			ro = new ResizeObserver(() => {
				try { fit.fit(); } catch { /* ignore */ }
			});
			ro.observe(xtermContainer);
		}

		xtermInstance = { term, fit, onResize, ro };
	}

	onMount(() => {
		void initXterm();
		clockTimer = setInterval(() => {
			clockNow = formatClock(new Date());
		}, 1000);
	});

	onDestroy(() => {
		if (clockTimer) clearInterval(clockTimer);
		if (xtermInstance?.onResize) window.removeEventListener('resize', xtermInstance.onResize);
		try {
			xtermInstance?.ro?.disconnect?.();
		} catch {
			/* ignore */
		}
		try {
			xtermInstance?.term?.dispose?.();
		} catch {
			/* ignore */
		}
		xtermInstance = null;
	});
</script>

<div class="hf-terminal-stage">
	<div class="hf-title-banner">
		<div class="hf-title-line hf-title-line--main">HashFox</div>
		<div class="hf-title-line hf-title-line--sub">Backtest</div>
	</div>

	<div class="hf-terminal-window">
		<div class="hf-titlebar">
			<div class="hf-traffic" aria-hidden="true">
				<span class="hf-dot hf-dot--red"></span>
				<span class="hf-dot hf-dot--yellow"></span>
				<span class="hf-dot hf-dot--green"></span>
			</div>
			<div class="hf-title">
				<span class="hf-title-icon">▸</span>
				<span class="hf-title-text">hashfox</span>
				<span class="hf-title-sep">@</span>
				<span class="hf-title-host">backtest-engine</span>
				<span class="hf-title-sep">:</span>
				<span class="hf-title-path">~/config</span>
				<span class="hf-title-shell">— zsh</span>
			</div>
			<div class="hf-session">
				<span class="hf-led" aria-hidden="true"></span>
				<span class="hf-session-text">LIVE</span>
			</div>
		</div>

		<div class="hf-body">
			<div class="hf-terminal-host" bind:this={xtermContainer}></div>
		</div>

		<div class="hf-statusbar">
			<span class="hf-status-cell hf-status-cell--accent">
				<span class="hf-status-bullet"></span>
				STEP {stepLabel}
			</span>
			<span class="hf-status-cell">{stepDetail}</span>
			<span class="hf-status-spacer"></span>
			<span class="hf-status-cell hf-status-cell--dim">UTF-8</span>
			<span class="hf-status-cell hf-status-cell--dim">synthesis://polymarket</span>
			<span class="hf-status-cell hf-status-cell--mono">{clockNow}</span>
		</div>
	</div>
</div>

<style>
	.hf-terminal-stage {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		padding: 18px 22px 22px;
		background: #000;
	}

	.hf-title-banner {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 4px 0 18px 0;
		flex-shrink: 0;
		user-select: none;
	}
	.hf-title-line {
		font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
		color: #ff9500;
		font-weight: 900;
		line-height: 1;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		text-shadow:
			0 0 2px rgba(255, 149, 0, 0.65),
			0 0 14px rgba(255, 149, 0, 0.35),
			0 0 32px rgba(255, 149, 0, 0.18);
	}
	.hf-title-line--main {
		font-size: clamp(32px, 6vw, 72px);
	}
	.hf-title-line--sub {
		font-size: clamp(22px, 4.2vw, 48px);
		letter-spacing: 0.28em;
		opacity: 0.92;
	}

	.hf-terminal-window {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		border-radius: 12px;
		overflow: hidden;
		background: #000;
		border: 1px solid rgba(255, 255, 255, 0.07);
		box-shadow:
			0 0 0 1px rgba(255, 149, 0, 0.06),
			0 24px 60px rgba(0, 0, 0, 0.6);
	}

	.hf-titlebar {
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
		background: linear-gradient(180deg, #141418 0%, #0c0c0f 100%);
		border-bottom: 1px solid rgba(255, 255, 255, 0.06);
		flex-shrink: 0;
	}

	.hf-traffic {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	.hf-dot {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		display: inline-block;
		border: 1px solid rgba(0, 0, 0, 0.4);
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.25),
			0 0 0 0.5px rgba(0, 0, 0, 0.6);
		transition: filter 0.15s ease;
	}
	.hf-dot:hover {
		filter: brightness(1.15);
	}
	.hf-dot--red {
		background: radial-gradient(circle at 30% 30%, #ff8077, #ff5f57 55%, #d1423c);
	}
	.hf-dot--yellow {
		background: radial-gradient(circle at 30% 30%, #ffd56b, #febc2e 55%, #c79315);
	}
	.hf-dot--green {
		background: radial-gradient(circle at 30% 30%, #58e074, #28c840 55%, #109b29);
	}

	.hf-title {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 12px;
		color: #9ea2aa;
		letter-spacing: 0.02em;
		user-select: none;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.hf-title-icon { color: #ff9500; margin-right: 4px; }
	.hf-title-text { color: #d6d6d6; font-weight: 600; }
	.hf-title-sep { color: #5a5f69; }
	.hf-title-host { color: #22d3ee; }
	.hf-title-path { color: #ff9500; }
	.hf-title-shell { color: #5a5f69; margin-left: 6px; }

	.hf-session {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 10px;
		letter-spacing: 0.14em;
		color: #34d399;
		padding: 3px 8px;
		border-radius: 999px;
		background: rgba(16, 185, 129, 0.08);
		border: 1px solid rgba(16, 185, 129, 0.25);
	}
	.hf-led {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #34d399;
		box-shadow: 0 0 8px rgba(52, 211, 153, 0.8);
		animation: hf-pulse 1.6s ease-in-out infinite;
	}
	@keyframes hf-pulse {
		0%, 100% { opacity: 1; box-shadow: 0 0 10px rgba(52, 211, 153, 0.8); }
		50%      { opacity: 0.55; box-shadow: 0 0 4px rgba(52, 211, 153, 0.4); }
	}

	.hf-body {
		flex: 1;
		min-height: 0;
		background: #000;
		padding: 10px 12px;
		overflow: hidden;
		position: relative;
	}

	.hf-terminal-host {
		width: 100%;
		height: 100%;
	}
	.hf-terminal-host :global(.xterm) {
		height: 100%;
		background-color: #000 !important;
	}
	.hf-terminal-host :global(.xterm-screen) {
		background-color: #000 !important;
	}
	.hf-terminal-host :global(.xterm .xterm-helper-textarea) {
		outline: none;
	}
	.hf-terminal-host :global(.xterm-viewport) {
		background-color: #000 !important;
		overflow-y: auto !important;
		scrollbar-width: thin;
		scrollbar-color: rgba(255, 149, 0, 0.35) transparent;
	}
	.hf-terminal-host :global(.xterm-viewport::-webkit-scrollbar) {
		width: 10px;
	}
	.hf-terminal-host :global(.xterm-viewport::-webkit-scrollbar-track) {
		background: #000;
	}
	.hf-terminal-host :global(.xterm-viewport::-webkit-scrollbar-thumb) {
		background: rgba(255, 149, 0, 0.35);
		border-radius: 5px;
		border: 2px solid #000;
	}
	.hf-terminal-host :global(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
		background: rgba(255, 149, 0, 0.6);
	}

	.hf-statusbar {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 6px 14px;
		background: linear-gradient(180deg, #0c0c0f 0%, #000 100%);
		border-top: 1px solid rgba(255, 255, 255, 0.05);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 10.5px;
		letter-spacing: 0.06em;
		color: #9ea2aa;
		flex-shrink: 0;
	}
	.hf-status-cell {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		text-transform: uppercase;
	}
	.hf-status-cell--accent {
		color: #ff9500;
		font-weight: 600;
	}
	.hf-status-cell--dim {
		color: #5a5f69;
		text-transform: none;
		letter-spacing: 0.02em;
	}
	.hf-status-cell--mono {
		color: #d6d6d6;
		letter-spacing: 0.08em;
		font-variant-numeric: tabular-nums;
	}
	.hf-status-spacer {
		flex: 1;
	}
	.hf-status-bullet {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #ff9500;
		box-shadow: 0 0 8px rgba(255, 149, 0, 0.7);
	}

	@media (max-width: 780px) {
		.hf-terminal-stage { padding: 10px 10px 12px; }
		.hf-title { font-size: 11px; }
		.hf-title-shell { display: none; }
		.hf-status-cell--dim:nth-of-type(2) { display: none; }
	}
</style>
