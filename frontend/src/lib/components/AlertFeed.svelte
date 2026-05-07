<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { AlertEvent } from '$lib/server/structAlerts';

	const MAX_DISPLAY = 10;

	const SECTIONS = [
		{ event: 'trader_whale_trade', label: 'WHALE TRADES' },
		{ event: 'price_spike', label: 'PRICE SPIKES' },
		{ event: 'market_volume_spike', label: 'VOLUME SPIKES' }
	] as const;

	function formatUsd(val: unknown): string {
		return '$' + Number(val ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
	}

	function formatPrice(val: unknown): string {
		return Number(val ?? 0).toFixed(2);
	}

	function describe(alert: AlertEvent): string {
		const d = alert.data;
		switch (alert.event) {
			case 'price_spike':
				return `Price spiked ${d.price_change_pct ?? '?'}%`;
			case 'market_volume_spike': {
				const vol = Number(d.volume_usd ?? d.volume ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
				return `Volume surged to $${vol}`;
			}
			default:
				return JSON.stringify(d).slice(0, 80);
		}
	}

	function marketName(alert: AlertEvent): string {
		const d = alert.data;
		return String(d.market_question ?? d.market ?? d.question ?? d.title ?? alert.event);
	}

	function timeAgo(ts: number): string {
		const diff = Math.floor((Date.now() - ts) / 1000);
		if (diff < 5) return 'just now';
		if (diff < 60) return `${diff}s ago`;
		if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
		return `${Math.floor(diff / 3600)}h ago`;
	}

	let byEvent = $state<Record<string, AlertEvent[]>>({
		trader_whale_trade: [],
		price_spike: [],
		market_volume_spike: []
	});

	let es: EventSource | null = null;

	function ingest(alert: AlertEvent) {
		if (!(alert.event in byEvent)) return;
		byEvent[alert.event] = [alert, ...byEvent[alert.event]].slice(0, MAX_DISPLAY);
	}

	onMount(() => {
		es = new EventSource('/api/alerts');

		es.onmessage = (e) => {
			const data = JSON.parse(e.data);
			if (data.type === 'init') {
				for (const alert of [...data.alerts].reverse()) ingest(alert);
			} else {
				ingest(data);
			}
		};

		es.onerror = () => {
			console.warn('[AlertFeed] SSE error — browser will auto-reconnect');
		};
	});

	onDestroy(() => {
		es?.close();
	});
</script>

<section class="news-discovery alerts-section">
	<div class="inner">
		<div class="header">
			<div class="h-left">
				<div class="title">Alerts</div>
			</div>
		</div>

		<div class="grid">
			{#each SECTIONS as section, i}
				<div
					class="panel"
					class:col-first={i === 0}
					class:col-last={i === SECTIONS.length - 1}
				>
					<div class="panel-head">
						<span class="ph-title">{section.label}</span>
						<span class="ph-meta">{byEvent[section.event].length} items</span>
					</div>
					<div class="panel-body scroll">
						{#if byEvent[section.event].length === 0}
							<div class="state">Waiting for alerts…</div>
						{:else}
							{#each byEvent[section.event] as alert (alert.id)}
								{#if alert.event === 'trader_whale_trade'}
									<div class="item">
										<div class="rmeta">
											<span class="badge">{String(alert.data.outcome ?? '—').toUpperCase()}</span>
											<span class="badge dim">{timeAgo(alert.receivedAt)}</span>
										</div>
										<div class="it-title">{String(alert.data.question ?? alert.data.market ?? '—')}</div>
										<div class="rmeta tail">
											<span class="badge dim">{(alert.data.side ?? '—').toString().toUpperCase()}</span>
											<span class="badge">{formatUsd(alert.data.amount_usd)}</span>
											<span class="badge dim">@{formatPrice(alert.data.price)}</span>
										</div>
									</div>
								{:else if alert.event === 'price_spike'}
									<div class="item">
										<div class="rmeta">
											<span
												class="badge"
												class:badge-up={String(alert.data.spike_direction).toLowerCase() === 'up'}
												class:badge-down={String(alert.data.spike_direction).toLowerCase() === 'down'}
											>
												{String(alert.data.spike_direction ?? '—').toUpperCase()}
											</span>
											<span class="badge dim">{timeAgo(alert.receivedAt)}</span>
										</div>
										<div class="it-title">
											{String(alert.data.question ?? alert.data.event_slug ?? alert.data.condition_id ?? '—')}
										</div>
										<div class="rmeta tail">
											<span class="badge dim">{String(alert.data.outcome ?? '—')}</span>
											<span class="badge">{Number(alert.data.spike_pct ?? 0).toFixed(1)}%</span>
										</div>
									</div>
								{:else if alert.event === 'market_volume_spike'}
									<div class="item">
										<div class="rmeta">
											<span class="badge">{String(alert.data.timeframe ?? '—').toUpperCase()}</span>
											<span class="badge dim">{timeAgo(alert.receivedAt)}</span>
										</div>
										<div class="it-title">{String(alert.data.condition_id ?? '—')}</div>
										<div class="rmeta tail">
											<span class="badge">+{Number(alert.data.spike_pct ?? 0).toFixed(1)}%</span>
											<span class="badge dim">{alert.data.txns ?? 0} txns</span>
											<span class="badge dim">{formatUsd(alert.data.current_volume_usd)} vol</span>
										</div>
									</div>
								{:else}
									<div class="item">
										<div class="rmeta">
											<span class="badge">{alert.event}</span>
											<span class="badge dim">{timeAgo(alert.receivedAt)}</span>
										</div>
										<div class="it-title">{marketName(alert)}</div>
										<p class="body">{describe(alert)}</p>
									</div>
								{/if}
							{/each}
						{/if}
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	/* Align with NewsDiscoveryPanel: chrome, typography, panel shell */
	.news-discovery.alerts-section {
		background: #000;
		border-bottom: 1px solid #222;
	}
	.inner {
		max-width: none;
		margin: 0;
		padding: 18px 0 22px;
	}
	.header {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: 16px;
		margin: 0 0 14px 0;
		padding: 0 18px;
		flex-wrap: wrap;
	}
	.title {
		font-size: 26px;
		font-weight: 800;
		color: #fff;
		letter-spacing: -0.02em;
		margin-top: 4px;
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 14px;
		align-items: stretch;
		padding: 0;
	}

	.panel {
		border: 1px solid #333;
		border-radius: 10px;
		background: #0a0a0a;
		overflow: hidden;
		height: 320px;
		max-height: 320px;
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.panel.col-first {
		border-left: 0;
	}
	.panel.col-last {
		border-right: 0;
	}

	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		background: #000;
		border-bottom: 1px solid #222;
		flex-shrink: 0;
	}
	.ph-title {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.18em;
		color: #ff9500;
	}
	.ph-meta {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		color: #c4c4c4;
	}

	.panel-body {
		padding: 10px 12px;
		flex: 1;
		min-height: 0;
	}
	.scroll {
		overflow-y: auto;
		min-height: 0;
		flex: 1;
	}

	.state {
		color: #c4c4c4;
		font-family: 'Courier New', monospace;
		font-size: 12px;
		padding: 12px 4px;
	}

	.item {
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid #1b1b1b;
		border-radius: 8px;
		padding: 8px 10px;
		margin-bottom: 8px;
	}
	.item:last-child {
		margin-bottom: 0;
	}

	/* Match NewsDiscoveryPanel reader: .rmeta + .badge / .badge.dim */
	.rmeta {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		align-items: center;
		margin-bottom: 8px;
	}
	.rmeta.tail {
		margin-bottom: 0;
		margin-top: 8px;
	}

	.badge {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.06em;
		color: #ff9500;
		border: 1px solid rgba(255, 149, 0, 0.35);
		background: rgba(255, 149, 0, 0.08);
		padding: 4px 8px;
		border-radius: 999px;
	}
	.badge.dim {
		color: #e0e0e0;
		border-color: #555;
		background: rgba(255, 255, 255, 0.06);
		font-weight: 700;
	}
	.badge-up {
		color: #00ff66;
		border-color: rgba(0, 255, 102, 0.45);
		background: rgba(0, 255, 102, 0.1);
	}
	.badge-down {
		color: #ff6b6b;
		border-color: rgba(255, 107, 107, 0.45);
		background: rgba(255, 107, 107, 0.1);
	}

	.it-title {
		color: #fff;
		font-size: 13px;
		line-height: 1.45;
		font-weight: 600;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.body {
		color: #bdbdbd;
		font-size: 13px;
		line-height: 1.65;
		margin: 8px 0 0;
	}

	@media (max-width: 1100px) {
		.grid {
			grid-template-columns: 1fr;
		}
		.panel {
			height: 260px;
			max-height: 260px;
			border-left: 1px solid #333;
			border-right: 1px solid #333;
		}
		.panel.col-first,
		.panel.col-last {
			border-left: 1px solid #333;
			border-right: 1px solid #333;
		}
	}
</style>
