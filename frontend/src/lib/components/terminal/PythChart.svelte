<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { pythPrices } from '$lib/stores/pythPrices';
	import { findMarket } from '$lib/markets';
	import {
		createChart,
		CandlestickSeries,
		type IChartApi,
		type ISeriesApi,
		type CandlestickData,
		type CandlestickSeriesOptions,
		type Time,
		CrosshairMode,
		LineStyle
	} from 'lightweight-charts';

	export let symbol: string = 'SOL';
	export let interval: string = '1m';

	/** Bucket size in seconds for live aggregation. */
	const INTERVALS: Record<string, number> = {
		'1m': 60,
		'5m': 300,
		'15m': 900,
		'1h': 3600,
		'4h': 14400,
		'1d': 86400
	};
	/** Resolution code expected by the Pyth Benchmarks TradingView UDF. */
	const PYTH_RES: Record<string, string> = {
		'1m': '1',
		'5m': '5',
		'15m': '15',
		'1h': '60',
		'4h': '240',
		'1d': 'D'
	};
	const DEFAULT_BARS: Record<string, number> = {
		'1m': 480,
		'5m': 288,
		'15m': 192,
		'1h': 168,
		'4h': 180,
		'1d': 365
	};
	const INTERVAL_LABELS = Object.keys(INTERVALS);

	let container: HTMLDivElement;
	let chart: IChartApi | null = null;
	let candleSeries: ISeriesApi<'Candlestick', Time> | null = null;
	let currentBar: CandlestickData<Time> | null = null;
	let unsubPrices: (() => void) | undefined;
	let activeKey = '';
	let loadError = '';

	function barTime(ts: number, bucketSec: number): Time {
		return (Math.floor(ts / 1000 / bucketSec) * bucketSec) as Time;
	}

	/** Map a market symbol to the Pyth Benchmarks UDF symbol identifier. */
	function pythBenchmarksSymbol(sym: string): string | null {
		const m = findMarket(sym);
		if (!m) return `Crypto.${sym}/USD`;
		switch (m.sub) {
			case 'crypto':
				return `Crypto.${sym}/USD`;
			case 'stock':
			case 'equity':
				return `Equity.US.${sym}/USD`;
			case 'metal':
				// XAUUSD → Metal.XAU/USD
				return `Metal.${sym.slice(0, 3)}/USD`;
			case 'forex': {
				// EURUSD → FX.EUR/USD ; USDJPY → FX.USD/JPY
				const base = sym.slice(0, 3);
				const quote = sym.slice(3, 6);
				return `FX.${base}/${quote}`;
			}
			default:
				return null;
		}
	}

	function isCryptoMarket(sym: string): boolean {
		const m = findMarket(sym);
		return !m || m.sub === 'crypto';
	}

	/** Binance kline interval codes for our app's intervals. */
	const BINANCE_IV: Record<string, string> = {
		'1m': '1m',
		'5m': '5m',
		'15m': '15m',
		'1h': '1h',
		'4h': '4h',
		'1d': '1d'
	};

	async function fetchCandlesBinance(
		sym: string,
		iv: string
	): Promise<CandlestickData<Time>[]> {
		const ivCode = BINANCE_IV[iv] ?? '1m';
		const limit = Math.min(1000, (DEFAULT_BARS[iv] ?? 200) * 2);
		// Most of our crypto markets are quoted in USD on the program but
		// Binance lists them as USDT pairs. Same number to within a few bps.
		const pair = `${sym}USDT`;
		const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(
			pair
		)}&interval=${ivCode}&limit=${limit}`;
		const response = await fetch(url);
		if (!response.ok) throw new Error(`Binance ${response.status}`);
		const rows = (await response.json()) as Array<
			[number, string, string, string, string, ...unknown[]]
		>;
		const out: CandlestickData<Time>[] = [];
		for (const r of rows) {
			out.push({
				time: Math.floor(r[0] / 1000) as Time,
				open: Number(r[1]),
				high: Number(r[2]),
				low: Number(r[3]),
				close: Number(r[4])
			});
		}
		return out;
	}

	function priceFormatFor(sym: string): Partial<CandlestickSeriesOptions>['priceFormat'] {
		const m = findMarket(sym);
		const decimals = m?.decimals ?? 4;
		const minMove = Math.pow(10, -decimals);
		return { type: 'price', precision: decimals, minMove };
	}

	function quoteFor(sym: string): string {
		const m = findMarket(sym);
		return m?.quote ?? 'USD';
	}

	async function fetchCandlesPyth(
		sym: string,
		iv: string
	): Promise<CandlestickData<Time>[]> {
		const pythSym = pythBenchmarksSymbol(sym);
		if (!pythSym) throw new Error(`No Pyth symbol for ${sym}`);
		const res = PYTH_RES[iv] ?? '15';
		const bars = DEFAULT_BARS[iv] ?? 200;
		const bucket = INTERVALS[iv] ?? 900;
		const now = Math.floor(Date.now() / 1000);
		// Pull ~3× the visible window so we have history for scroll-back.
		const from = now - bucket * Math.max(bars * 3, 600);
		const url = `https://benchmarks.pyth.network/v1/shims/tradingview/history?symbol=${encodeURIComponent(
			pythSym
		)}&resolution=${res}&from=${from}&to=${now}`;
		// Don't let a Pyth outage hang the chart for 30s. AbortController +
		// 6s budget gives the fallback a chance to take over quickly.
		const ctrl = new AbortController();
		const timer = setTimeout(() => ctrl.abort(), 6_000);
		let response: Response;
		try {
			response = await fetch(url, { signal: ctrl.signal });
		} finally {
			clearTimeout(timer);
		}
		if (!response.ok) throw new Error(`Pyth Benchmarks ${response.status}`);
		const data = (await response.json()) as {
			s: string;
			t?: number[];
			o?: number[];
			h?: number[];
			l?: number[];
			c?: number[];
		};
		if (data.s !== 'ok' || !data.t || !data.o || !data.h || !data.l || !data.c) {
			throw new Error(`Pyth Benchmarks status=${data.s}`);
		}
		const out: CandlestickData<Time>[] = [];
		for (let i = 0; i < data.t.length; i++) {
			out.push({
				time: data.t[i] as Time,
				open: data.o[i],
				high: data.h[i],
				low: data.l[i],
				close: data.c[i]
			});
		}
		return out;
	}

	/** Try Pyth Benchmarks first; on failure for a crypto market, fall back
	 *  to Binance klines. Pyth Benchmarks has had repeated outages — the
	 *  fallback keeps the chart populated and the chart's live-tick layer
	 *  (Hermes WS via pythPrices) is unaffected either way. */
	async function fetchCandles(sym: string, iv: string): Promise<CandlestickData<Time>[]> {
		try {
			const out = await fetchCandlesPyth(sym, iv);
			if (out.length > 0) return out;
			throw new Error('Pyth returned 0 bars');
		} catch (pythErr) {
			if (!isCryptoMarket(sym)) throw pythErr;
			console.warn(
				`[PythChart] Pyth Benchmarks failed for ${sym} (${iv}); falling back to Binance`,
				pythErr
			);
			return fetchCandlesBinance(sym, iv);
		}
	}

	async function initChart(sym: string, iv: string) {
		const key = `${sym}:${iv}`;
		if (!container) return;
		if (chart) {
			chart.remove();
			chart = null;
			candleSeries = null;
			currentBar = null;
		}
		activeKey = key;
		loadError = '';

		chart = createChart(container, {
			autoSize: true,
			layout: {
				background: { color: '#0d0d0d' },
				textColor: '#8a8f9a',
				fontFamily: 'Inter, ui-monospace, monospace',
				fontSize: 11
			},
			grid: {
				vertLines: { color: '#1a1a1a' },
				horzLines: { color: '#1a1a1a' }
			},
			crosshair: {
				mode: CrosshairMode.Normal,
				vertLine: { color: '#444', style: LineStyle.Dashed },
				horzLine: { color: '#444', style: LineStyle.Dashed }
			},
			rightPriceScale: { borderColor: '#1e1e1e' },
			timeScale: {
				borderColor: '#1e1e1e',
				timeVisible: true,
				secondsVisible: iv === '1m'
			}
		});

		candleSeries = chart.addSeries(CandlestickSeries, {
			upColor: '#00c076',
			downColor: '#ff4560',
			borderUpColor: '#00c076',
			borderDownColor: '#ff4560',
			wickUpColor: '#00c076',
			wickDownColor: '#ff4560',
			priceFormat: priceFormatFor(sym)
		} satisfies Partial<CandlestickSeriesOptions>);

		try {
			const candles = await fetchCandles(sym, iv);
			if (activeKey !== key) return;
			if (candleSeries && candles.length) {
				candleSeries.setData(candles);
				const bars = DEFAULT_BARS[iv] ?? 96;
				const to = candles.length - 1;
				const from = Math.max(0, to - bars);
				chart.timeScale().setVisibleLogicalRange({ from, to: to + 3 });
				currentBar = { ...candles[candles.length - 1] };
			} else if (candleSeries) {
				loadError = 'No history available';
			}
		} catch (err) {
			loadError = err instanceof Error ? err.message : 'Load failed';
		}
	}

	function onPriceUpdate(price: number) {
		if (!candleSeries || price <= 0) return;
		const bucket = INTERVALS[interval] ?? 60;
		const t = barTime(Date.now(), bucket);
		if (!currentBar || currentBar.time !== t) {
			if (currentBar) candleSeries.update(currentBar);
			currentBar = { time: t, open: price, high: price, low: price, close: price };
		} else {
			currentBar = {
				...currentBar,
				high: Math.max(currentBar.high, price),
				low: Math.min(currentBar.low, price),
				close: price
			};
		}
		candleSeries.update(currentBar);
	}

	function subscribePrices() {
		unsubPrices?.();
		unsubPrices = pythPrices.subscribe((prices) => {
			onPriceUpdate(prices[symbol]?.price ?? 0);
		});
	}

	onMount(async () => {
		await initChart(symbol, interval);
		subscribePrices();
	});

	onDestroy(() => {
		unsubPrices?.();
		chart?.remove();
	});

	let prevSymbol = symbol;
	let prevInterval = interval;
	$: if (symbol !== prevSymbol || interval !== prevInterval) {
		prevSymbol = symbol;
		prevInterval = interval;
		if (chart !== null || activeKey !== '') {
			initChart(symbol, interval).then(subscribePrices);
		}
	}

	$: quote = quoteFor(symbol);
</script>

<div class="wrap">
	<div class="toolbar">
		{#each INTERVAL_LABELS as iv}
			<button type="button" class="iv" class:active={interval === iv} on:click={() => (interval = iv)}>
				{iv.toUpperCase()}
			</button>
		{/each}
		<span class="spacer"></span>
		{#if loadError}
			<span class="err">{loadError}</span>
		{/if}
		<span class="sym">{symbol}/{quote}</span>
	</div>
	<div class="chart" bind:this={container}></div>
</div>

<style>
	.wrap {
		border: 1px solid #333;
		background: #0a0a0a;
		border-radius: 12px;
		overflow: hidden;
		min-height: 420px;
		display: flex;
		flex-direction: column;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 10px;
		background: #000;
		border-bottom: 1px solid #222;
	}
	.iv {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 6px 10px;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: 800;
		letter-spacing: 0.1em;
		cursor: pointer;
	}
	.iv.active {
		border-color: #ff5a00;
		color: #ff5a00;
		background: rgba(255, 90, 0, 0.06);
	}
	.iv:hover { border-color: #444; color: #ccc; }
	.spacer { flex: 1; }
	.err {
		font-family: 'Courier New', monospace;
		font-size: 10px;
		color: #ff8a4d;
		letter-spacing: 0.04em;
	}
	.sym {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: 800;
		color: #e8e8e8;
		letter-spacing: 0.06em;
	}
	.chart {
		flex: 1;
		min-height: 360px;
	}
</style>
