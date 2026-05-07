<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	export let rawData: { timestamp: string; equity: number }[] | undefined = undefined;
	export let positive: boolean = true;
	export let height: number = 140;

	let container: HTMLDivElement;
	let chart: any = null;
	let resizeObs: ResizeObserver | null = null;
	let cancelled = false;

	async function build() {
		if (!container || !rawData || rawData.length < 2) return;

		const seen = new Set<string>();
		const chartData: { time: string; value: number }[] = [];
		for (const p of rawData) {
			const day = p.timestamp.slice(0, 10);
			if (seen.has(day)) {
				chartData[chartData.length - 1].value = p.equity;
			} else {
				seen.add(day);
				chartData.push({ time: day, value: p.equity });
			}
		}
		if (chartData.length < 2) return;

		const lc = await import('lightweight-charts');
		if (cancelled || !container) return;

		chart = lc.createChart(container, {
			width: container.clientWidth,
			height,
			layout: {
				background: { type: lc.ColorType.Solid, color: 'transparent' },
				textColor: '#666',
				fontFamily: "'Courier New', monospace",
				fontSize: 10
			},
			grid: {
				vertLines: { color: 'rgba(255,255,255,0.03)' },
				horzLines: { color: 'rgba(255,255,255,0.03)' }
			},
			rightPriceScale: {
				borderVisible: false,
				scaleMargins: { top: 0.1, bottom: 0.05 }
			},
			timeScale: {
				borderVisible: false,
				timeVisible: false
			},
			crosshair: {
				horzLine: { visible: false, labelVisible: false },
				vertLine: {
					visible: true,
					labelVisible: false,
					color: 'rgba(255, 90, 0,0.3)',
					style: lc.LineStyle.Dashed
				}
			},
			handleScroll: { mouseWheel: false, pressedMouseMove: false },
			handleScale: { mouseWheel: false, pinch: false, axisPressedMouseMove: false }
		});

		const lineColor = positive ? '#00ff66' : '#ff6b6b';
		const series = chart.addSeries(lc.AreaSeries, {
			lineColor,
			topColor: positive ? 'rgba(0,255,102,0.22)' : 'rgba(255,107,107,0.22)',
			bottomColor: 'rgba(0,0,0,0)',
			lineWidth: 2,
			crosshairMarkerVisible: true,
			crosshairMarkerRadius: 3,
			crosshairMarkerBorderColor: '#ff5a00',
			crosshairMarkerBackgroundColor: '#000',
			priceFormat: { type: 'price', precision: 2, minMove: 0.01 }
		});
		series.setData(chartData);

		const baseline = chart.addSeries(lc.LineSeries, {
			color: 'rgba(255, 90, 0,0.22)',
			lineWidth: 1,
			lineStyle: lc.LineStyle.Dashed,
			priceLineVisible: false,
			lastValueVisible: false,
			crosshairMarkerVisible: false
		});
		baseline.setData(chartData.map((d) => ({ time: d.time, value: chartData[0].value })));

		chart.timeScale().fitContent();

		resizeObs = new ResizeObserver(() => {
			if (chart && container) chart.applyOptions({ width: container.clientWidth });
		});
		resizeObs.observe(container);
	}

	onMount(() => {
		cancelled = false;
		build();
	});

	onDestroy(() => {
		cancelled = true;
		if (resizeObs) resizeObs.disconnect();
		if (chart) {
			chart.remove();
			chart = null;
		}
	});

	$: hasData = rawData && rawData.length >= 2;
</script>

{#if hasData}
	<div bind:this={container} class="equity-chart" style="height: {height}px"></div>
{/if}

<style>
	.equity-chart {
		width: 100%;
	}
</style>
