<script lang="ts">
	import { goto } from '$app/navigation';
	import { getActiveTournaments, type Tournament } from '$lib/social/leaderboard';

	const tournaments: Tournament[] = getActiveTournaments();
	let selectedId: string = tournaments[0]?.id ?? '';

	$: selected = tournaments.find((t) => t.id === selectedId) ?? tournaments[0];

	function fmtCountdown(iso: string): string {
		const ms = new Date(iso).getTime() - Date.now();
		if (Number.isNaN(ms) || ms <= 0) return '—';
		const sec = Math.floor(ms / 1000);
		const d = Math.floor(sec / 86_400);
		const h = Math.floor((sec % 86_400) / 3600);
		const m = Math.floor((sec % 3600) / 60);
		if (d > 0) return `${d}d ${h}h ${m}m`;
		if (h > 0) return `${h}h ${m}m`;
		return `${m}m`;
	}

	const roadmap = [
		{
			phase: 'PHASE 01',
			title: 'Open Beta',
			status: 'live',
			points: [
				'Free entry across all tournaments',
				'Live leaderboards updated in real time',
				'Performance verified against on-chain trades'
			]
		},
		{
			phase: 'PHASE 02',
			title: 'Prize Pools',
			status: 'next',
			points: [
				'USDC-denominated prize pools',
				'Sponsored brackets and partner cups',
				'Automatic payouts via Solana settlement'
			]
		},
		{
			phase: 'PHASE 03',
			title: 'Pro Circuit',
			status: 'planned',
			points: [
				'Seasonal pro league with seeded brackets',
				'Spectator mode and live commentator feeds',
				'Cross-asset team tournaments'
			]
		}
	];

	const featured = [
		{ label: 'Strict anti-cheat', desc: 'Trade verification cross-checked with the on-chain HashFox program — no fake fills.' },
		{ label: 'Multi-asset', desc: 'Compete across crypto perps, prediction markets, forex and equities in one circuit.' },
		{ label: 'Transparent ranking', desc: 'P&L-based ranking with full breakdown — every trade in the run is auditable.' },
		{ label: 'Free to enter', desc: 'Open beta is free. Prize-pool tournaments will publish entry rules per cup.' }
	];
</script>

