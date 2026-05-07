<script lang="ts">
	import Leaderboard from '$lib/components/social/Leaderboard.svelte';
	import SocialFeed from '$lib/components/social/SocialFeed.svelte';
	import NewsDiscoveryPanel from '$lib/components/NewsDiscoveryPanel.svelte';
	import BacktestingTerminal from '$lib/components/backtesting/BacktestingTerminal.svelte';
	import AlertFeed from '$lib/components/AlertFeed.svelte';
</script>

<main class="landing">
	<Leaderboard />
	<SocialFeed />
	<NewsDiscoveryPanel />
	<AlertFeed />
</main>

<style>
	.landing {
		background: #000;
		color: #e8e8e8;
		min-height: 100vh;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.backtest-section {
		padding: 0;
		background: #000;
		border-bottom: 1px solid #222;
	}

	.backtest-shell {
		width: 100%;
		height: calc(100vh - 97px);
		min-height: 720px;
		overflow: hidden;
		background: #000;
	}

	@media (max-width: 768px) {
		.backtest-shell {
			height: calc(100vh - 64px);
			min-height: 640px;
		}
	}
</style>
