<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import type { BacktestResult } from '$lib/backtesting/types';

	let { backtestResult }: { backtestResult: BacktestResult } = $props();

	let equityEl: HTMLDivElement;
	let drawdownEl: HTMLDivElement;
	let tradesEl: HTMLDivElement;

	let equityChart: any = null;
	let drawdownChart: any = null;
	let tradesChart: any = null;
	let resizeObs: ResizeObserver | null = null;

	const m = $derived(backtestResult.metrics);
	const isProfitable = $derived(
		(backtestResult.endingCapital ?? 0) >= (backtestResult.startingCapital ?? 0)
	);

	function safeNum(v: any): number {
		return typeof v === 'number' && !isNaN(v) ? v : 0;
	}

	// ── Chart theme ────────────────────────────────────────────────────────
	function chartOpts(lc: any, el: HTMLElement, height: number) {
		return {
			width: el.clientWidth || 400,
			height,
			layout: {
				background: { color: '#0a0a0a' },
				textColor: '#c9c9c9',
				fontFamily: 'Share Tech Mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
			},
			grid: {
				vertLines: { color: 'rgba(255,255,255,0.04)' },
				horzLines: { color: 'rgba(255,255,255,0.04)' },
			},
			rightPriceScale: {
				borderColor: 'rgba(255,255,255,0.08)',
			},
			timeScale: {
				borderColor: 'rgba(255,255,255,0.08)',
				timeVisible: true,
				secondsVisible: false,
			},
			crosshair: {
				vertLine: { color: 'rgba(249,115,22,0.2)' },
				horzLine: { color: 'rgba(249,115,22,0.2)' },
			},
		};
	}

	function toUnix(d: any): number {
		const t = new Date(d).getTime();
		return Math.floor((isNaN(t) ? Date.now() : t) / 1000);
	}

	async function initCharts() {
		if (!browser) return;
		const lc = await import('lightweight-charts');
		if (!equityEl || !drawdownEl || !tradesEl) return;

		// ── Chart 1: Equity Curve ────────────────────────────────────────
		equityChart = lc.createChart(equityEl, chartOpts(lc, equityEl, equityEl.clientHeight || 200));
		const eqSeries = equityChart.addSeries(lc.AreaSeries, {
			lineColor: isProfitable ? '#26a65b' : '#ef5350',
			topColor: isProfitable ? 'rgba(38,166,91,0.25)' : 'rgba(239,83,80,0.25)',
			bottomColor: 'rgba(10,10,10,0.0)',
			lineWidth: 2,
		});
		const eq = (m?.equityCurve || []).map((p: any) => ({ time: toUnix(p.timestamp), value: safeNum(p.equity) }));
		eqSeries.setData(eq);

		// Baseline at starting capital
		const blSeries = equityChart.addSeries(lc.LineSeries, {
			color: 'rgba(255,255,255,0.12)',
			lineWidth: 1,
			lineStyle: 2,
		});
		blSeries.setData(
			eq.length
				? [
						{ time: eq[0].time, value: safeNum(backtestResult.startingCapital) },
						{ time: eq[eq.length - 1].time, value: safeNum(backtestResult.startingCapital) }
					]
				: []
		);
		equityChart.timeScale().fitContent();

		// ── Chart 2: Drawdown ────────────────────────────────────────────
		drawdownChart = lc.createChart(drawdownEl, chartOpts(lc, drawdownEl, drawdownEl.clientHeight || 200));
		const ddSeries = drawdownChart.addSeries(lc.AreaSeries, {
			lineColor: '#f97316',
			topColor: 'rgba(249,115,22,0.25)',
			bottomColor: 'rgba(10,10,10,0.0)',
			lineWidth: 2,
		});
		const dd = (m?.drawdownCurve || []).map((p: any) => ({
			time: toUnix(p.timestamp),
			value: -Math.abs(safeNum(p.drawdownPercentage || p.drawdown || 0))
		}));
		ddSeries.setData(dd);
		drawdownChart.timeScale().fitContent();

		// ── Chart 3: Trade Activity ──────────────────────────────────────
		tradesChart = lc.createChart(tradesEl, chartOpts(lc, tradesEl, tradesEl.clientHeight || 200));

		const trades = backtestResult.trades || [];
		// Histogram of invested amount (proxy volume)
		const hist = trades.map((t: any) => ({
			time: toUnix(t.entryTime),
			value: safeNum(t.amountInvested),
			color: safeNum(t.pnl) >= 0 ? 'rgba(38,166,91,0.7)' : 'rgba(239,83,80,0.7)'
		}));
		const histSeries = tradesChart.addSeries(lc.HistogramSeries, {
			priceScaleId: 'cost',
		});
		histSeries.setData(hist);
		tradesChart.priceScale('cost').applyOptions({
			scaleMargins: { top: 0.2, bottom: 0.2 },
		});

		// Line series of entry prices
		const lineSeries = tradesChart.addSeries(lc.LineSeries, {
			color: 'rgba(255,255,255,0.35)',
			lineWidth: 2,
		});
		lineSeries.setData(
			trades.map((t: any) => ({ time: toUnix(t.entryTime), value: safeNum(t.entryPrice) }))
		);
		tradesChart.timeScale().fitContent();

		// Resize observer
		resizeObs = new ResizeObserver(() => {
			if (equityEl && equityChart) equityChart.applyOptions({ width: equityEl.clientWidth, height: equityEl.clientHeight });
			if (drawdownEl && drawdownChart) drawdownChart.applyOptions({ width: drawdownEl.clientWidth, height: drawdownEl.clientHeight });
			if (tradesEl && tradesChart) tradesChart.applyOptions({ width: tradesEl.clientWidth, height: tradesEl.clientHeight });
		});
		resizeObs.observe(equityEl);
		resizeObs.observe(drawdownEl);
		resizeObs.observe(tradesEl);
	}

	onMount(() => {
		if (browser) setTimeout(() => initCharts(), 100);
	});

	onDestroy(() => {
		resizeObs?.disconnect();
		resizeObs = null;
		equityChart?.remove();
		drawdownChart?.remove();
		tradesChart?.remove();
		equityChart = null;
		drawdownChart = null;
		tradesChart = null;
	});
