<script lang="ts">
	import TopChrome from '$lib/components/TopChrome.svelte';
	let { children } = $props();
</script>

<TopChrome />
{@render children?.()}

<style>
	:global(*) {
		margin: 0;
		padding: 0;
		box-sizing: border-box;
	}

	:global(html) {
		scroll-behavior: smooth;
		scroll-padding-top: 80px;
	}

	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, Helvetica, sans-serif;
		background: #000;
		color: #e8e8e8;
	}

	:global(a) { color: inherit; }
</style>
