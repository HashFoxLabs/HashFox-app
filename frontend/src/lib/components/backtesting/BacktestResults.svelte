<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	import type { BacktestResult } from '$lib/backtesting/types';
	import BacktestChart from './BacktestChart.svelte';

	let { backtestResult, selectedMarkets, config, walletConnected }: {
		backtestResult: BacktestResult;
		selectedMarkets: any[];
		config: any;
		walletConnected: boolean;
	} = $props();

	/** Safe number: treats null/undefined/NaN as 0 */
	function n(v: any): number {
		return typeof v === 'number' && !isNaN(v) ? v : 0;
	}

	const m = $derived(backtestResult.metrics);
	const isProfitable = $derived((backtestResult.endingCapital ?? 0) >= (backtestResult.startingCapital ?? 0));

	let activeTab: 'overview' | 'trades' | 'analysis' = $state('overview');

	function fmt$(val: number): string {
		const v = n(val);
		return `${v >= 0 ? '+' : ''}$${Math.abs(v).toLocaleString(undefined, {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		})}`;
	}
	function fmtPct(val: number): string {
		const v = n(val);
		return `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
	}
	function fmtDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
	}
	function fmtHours(h: number): string {
		const v = n(h);
		if (v < 1) return `${(v * 60).toFixed(0)}m`;
		if (v < 24) return `${v.toFixed(1)}h`;
		return `${(v / 24).toFixed(1)}d`;
	}

	function exportJSON() {
		const data = {
			summary: {
				startingCapital: backtestResult.startingCapital,
				endingCapital: backtestResult.endingCapital,
				marketsAnalyzed: backtestResult.marketsAnalyzed,
				executionTime: backtestResult.executionTime
			},
			metrics: backtestResult.metrics,
			trades: backtestResult.trades,
			equityCurve: backtestResult.metrics?.equityCurve || [],
			config: backtestResult.strategyConfig
		};
		downloadFile(JSON.stringify(data, null, 2), `backtest_${new Date().toISOString().slice(0, 10)}.json`, 'application/json');
	}

	function exportCSV() {
		const headers = ['#', 'Market', 'Side', 'Entry Time', 'Exit Time', 'Entry Price', 'Exit Price', 'Amount', 'Shares', 'P&L', 'P&L %', 'Exit Reason', 'Duration (h)'];
		const rows = (backtestResult.trades || []).map((t: any, i: number) => [
			i + 1, `"${t.marketName || ''}"`, t.side || '',
			t.entryTime ? new Date(t.entryTime).toISOString() : '', t.exitTime ? new Date(t.exitTime).toISOString() : '',
			n(t.entryPrice).toFixed(4), n(t.exitPrice).toFixed(4), n(t.amountInvested).toFixed(2), n(t.shares).toFixed(4),
			n(t.pnl).toFixed(2), n(t.pnlPercentage).toFixed(2), t.exitReason || '', t.holdingDuration ? n(t.holdingDuration).toFixed(1) : '',
		]);
		downloadFile([headers.join(','), ...rows.map(r => r.join(','))].join('\n'), `backtest_trades_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv');
	}

	function downloadFile(content: string, filename: string, type: string) {
		const blob = new Blob([content], { type: `${type};charset=utf-8;` });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = filename;
		link.style.visibility = 'hidden';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}
</script>

