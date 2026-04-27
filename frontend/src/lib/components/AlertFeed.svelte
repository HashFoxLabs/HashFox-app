<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { AlertEvent } from '$lib/server/structAlerts';

	const MAX_DISPLAY = 10;

	const SECTIONS = [
		{ event: 'trader_whale_trade', label: '🐳 WHALE TRADES' },
		{ event: 'price_spike',        label: '🔥 PRICE SPIKES' },
		{ event: 'market_volume_spike', label: '📊 VOLUME SPIKES' }
	];

	function formatUsd(val: unknown): string {
		return '$' + Number(val ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
	}

	function formatPrice(val: unknown): string {
		return Number(val ?? 0).toFixed(2);
	}

	function formatDate(val: unknown): string {
		const ts = Number(val ?? 0);
		if (!ts) return '—';
		const d = new Date(ts < 1e12 ? ts * 1000 : ts);
		return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

<div class="alert-grid">
	{#each SECTIONS as section}
		<div class="alert-feed">
			<div class="feed-header">{section.label}</div>
			{#if byEvent[section.event].length === 0}
				<div class="empty">Waiting for alerts…</div>
			{:else}
				{#each byEvent[section.event] as alert (alert.id)}
					{#if alert.event === 'trader_whale_trade'}
						<div class="alert-card">
							<div class="card-top">
								<span class="market">{String(alert.data.question ?? alert.data.market ?? '—')}</span>
								<span class="timestamp">{timeAgo(alert.receivedAt)}</span>
							</div>
							<div class="whale-row">
								<span class="tag {String(alert.data.outcome).toLowerCase()}">{alert.data.outcome ?? '—'}</span>
								<span class="tag side">{alert.data.side ?? '—'}</span>
								<span class="amount">{formatUsd(alert.data.amount_usd)}</span>
							</div>
							<div class="whale-row secondary">
								<span>Price <strong>{formatPrice(alert.data.price)}</strong></span>
								<span>{formatDate(alert.data.confirmed_at)}</span>
							</div>
						</div>
					{:else if alert.event === 'price_spike'}
						<div class="alert-card">
							<div class="card-top">
								<span class="market">{String(alert.data.question ?? alert.data.event_slug ?? alert.data.condition_id ?? '—')}</span>
								<span class="timestamp">{timeAgo(alert.receivedAt)}</span>
							</div>
							<div class="whale-row">
								<span class="tag {String(alert.data.spike_direction) === 'up' ? 'yes' : 'no'}">
									{alert.data.spike_direction === 'up' ? '▲' : '▼'} {alert.data.spike_direction}
								</span>
								<span class="tag side">{alert.data.outcome ?? '—'}</span>
								<span class="amount">{Number(alert.data.spike_pct ?? 0).toFixed(1)}%</span>
							</div>
						</div>
					{:else if alert.event === 'market_volume_spike'}
						<div class="alert-card">
							<div class="card-top">
								<span class="market">{String(alert.data.condition_id ?? '—')}</span>
								<span class="timestamp">{timeAgo(alert.receivedAt)}</span>
							</div>
							<div class="whale-row">
								<span class="tag side">{alert.data.timeframe ?? '—'}</span>
								<span class="amount">+{Number(alert.data.spike_pct ?? 0).toFixed(1)}%</span>
							</div>
							<div class="whale-row secondary">
								<span>{alert.data.txns ?? 0} trades occurred</span>
								<span>{formatUsd(alert.data.current_volume_usd)} volume</span>
							</div>
						</div>
					{:else}
						<div class="alert-card">
							<div class="card-top">
								<span class="market">{marketName(alert)}</span>
								<span class="timestamp">{timeAgo(alert.receivedAt)}</span>
							</div>
							<div class="desc">{describe(alert)}</div>
						</div>
					{/if}
				{/each}
			{/if}
		</div>
	{/each}
</div>

<style>
	.alert-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.alert-feed {
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		font-family: 'Courier New', monospace;
		font-size: 12px;
		color: #ccc;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.feed-header {
		padding: 8px 12px;
		font-size: 10px;
		letter-spacing: 0.1em;
		color: #ff9500;
		border-bottom: 1px solid #222;
		background: #111;
	}

	.empty {
		padding: 16px 12px;
		color: #555;
		font-size: 11px;
	}

	.alert-card {
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a1a;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.alert-card:last-child {
		border-bottom: none;
	}

	.card-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.market {
		color: #fff;
		font-size: 11px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.timestamp {
		color: #555;
		font-size: 10px;
		flex-shrink: 0;
	}

	.desc {
		color: #888;
		font-size: 11px;
	}

	.whale-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}

	.whale-row.secondary {
		color: #666;
		font-size: 10px;
		justify-content: space-between;
	}

	.whale-row.secondary strong {
		color: #aaa;
	}

	.tag {
		font-size: 10px;
		font-weight: bold;
		padding: 1px 6px;
		border-radius: 3px;
		text-transform: uppercase;
	}

	.tag.yes { background: #003d1a; color: #00ff64; }
	.tag.no  { background: #3d0000; color: #ff4444; }
	.tag.side { background: #1a1a00; color: #ff9500; }

	.amount {
		font-size: 13px;
		font-weight: bold;
		color: #fff;
		margin-left: auto;
	}
</style>
