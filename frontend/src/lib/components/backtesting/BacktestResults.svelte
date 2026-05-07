<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	interface TradeLogEntry {
		timestamp: string;
		market: string;
		side: 'BUY' | 'SELL';
		quantity: number;
		price: number;
		fees: number;
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
		trade_log: TradeLogEntry[];
		error: string | null;
	}

	let { result, paths, onBack }: {
		result: EngineResult;
		paths: string[];
		onBack: () => void;
	} = $props();

	let activeTab: 'overview' | 'trades' | 'equity' = $state('overview');

	function n(v: number | null | undefined): number {
		return typeof v === 'number' && isFinite(v) ? v : 0;
	}
	function fmt$(v: number): string {
		const val = n(v);
		return `${val >= 0 ? '+' : ''}$${Math.abs(val).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	}
	function fmtPct(v: number | null): string {
		const val = n(v);
		return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`;
	}
	function fmtNum(v: number | null, decimals = 2): string {
		if (v === null || !isFinite(v)) return '—';
		return v.toFixed(decimals);
	}
	function fmtDate(s: string): string {
		try {
			return new Date(s).toLocaleString('en-US', { month: 'short', day: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit' });
		} catch {
			return s;
		}
	}

	const isProfitable = $derived(result.final_portfolio_value >= result.initial_capital);

	// Compute equity curve: cash + open positions valued at latest trade price
	const equityCurve = $derived.by(() => {
		const trades = result.trade_log ?? [];
		if (trades.length === 0) return [];

		let cash = result.initial_capital;
		const positions: Record<string, number> = {};  // market → qty held
		const lastPrice: Record<string, number> = {};  // market → last seen price

		const portfolioValue = () =>
			cash + Object.entries(positions).reduce((sum, [mkt, qty]) => sum + qty * (lastPrice[mkt] ?? 0), 0);

		const points: { t: string; v: number }[] = [{ t: trades[0].timestamp, v: result.initial_capital }];

		for (const t of trades) {
			lastPrice[t.market] = t.price;
			if (t.side === 'BUY') {
				cash -= t.quantity * t.price + t.fees;
				positions[t.market] = (positions[t.market] ?? 0) + t.quantity;
			} else {
				cash += t.quantity * t.price - t.fees;
				positions[t.market] = Math.max(0, (positions[t.market] ?? 0) - t.quantity);
			}
			points.push({ t: t.timestamp, v: portfolioValue() });
		}

		// Anchor the last point to the engine's authoritative final value
		points[points.length - 1].v = result.final_portfolio_value;

		return points;
	});

	const chartData = $derived.by(() => {
		const pts = equityCurve;
		if (pts.length < 2) return null;

		// SVG virtual canvas
		const W = 820, H = 300;
		const ML = 78, MR = 16, MT = 16, MB = 44;
		const CW = W - ML - MR;
		const CH = H - MT - MB;

		const vals = pts.map((p) => p.v);
		const minV = Math.min(...vals);
		const maxV = Math.max(...vals);
		const vPad = (maxV - minV) * 0.06 || 10;
		const vMin = minV - vPad;
		const vMax = maxV + vPad;
		const vRange = vMax - vMin;

		const times = pts.map((p) => new Date(p.t).getTime()).filter((t) => isFinite(t));
		const tMin = Math.min(...times);
		const tMax = Math.max(...times);
		const tRange = tMax - tMin || 1;

		const toX = (t: string) => ML + ((new Date(t).getTime() - tMin) / tRange) * CW;
		const toY = (v: number) => MT + (1 - (v - vMin) / vRange) * CH;

		// Line + fill paths
		const linePts = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.t).toFixed(1)},${toY(p.v).toFixed(1)}`).join(' ');
		const baseY = (MT + CH).toFixed(1);
		const fillPath = `${linePts} L${toX(pts[pts.length - 1].t).toFixed(1)},${baseY} L${toX(pts[0].t).toFixed(1)},${baseY} Z`;

		// Y ticks (6 evenly spaced dollar values)
		const yTickCount = 6;
		const yTicks = Array.from({ length: yTickCount }, (_, i) => {
			const frac = i / (yTickCount - 1);
			const v = vMin + frac * vRange;
			return {
				y: toY(v).toFixed(1),
				label: '$' + Math.round(v).toLocaleString()
			};
		});

		// X ticks (5 evenly spaced dates)
		const xTickCount = 5;
		const xTicks = Array.from({ length: xTickCount }, (_, i) => {
			const frac = i / (xTickCount - 1);
			const ms = tMin + frac * tRange;
			const idx = Math.min(Math.round(frac * (pts.length - 1)), pts.length - 1);
			return {
				x: toX(pts[idx].t).toFixed(1),
				label: new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
			};
		});

		const color = vals[vals.length - 1] >= vals[0] ? '#26a65b' : '#ef5350';
		const fillColor = vals[vals.length - 1] >= vals[0] ? 'rgba(38,166,91,0.1)' : 'rgba(239,83,80,0.1)';

		return { W, H, ML, MR, MT, MB, CW, CH, linePts, fillPath, yTicks, xTicks, color, fillColor };
	});

	function exportCSV() {
		const headers = ['#', 'Timestamp', 'Market', 'Side', 'Qty', 'Price', 'Fees'];
		const rows = (result.trade_log ?? []).map((t, i) => [
			i + 1, t.timestamp, `"${t.market}"`, t.side,
			n(t.quantity).toFixed(4), n(t.price).toFixed(4), n(t.fees).toFixed(4)
		]);
		const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
		const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
		const link = document.createElement('a');
		link.href = URL.createObjectURL(blob);
		link.download = `backtest_trades_${new Date().toISOString().slice(0, 10)}.csv`;
		link.style.visibility = 'hidden';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
	}
</script>

<div class="results">
	<!-- Hero -->
	<div class="hero">
		<div class="hero-left">
			<div class="hero-label">ENDING CAPITAL</div>
			<div class="hero-value" class:positive={isProfitable} class:negative={!isProfitable}>
				${n(result.final_portfolio_value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
			</div>
			<div class="hero-sub">
				<span class="sub-pill" class:positive={result.total_return_pct >= 0} class:negative={result.total_return_pct < 0}>
					ROI {fmtPct(result.total_return_pct)}
				</span>
				<span class="sub-pill">TRADES {result.total_trades}</span>
				<span class="sub-pill">FEES ${n(result.total_fees).toFixed(2)}</span>
				{#if result.max_drawdown_pct !== null}
					<span class="sub-pill">DD {fmtNum(result.max_drawdown_pct)}%</span>
				{/if}
			</div>
		</div>
		<div class="hero-right">
			<div class="hero-meta">
				<div><span class="k">Initial capital</span><span class="v">${n(result.initial_capital).toLocaleString()}</span></div>
				<div><span class="k">Files</span><span class="v">{paths.length}</span></div>
				<div><span class="k">Job ID</span><span class="v dim">{result.job_id?.slice(0, 8) ?? '—'}…</span></div>
			</div>
			<div class="hero-actions">
				<button class="btn" onclick={onBack}>← New backtest</button>
				<button class="btn" onclick={exportCSV}>Export CSV</button>
			</div>
		</div>
	</div>

	<!-- Tabs -->
	<div class="tabs">
		<button class="tab" class:active={activeTab === 'overview'} onclick={() => (activeTab = 'overview')}>Overview</button>
		<button class="tab" class:active={activeTab === 'trades'} onclick={() => (activeTab = 'trades')}>Trades ({result.total_trades})</button>
		<button class="tab" class:active={activeTab === 'equity'} onclick={() => (activeTab = 'equity')}>Equity curve</button>
	</div>

	{#if activeTab === 'overview'}
		<div class="grid">
			<div class="panel">
				<div class="ph">P&amp;L</div>
				<div class="row"><span>Starting capital</span><span class="val">${n(result.initial_capital).toLocaleString()}</span></div>
				<div class="row"><span>Ending capital</span><span class="val" class:positive={isProfitable} class:negative={!isProfitable}>${n(result.final_portfolio_value).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</span></div>
				<div class="row"><span>Return</span><span class="val" class:positive={result.total_return_pct >= 0} class:negative={result.total_return_pct < 0}>{fmtPct(result.total_return_pct)}</span></div>
				<div class="row"><span>Total fees</span><span class="val">-${n(result.total_fees).toFixed(4)}</span></div>
			</div>
			<div class="panel">
				<div class="ph">Trade stats</div>
				<div class="row"><span>Total trades</span><span class="val">{result.total_trades}</span></div>
				<div class="row"><span>Buys</span><span class="val">{(result.trade_log ?? []).filter(t => t.side === 'BUY').length}</span></div>
				<div class="row"><span>Sells</span><span class="val">{(result.trade_log ?? []).filter(t => t.side === 'SELL').length}</span></div>
			</div>
			<div class="panel">
				<div class="ph">Risk ratios</div>
				<div class="row"><span>Sharpe</span><span class="val">{fmtNum(result.sharpe_ratio)}</span></div>
				<div class="row"><span>Sortino</span><span class="val">{fmtNum(result.sortino_ratio)}</span></div>
				<div class="row"><span>Calmar</span><span class="val">{fmtNum(result.calmar_ratio)}</span></div>
				<div class="row"><span>Max drawdown</span><span class="val negative">{result.max_drawdown_pct !== null ? `-${fmtNum(result.max_drawdown_pct)}%` : '—'}</span></div>
				<div class="row"><span>Volatility (ann.)</span><span class="val">{fmtNum(result.volatility_annualized)}</span></div>
			</div>
		</div>

	{:else if activeTab === 'trades'}
		<div class="table-wrap">
			{#if (result.trade_log ?? []).length === 0}
				<div class="empty">No trades executed.</div>
			{:else}
				<table class="tbl">
					<thead>
						<tr>
							<th>#</th>
							<th>Timestamp</th>
							<th>Market</th>
							<th>Side</th>
							<th>Qty</th>
							<th>Price</th>
							<th>Fees</th>
						</tr>
					</thead>
					<tbody>
						{#each result.trade_log as t, i}
							<tr>
								<td class="dim">{i + 1}</td>
								<td class="dim">{fmtDate(t.timestamp)}</td>
								<td class="mkt">{t.market}</td>
								<td class:buy={t.side === 'BUY'} class:sell={t.side === 'SELL'}>{t.side}</td>
								<td class="dim">{n(t.quantity).toFixed(4)}</td>
								<td class="dim">${n(t.price).toFixed(4)}</td>
								<td class="dim">${n(t.fees).toFixed(4)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

	{:else}
		<div class="equity-panel">
			{#if chartData}
				{@const c = chartData}
				<svg
					viewBox="0 0 {c.W} {c.H}"
					preserveAspectRatio="xMidYMid meet"
					class="equity-svg"
				>
					<!-- Y grid lines + labels -->
					{#each c.yTicks as tick}
						<line
							x1={c.ML} y1={tick.y}
							x2={c.ML + c.CW} y2={tick.y}
							stroke="rgba(255,255,255,0.05)" stroke-width="1"
						/>
						<text
							x={c.ML - 8} y={tick.y}
							text-anchor="end" dominant-baseline="middle"
							class="axis-label"
						>{tick.label}</text>
					{/each}

					<!-- X grid lines + labels -->
					{#each c.xTicks as tick}
						<line
							x1={tick.x} y1={c.MT}
							x2={tick.x} y2={c.MT + c.CH}
							stroke="rgba(255,255,255,0.05)" stroke-width="1"
						/>
						<text
							x={tick.x} y={c.MT + c.CH + 20}
							text-anchor="middle" dominant-baseline="middle"
							class="axis-label"
						>{tick.label}</text>
					{/each}

					<!-- Axis lines -->
					<line
						x1={c.ML} y1={c.MT}
						x2={c.ML} y2={c.MT + c.CH}
						stroke="rgba(255,255,255,0.15)" stroke-width="1"
					/>
					<line
						x1={c.ML} y1={c.MT + c.CH}
						x2={c.ML + c.CW} y2={c.MT + c.CH}
						stroke="rgba(255,255,255,0.15)" stroke-width="1"
					/>

					<!-- Filled area -->
					<path d={c.fillPath} fill={c.fillColor} />

					<!-- Equity line -->
					<path d={c.linePts} fill="none" stroke={c.color} stroke-width="1.5" stroke-linejoin="round" />
				</svg>
			{:else}
				<div class="empty">Not enough trades to plot equity curve.</div>
			{/if}
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
		grid-template-columns: 1fr 320px;
		gap: 18px;
		padding: 16px 20px;
		border-bottom: 1px solid #1a1a1a;
		background: #000;
		flex-shrink: 0;
	}
	.hero-label {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.12em;
		font-size: 10px;
		color: #9a9a9a;
	}
	.hero-value {
		font-family: 'Share Tech Mono', monospace;
		font-size: 32px;
		font-weight: 900;
		margin-top: 6px;
	}
	.hero-value.positive { color: #26a65b; }
	.hero-value.negative { color: #ef5350; }
	.hero-sub { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
	.sub-pill {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 999px;
		padding: 5px 10px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #e8e8e8;
	}
	.sub-pill.positive { border-color: rgba(38,166,91,0.4); color: #26a65b; }
	.sub-pill.negative { border-color: rgba(239,83,80,0.4); color: #ef5350; }
	.hero-right { display: flex; flex-direction: column; gap: 10px; }
	.hero-meta { display: grid; gap: 5px; font-family: 'Share Tech Mono', monospace; font-size: 11px; color: #bdbdbd; }
	.k { color: #555; margin-right: 8px; }
	.v { color: #e8e8e8; }
	.v.dim { color: #555; }
	.hero-actions { display: flex; gap: 8px; }
	.btn {
		background: #111;
		border: 1px solid #333;
		color: #e8e8e8;
		padding: 7px 12px;
		border-radius: 8px;
		font-size: 12px;
		font-family: 'Share Tech Mono', monospace;
		cursor: pointer;
	}
	.btn:hover { border-color: rgba(255,149,0,0.5); color: #ff9500; }

	.tabs {
		display: flex;
		gap: 8px;
		padding: 10px 16px 0;
		border-bottom: 1px solid #1a1a1a;
		flex-shrink: 0;
	}
	.tab {
		background: transparent;
		border: 1px solid #1a1a1a;
		border-bottom: none;
		color: #bdbdbd;
		padding: 7px 12px;
		border-radius: 8px 8px 0 0;
		cursor: pointer;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		letter-spacing: 0.08em;
	}
	.tab.active { color: #ff9500; border-color: rgba(255,149,0,0.5); }

	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
		padding: 14px 16px;
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
		border-bottom: 1px solid rgba(255,255,255,0.05);
		color: #bdbdbd;
		font-size: 12px;
	}
	.row:last-child { border-bottom: none; }
	.val { font-family: 'Share Tech Mono', monospace; color: #e8e8e8; }
	.positive { color: #26a65b !important; }
	.negative { color: #ef5350 !important; }

	.table-wrap { padding: 12px 16px 18px; overflow: auto; flex: 1; min-height: 0; }
	.tbl { width: 100%; border-collapse: collapse; font-size: 12px; }
	.tbl th, .tbl td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,0.05); vertical-align: top; }
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
	.mkt { max-width: 360px; word-break: break-word; }
	.buy { color: #26a65b; font-family: 'Share Tech Mono', monospace; font-weight: 700; }
	.sell { color: #ef5350; font-family: 'Share Tech Mono', monospace; font-weight: 700; }

	.equity-panel {
		flex: 1;
		min-height: 0;
		padding: 20px 20px 12px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	.equity-svg {
		flex: 1;
		min-height: 0;
		width: 100%;
		display: block;
	}
	.equity-svg :global(.axis-label) {
		font-family: 'Share Tech Mono', ui-monospace, monospace;
		font-size: 11px;
		fill: #555;
	}
	.empty {
		padding: 20px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		color: #444;
	}

	@media (max-width: 900px) {
		.hero { grid-template-columns: 1fr; }
		.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
	@media (max-width: 600px) {
		.grid { grid-template-columns: 1fr; }
	}
</style>