<main class="comp-page">
	<header class="hero">
		<button class="back-btn" on:click={() => goto('/')}>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
				<path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7" />
			</svg>
			BACK TO LEADERBOARD
		</button>

		<div class="hero-tag">
			<span class="dot"></span>
			HASHFOX COMPETITION HUB
			<span class="beta">BETA</span>
		</div>
		<h1>Trade. Climb. <span class="grad">Win.</span></h1>
		<p class="hero-sub">
			HashFox tournaments turn paper-trading skill into ranked, prize-eligible
			competition. Verified P&amp;L, transparent leaderboards, and a circuit
			built for every market.
		</p>
		<div class="hero-stats">
			<div>
				<strong>{tournaments.length}</strong>
				<span>ACTIVE CUPS</span>
			</div>
			<div>
				<strong>$40K</strong>
				<span>TOTAL POOLS</span>
			</div>
			<div>
				<strong>{tournaments.reduce((acc, t) => acc + t.participants, 0)}</strong>
				<span>PLAYERS</span>
			</div>
			<div>
				<strong>4</strong>
				<span>MARKETS</span>
			</div>
		</div>
	</header>

	<section class="block">
		<div class="block-head">
			<h2>Live Tournaments</h2>
			<span class="muted">Pick a cup to preview the rules and join the wait-list.</span>
		</div>

		<div class="cup-grid">
			<div class="cup-list">
				{#each tournaments as t}
					<button
						class="cup-row"
						class:active={selectedId === t.id}
						on:click={() => (selectedId = t.id)}
					>
						<div class="cup-row-head">
							<span class="cup-tag {t.status}">{t.tag}</span>
							<span class="cup-row-title">{t.title}</span>
						</div>
						<div class="cup-row-meta">
							<span class="prize">{t.prizePool}</span>
							<span class="dot-sep">·</span>
							<span>{t.entryFee}</span>
							<span class="dot-sep">·</span>
							<span>{t.participants}/{t.maxParticipants}</span>
						</div>
					</button>
				{/each}
			</div>

			{#if selected}
				<div class="cup-detail">
					<div class="cup-detail-head">
						<div>
							<span class="cup-tag {selected.status}">{selected.tag}</span>
							<h3>{selected.title}</h3>
						</div>
						<span class="cup-status {selected.status}">
							{selected.status === 'live' ? 'LIVE' : 'OPENS SOON'}
						</span>
					</div>
					<p class="cup-desc">{selected.description}</p>

					<div class="cup-stats">
						<div>
							<span>PRIZE POOL</span>
							<strong class="prize">{selected.prizePool}</strong>
						</div>
						<div>
							<span>ENTRY FEE</span>
							<strong>{selected.entryFee}</strong>
						</div>
						<div>
							<span>PARTICIPANTS</span>
							<strong>{selected.participants} / {selected.maxParticipants}</strong>
						</div>
						<div>
							<span>{selected.status === 'live' ? 'ENDS IN' : 'STARTS IN'}</span>
							<strong>{fmtCountdown(selected.status === 'live' ? selected.endsAt : selected.startsAt)}</strong>
						</div>
					</div>

					<div class="cup-progress">
						<div class="bar"><div class="fill" style="width: {Math.min(100, (selected.participants / selected.maxParticipants) * 100)}%"></div></div>
						<span>{((selected.participants / selected.maxParticipants) * 100).toFixed(0)}% capacity</span>
					</div>

					<div class="cup-actions">
						<button class="primary" disabled>
							{selected.status === 'live' ? 'JOIN — COMING SOON' : 'PRE-REGISTER — COMING SOON'}
						</button>
						<button class="secondary" on:click={() => goto('/')}>VIEW LEADERBOARD</button>
					</div>
					<p class="cup-foot">
						Tournament entry is wired during open beta. Once enabled, joining
						will lock your trades to the cup window and add you to the live
						bracket.
					</p>
				</div>
			{/if}
		</div>
	</section>

	<section class="block">
		<div class="block-head">
			<h2>Why Compete on HashFox</h2>
		</div>
		<div class="feature-grid">
			{#each featured as f}
				<div class="feature">
					<span class="feature-label">{f.label}</span>
					<p>{f.desc}</p>
				</div>
			{/each}
		</div>
	</section>

	<section class="block">
		<div class="block-head">
			<h2>Roadmap</h2>
			<span class="muted">From open beta to a full pro circuit.</span>
		</div>
		<div class="roadmap-grid">
			{#each roadmap as r}
				<div class="phase {r.status}">
					<div class="phase-head">
						<span class="phase-id">{r.phase}</span>
						<span class="phase-status {r.status}">
							{r.status === 'live' ? 'LIVE' : r.status === 'next' ? 'NEXT' : 'PLANNED'}
						</span>
					</div>
					<h3>{r.title}</h3>
					<ul>
						{#each r.points as p}
							<li>{p}</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</section>

	<section class="cta-block">
		<h2>The full Competition system is on the way.</h2>
		<p>Brackets, prize-pool settlement, spectator mode and pro-circuit seasons land in the next releases. Until then, sharpen your edge on the leaderboard.</p>
		<div class="cta-actions">
			<button class="primary" on:click={() => goto('/')}>OPEN LEADERBOARD</button>
			<button class="secondary" on:click={() => goto('/terminal')}>GO TO TERMINAL</button>
		</div>
	</section>
</main>

<style>
	.comp-page {
		background: #000; color: #e8e8e8;
		min-height: 100vh;
		padding: 32px 18px 80px;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.back-btn {
		display: inline-flex; align-items: center; gap: 6px;
		background: rgba(255,255,255,0.04); border: 1px solid #2a2a2a;
		color: #ccc; padding: 7px 12px; border-radius: 999px;
		font-family: 'Courier New', monospace; font-size: 10px; font-weight: 800;
		letter-spacing: 0.1em; cursor: pointer; transition: all 0.15s;
		margin-bottom: 18px;
	}
	.back-btn:hover { color: #ff5a00; border-color: rgba(255, 90, 0, 0.5); }

	.hero {
		padding: 28px 28px 36px;
		background:
			radial-gradient(circle at 0% 0%, rgba(255, 90, 0, 0.18), transparent 50%),
			radial-gradient(circle at 100% 0%, rgba(255,102,204, 0.12), transparent 50%),
			#0a0a0a;
		border: 1px solid #222;
		border-radius: 18px;
	}
	.hero-tag {
		display: inline-flex; align-items: center; gap: 8px;
		padding: 6px 12px; border-radius: 999px;
		background: rgba(255, 90, 0, 0.08);
		border: 1px solid rgba(255, 90, 0, 0.4);
		color: #ff5a00; font-family: 'Courier New', monospace;
		font-size: 10px; font-weight: 900; letter-spacing: 0.18em;
	}
	.hero-tag .dot {
		width: 6px; height: 6px; border-radius: 50%;
		background: #ff5a00; box-shadow: 0 0 8px rgba(255, 90, 0, 0.7);
	}
	.hero-tag .beta {
		background: #ff5a00; color: #000;
		padding: 1px 6px; border-radius: 4px; letter-spacing: 0.2em;
	}
	.hero h1 {
		margin: 14px 0 8px; color: #fff;
		font-size: clamp(34px, 5vw, 54px); font-weight: 900;
		letter-spacing: -0.02em; line-height: 1.05;
	}
	.hero h1 .grad {
		background: linear-gradient(90deg, #ff5a00, #ffb733, #ff66cc);
		-webkit-background-clip: text; background-clip: text; color: transparent;
	}
	.hero-sub { color: #aaa; max-width: 720px; font-size: 14px; line-height: 1.6; margin: 0 0 22px; }
	.hero-stats {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
		max-width: 720px;
	}
	.hero-stats div {
		padding: 12px 14px;
		background: rgba(255,255,255,0.03);
		border: 1px solid #222;
		border-radius: 12px;
	}
	.hero-stats strong {
		display: block; color: #ff5a00; font-family: 'Courier New', monospace;
		font-size: 22px; font-weight: 900;
	}
	.hero-stats span {
		color: #777; font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 800; letter-spacing: 0.14em;
	}

	.block { margin-top: 36px; }
	.block-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
	.block-head h2 { color: #fff; font-size: 22px; font-weight: 800; letter-spacing: -0.01em; margin: 0; }
	.block-head .muted { color: #777; font-size: 12px; font-family: 'Courier New', monospace; }

	.cup-grid {
		display: grid;
		grid-template-columns: 320px minmax(0, 1fr);
		gap: 16px;
	}
	.cup-list { display: flex; flex-direction: column; gap: 8px; }
	.cup-row {
		display: flex; flex-direction: column; gap: 6px; text-align: left;
		padding: 14px;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 12px;
		cursor: pointer;
		font-family: inherit; color: inherit;
		transition: all 0.15s;
	}
	.cup-row:hover { border-color: rgba(255, 90, 0, 0.4); }
	.cup-row.active { border-color: #ff5a00; background: rgba(255, 90, 0, 0.06); }
	.cup-row-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.cup-row-title { color: #fff; font-weight: 700; font-size: 13px; }
	.cup-row-meta {
		font-family: 'Courier New', monospace;
		color: #888; font-size: 11px;
		display: flex; gap: 6px; align-items: center; flex-wrap: wrap;
	}
	.cup-row-meta .prize { color: #00ff66; font-weight: 900; }
	.cup-row-meta .dot-sep { color: #444; }

	.cup-tag {
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 900; letter-spacing: 0.16em;
		padding: 3px 7px; border-radius: 4px;
		background: rgba(255, 90, 0, 0.12); color: #ff5a00;
		border: 1px solid rgba(255, 90, 0, 0.4);
	}
	.cup-tag.upcoming { background: rgba(255,102,204,0.10); color: #ff66cc; border-color: rgba(255,102,204,0.4); }

	.cup-detail {
		padding: 22px;
		background: linear-gradient(180deg, rgba(255, 90, 0, 0.05), rgba(255,255,255,0.01));
		border: 1px solid rgba(255, 90, 0, 0.2);
		border-radius: 14px;
		display: flex; flex-direction: column; gap: 14px;
	}
	.cup-detail-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
	.cup-detail-head h3 { color: #fff; font-size: 22px; font-weight: 800; margin: 8px 0 0; letter-spacing: -0.01em; }
	.cup-status {
		font-family: 'Courier New', monospace;
		font-size: 10px; font-weight: 900; letter-spacing: 0.16em;
		padding: 4px 10px; border-radius: 999px;
	}
	.cup-status.live { background: rgba(0,255,102,0.10); color: #00ff66; border: 1px solid rgba(0,255,102,0.35); }
	.cup-status.upcoming { background: rgba(255,102,204,0.10); color: #ff66cc; border: 1px solid rgba(255,102,204,0.35); }
	.cup-desc { color: #bbb; font-size: 13px; line-height: 1.6; margin: 0; }
	.cup-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
	.cup-stats div {
		padding: 12px;
		background: rgba(255,255,255,0.03); border: 1px solid #1f1f1f; border-radius: 10px;
		display: flex; flex-direction: column; gap: 4px;
	}
	.cup-stats span { color: #777; font-family: 'Courier New', monospace; font-size: 9px; letter-spacing: 0.14em; font-weight: 800; }
	.cup-stats strong { color: #fff; font-family: 'Courier New', monospace; font-size: 16px; font-weight: 900; }
	.cup-stats strong.prize { color: #00ff66; }
	.cup-progress { display: flex; flex-direction: column; gap: 6px; }
	.cup-progress .bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,0.05); overflow: hidden; }
	.cup-progress .fill { height: 100%; background: linear-gradient(90deg, #ff5a00, #ffb733); }
	.cup-progress span { color: #777; font-family: 'Courier New', monospace; font-size: 11px; }

	.cup-actions { display: flex; gap: 10px; flex-wrap: wrap; }
	.primary, .secondary {
		padding: 12px 20px;
		border-radius: 10px; cursor: pointer;
		font-family: 'Courier New', monospace; font-size: 11px; font-weight: 900; letter-spacing: 0.12em;
		transition: all 0.15s;
	}
	.primary {
		background: #ff5a00; color: #000; border: 1px solid #ff5a00;
	}
	.primary:hover:not(:disabled) { background: #ffb733; box-shadow: 0 6px 20px rgba(255, 90, 0, 0.35); }
	.primary:disabled { opacity: 0.55; cursor: not-allowed; }
	.secondary {
		background: transparent; color: #ccc;
		border: 1px solid #2a2a2a;
	}
	.secondary:hover { color: #fff; border-color: #ff5a00; }
	.cup-foot { color: #666; font-family: 'Courier New', monospace; font-size: 10px; margin: 0; }

	.feature-grid {
		display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;
	}
	.feature {
		padding: 16px;
		background: #0a0a0a; border: 1px solid #222; border-radius: 12px;
		display: flex; flex-direction: column; gap: 6px;
	}
	.feature-label {
		font-family: 'Courier New', monospace;
		font-size: 10px; font-weight: 900; letter-spacing: 0.14em;
		color: #ff5a00;
	}
	.feature p { color: #aaa; font-size: 12px; line-height: 1.55; margin: 0; }

	.roadmap-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
	.phase {
		padding: 18px;
		background: #0a0a0a; border: 1px solid #222; border-radius: 14px;
		display: flex; flex-direction: column; gap: 10px;
	}
	.phase.live { border-color: rgba(0,255,102,0.35); background: linear-gradient(180deg, rgba(0,255,102,0.04), rgba(255,255,255,0.01)); }
	.phase.next { border-color: rgba(255, 90, 0, 0.35); }
	.phase-head { display: flex; justify-content: space-between; align-items: center; }
	.phase-id { color: #777; font-family: 'Courier New', monospace; font-size: 10px; font-weight: 900; letter-spacing: 0.16em; }
	.phase-status {
		font-family: 'Courier New', monospace;
		font-size: 9px; font-weight: 900; letter-spacing: 0.14em;
		padding: 3px 8px; border-radius: 999px;
	}
	.phase-status.live { background: rgba(0,255,102,0.10); color: #00ff66; border: 1px solid rgba(0,255,102,0.35); }
	.phase-status.next { background: rgba(255, 90, 0, 0.10); color: #ff5a00; border: 1px solid rgba(255, 90, 0, 0.4); }
	.phase-status.planned { background: rgba(255,255,255,0.04); color: #888; border: 1px solid #2a2a2a; }
	.phase h3 { color: #fff; font-size: 18px; font-weight: 800; margin: 0; }
	.phase ul { list-style: none; padding: 0; margin: 4px 0 0; display: flex; flex-direction: column; gap: 6px; }
	.phase li {
		color: #bbb; font-size: 12px; line-height: 1.5;
		padding-left: 14px; position: relative;
	}
	.phase li::before {
		content: '›'; position: absolute; left: 0; top: 0;
		color: #ff5a00; font-weight: 900;
	}

	.cta-block {
		margin-top: 40px;
		padding: 36px 24px; text-align: center;
		background:
			radial-gradient(circle at 50% 0%, rgba(255, 90, 0, 0.18), transparent 60%),
			#0a0a0a;
		border: 1px solid rgba(255, 90, 0, 0.25);
		border-radius: 18px;
	}
	.cta-block h2 { color: #fff; font-size: 26px; margin: 0 0 8px; font-weight: 800; letter-spacing: -0.02em; }
	.cta-block p { color: #aaa; max-width: 620px; margin: 0 auto 18px; font-size: 13px; line-height: 1.6; }
	.cta-actions { display: inline-flex; gap: 10px; flex-wrap: wrap; justify-content: center; }

	@media (max-width: 1000px) {
		.cup-grid { grid-template-columns: 1fr; }
		.feature-grid { grid-template-columns: repeat(2, 1fr); }
		.cup-stats { grid-template-columns: repeat(2, 1fr); }
		.hero-stats { grid-template-columns: repeat(2, 1fr); }
		.roadmap-grid { grid-template-columns: 1fr; }
	}
</style>
