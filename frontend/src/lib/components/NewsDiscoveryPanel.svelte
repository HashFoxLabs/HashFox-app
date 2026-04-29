<script lang="ts">
	import { onMount } from 'svelte';

	type NewsDataArticle = {
		article_id: string;
		title: string;
		description?: string;
		content?: string;
		link: string;
		source_id: string;
		pubDate: string;
		image_url?: string;
		category?: string[];
	};

	type Article = {
		id: string;
		title: string;
		body: string;
		url: string;
		source: string;
		published_on: number;
		imageurl?: string;
		tags?: string;
	};

	const categories = [
		{ id: 'top', label: 'Top' },
		{ id: 'business', label: 'Business' },
		{ id: 'technology', label: 'Tech' },
		{ id: 'science', label: 'Science' },
		{ id: 'politics', label: 'Politics' },
		{ id: 'sports', label: 'Sports' },
		{ id: 'entertainment', label: 'Culture' },
		{ id: 'health', label: 'Health' }
	] as const;

	let selectedCategory: (typeof categories)[number]['id'] = 'top';
	let news: Article[] = [];
	let selectedArticle: Article | null = null;
	let newsLoading = true;
	let articleLoading = false;
	let errorMessage = '';

	async function fetchNews() {
		newsLoading = true;
		errorMessage = '';
		try {
			const response = await fetch(`/api/newsdata?category=${selectedCategory}&language=en`);
			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}));
				throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
			}
			const data = await response.json();
			const results = (data.results || []) as NewsDataArticle[];

			news = results.map((a) => ({
				id: a.article_id,
				title: a.title,
				body: a.description || a.content || 'No description available.',
				url: a.link,
				source: a.source_id || 'Unknown',
				published_on: a.pubDate ? new Date(a.pubDate).getTime() / 1000 : Math.floor(Date.now() / 1000),
				imageurl: a.image_url,
				tags: a.category ? a.category.join('|') : ''
			}));

			selectedArticle = news[0] ?? null;
		} catch (err: any) {
			errorMessage = err?.message || 'Failed to load news';
			news = [];
			selectedArticle = null;
		} finally {
			newsLoading = false;
		}
	}

	function changeCategory(categoryId: typeof selectedCategory) {
		if (selectedCategory === categoryId) return;
		selectedCategory = categoryId;
		void fetchNews();
	}

	function selectArticle(article: Article) {
		selectedArticle = article;
		articleLoading = true;
		setTimeout(() => (articleLoading = false), 180);
	}

	function formatDate(ts: number): string {
		return new Date(ts * 1000).toLocaleString('en-US', {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	onMount(() => {
		void fetchNews();
		const interval = setInterval(fetchNews, 5 * 60 * 1000);
		return () => clearInterval(interval);
	});
</script>

<section class="news-discovery">
	<div class="inner">
		<div class="header">
			<div class="h-left">
				<div class="title">Market News</div>
			</div>
			<div class="h-right">
				<div class="tabs" role="tablist" aria-label="News categories">
					{#each categories as c}
						<button class="tab" class:active={selectedCategory === c.id} on:click={() => changeCategory(c.id)}>
							{c.label}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="grid">
			<div class="panel list">
				<div class="panel-head">
					<span class="ph-title">{categories.find((c) => c.id === selectedCategory)?.label.toUpperCase()}</span>
					{#if !newsLoading}
						<span class="ph-meta">{news.length} items</span>
					{/if}
				</div>
				<div class="panel-body scroll">
					{#if newsLoading}
						<div class="state">Loading news…</div>
					{:else if errorMessage}
						<div class="state err">{errorMessage}</div>
					{:else if news.length === 0}
						<div class="state">No articles for this category.</div>
					{:else}
						{#each news as a (a.id)}
							<button class="item" class:active={selectedArticle?.id === a.id} on:click={() => selectArticle(a)}>
								<div class="meta">
									<span class="src">{a.source}</span>
									<span class="dot">•</span>
									<span class="time">{formatDate(a.published_on)}</span>
								</div>
								<div class="it-title">{a.title}</div>
							</button>
						{/each}
					{/if}
				</div>
			</div>

			<div class="panel reader">
				<div class="panel-head">
					<span class="ph-title">ARTICLE</span>
					{#if selectedArticle}
						<a class="ph-link" href={selectedArticle.url} target="_blank" rel="noopener noreferrer">OPEN ↗</a>
					{/if}
				</div>
				<div class="panel-body">
					{#if articleLoading}
						<div class="state">Loading…</div>
					{:else if selectedArticle}
						{#if selectedArticle.imageurl}
							<img class="heroimg" src={selectedArticle.imageurl} alt="" />
						{/if}
						<div class="rtitle">{selectedArticle.title}</div>
						<div class="rmeta">
							<span class="badge">{selectedArticle.source}</span>
							<span class="badge dim">{formatDate(selectedArticle.published_on)}</span>
						</div>
						<p class="body">{selectedArticle.body}</p>
						<div class="actions">
							<a class="btn" href={selectedArticle.url} target="_blank" rel="noopener noreferrer">Read full article</a>
						</div>
					{:else}
						<div class="state">Select an article.</div>
					{/if}
				</div>
			</div>
		</div>
	</div>
</section>

<style>
	.news-discovery {
		background: #000;
		border-bottom: 1px solid #222;
	}
	.inner {
		/* Full-bleed: no gutter between viewport and panel borders */
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
	.tabs {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		justify-content: flex-end;
	}
	.tab {
		background: #000;
		border: 1px solid #333;
		color: #bbb;
		padding: 8px 10px;
		border-radius: 8px;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.08em;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.tab:hover {
		border-color: #ff5a00;
		color: #fff;
	}
	.tab.active {
		border-color: #ff5a00;
		background: rgba(255, 90, 0, 0.08);
		color: #ff5a00;
	}

	.grid {
		display: grid;
		grid-template-columns: 420px 1fr;
		gap: 14px;
		align-items: stretch;
		padding: 0;
	}
	.panel {
		border: 1px solid #333;
		border-radius: 10px;
		background: #0a0a0a;
		overflow: hidden;
		height: 560px;
		max-height: 560px;
		display: flex;
		flex-direction: column;
	}
	.panel.list { border-left: 0; }
	.panel.reader { border-right: 0; }
	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px 16px;
		background: #000;
		border-bottom: 1px solid #222;
	}
	.ph-title {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.18em;
		color: #ff5a00;
	}
	.ph-meta {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		color: #777;
	}
	.ph-link {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		color: #6ae;
		text-decoration: none;
		border: 1px solid #244;
		padding: 6px 10px;
		border-radius: 8px;
	}
	.ph-link:hover { border-color: #6ae; color: #9cf; }

	.panel-body {
		padding: 14px 16px;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.scroll { overflow-y: auto; min-height: 0; flex: 1; }

	.state {
		color: #777;
		font-family: 'Courier New', monospace;
		font-size: 12px;
		padding: 18px 4px;
	}
	.state.err { color: #ff6b6b; }

	.item {
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid #1b1b1b;
		border-radius: 10px;
		padding: 12px 12px;
		margin-bottom: 10px;
		cursor: pointer;
		transition: border-color 0.12s ease, background 0.12s ease;
	}
	.item:hover { border-color: #444; background: rgba(255,255,255,0.03); }
	.item.active { border-color: rgba(255, 90, 0,0.9); background: rgba(255, 90, 0,0.06); }
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		color: #8a8a8a;
		font-size: 11px;
		font-family: 'Courier New', monospace;
		margin-bottom: 6px;
		flex-wrap: wrap;
	}
	.src { color: #00ff66; font-weight: 800; letter-spacing: 0.05em; }
	.dot { color: #444; }
	.time { color: #888; }
	.it-title {
		color: #e8e8e8;
		font-size: 13px;
		line-height: 1.45;
		font-weight: 600;
	}

	.heroimg {
		width: 100%;
		max-height: 240px;
		object-fit: cover;
		border-radius: 10px;
		border: 1px solid #222;
		margin-bottom: 12px;
		background: #000;
	}
	.rtitle {
		color: #fff;
		font-size: 18px;
		font-weight: 800;
		line-height: 1.3;
		margin: 2px 0 10px;
	}
	.rmeta {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
		margin-bottom: 12px;
	}
	.badge {
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: 800;
		letter-spacing: 0.06em;
		color: #ff5a00;
		border: 1px solid rgba(255, 90, 0,0.35);
		background: rgba(255, 90, 0,0.08);
		padding: 4px 8px;
		border-radius: 999px;
	}
	.badge.dim {
		color: #bbb;
		border-color: #333;
		background: rgba(255,255,255,0.03);
		font-weight: 700;
	}
	.body {
		color: #bdbdbd;
		font-size: 13px;
		line-height: 1.65;
		margin: 0;
	}
	.actions { margin-top: 14px; display: flex; }
	.btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: #ff5a00;
		color: #000;
		text-decoration: none;
		font-weight: 800;
		border-radius: 10px;
		padding: 10px 12px;
		font-family: 'Courier New', monospace;
		letter-spacing: 0.06em;
		border: 1px solid #ff5a00;
		transition: background 0.15s ease;
	}
	.btn:hover { background: #ffb733; border-color: #ffb733; }

	@media (max-width: 1100px) {
		.grid { grid-template-columns: 1fr; }
		.panel { min-height: 420px; }
		.panel.list, .panel.reader { border-left: 1px solid #333; border-right: 1px solid #333; }
	}
</style>

