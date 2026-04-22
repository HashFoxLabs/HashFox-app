<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	import { walletStore } from '$lib/wallet/stores';
	import type { BacktestResult } from '$lib/backtesting/types';
	import ConfigTerminal from './ConfigTerminal.svelte';
	import CodeEditor from './CodeEditor.svelte';
	import BacktestResults from './BacktestResults.svelte';

	// Strategy sub-tab state
	let strategyTab: 'configure' | 'strategy' | 'results' = $state('configure');
	let isRunning = $state(false);
	let progress = $state(0);
	let progressMessage = $state('');
	let error = $state('');

	// Config from terminal wizard
	let engineConfig: any = $state(null);
	let configState: any = $state({});

	// Backtest results
	let backtestResult: BacktestResult | null = $state(null);

	// Legacy config for API calls (kept for compatibility)
	let config: any = $state({
		specificMarkets: [],
		categories: [],
		initialBankroll: 10000,
		entryType: 'BOTH',
		startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
		endDate: new Date(),
		positionSizing: {
			type: 'PERCENTAGE',
			fixedAmount: 100,
			percentageOfBankroll: 5,
			maxExposurePercent: undefined
		},
		entryPriceThreshold: { yes: { min: 0.3, max: 0.7 }, no: { min: 0.3, max: 0.7 } },
		exitRules: {
			resolveOnExpiry: true,
			stopLoss: undefined,
			takeProfit: undefined,
			maxHoldTime: undefined,
			trailingStop: { enabled: false, activationPercent: undefined, trailPercent: undefined },
			partialExits: {
				enabled: false,
				takeProfit1: { percent: undefined, sellPercent: undefined },
				takeProfit2: { percent: undefined, sellPercent: undefined }
			}
		},
		tradeFrequency: { maxTradesPerDay: undefined, cooldownHours: undefined },
		entryTimeConstraints: { earliestEntry: undefined, latestEntry: undefined }
	});

	let selectedMarkets: any[] = $state([]);

	function handleConfigComplete(cfg: any) {
		engineConfig = cfg.config;
		configState = cfg;
		selectedMarkets = cfg.selectedMarkets || [];
		strategyTab = 'strategy';
	}

	function handleEditConfig() {
		strategyTab = 'configure';
	}

	async function handleRunBacktest(
		strategyCode: string,
		strategyType: string | null,
		strategyParams?: any
	) {
		const isSynthesis = configState.dataSource === 'synthesis';
		if (isSynthesis) {
			await runSynthesisBacktest(strategyCode, strategyType, strategyParams);
		} else {
			await runLegacyBacktest(strategyCode);
		}
	}

	let lastStrategyParams: any = $state(null);

	async function runSynthesisBacktest(strategyCode: string, strategyType: string | null, strategyParams?: any) {
		isRunning = true;
		error = '';
		progress = 0;
		progressMessage = 'Sending backtest request...';
		strategyTab = 'results';
		lastStrategyParams = strategyParams;

		try {
			if (selectedMarkets.length === 0) {
				throw new Error('No markets selected. Go back and select markets in the config.');
			}
			if (!strategyType) {
				throw new Error('Please select one of the example strategies (load 1-5) before running.');
			}

			progress = 10;
			progressMessage = 'Running backtest on server...';

			const response = await fetch('/api/backtest/run', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					markets: selectedMarkets,
					strategyType,
					strategyCode,
					initialCash: strategyParams?.initialCash ?? config.initialBankroll ?? 10000,
					reimburseOpenPositions: strategyParams?.reimburseOpenPositions ?? false,
					priceInf: strategyParams?.priceInf ?? null,
					priceSup: strategyParams?.priceSup ?? null,
					position: configState.config?.position ?? null,
					timestampStart: configState.useTimePeriod ? configState.timestampStartStr : null,
					timestampEnd: configState.useTimePeriod ? configState.timestampEndStr : null,
					strategyParams: strategyParams?.strategyParams ?? null,
					stopLoss: strategyParams?.stopLoss ?? null,
					takeProfit: strategyParams?.takeProfit ?? null,
					trailingStop: strategyParams?.trailingStop ?? null,
					maxHoldHours: strategyParams?.maxHoldHours ?? null
				})
			});

			if (!response.ok) {
				const errData = await response.json().catch(() => ({}));
				throw new Error((errData as any).error || 'Failed to run backtest');
			}

			// Parse NDJSON stream for progress updates and final result
			const reader = response.body!.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
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
						backtestResult = {
							...msg.data,
							strategyConfig: {
								strategyType,
								initialCash: lastStrategyParams?.initialCash ?? config.initialBankroll ?? 10000,
								priceInf: lastStrategyParams?.priceInf ?? null,
								priceSup: lastStrategyParams?.priceSup ?? null,
								position: configState.config?.position ?? null,
								stopLoss: lastStrategyParams?.stopLoss ?? null,
								takeProfit: lastStrategyParams?.takeProfit ?? null,
								trailingStop: lastStrategyParams?.trailingStop ?? null,
								maxHoldHours: lastStrategyParams?.maxHoldHours ?? null
							}
						} as BacktestResult;
						progress = 100;
						progressMessage = 'Backtest complete!';
					} else if (msg.type === 'error') {
						throw new Error(msg.error);
					}
				}
			}

			if (!backtestResult) {
				throw new Error('No result received from backtest engine.');
			}
		} catch (err: any) {
			error = err?.message || 'An error occurred during backtest';
			strategyTab = 'strategy';
		} finally {
			isRunning = false;
		}
	}

	async function runLegacyBacktest(strategyCode: string) {
		// Legacy mode kept for parity; requires an external API (not used in the unified build by default).
		isRunning = true;
		error = '';
		progress = 0;
		progressMessage = 'Running backtest...';
		strategyTab = 'results';

		try {
			const progressInterval = setInterval(() => {
				progress = Math.min(progress + 10, 90);
			}, 500);

			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), 180000);

			const response = await fetch(`https://main-production-5e3b.up.railway.app/api/backtest`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					...config,
					strategyCode,
					engineConfig
				}),
				signal: controller.signal
			});

			clearTimeout(timeoutId);
			clearInterval(progressInterval);

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error((errorData as any).error || 'Backtest failed');
			}

			backtestResult = (await response.json()) as BacktestResult;
			progress = 100;
		} catch (err: any) {
			if (err?.name === 'AbortError') {
				error = 'Request timeout - try reducing the date range or number of markets.';
			} else {
				error = err?.message || 'An error occurred';
			}
			strategyTab = 'strategy';
		} finally {
			isRunning = false;
		}
	}
