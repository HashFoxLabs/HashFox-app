<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	let { onSelect }: {
		onSelect: (type: 'highfrequency' | 'longrun') => void;
	} = $props();

	const HIGH_FREQ_SOURCES = ['Polymarket', 'Crypto', 'Stocks', 'Forex'];
	const LONGRUN_SOURCES = ['Polymarket', 'CryptoMinute', 'ForexMinute', 'StocksMinute'];
</script>

<div class="selector">
	<div class="header">
		<div class="header-label">BACKTEST ENGINE</div>
		<p class="header-sub">Choose the data granularity before selecting your markets.</p>
	</div>

	<div class="cards">
		<button class="card" onclick={() => onSelect('highfrequency')}>
			<div class="card-top">
				<div class="card-badge hf">HF</div>
				<div class="card-title">High-Frequency</div>
			</div>
			<div class="card-tagline">Tick-level data · millisecond precision</div>
			<div class="card-desc">
				Best for intraday momentum, microstructure, and short-horizon strategies operating on individual trade ticks.
			</div>
			<div class="card-sources">
				{#each HIGH_FREQ_SOURCES as s}
					<span class="source-chip">{s}</span>
				{/each}
			</div>
			<div class="card-cta">Select →</div>
		</button>

		<button class="card" onclick={() => onSelect('longrun')}>
			<div class="card-top">
				<div class="card-badge lr">LR</div>
				<div class="card-title">Long-Run</div>
			</div>
			<div class="card-tagline">1-minute bars · multi-day strategies</div>
			<div class="card-desc">
				Best for swing trading, trend-following, and strategies operating on multi-day or multi-year horizons.
			</div>
			<div class="card-sources">
				{#each LONGRUN_SOURCES as s}
					<span class="source-chip">{s}</span>
				{/each}
			</div>
			<div class="card-cta">Select →</div>
		</button>
	</div>
</div>

<style>
	.selector {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		background: #000;
		padding: 40px 24px;
		gap: 40px;
	}

	.header {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.header-label {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.18em;
		font-size: 11px;
		color: #ff5a00;
	}
	.header-sub {
		margin: 0;
		font-family: 'Share Tech Mono', monospace;
		font-size: 13px;
		color: #555;
	}

	.cards {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
		width: 100%;
		max-width: 740px;
	}

	.card {
		background: #080808;
		border: 1px solid #1c1c1c;
		border-radius: 12px;
		padding: 28px 24px;
		cursor: pointer;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 14px;
		transition: border-color 0.18s, box-shadow 0.18s, background 0.18s;
		color: inherit;
	}
	.card:hover {
		border-color: rgba(255, 90, 0, 0.5);
		background: #0c0c0c;
		box-shadow: 0 0 28px rgba(255, 90, 0, 0.07);
	}

	.card-top {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.card-badge {
		width: 36px;
		height: 36px;
		border-radius: 8px;
		display: flex;
		align-items: center;
		justify-content: center;
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		font-weight: 700;
		flex-shrink: 0;
		letter-spacing: 0.05em;
	}
	.card-badge.hf {
		background: rgba(255, 90, 0, 0.12);
		border: 1px solid rgba(255, 90, 0, 0.3);
		color: #ff5a00;
	}
	.card-badge.lr {
		background: rgba(99, 179, 237, 0.1);
		border: 1px solid rgba(99, 179, 237, 0.25);
		color: #63b3ed;
	}

	.card-title {
		font-family: 'Share Tech Mono', monospace;
		font-size: 16px;
		color: #e8e8e8;
		letter-spacing: 0.04em;
	}
	.card-tagline {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #777;
		letter-spacing: 0.06em;
	}
	.card-desc {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #555;
		line-height: 1.65;
	}
	.card-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.source-chip {
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid #222;
		border-radius: 999px;
		padding: 3px 10px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #888;
		letter-spacing: 0.04em;
	}
	.card-cta {
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		color: #444;
		margin-top: 4px;
		letter-spacing: 0.06em;
		transition: color 0.15s;
	}
	.card:hover .card-cta {
		color: #ff5a00;
	}

	@media (max-width: 640px) {
		.cards { grid-template-columns: 1fr; }
	}
</style>
