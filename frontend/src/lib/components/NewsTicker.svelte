<script lang="ts">
	import { onMount } from 'svelte';

	interface NewsItem {
		title: string;
		link?: string;
		image_url?: string;
	}

	let newsItems: NewsItem[] = [];
	let loading = true;

	async function fetchTickerNews() {
		try {
			const categories = ['business', 'technology', 'science'];
			const allNews: NewsItem[] = [];

			for (const category of categories) {
				const response = await fetch(`/api/newsdata?category=${category}&language=en`);
				if (response.ok) {
					const data = await response.json();
					if (data.results && Array.isArray(data.results)) {
						const categoryNews = data.results.slice(0, 5).map((item: any) => ({
							title: item.title,
							link: item.link,
							image_url: item.image_url || null
						}));
						allNews.push(...categoryNews);
					}
				}
			}

			newsItems =
				allNews.length > 0
					? allNews
					: [{ title: 'Markets update in real-time' }, { title: 'Trade prediction markets with confidence' }];
		} catch (error) {
			console.error('Error fetching ticker news:', error);
			newsItems = [{ title: 'Welcome to HashFox' }, { title: 'Real-time markets + signals' }];
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		fetchTickerNews();
		const interval = setInterval(fetchTickerNews, 10 * 60 * 1000);
		return () => clearInterval(interval);
	});
</script>

<div class="news-ticker">
	{#if loading}
		<div class="ticker-content">
			<span class="news-item">Loading news...</span>
		</div>
	{:else}
		<div class="ticker-content">
			{#each newsItems as item}
				<span class="news-item">
					{#if item.image_url}
						<img src={item.image_url} alt="" class="news-image" />
					{/if}
					<span class="bullet">•</span>
					{item.title}
				</span>
			{/each}
			{#each newsItems as item}
				<span class="news-item">
					{#if item.image_url}
						<img src={item.image_url} alt="" class="news-image" />
					{/if}
					<span class="bullet">•</span>
					{item.title}
				</span>
			{/each}
		</div>
	{/if}
</div>

<style>
	.news-ticker {
		flex: 1;
		overflow: hidden;
		background: #000000;
		border: 1px solid #404040;
		border-radius: 8px;
		padding: 8px 12px;
		height: 40px;
		display: flex;
		align-items: center;
		pointer-events: none;
		user-select: none;
	}

	.ticker-content {
		display: flex;
		gap: 40px;
		white-space: nowrap;
		animation: scroll 60s linear infinite;
		will-change: transform;
	}

	@keyframes scroll {
		0% {
			transform: translateX(0);
		}
		100% {
			transform: translateX(-50%);
		}
	}

	.news-item {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: #e8e8e8;
		font-weight: 500;
	}

	.news-image {
		width: 28px;
		height: 28px;
		object-fit: cover;
		border-radius: 4px;
		border: 1px solid #404040;
		flex-shrink: 0;
	}

	.bullet {
		color: #f97316;
		font-size: 14px;
		font-weight: bold;
	}
</style>

