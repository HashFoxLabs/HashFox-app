<script lang="ts">
	import BacktestingTerminal from '$lib/components/backtesting/BacktestingTerminal.svelte';
</script>

<div class="page">
	<BacktestingTerminal />
</div>

<style>
	.page {
		height: calc(100vh - 97px);
		min-height: 0;
		overflow: hidden;
	}

	@media (max-width: 768px) {
		.page {
			height: calc(100vh - 64px);
		}
	}
</style>