</script>

<div class="backtesting-container">
	<div class="strategy-backtesting">
		{#if strategyTab === 'configure'}
			<ConfigTerminal onConfigComplete={handleConfigComplete} />
		{:else if strategyTab === 'strategy'}
			<CodeEditor
				dataSource={configState.dataSource ?? 'synthesis'}
				useTimePeriod={configState.useTimePeriod ?? false}
				timestampStartStr={configState.timestampStartStr ?? ''}
				timestampEndStr={configState.timestampEndStr ?? ''}
				filterTitleSearch={configState.filterTitleSearch ?? ''}
				filterCategories={configState.filterCategories ?? new Set()}
				filterVolumeInf={configState.filterVolumeInf ?? null}
				filterVolumeSup={configState.filterVolumeSup ?? null}
				{selectedMarkets}
				onEditConfig={handleEditConfig}
				onRunBacktest={handleRunBacktest}
			/>
		{:else if strategyTab === 'results' && backtestResult}
			<BacktestResults
				{backtestResult}
				{selectedMarkets}
				config={{
					...config,
					strategyType: backtestResult.strategyConfig?.strategyType,
					exitRules: {
						...config.exitRules,
						stopLoss: backtestResult.strategyConfig?.stopLoss,
						takeProfit: backtestResult.strategyConfig?.takeProfit,
						trailingStop: backtestResult.strategyConfig?.trailingStop,
						maxHoldTime: backtestResult.strategyConfig?.maxHoldHours
					},
					strategyParams: backtestResult.strategyConfig
				}}
				walletConnected={$walletStore.connected}
			/>
		{/if}

		{#if isRunning}
			<div class="running-overlay">
				<div class="skel-progress-section">
					<div class="skel-spinner">
						<svg viewBox="0 0 50 50">
							<circle cx="25" cy="25" r="20" fill="none" stroke="#1a1a1a" stroke-width="3" />
							<circle
								cx="25"
								cy="25"
								r="20"
								fill="none"
								stroke="#f97316"
								stroke-width="3"
								stroke-dasharray="31.4 94.2"
								stroke-linecap="round"
								class="spinner-arc"
							/>
						</svg>
					</div>
					<div class="skel-progress-info">
						<p class="skel-progress-msg">{progressMessage || 'Initializing backtest engine...'}</p>
						<div class="skel-progress-track">
							<div class="skel-progress-fill" style="width: {progress}%"></div>
						</div>
						<div class="skel-progress-steps">
							<span class="skel-step" class:done={progress >= 5} class:active={progress > 0 && progress < 5}>Connecting</span>
							<span class="skel-step-dot"></span>
							<span class="skel-step" class:done={progress >= 20} class:active={progress >= 5 && progress < 20}>Fetching trades</span>
							<span class="skel-step-dot"></span>
							<span class="skel-step" class:done={progress >= 90} class:active={progress >= 20 && progress < 90}>Running strategy</span>
							<span class="skel-step-dot"></span>
							<span class="skel-step" class:done={progress >= 100} class:active={progress >= 90 && progress < 100}>Finalizing</span>
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if error}
			<div class="error-banner">
				<p>{error}</p>
				<button on:click={() => (error = '')}>Dismiss</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.backtesting-container {
		height: 100%;
		background: #000000;
		color: white;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.strategy-backtesting {
		width: 100%;
		max-width: 100%;
		margin: 0;
		padding: 0;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		position: relative;
	}

	.running-overlay {
		position: absolute;
		inset: 0;
		background: rgba(10, 10, 10, 0.95);
		display: flex;
		flex-direction: column;
		z-index: 10;
		overflow: hidden;
	}

	/* Progress section */
	.skel-progress-section {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 18px 24px;
		background: #000;
		border-bottom: 1px solid #1a1a1a;
	}
	.skel-spinner {
		width: 36px;
		height: 36px;
		flex-shrink: 0;
	}
	.skel-spinner svg {
		width: 100%;
		height: 100%;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.spinner-arc {
		transform-origin: center;
		animation: spin 1s linear infinite;
	}
	.skel-progress-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.skel-progress-msg {
		margin: 0;
		font-size: 13px;
		font-family: 'Share Tech Mono', monospace;
		color: #f97316;
		letter-spacing: 0.5px;
	}
	.skel-progress-track {
		width: 100%;
		height: 3px;
		background: #1a1a1a;
		border-radius: 2px;
		overflow: hidden;
	}
	.skel-progress-fill {
		height: 100%;
		background: linear-gradient(90deg, #f97316, #fb923c);
		border-radius: 2px;
		transition: width 0.4s ease;
		box-shadow: 0 0 8px rgba(249, 115, 22, 0.5);
	}
	.skel-progress-steps {
		display: flex;
		align-items: center;
		gap: 6px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		letter-spacing: 0.5px;
	}
	.skel-step {
		color: #333;
		transition: color 0.3s ease;
	}
	.skel-step.active {
		color: #f97316;
	}
	.skel-step.done {
		color: #666;
	}
	.skel-step-dot {
		width: 12px;
		height: 1px;
		background: #222;
	}

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

	.error-banner p {
		color: #ff4757;
		margin: 0;
		font-size: 14px;
	}

	.error-banner button {
		background: transparent;
		border: 1px solid #ff4757;
		color: #ff4757;
		padding: 4px 12px;
		border-radius: 4px;
		cursor: pointer;
		font-size: 12px;
	}

	.error-banner button:hover {
		background: #ff4757;
		color: #000;
	}
</style>

