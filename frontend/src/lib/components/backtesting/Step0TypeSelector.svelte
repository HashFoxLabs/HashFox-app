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

	const STEPS = [
		{ id: 1, label: 'Granularity', active: true,  done: false },
		{ id: 2, label: 'Data',        active: false, done: false },
		{ id: 3, label: 'Strategy',    active: false, done: false },
		{ id: 4, label: 'Results',     active: false, done: false }
	];
</script>

<div class="selector">
	<!-- Stepper -->
	<div class="stepper">
		{#each STEPS as s, i}
			<div class="step" class:active={s.active}>
				<span class="step-num">{s.id}</span>
				<span class="step-name">{s.label}</span>
			</div>
			{#if i < STEPS.length - 1}
				<span class="step-bar"></span>
			{/if}
		{/each}
	</div>

	<div class="header">
		<div class="header-label">CHOOSE GRANULARITY</div>
		<h1 class="header-title">How granular should your data be?</h1>
		<p class="header-sub">
			Pick the cadence of the data you want to backtest against. You can change this later by going back.
		</p>
	</div>

	<div class="cards">
		<button class="card hf-card" onclick={() => onSelect('highfrequency')}>
			<div class="card-glow"></div>
			<div class="card-top">
				<div class="card-icon hf">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M3 12h3l2-6 4 12 2-6 3 0"/>
						<circle cx="20" cy="12" r="1.5" fill="currentColor"/>
					</svg>
				</div>
				<div class="card-titles">
					<div class="card-title">High-Frequency</div>
					<div class="card-tagline">Tick-level · millisecond precision</div>
				</div>
				<span class="card-badge hf">HF</span>
			</div>
			<div class="card-desc">
				Best for intraday momentum, microstructure, and short-horizon strategies operating on individual trade ticks.
			</div>
			<div class="card-stats">
				<div class="stat">
					<span class="stat-label">Resolution</span>
					<span class="stat-val">~ms</span>
				</div>
				<div class="stat">
					<span class="stat-label">Horizon</span>
					<span class="stat-val">seconds → days</span>
				</div>
			</div>
			<div class="card-sources">
				{#each HIGH_FREQ_SOURCES as s}
					<span class="source-chip">{s}</span>
				{/each}
			</div>
			<div class="card-cta">Choose High-Frequency →</div>
		</button>

		<button class="card lr-card" onclick={() => onSelect('longrun')}>
			<div class="card-glow"></div>
			<div class="card-top">
				<div class="card-icon lr">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<path d="M3 17l4-4 3 3 5-7 6 8"/>
						<path d="M3 21h18"/>
					</svg>
				</div>
				<div class="card-titles">
					<div class="card-title">Long-Run</div>
					<div class="card-tagline">1-minute bars · multi-day strategies</div>
				</div>
				<span class="card-badge lr">LR</span>
			</div>
			<div class="card-desc">
				Best for swing trading, trend-following, and strategies operating on multi-day or multi-year horizons.
			</div>
			<div class="card-stats">
				<div class="stat">
					<span class="stat-label">Resolution</span>
					<span class="stat-val">1 minute</span>
				</div>
				<div class="stat">
					<span class="stat-label">Horizon</span>
					<span class="stat-val">days → years</span>
				</div>
			</div>
			<div class="card-sources">
				{#each LONGRUN_SOURCES as s}
					<span class="source-chip">{s}</span>
				{/each}
			</div>
			<div class="card-cta">Choose Long-Run →</div>
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
		justify-content: flex-start;
		background:
			radial-gradient(ellipse 60% 50% at 50% 0%, rgba(255,90,0,0.06), transparent 70%),
			#000;
		padding: 28px 24px 40px;
		gap: 28px;
		overflow-y: auto;
	}

	/* Stepper */
	.stepper {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 10px 18px;
		border: 1px solid #1a1a1a;
		border-radius: 999px;
		background: rgba(10,10,10,0.7);
		backdrop-filter: blur(6px);
	}
	.step {
		display: flex;
		align-items: center;
		gap: 8px;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #555;
		letter-spacing: 0.06em;
	}
	.step-num {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		border: 1px solid #2a2a2a;
		font-size: 10px;
		color: #555;
		background: #050505;
	}
	.step.active { color: #ff5a00; }
	.step.active .step-num {
		border-color: rgba(255,90,0,0.55);
		color: #ff5a00;
		background: rgba(255,90,0,0.08);
		box-shadow: 0 0 12px rgba(255,90,0,0.25);
	}
	.step-bar {
		width: 22px;
		height: 1px;
		background: #1f1f1f;
	}

	.header {
		text-align: center;
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 640px;
		margin-top: 8px;
	}
	.header-label {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.2em;
		font-size: 11px;
		color: #ff5a00;
	}
	.header-title {
		margin: 0;
		font-family: 'Share Tech Mono', monospace;
		font-size: 22px;
		color: #f4f4f4;
		letter-spacing: 0.02em;
		font-weight: 500;
	}
	.header-sub {
		margin: 0;
		font-family: 'Share Tech Mono', monospace;
		font-size: 13px;
		color: #666;
		line-height: 1.55;
	}

	.cards {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 18px;
		width: 100%;
		max-width: 880px;
	}

	.card {
		position: relative;
		background: linear-gradient(180deg, #0a0a0a 0%, #060606 100%);
		border: 1px solid #1c1c1c;
		border-radius: 14px;
		padding: 22px 22px 18px;
		cursor: pointer;
		text-align: left;
		display: flex;
		flex-direction: column;
		gap: 14px;
		transition: border-color 0.2s, transform 0.18s, box-shadow 0.2s;
		color: inherit;
		overflow: hidden;
	}
	.card-glow {
		position: absolute;
		inset: -1px;
		border-radius: 14px;
		opacity: 0;
		transition: opacity 0.25s;
		pointer-events: none;
	}
	.hf-card .card-glow { box-shadow: inset 0 0 60px rgba(255, 90, 0, 0.12); }
	.lr-card .card-glow { box-shadow: inset 0 0 60px rgba(99, 179, 237, 0.10); }
	.card:hover {
		border-color: rgba(255, 90, 0, 0.45);
		transform: translateY(-2px);
		box-shadow: 0 6px 28px rgba(0,0,0,0.5), 0 0 24px rgba(255, 90, 0, 0.06);
	}
	.lr-card:hover {
		border-color: rgba(99, 179, 237, 0.4);
		box-shadow: 0 6px 28px rgba(0,0,0,0.5), 0 0 24px rgba(99, 179, 237, 0.08);
	}
	.card:hover .card-glow { opacity: 1; }

	.card-top {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.card-icon {
		width: 42px;
		height: 42px;
		border-radius: 10px;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
	}
	.card-icon svg { width: 22px; height: 22px; }
	.card-icon.hf {
		background: rgba(255, 90, 0, 0.1);
		border: 1px solid rgba(255, 90, 0, 0.3);
		color: #ff5a00;
	}
	.card-icon.lr {
		background: rgba(99, 179, 237, 0.08);
		border: 1px solid rgba(99, 179, 237, 0.25);
		color: #63b3ed;
	}
	.card-titles {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.card-title {
		font-family: 'Share Tech Mono', monospace;
		font-size: 16px;
		color: #e8e8e8;
		letter-spacing: 0.04em;
	}
	.card-tagline {
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		color: #777;
		letter-spacing: 0.05em;
	}
	.card-badge {
		font-family: 'Share Tech Mono', monospace;
		font-size: 10px;
		font-weight: 700;
		padding: 4px 8px;
		border-radius: 6px;
		flex-shrink: 0;
		letter-spacing: 0.06em;
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

	.card-desc {
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		color: #888;
		line-height: 1.65;
	}

	.card-stats {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		padding: 10px 12px;
		background: rgba(0,0,0,0.4);
		border: 1px solid #141414;
		border-radius: 8px;
	}
	.stat { display: flex; flex-direction: column; gap: 2px; }
	.stat-label {
		font-family: 'Share Tech Mono', monospace;
		font-size: 9px;
		color: #555;
		letter-spacing: 0.1em;
		text-transform: uppercase;
	}
	.stat-val {
		font-family: 'Share Tech Mono', monospace;
		font-size: 12px;
		color: #d8d8d8;
	}

	.card-sources {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.source-chip {
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid #1f1f1f;
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
		color: #555;
		margin-top: 4px;
		letter-spacing: 0.05em;
		transition: color 0.15s;
	}
	.hf-card:hover .card-cta { color: #ff5a00; }
	.lr-card:hover .card-cta { color: #63b3ed; }

	@media (max-width: 760px) {
		.cards { grid-template-columns: 1fr; }
		.header-title { font-size: 18px; }
		.stepper { padding: 8px 12px; gap: 4px; }
		.step-name { display: none; }
		.step-bar { width: 14px; }
	}
</style>
