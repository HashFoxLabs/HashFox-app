<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
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

	let backtestResult: EngineResult | null = $state(null);

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

		try {
			const response = await fetch('/api/backtest/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ ...payload, backtest_type: backtestType ?? 'highfrequency' })
			});

			if (!response.ok || !response.body) {
				const errData = await response.json().catch(() => ({}));
				throw new Error((errData as { error?: string }).error || `HTTP ${response.status}`);
			}

			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			let resultReceived = false;

			outer: while (true) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop()!;

				for (const line of lines) {
					if (!line.trim()) continue;
					const msg = JSON.parse(line);
					if (msg.type === 'progress') {
						progress = msg.progress ?? progress;
						progressMessage = msg.message ?? progressMessage;
					} else if (msg.type === 'result') {
						backtestResult = msg.data as EngineResult;
						progress = 100;
						resultReceived = true;
						break outer;
					} else if (msg.type === 'error') {
						throw new Error(msg.error);
					}
				}
			}

			reader.cancel().catch(() => {});

			if (!resultReceived || !backtestResult) throw new Error('No result received from backtest engine.');
			step = 'results';
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		} finally {
			isRunning = false;
		}
	}
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
				<div class="progress-section">
					<div class="spinner">
						<svg viewBox="0 0 50 50">
							<circle cx="25" cy="25" r="20" fill="none" stroke="#1a1a1a" stroke-width="3" />
							<circle
								cx="25" cy="25" r="20"
								fill="none" stroke="#f97316" stroke-width="3"
								stroke-dasharray="31.4 94.2" stroke-linecap="round"
								class="spinner-arc"
							/>
						</svg>
					</div>
					<div class="progress-info">
						<p class="progress-msg">{progressMessage || 'Initializing backtest engine...'}</p>
						<div class="progress-track">
							<div class="progress-fill" style="width: {progress}%"></div>
						</div>
						<div class="progress-steps">
							<span class="step-label" class:done={progress >= 10} class:active={progress > 0 && progress < 10}>Submitting</span>
							<span class="step-dot"></span>
							<span class="step-label" class:done={progress >= 85} class:active={progress >= 10 && progress < 85}>Running</span>
							<span class="step-dot"></span>
							<span class="step-label" class:done={progress >= 100} class:active={progress >= 85 && progress < 100}>Finalizing</span>
						</div>
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

	.overlay {
		position: absolute;
		inset: 0;
		background: rgba(10, 10, 10, 0.95);
		display: flex;
		flex-direction: column;
		z-index: 10;
	}
	.progress-section {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 18px 24px;
		background: #000;
		border-bottom: 1px solid #1a1a1a;
	}
	.spinner { width: 36px; height: 36px; flex-shrink: 0; }
	.spinner svg { width: 100%; height: 100%; }
	@keyframes spin { to { transform: rotate(360deg); } }
	.spinner-arc { transform-origin: center; animation: spin 1s linear infinite; }

	.progress-info { flex: 1; display: flex; flex-direction: column; gap: 8px; }
	.progress-msg {
		margin: 0;
		font-size: 13px;
		font-family: 'Share Tech Mono', monospace;
		color: #f97316;
		letter-spacing: 0.5px;
	}
	.progress-track { width: 100%; height: 3px; background: #1a1a1a; border-radius: 2px; overflow: hidden; }
	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #f97316, #fb923c);
		border-radius: 2px;
		transition: width 0.4s ease;
		box-shadow: 0 0 8px rgba(249,115,22,0.5);
	}
	.progress-steps { display: flex; align-items: center; gap: 6px; font-family: 'Share Tech Mono', monospace; font-size: 10px; }
	.step-label { color: #333; transition: color 0.3s; }
	.step-label.active { color: #f97316; }
	.step-label.done { color: #555; }
	.step-dot { width: 12px; height: 1px; background: #222; }

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
		z-index: 10;
	}
	.error-banner p { color: #ff4757; margin: 0; font-size: 14px; font-family: 'Share Tech Mono', monospace; }
	.error-banner button {
		background: transparent;
		border: 1px solid #ff4757;
		color: #ff4757;
		padding: 4px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
	}
	.error-banner button:hover { background: #ff4757; color: #000; }
</style>
