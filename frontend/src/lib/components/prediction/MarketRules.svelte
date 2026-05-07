<script lang="ts">
	export let event: any;
	export let market: any;
</script>

<div class="rules-section">
	<h3 class="rules-title">Rules</h3>

	<div class="rules-card">
		<div class="rule-item">
			<h4 class="rule-header">Description</h4>
			<p class="rule-text">
				{event?.description ||
					market?.description ||
					'This market will resolve based on official outcomes.'}
			</p>
		</div>

		{#if event?.resolutionSource || market?.resolutionSource}
			<div class="rule-item">
				<h4 class="rule-header">Resolution Source</h4>
				<p class="rule-text">{event?.resolutionSource || market?.resolutionSource}</p>
			</div>
		{/if}

		<div class="rule-item">
			<h4 class="rule-header">Market Details</h4>
			<p class="rule-text">
				All trades are final and non-reversible.
				{#if event?.endDate || market?.endDate || market?.end_date_iso}
					This market closes on
					{new Date(
						event?.endDate || market?.endDate || market?.end_date_iso
					).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}.
				{/if}
			</p>
		</div>

		{#if event?.categories?.length}
			<div class="rule-item">
				<h4 class="rule-header">Categories</h4>
				<div class="categories">
					{#each event.categories as category}
						<span class="category-tag">{category}</span>
					{/each}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.rules-section {
		padding: 20px;
	}
	.rules-title {
		font-size: 14px;
		font-weight: 900;
		color: #e8e8e8;
		margin: 0 0 14px 0;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.rules-card {
		background: #000;
		border: 1px solid #1a1a1a;
		border-radius: 10px;
		padding: 18px;
		display: flex;
		flex-direction: column;
		gap: 18px;
	}
	.rule-item {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.rule-header {
		font-size: 11px;
		font-weight: 900;
		color: #ff5a00;
		margin: 0;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.rule-text {
		font-size: 13px;
		color: #e8e8e8;
		line-height: 1.55;
		margin: 0;
	}
	.categories {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.category-tag {
		background: rgba(255, 90, 0, 0.1);
		color: #ff5a00;
		padding: 3px 10px;
		border-radius: 12px;
		font-size: 11px;
		font-weight: 600;
		border: 1px solid rgba(255, 90, 0, 0.25);
	}
</style>
