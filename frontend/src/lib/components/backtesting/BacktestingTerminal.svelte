<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import Step0TypeSelector from './Step0TypeSelector.svelte';
	import Step1DataFilter from './Step1DataFilter.svelte';
	import Step2StrategyEditor from './Step2StrategyEditor.svelte';
	import BacktestResults from './BacktestResults.svelte';

	interface PreviewResult {
		total_rows: number;
		returned_rows: number;
		columns: string[];
		rows: Record<string, unknown>[];
	}

	interface EngineResult {
		job_id: string;
		status: string;
		initial_capital: number;
		final_portfolio_value: number;
		total_return_pct: number;
		total_trades: number;
		total_fees: number;
		sharpe_ratio: number | null;
		sortino_ratio: number | null;
		max_drawdown_pct: number | null;
		calmar_ratio: number | null;
		volatility_annualized: number | null;
		trade_log: { timestamp: string; market: string; side: 'BUY' | 'SELL'; quantity: number; price: number; fees: number }[];
		error: string | null;
	}

	let step: 'type' | 'data' | 'strategy' | 'results' = $state('type');
	let backtestType: 'highfrequency' | 'longrun' | null = $state(null);

	let selectedPaths: string[] = $state([]);
	let previewData: PreviewResult | null = $state(null);
	let selectedStartDate: string | null = $state(null);
	let selectedEndDate: string | null = $state(null);

	let isRunning = $state(false);
	let progress = $state(0);
	let progressMessage = $state('');
	let error = $state('');
	let elapsedSec = $state(0);
	let runStartedAt = 0;
	let elapsedTimer: ReturnType<typeof setInterval> | null = null;

	let backtestResult: EngineResult | null = $state(null);

	function startElapsedTimer() {
		runStartedAt = Date.now();
		elapsedSec = 0;
		if (elapsedTimer) clearInterval(elapsedTimer);
		elapsedTimer = setInterval(() => {
			elapsedSec = Math.floor((Date.now() - runStartedAt) / 1000);
		}, 1000);
	}
	function stopElapsedTimer() {
		if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
	}
	onDestroy(stopElapsedTimer);

	const etaText = $derived.by(() => {
		if (progress <= 0 || elapsedSec < 2) return 'estimating…';
		const total = elapsedSec / (progress / 100);
		const remaining = Math.max(0, total - elapsedSec);
		return formatDuration(remaining);
	});

	function formatDuration(sec: number): string {
		const s = Math.round(sec);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		const rem = s % 60;
		return rem === 0 ? `${m}m` : `${m}m ${rem}s`;
	}

	function handleTypeSelect(t: 'highfrequency' | 'longrun') {
		backtestType = t;
		step = 'data';
	}

	function handleBackToType() {
		step = 'type';
		backtestType = null;
		selectedPaths = [];
		previewData = null;
		selectedStartDate = null;
		selectedEndDate = null;
	}

	function handleStep1Next(paths: string[], preview: PreviewResult | null, startDate: string | null, endDate: string | null) {
		selectedPaths = paths;
		previewData = preview;
		selectedStartDate = startDate;
		selectedEndDate = endDate;
		step = 'strategy';
	}

	function handleBack() {
		step = 'data';
		backtestResult = null;
		error = '';
	}

	async function handleRun(payload: {
		paths: string[];
		strategy_code: string;
		initial_capital: number;
		start_date: string | null;
		end_date: string | null;
	}) {
		isRunning = true;
		error = '';
		progress = 0;
		progressMessage = 'Sending backtest request...';
		startElapsedTimer();

		const POLL_INTERVAL_MS = 1000;
		const MAX_POLL_ATTEMPTS = 300; // 5 minutes max

		try {
			progress = 5;
			progressMessage = 'Submitting backtest job...';

			const submitRes = await fetch('/api/backtest/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...payload, backtest_type: backtestType ?? 'highfrequency' })
			});

			if (!submitRes.ok) {
				const errData = await submitRes.json().catch(() => ({}));
				throw new Error((errData as { error?: string }).error || `HTTP ${submitRes.status}`);
			}

			const { job_id } = (await submitRes.json()) as { job_id: string };
			if (!job_id) throw new Error('Engine did not return a job_id.');

			progress = 15;
			progressMessage = 'Job queued, waiting for engine...';

			let resultReceived = false;
			for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
				await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

				const pollRes = await fetch(`/api/backtest/status/${encodeURIComponent(job_id)}`);
				if (!pollRes.ok) {
					const errData = await pollRes.json().catch(() => ({}));
					throw new Error((errData as { error?: string }).error || `Poll error (${pollRes.status})`);
				}

				const result = await pollRes.json();

				if (result.status === 'pending' || result.status === 'running') {
					progress = 15 + Math.min(70, attempt * 2);
					progressMessage = 'Running backtest...';
					continue;
				}

				if (result.status === 'failed') {
					throw new Error(result.error ?? 'Backtest failed');
				}

				if (result.status === 'done') {
					progress = 95;
					progressMessage = 'Finalizing results...';
					backtestResult = result as EngineResult;
					progress = 100;
					resultReceived = true;
					break;
				}
			}

			if (!resultReceived || !backtestResult) throw new Error('Backtest timed out after 5 minutes.');
			step = 'results';
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			isRunning = false;
			stopElapsedTimer();
		}
	}

	const phaseSubmit    = $derived(progress < 10);
	const phaseRunning   = $derived(progress >= 10 && progress < 95);
	const phaseFinalize  = $derived(progress >= 95 && progress < 100);