</script>

<div class="charts-row">
	<!-- Chart 1: Equity -->
	<div class="chart-card">
		<div class="chart-head">
			<span class="chart-label">EQUITY CURVE</span>
			<span class="chart-val" class:positive={isProfitable} class:negative={!isProfitable}>
				${(backtestResult.endingCapital ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
			</span>
		</div>
		<div class="chart-body" bind:this={equityEl}></div>
		<div class="chart-foot">
			<span><b>ROI</b> {(m?.roi ?? 0).toFixed(2)}%</span>
			<span><b>DD</b> {(m?.maxDrawdownPercentage ?? 0).toFixed(2)}%</span>
		</div>
	</div>

	<div class="chart-separator"></div>

	<!-- Chart 2: Drawdown -->
	<div class="chart-card">
		<div class="chart-head">
			<span class="chart-label">DRAWDOWN</span>
			<span class="chart-val negative">-{Math.abs(m?.maxDrawdownPercentage ?? 0).toFixed(2)}%</span>
		</div>
		<div class="chart-body" bind:this={drawdownEl}></div>
		<div class="chart-foot">
			<span><b>MAX</b> ${Math.abs(m?.maxDrawdown ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}</span>
			<span><b>SHARPE</b> {(m?.sharpeRatio ?? 0).toFixed(2)}</span>
		</div>
	</div>

	<div class="chart-separator"></div>

	<!-- Chart 3: Trade Activity -->
	<div class="chart-card">
		<div class="chart-head">
			<span class="chart-label">TRADE ACTIVITY</span>
			<span class="chart-val">{m.totalTrades} trades</span>
		</div>
		<div class="chart-body" bind:this={tradesEl}></div>
		<div class="chart-foot">
			<span><b>WIN</b> {(m?.winRate ?? 0).toFixed(1)}%</span>
			<span><b>PF</b> {(m?.profitFactor ?? 0).toFixed(2)}</span>
		</div>
	</div>
</div>

<style>
	.charts-row {
		display: flex;
		gap: 0;
		padding: 12px 16px;
		border-bottom: 1px solid #1a1a1a;
		background: #000;
	}
	.chart-card {
		flex: 1;
		min-width: 0;
		background: #0f0f0f;
		border: 1px solid #1a1a1a;
		border-radius: 8px;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}
	.chart-separator {
		width: 12px;
		flex-shrink: 0;
	}
	.chart-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 10px 14px;
		border-bottom: 1px solid #1a1a1a;
		background: #0a0a0a;
	}
	.chart-label {
		font-size: 10px;
		letter-spacing: 0.12em;
		color: #9a9a9a;
	}
	.chart-val {
		font-size: 12px;
		font-weight: 800;
		font-family: 'Share Tech Mono', monospace;
		color: #e8e8e8;
	}
	.chart-val.positive { color: #26a65b; }
	.chart-val.negative { color: #ef5350; }
	.chart-body {
		flex: 1;
		min-height: 140px;
		margin: 8px;
		border-radius: 4px;
	}
	.chart-foot {
		display: flex;
		justify-content: space-between;
		padding: 8px 14px;
		border-top: 1px solid #1a1a1a;
		background: #0a0a0a;
		font-size: 10px;
		color: #bdbdbd;
		font-family: 'Share Tech Mono', monospace;
	}
	.chart-foot b { color: #f97316; font-weight: 800; }

	@media (max-width: 980px) {
		.charts-row { flex-direction: column; }
		.chart-separator { display: none; }
	}
</style>