<div class="results">
	<div class="hero">
		<div class="hero-left">
			<div class="hero-label">ENDING CAPITAL</div>
			<div class="hero-value" class:positive={isProfitable} class:negative={!isProfitable}>
				${n(backtestResult.endingCapital).toLocaleString(undefined, { maximumFractionDigits: 0 })}
			</div>
			<div class="hero-sub">
				<span class="sub-pill">ROI {fmtPct(n(m?.roi))}</span>
				<span class="sub-pill">TRADES {n(m?.totalTrades)}</span>
				<span class="sub-pill">WIN {n(m?.winRate).toFixed(1)}%</span>
				<span class="sub-pill">DD {n(m?.maxDrawdownPercentage).toFixed(2)}%</span>
			</div>
		</div>

		<div class="hero-right">
			<div class="hero-meta">
				<div><span class="k">Markets</span><span class="v">{backtestResult.marketsAnalyzed}</span></div>
				<div><span class="k">Runtime</span><span class="v">{Math.round(n(backtestResult.executionTime))}ms</span></div>
				<div><span class="k">Start</span><span class="v">{fmtDate(backtestResult.strategyConfig?.startDate ?? new Date())}</span></div>
				<div><span class="k">End</span><span class="v">{fmtDate(backtestResult.strategyConfig?.endDate ?? new Date())}</span></div>
			</div>
			<div class="hero-actions">
				<button class="btn" on:click={exportJSON}>Export JSON</button>
				<button class="btn" on:click={exportCSV}>Export CSV</button>
			</div>
			{#if !walletConnected}
				<div class="hint">Connect wallet to enable any on-chain/paper-trading actions. Backtesting works without it.</div>
			{/if}
		</div>
	</div>

	<BacktestChart {backtestResult} />

	<div class="tabs">
		<button class="tab" class:active={activeTab === 'overview'} on:click={() => (activeTab = 'overview')}>Overview</button>
		<button class="tab" class:active={activeTab === 'trades'} on:click={() => (activeTab = 'trades')}>Trades</button>
		<button class="tab" class:active={activeTab === 'analysis'} on:click={() => (activeTab = 'analysis')}>Analysis</button>
	</div>

	{#if activeTab === 'overview'}
		<div class="grid">
			<div class="panel">
				<div class="ph">PnL</div>
				<div class="row"><span>Gross</span><span class="val">{fmt$(n(m?.totalPnl))}</span></div>
				<div class="row"><span>Fees</span><span class="val">-${n(m?.totalFees).toFixed(2)}</span></div>
				<div class="row"><span>Net</span><span class="val" class:positive={n(m?.netPnl) >= 0} class:negative={n(m?.netPnl) < 0}>{fmt$(n(m?.netPnl))}</span></div>
			</div>
			<div class="panel">
				<div class="ph">Trade stats</div>
				<div class="row"><span>Total</span><span class="val">{n(m?.totalTrades)}</span></div>
				<div class="row"><span>Wins</span><span class="val positive">{n(m?.winningTrades)}</span></div>
				<div class="row"><span>Losses</span><span class="val negative">{n(m?.losingTrades)}</span></div>
				<div class="row"><span>Best</span><span class="val positive">{fmt$(n(m?.bestTrade))}</span></div>
				<div class="row"><span>Worst</span><span class="val negative">{fmt$(n(m?.worstTrade))}</span></div>
			</div>
			<div class="panel">
				<div class="ph">Risk</div>
				<div class="row"><span>Max DD</span><span class="val negative">-{Math.abs(n(m?.maxDrawdownPercentage)).toFixed(2)}%</span></div>
				<div class="row"><span>Sharpe</span><span class="val">{n(m?.sharpeRatio).toFixed(2)}</span></div>
				<div class="row"><span>Volatility</span><span class="val">{n(m?.volatility).toFixed(2)}</span></div>
				<div class="row"><span>Profit factor</span><span class="val">{n(m?.profitFactor).toFixed(2)}</span></div>
			</div>
			<div class="panel">
				<div class="ph">Timing</div>
				<div class="row"><span>Avg hold</span><span class="val">{fmtHours(n(m?.avgHoldTime))}</span></div>
				<div class="row"><span>Median win</span><span class="val positive">{fmt$(n(m?.medianWin))}</span></div>
				<div class="row"><span>Median loss</span><span class="val negative">{fmt$(n(m?.medianLoss))}</span></div>
				<div class="row"><span>Expectancy</span><span class="val">{n(m?.expectancy).toFixed(2)}</span></div>
			</div>
		</div>
	{:else if activeTab === 'trades'}
		<div class="table-wrap">
			<table class="tbl">
				<thead>
					<tr>
						<th>#</th>
						<th>Market</th>
						<th>Side</th>
						<th>Entry</th>
						<th>Exit</th>
						<th>PnL</th>
						<th>PnL%</th>
						<th>Hold</th>
						<th>Reason</th>
					</tr>
				</thead>
				<tbody>
					{#each backtestResult.trades || [] as t, i}
						<tr>
							<td class="dim">{i + 1}</td>
							<td class="mkt">{t.marketName}</td>
							<td class="dim">{t.side}</td>
							<td class="dim">{t.entryTime ? fmtDate(t.entryTime) : ''}</td>
							<td class="dim">{t.exitTime ? fmtDate(t.exitTime) : ''}</td>
							<td class:positive={n(t.pnl) >= 0} class:negative={n(t.pnl) < 0}>{fmt$(n(t.pnl))}</td>
							<td class:positive={n(t.pnlPercentage) >= 0} class:negative={n(t.pnlPercentage) < 0}>{fmtPct(n(t.pnlPercentage))}</td>
							<td class="dim">{t.holdingDuration ? fmtHours(n(t.holdingDuration)) : ''}</td>
							<td class="dim">{t.exitReason || ''}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{:else}
		<div class="analysis">
			<div class="panel">
				<div class="ph">Run config</div>
				<pre class="pre">{JSON.stringify(backtestResult.strategyConfig ?? config ?? {}, null, 2)}</pre>
			</div>
			<div class="panel">
				<div class="ph">Selected markets</div>
				<pre class="pre">{JSON.stringify((selectedMarkets ?? []).slice(0, 15), null, 2)}</pre>
			</div>
		</div>
	{/if}
</div>

<style>
	.results {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: #000;
	}
	.hero {
		display: grid;
		grid-template-columns: 1fr 420px;
		gap: 18px;
		padding: 16px 20px;
		border-bottom: 1px solid #1a1a1a;
		background: #000;
	}
	.hero-label {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.12em;
		font-size: 10px;
		color: #9a9a9a;
	}
	.hero-value {
		font-family: 'Share Tech Mono', monospace;
		font-size: 34px;
		font-weight: 900;
		margin-top: 6px;
	}
	.hero-value.positive { color: #26a65b; }
	.hero-value.negative { color: #ef5350; }
	.hero-sub {
		display: flex;
		gap: 10px;
		flex-wrap: wrap;
		margin-top: 10px;
	}
	.sub-pill {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 999px;
		padding: 6px 10px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #e8e8e8;
	}
	.hero-right { display: flex; flex-direction: column; gap: 10px; }
	.hero-meta {
		display: grid;
		gap: 6px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #bdbdbd;
	}
	.k { color: #777; margin-right: 8px; }
	.v { color: #e8e8e8; }
	.hero-actions { display: flex; gap: 10px; }
	.btn {
		background: #111;
		border: 1px solid #333;
		color: #e8e8e8;
		padding: 8px 12px;
		border-radius: 10px;
		font-size: 12px;
		cursor: pointer;
	}
	.btn:hover { border-color: rgba(255,149,0,0.6); }
	.hint {
		color: #777;
		font-size: 11px;
		line-height: 1.35;
	}
	.tabs {
		display: flex;
		gap: 8px;
		padding: 10px 16px 0;
		border-bottom: 1px solid #1a1a1a;
	}
	.tab {
		background: transparent;
		border: 1px solid #1a1a1a;
		border-bottom: none;
		color: #bdbdbd;
		padding: 8px 12px;
		border-radius: 8px 8px 0 0;
		cursor: pointer;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		letter-spacing: 0.08em;
	}
	.tab.active {
		color: #ff9500;
		border-color: rgba(255,149,0,0.6);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 14px;
		padding: 14px 16px 16px;
		overflow: auto;
	}
	.panel {
		background: #0a0a0a;
		border: 1px solid #1a1a1a;
		border-radius: 12px;
		padding: 14px;
	}
	.ph {
		font-family: 'Share Tech Mono', monospace;
		color: #ff9500;
		letter-spacing: 0.12em;
		font-size: 10px;
		margin-bottom: 10px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 6px 0;
		border-bottom: 1px solid rgba(255,255,255,0.06);
		color: #bdbdbd;
		font-size: 12px;
	}
	.row:last-child { border-bottom: none; }
	.val { font-family: 'Share Tech Mono', monospace; color: #e8e8e8; }
	.positive { color: #26a65b !important; }
	.negative { color: #ef5350 !important; }

	.table-wrap { padding: 12px 16px 18px; overflow: auto; }
	.tbl {
		width: 100%;
		border-collapse: collapse;
		font-size: 12px;
	}
	.tbl th, .tbl td {
		padding: 10px 10px;
		border-bottom: 1px solid rgba(255,255,255,0.06);
		vertical-align: top;
	}
	.tbl th {
		position: sticky;
		top: 0;
		background: #000;
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.08em;
		color: #9a9a9a;
		font-size: 10px;
		text-align: left;
	}
	.dim { color: #9a9a9a; font-family: 'Share Tech Mono', monospace; }
	.mkt { max-width: 520px; }

	.analysis {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 14px;
		padding: 14px 16px 16px;
		overflow: auto;
	}
	.pre {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		color: #cfcfcf;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		line-height: 1.35;
	}

	@media (max-width: 980px) {
		.hero { grid-template-columns: 1fr; }
		.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.analysis { grid-template-columns: 1fr; }
	}
</style>