</script>

<div class="container">
	<div class="inner">
		{#if step === 'type'}
			<Step0TypeSelector onSelect={handleTypeSelect} />
		{:else if step === 'data'}
			<Step1DataFilter
				onNext={handleStep1Next}
				onBack={handleBackToType}
				backtestType={backtestType!}
			/>
		{:else if step === 'strategy'}
			<Step2StrategyEditor
				paths={selectedPaths}
				{previewData}
				startDate={selectedStartDate}
				endDate={selectedEndDate}
				backtestType={backtestType!}
				onBack={handleBack}
				onRun={handleRun}
			/>
		{:else if step === 'results' && backtestResult}
			<BacktestResults
				result={backtestResult}
				paths={selectedPaths}
				onBack={handleBack}
			/>
		{/if}

		{#if isRunning}
			<div class="overlay">
				<div class="overlay-bg"></div>
				<div class="run-card">
					<div class="run-header">
						<div class="run-title">
							<span class="title-pulse"></span>
							Running backtest
						</div>
						<div class="run-percent">{Math.round(progress)}<span class="pct">%</span></div>
					</div>

					<div class="run-message">{progressMessage || 'Initializing backtest engine…'}</div>

					<div class="progress-track">
						<div class="progress-fill" style="width: {progress}%"></div>
						<div class="progress-shimmer"></div>
					</div>

					<div class="run-stats">
						<div class="stat">
							<span class="stat-label">Elapsed</span>
							<span class="stat-val">{formatDuration(elapsedSec)}</span>
						</div>
						<div class="stat">
							<span class="stat-label">ETA</span>
							<span class="stat-val">{etaText}</span>
						</div>
					</div>

					<div class="run-phases">
						<div class="phase" class:active={phaseSubmit} class:done={progress >= 10}>
							<span class="phase-num">1</span>
							<span class="phase-name">Submitting job</span>
						</div>
						<span class="phase-bar" class:done={progress >= 10}></span>
						<div class="phase" class:active={phaseRunning} class:done={progress >= 95}>
							<span class="phase-num">2</span>
							<span class="phase-name">Running on engine</span>
						</div>
						<span class="phase-bar" class:done={progress >= 95}></span>
						<div class="phase" class:active={phaseFinalize} class:done={progress >= 100}>
							<span class="phase-num">3</span>
							<span class="phase-name">Finalizing</span>
						</div>
					</div>

					<div class="run-hint">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
							<circle cx="12" cy="12" r="10"/>
							<path d="M12 6v6l4 2"/>
						</svg>
						Large datasets can take up to ~10 minutes. Keep this tab open.
					</div>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="error-banner">
				<p>{error}</p>
				<button onclick={() => (error = '')}>Dismiss</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.container {
		height: 100%;
		background: #000;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.inner {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}

	/* Overlay */
	.overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 20;
	}
	.overlay-bg {
		position: absolute;
		inset: 0;
		background:
			radial-gradient(ellipse 70% 50% at 50% 50%, rgba(255,90,0,0.08), transparent 60%),
			rgba(0,0,0,0.85);
		backdrop-filter: blur(4px);
	}
	.run-card {
		position: relative;
		z-index: 1;
		width: min(560px, 92%);
		background: linear-gradient(180deg, rgba(14,14,14,0.95), rgba(6,6,6,0.95));
		border: 1px solid rgba(255,90,0,0.25);
		border-radius: 14px;
		padding: 26px 28px;
		box-shadow:
			0 20px 60px rgba(0,0,0,0.6),
			0 0 40px rgba(255,90,0,0.08);
		display: flex;
		flex-direction: column;
		gap: 18px;
	}

	.run-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.run-title {
		display: flex;
		align-items: center;
		gap: 10px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 13px;
		color: #ff5a00;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.title-pulse {
		width: 8px; height: 8px;
		border-radius: 50%;
		background: #ff5a00;
		box-shadow: 0 0 12px rgba(255,90,0,0.7);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		0%, 100% { opacity: 1; transform: scale(1); }
		50% { opacity: 0.5; transform: scale(0.85); }
	}
	.run-percent {
		font-family: 'Share Tech Mono', monospace;
		font-size: 28px;
		color: #f4f4f4;
		font-weight: 500;
		letter-spacing: 0.02em;
	}
	.run-percent .pct {
		font-size: 14px;
		color: #777;
		margin-left: 2px;
	}

	.run-message {
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		color: #c8c8c8;
		letter-spacing: 0.04em;
	}

	.progress-track {
		position: relative;
		height: 6px;
		background: #131313;
		border-radius: 999px;
		overflow: hidden;
	}
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #ff5a00, #ff8a30);
		border-radius: 999px;
		transition: width 0.5s ease;
		box-shadow: 0 0 12px rgba(255, 90, 0, 0.55);
	}
	.progress-shimmer {
		position: absolute;
		inset: 0;
		background: linear-gradient(
			90deg,
			transparent 0%,
			rgba(255,255,255,0.08) 50%,
			transparent 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.6s linear infinite;
		pointer-events: none;
	}
	@keyframes shimmer {
		0% { background-position: 200% 0; }
		100% { background-position: -200% 0; }
	}

	.run-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 10px;
	}
	.stat {
		padding: 10px 12px;
		background: rgba(0,0,0,0.4);
		border: 1px solid #1a1a1a;
		border-radius: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.stat-label {
		font-family: 'Share Tech Mono', monospace;
		font-size: 9px;
		color: #555;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.stat-val {
		font-family: 'Share Tech Mono', monospace;
		font-size: 16px;
		color: #e8e8e8;
	}

	.run-phases {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 4px;
		padding-top: 4px;
	}
	.phase {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #444;
		letter-spacing: 0.04em;
	}
	.phase-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px; height: 20px;
		border-radius: 50%;
		border: 1px solid #2a2a2a;
		font-size: 10px;
		color: #555;
		background: #050505;
		flex-shrink: 0;
	}
	.phase.active { color: #ff5a00; }
	.phase.active .phase-num {
		border-color: #ff5a00;
		color: #ff5a00;
		background: rgba(255,90,0,0.08);
		box-shadow: 0 0 10px rgba(255,90,0,0.3);
		animation: pulse-soft 1.6s ease-in-out infinite;
	}
	.phase.done { color: #26a65b; }
	.phase.done .phase-num {
		border-color: #26a65b;
		color: #26a65b;
		background: rgba(38,166,91,0.08);
	}
	@keyframes pulse-soft {
		0%, 100% { box-shadow: 0 0 10px rgba(255,90,0,0.3); }
		50% { box-shadow: 0 0 18px rgba(255,90,0,0.55); }
	}
	.phase-bar {
		flex: 1;
		height: 1px;
		background: #1f1f1f;
		min-width: 8px;
	}
	.phase-bar.done { background: #26a65b55; }

	.run-hint {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		background: rgba(255,90,0,0.04);
		border: 1px solid rgba(255,90,0,0.18);
		border-radius: 8px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #aaa;
		line-height: 1.4;
	}
	.run-hint svg {
		width: 14px; height: 14px;
		color: #ff5a00;
		flex-shrink: 0;
	}

	/* Error banner */
	.error-banner {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		background: #1a0000;
		border-top: 1px solid #ff4757;
		padding: 12px 24px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		z-index: 30;
	}
	.error-banner p { color: #ff4757; margin: 0; font-size: 13px; font-family: 'Share Tech Mono', monospace; }
	.error-banner button {
		background: transparent;
		border: 1px solid #ff4757;
		color: #ff4757;
		padding: 4px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
		font-family: 'Share Tech Mono', monospace;
	}
	.error-banner button:hover { background: #ff4757; color: #000; }

	@media (max-width: 600px) {
		.run-card { padding: 20px 18px; }
		.phase-name { display: none; }
	}
</style>
