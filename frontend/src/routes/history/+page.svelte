<script lang="ts">
	import { browser } from '$app/environment';
	import { onMount, onDestroy } from 'svelte';
	import { BN } from '$lib/vendor/anchor';
	import { walletStore } from '$lib/wallet/stores';
	import { sessionKey } from '$lib/stores/sessionKey';
	import { pythPrices, startPythStream } from '$lib/stores/pythPrices';
	import {
		binanceOrderBook,
		binanceStreamingSymbol,
		connectBinance,
		disconnectBinance
	} from '$lib/stores/binanceOrderbook';
	import {
		stocksOrderBook,
		stocksStreamingSymbol,
		connectStocks,
		disconnectStocks
	} from '$lib/stores/stocksOrderbook';
	import { sessionKeyManager } from '$lib/solana/session-keys';
	import {
		buildConnection,
		buildProgram,
		buildKeypairProgram,
		closeTradingPosition as closeTradingPositionRpc,
		cancelLimitOrder as cancelLimitOrderRpc,
		sellYes as sellYesRpc,
		sellNo as sellNoRpc,
		fetchUnifiedHistory,
		priceScaled,
		usd,
		PRICE_SCALE,
		USD_SCALE,
		type UnifiedHistoryEntry,
		type TradingPositionAccount,
		type PredictionPositionAccount
	} from '$lib/hashfox';
	import { ALL_MARKETS } from '$lib/markets';
	import { polymarketClient } from '$lib/polymarket';
	import {
		getAllRememberedMarketNames,
		rememberPredictionMarketName
	} from '$lib/stores/predictionMarketNames';

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let session: any = {};
	sessionKey.subscribe((s) => (session = s));

	/** Auto-subscribe so Svelte 5 re-renders on every Pyth tick (same store as terminal). */
	$: prices = $pythPrices;
	$: binanceBook = $binanceOrderBook;
	$: stocksBook = $stocksOrderBook;
	$: streamCryptoSym = $binanceStreamingSymbol;
	$: streamStockSym = $stocksStreamingSymbol;

	type HistoryEntry =
		| (Omit<UnifiedHistoryEntry, 'kind' | 'data'> & { kind: 'trading'; data: TradingPositionAccount })
		| (Omit<UnifiedHistoryEntry, 'kind' | 'data'> & { kind: 'prediction'; data: PredictionPositionAccount });

	let entries: HistoryEntry[] = [];
	let loading = false;
	let error = '';
	let actionMessage = '';
	let closingPubkey = '';
	let sellingPubkey = '';
	let predMeta: Record<string, { question: string; yesPrice: number; noPrice: number }> = {};
	let sellQty: Record<string, number> = {};

	type HistoryFilter = 'all' | 'crypto' | 'traditional' | 'prediction';
	let filter: HistoryFilter = 'all';
	const FILTER_OPTIONS = ['all', 'crypto', 'traditional', 'prediction'] as const satisfies readonly HistoryFilter[];

	async function load() {
		if (!wallet.connected || !wallet.publicKey) {
			entries = [];
			return;
		}
		loading = true;
		error = '';
		try {
			const conn = buildConnection();
			const program = buildProgram(conn, wallet.adapter);
			entries = (await fetchUnifiedHistory(program, wallet.publicKey)) as unknown as HistoryEntry[];
			void loadPredictionMeta();
		} catch (err: any) {
			error = err?.message ?? 'Failed to load history';
		} finally {
			loading = false;
		}
	}

	async function loadPredictionMeta() {
		const ids = new Set<string>();
		for (const e of entries) {
			if (e.kind === 'prediction') ids.add((e.data as PredictionPositionAccount).marketId);
		}
		const cached = getAllRememberedMarketNames();
		const seeded: typeof predMeta = { ...predMeta };
		for (const id of ids) {
			if (seeded[id]) continue;
			if (cached[id]) seeded[id] = { question: cached[id], yesPrice: 0, noPrice: 0 };
		}
		predMeta = seeded;

		const toFetch = [...ids].filter((id) => !predMeta[id] || predMeta[id].yesPrice === 0);
		if (toFetch.length === 0) return;
		const results = await Promise.all(
			toFetch.map((id) => polymarketClient.fetchMarketByConditionId(id))
		);
		const next = { ...predMeta };
		toFetch.forEach((id, i) => {
			const r = results[i];
			if (r) {
				const question = r.question || next[id]?.question || id;
				next[id] = { question, yesPrice: r.yesPrice, noPrice: r.noPrice };
				if (r.question) rememberPredictionMarketName(id, r.question);
			} else if (!next[id]) {
				next[id] = { question: id, yesPrice: 0, noPrice: 0 };
			}
		});
		predMeta = next;
	}

	onMount(() => {
		startPythStream();
		void load();
	});

	$: if (wallet.connected) load();

	function variantKey(v: any): string {
		if (!v || typeof v !== 'object') return '';
		return Object.keys(v)[0] ?? '';
	}

	function pairToSymbol(pairIndex: number, category: string): string {
		const m = ALL_MARKETS.find(
			(mm) => mm.pairIndex === pairIndex && matchCategory(mm.category, category)
		);
		return m?.symbol ?? `#${pairIndex}`;
	}

	function matchCategory(
		mktCat: 'crypto' | 'traditional' | 'prediction',
		contractCat: string
	): boolean {
		if (contractCat === 'crypto') return mktCat === 'crypto';
		return mktCat === 'traditional';
	}

	function tradingCategory(t: TradingPositionAccount): string {
		return variantKey(t.marketCategory);
	}

	function tradingSymbol(t: TradingPositionAccount): string {
		return pairToSymbol(t.pairIndex, tradingCategory(t));
	}

	function rawNum(raw: any): number {
		return typeof raw?.toNumber === 'function' ? raw.toNumber() : Number(raw);
	}
	function fmtUsd(raw: any): string {
		return (rawNum(raw) / USD_SCALE).toLocaleString('en-US', {
			minimumFractionDigits: 2,
			maximumFractionDigits: 2
		});
	}
	function fmtPrice(raw: any): string {
		return (rawNum(raw) / PRICE_SCALE).toLocaleString('en-US', { maximumFractionDigits: 6 });
	}
	function fmtNum(n: number, digits = 2): string {
		const sign = n > 0 ? '+' : '';
		return `${sign}${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
	}
	function fmtPnl(raw: any): { txt: string; cls: 'up' | 'down' | 'flat' } {
		const v = rawNum(raw) / USD_SCALE;
		const cls = v > 0 ? 'up' : v < 0 ? 'down' : 'flat';
		return { txt: `${fmtNum(v)} USDT`, cls };
	}
	function fmtDate(ts: number): string {
		if (!ts) return '—';
		return new Date(ts * 1000).toLocaleString();
	}
	function shortDate(ts: number): string {
		if (!ts) return '—';
		const d = new Date(ts * 1000);
		const date = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' });
		const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
		return `${date} · ${time}`;
	}

	/**
	 * Mark from Pyth (same source as terminal Open Orders). When History holds an
	 * open crypto/stock position we also wire Binance/Alpaca so depth/poll ticks
	 * re-render the page — terminal gets that for free from the chart orderbook.
	 */
	function liveMarkUsd(t: TradingPositionAccount): number {
		const symbol = tradingSymbol(t);
		const cat = tradingCategory(t);
		/* Establish reactive deps on L1 books so uPnL updates every tick like the terminal. */
		if (cat === 'crypto' && streamCryptoSym === symbol) {
			void binanceBook.asks;
			void binanceBook.bids;
		} else if ((cat === 'stock' || cat === 'equity') && streamStockSym === symbol) {
			void stocksBook.asks;
			void stocksBook.bids;
		}
		return prices[symbol]?.price ?? 0;
	}

	/** Compute live unrealized PnL for an active trading position. Returns null
	 * when no live mark price is available (e.g. limit not filled, or feed
	 * missing). */
	function liveTradingPnl(t: TradingPositionAccount):
		| { pnl: number; markPrice: number; pct: number }
		| null {
		const status = variantKey(t.status);
		if (status !== 'active') return null;
		const mark = liveMarkUsd(t);
		const entry = rawNum(t.entryPrice) / PRICE_SCALE;
		const sizeUsd = rawNum(t.sizeUsd) / USD_SCALE;
		const margin = rawNum(t.marginUsd) / USD_SCALE;
		if (!mark || !entry || !sizeUsd) return null;
		const dir = variantKey(t.direction);
		const raw =
			dir === 'long'
				? ((mark - entry) / entry) * sizeUsd
				: ((entry - mark) / entry) * sizeUsd;
		const pct = margin > 0 ? (raw / margin) * 100 : 0;
		return { pnl: raw, markPrice: mark, pct };
	}

	function buildTradeRuntime(): {
		program: any;
		signer: import('@solana/web3.js').PublicKey;
		sessionToken: import('@solana/web3.js').PublicKey | null;
	} {
		const conn = buildConnection();
		const sessionActive =
			session.active &&
			sessionKeyManager.isSessionActive() &&
			sessionKeyManager.isSessionForWallet(wallet.publicKey);
		if (sessionActive) {
			const kp = sessionKeyManager.getSessionKeypair();
			const tokenPda = sessionKeyManager.getSessionTokenPDA();
			if (kp && tokenPda) {
				return {
					program: buildKeypairProgram(conn, kp),
					signer: kp.publicKey,
					sessionToken: tokenPda
				};
			}
		}
		return {
			program: buildProgram(conn, wallet.adapter),
			signer: wallet.publicKey,
			sessionToken: null
		};
	}

	function predMarketName(
		id: string,
		meta: Record<string, { question: string; yesPrice: number; noPrice: number }>
	): string {
		return meta[id]?.question || id;
	}

	function predCurrentPrice(
		p: PredictionPositionAccount,
		meta: Record<string, { question: string; yesPrice: number; noPrice: number }>
	): number {
		const m = meta[p.marketId];
		if (!m) return 0;
		return variantKey(p.predictionType) === 'yes' ? m.yesPrice : m.noPrice;
	}

	function predLivePnl(
		p: PredictionPositionAccount,
		meta: Record<string, { question: string; yesPrice: number; noPrice: number }>
	): { pnl: number; pct: number; current: number } | null {
		const cur = predCurrentPrice(p, meta);
		if (!cur) return null;
		const avg = rawNum(p.pricePerShare) / PRICE_SCALE;
		const remaining = rawNum(p.remainingShares) / USD_SCALE;
		if (remaining <= 0) return null;
		const pnl = (cur - avg) * remaining;
		const cost = avg * remaining;
		const pct = cost > 0 ? (pnl / cost) * 100 : 0;
		return { pnl, pct, current: cur };
	}

	async function sellPredictionEntry(e: HistoryEntry & { kind: 'prediction' }) {
		if (sellingPubkey) return;
		const p = e.data;
		const status = variantKey(p.status);
		if (status !== 'active' && status !== 'partiallySold') return;
		const isYes = variantKey(p.predictionType) === 'yes';
		const cur = predCurrentPrice(p, predMeta);
		if (!cur) {
			actionMessage = 'No live price for this market — try refreshing.';
			return;
		}
		const remaining = rawNum(p.remainingShares) / USD_SCALE;
		const qty = sellQty[e.pubkey] && sellQty[e.pubkey] > 0 ? sellQty[e.pubkey] : remaining;
		if (qty <= 0 || qty > remaining + 0.0001) {
			actionMessage = 'Invalid quantity.';
			return;
		}
		sellingPubkey = e.pubkey;
		actionMessage = '';
		try {
			const { program, signer, sessionToken } = buildTradeRuntime();
			const positionId = new BN(rawNum(p.positionId));
			const fn = isYes ? sellYesRpc : sellNoRpc;
			await fn(
				program,
				wallet.publicKey,
				positionId,
				usd(qty),
				priceScaled(cur),
				sessionToken,
				signer
			);
			actionMessage = `Sold ${qty.toFixed(2)} shares @ $${cur.toFixed(3)}`;
			delete sellQty[e.pubkey];
			sellQty = sellQty;
			await load();
		} catch (err: any) {
			console.error(err);
			actionMessage = err?.message ?? 'Sell failed.';
		} finally {
			sellingPubkey = '';
		}
	}

	async function closeEntry(e: HistoryEntry & { kind: 'trading' }) {
		if (closingPubkey) return;
		const t = e.data;
		const status = variantKey(t.status);
		if (status !== 'active' && status !== 'pendingFill') return;
		closingPubkey = e.pubkey;
		actionMessage = '';
		try {
			const { program, signer, sessionToken } = buildTradeRuntime();
			const positionId = new BN(rawNum(t.positionId));
			if (status === 'pendingFill') {
				await cancelLimitOrderRpc(program, wallet.publicKey, positionId, sessionToken, signer);
				actionMessage = `Cancelled #${positionId.toString()}`;
			} else {
				const symbol = tradingSymbol(t);
				const mark = liveMarkUsd(t);
				if (!mark) {
					actionMessage = `No live price for ${symbol} — try again in a moment.`;
					closingPubkey = '';
					return;
				}
				await closeTradingPositionRpc(
					program,
					wallet.publicKey,
					positionId,
					priceScaled(mark),
					sessionToken,
					signer
				);
				actionMessage = `Closed #${positionId.toString()} at $${mark.toFixed(2)}`;
			}
			await load();
		} catch (err: any) {
			console.error(err);
			actionMessage = err?.message ?? 'Close failed.';
		} finally {
			closingPubkey = '';
		}
	}

	function isOpenEntry(e: HistoryEntry): boolean {
		const s =
			e.kind === 'trading'
				? variantKey((e.data as TradingPositionAccount).status)
				: variantKey((e.data as PredictionPositionAccount).status);
		return s === 'active' || s === 'pendingFill' || s === 'partiallySold';
	}

	$: filteredAll = entries.filter((e) => {
		if (filter === 'all') return true;
		if (filter === 'prediction') return e.kind === 'prediction';
		if (filter === 'crypto')
			return e.kind === 'trading' && tradingCategory(e.data as TradingPositionAccount) === 'crypto';
		if (filter === 'traditional')
			return e.kind === 'trading' && tradingCategory(e.data as TradingPositionAccount) !== 'crypto';
		return true;
	});

	$: openEntries = filteredAll.filter(isOpenEntry);
	$: closedEntries = filteredAll.filter((e) => !isOpenEntry(e));

	/* Aggregate live uPnL across all currently active trading positions for the
	 * "Open positions" header pill. */
	$: totalLivePnl = openEntries.reduce((sum, e) => {
		if (e.kind !== 'trading') return sum;
		const live = liveTradingPnl(e.data as TradingPositionAccount);
		return sum + (live?.pnl ?? 0);
	}, 0);

	/* Keep Binance / Alpaca streams open on History when there are open positions,
	 * so marks and uPnL tick at the same cadence as the terminal (not only on Pyth batches). */
	let wiredCryptoFeeds = '';
	let wiredStockFeeds = '';
	$: if (browser && wallet?.connected) {
		let wantC = '';
		let wantS = '';
		for (const e of openEntries) {
			if (e.kind !== 'trading') continue;
			const t = e.data as TradingPositionAccount;
			const c = tradingCategory(t);
			if (!wantC && c === 'crypto') wantC = tradingSymbol(t);
			if (!wantS && (c === 'stock' || c === 'equity')) wantS = tradingSymbol(t);
			if (wantC && wantS) break;
		}
		if (wantC !== wiredCryptoFeeds) {
			wiredCryptoFeeds = wantC;
			if (wantC) connectBinance(wantC);
			else disconnectBinance();
		}
		if (wantS !== wiredStockFeeds) {
			wiredStockFeeds = wantS;
			if (wantS) connectStocks(wantS);
			else disconnectStocks();
		}
	} else if (browser) {
		if (wiredCryptoFeeds) {
			wiredCryptoFeeds = '';
			disconnectBinance();
		}
		if (wiredStockFeeds) {
			wiredStockFeeds = '';
			disconnectStocks();
		}
	}

	onDestroy(() => {
		if (!browser) return;
		disconnectBinance();
		disconnectStocks();
		wiredCryptoFeeds = '';
		wiredStockFeeds = '';
	});
</script>

<main class="history-page">
	<div class="inner">
		<header class="head">
			<h1>History</h1>
		</header>

		{#if !wallet.connected}
			<div class="placeholder">Connect a wallet to view history.</div>
		{:else}
			<nav class="filter-nav">
				{#each FILTER_OPTIONS as f}
					<button class="fbtn" class:active={filter === f} on:click={() => (filter = f)}>
						{f.toUpperCase()}
					</button>
				{/each}
				<span class="spacer"></span>
				{#if actionMessage}
					<span class="action-msg">{actionMessage}</span>
				{/if}
				<button class="refresh" on:click={load} disabled={loading}>
					{loading ? '…' : '↻ REFRESH'}
				</button>
			</nav>

			{#if error}
				<div class="placeholder err">{error}</div>
			{:else if loading && entries.length === 0}
				<div class="placeholder">Loading positions…</div>
			{:else if filteredAll.length === 0}
				<div class="placeholder">No positions for this filter.</div>
			{:else}
				<!-- ===================== OPEN POSITIONS ===================== -->
				{#if openEntries.length > 0}
					<section class="section">
						<div class="section-head">
							<div class="section-title">
								<span class="dot dot-live"></span>
								Open Positions
								<span class="section-count">({openEntries.length})</span>
							</div>
							{#if totalLivePnl !== 0}
								<span
									class="pnl-pill"
									class:up={totalLivePnl >= 0}
									class:down={totalLivePnl < 0}
								>
									Live uPnL {fmtNum(totalLivePnl)} USDT
								</span>
							{/if}
						</div>

						<div class="cards">
							{#each openEntries as e (e.pubkey)}
								{#if e.kind === 'trading'}
									{@const t = e.data as TradingPositionAccount}
									{@const status = variantKey(t.status)}
									{@const dir = variantKey(t.direction)}
									{@const tmode = variantKey(t.tradeMode)}
									{@const otype = variantKey(t.orderType)}
									{@const symbol = tradingSymbol(t)}
									{@const cat = tradingCategory(t)}
									{@const live = liveTradingPnl(t)}
									{@const entryPx = rawNum(t.entryPrice) / PRICE_SCALE}
									{@const limitPx = rawNum(t.limitPrice) / PRICE_SCALE}
									{@const tpPx = rawNum(t.takeProfitPrice) / PRICE_SCALE}
									{@const slPx = rawNum(t.stopLossPrice) / PRICE_SCALE}
									{@const liqPx = rawNum(t.liquidationPrice) / PRICE_SCALE}
									{@const sizeUsd = rawNum(t.sizeUsd) / USD_SCALE}
									{@const marginUsd = rawNum(t.marginUsd) / USD_SCALE}
									{@const sizeTokens =
										entryPx > 0 ? sizeUsd / entryPx : limitPx > 0 ? sizeUsd / limitPx : 0}

									<article class="card">
										<header class="card-head">
											<div class="card-symbol">
												<span class="sym">{symbol}</span>
												<span class="cat-badge cat-{cat}">{cat.toUpperCase()}</span>
												<span class="mode-badge">{tmode.toUpperCase()}</span>
												{#if otype === 'limit'}<span class="mode-badge alt">LIMIT</span>{/if}
												<span class="side-pill side-{dir}">
													{tmode === 'perp' ? dir.toUpperCase() : dir === 'long' ? 'BUY' : 'SELL'}
												</span>
												{#if tmode === 'perp' && t.leverage > 1}
													<span class="lev-badge">{t.leverage}x</span>
												{/if}
												<span class="status-badge s-{status}">
													{status === 'pendingFill' ? 'PENDING' : status.toUpperCase()}
												</span>
											</div>
											<div class="card-actions">
												<button
													class="close-btn"
													class:cancel={status === 'pendingFill'}
													disabled={closingPubkey === e.pubkey}
													on:click={() => closeEntry(e)}
												>
													{#if closingPubkey === e.pubkey}
														…
													{:else if status === 'pendingFill'}
														CANCEL
													{:else}
														CLOSE
													{/if}
												</button>
											</div>
										</header>

										<div class="card-grid grid-trading">
											<div class="cell">
												<span class="k">Size</span>
												<span class="v">${fmtUsd(t.sizeUsd)}</span>
												<span class="sub">{sizeTokens.toFixed(4)} {symbol}</span>
											</div>
											<div class="cell">
												<span class="k">{tmode === 'perp' ? 'Margin' : 'Cost'}</span>
												<span class="v">${fmtUsd(t.marginUsd)}</span>
											</div>
											<div class="cell">
												<span class="k">{status === 'pendingFill' ? 'Limit' : 'Entry'}</span>
												<span class="v">
													${(status === 'pendingFill' ? limitPx : entryPx).toFixed(2)}
												</span>
											</div>
											<div class="cell">
												<span class="k">Current</span>
												<span class="v">
													{live ? '$' + live.markPrice.toFixed(2) : '—'}
												</span>
											</div>
											<div class="cell">
												<span class="k">TP</span>
												<span class="v soft">{tpPx > 0 ? '$' + tpPx.toFixed(2) : '—'}</span>
											</div>
											<div class="cell">
												<span class="k">SL</span>
												<span class="v soft">{slPx > 0 ? '$' + slPx.toFixed(2) : '—'}</span>
											</div>
											<div class="cell">
												<span class="k">Liq</span>
												<span class="v" class:warn={tmode === 'perp' && liqPx > 0}>
													{tmode === 'perp' && liqPx > 0 ? '$' + liqPx.toFixed(2) : '—'}
												</span>
											</div>
											<div class="cell pnl-cell">
												<span class="k">Pending PnL</span>
												{#if live}
													<span
														class="v big"
														class:up={live.pnl >= 0}
														class:down={live.pnl < 0}
													>
														{fmtNum(live.pnl)} USDT
													</span>
													<span
														class="sub"
														class:up={live.pct >= 0}
														class:down={live.pct < 0}
													>
														{fmtNum(live.pct)}% on margin
													</span>
												{:else}
													<span class="v soft">—</span>
													<span class="sub">awaiting fill</span>
												{/if}
											</div>
										</div>

										<footer class="card-foot">
											<span>Opened {shortDate(e.openedAt)}</span>
											<span class="dot-sep">·</span>
											<span class="pid">#{rawNum(t.positionId)}</span>
										</footer>
									</article>
								{:else}
									{@const p = e.data as PredictionPositionAccount}
									{@const ptype = variantKey(p.predictionType)}
									{@const status = variantKey(p.status)}
									{@const remainingShares = rawNum(p.remainingShares) / USD_SCALE}
									{@const live = predLivePnl(p, predMeta)}
									{@const marketName = predMarketName(p.marketId, predMeta)}
									<article class="card">
										<header class="card-head">
											<div class="card-symbol">
												<span class="sym pred-name" title={marketName}>{marketName}</span>
												<span class="cat-badge cat-prediction">PREDICTION</span>
												<span class="side-pill side-{ptype === 'yes' ? 'long' : 'short'}">
													{ptype.toUpperCase()}
												</span>
												<span class="status-badge s-{status}">
													{status === 'partiallySold' ? 'PARTIAL' : status.toUpperCase()}
												</span>
											</div>
										</header>
										<div class="card-grid grid-prediction">
											<div class="cell">
												<span class="k">Stake</span>
												<span class="v">${fmtUsd(p.amountUsd)}</span>
											</div>
											<div class="cell">
												<span class="k">Shares</span>
												<span class="v">{(rawNum(p.shares) / USD_SCALE).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
											</div>
											<div class="cell">
												<span class="k">Remaining</span>
												<span class="v">{remainingShares.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
											</div>
											<div class="cell">
												<span class="k">Avg price</span>
												<span class="v">${fmtPrice(p.pricePerShare)}</span>
											</div>
											<div class="cell">
												<span class="k">Current price</span>
												<span class="v">{live ? '$' + live.current.toFixed(3) : '—'}</span>
											</div>
											<div class="cell pnl-cell">
												<span class="k">Pending PnL</span>
												{#if live}
													<span class="v big" class:up={live.pnl >= 0} class:down={live.pnl < 0}>
														{fmtNum(live.pnl)} USDT
													</span>
													<span class="sub" class:up={live.pct >= 0} class:down={live.pct < 0}>
														{fmtNum(live.pct)}% on cost
													</span>
												{:else}
													<span class="v soft">—</span>
													<span class="sub">awaiting price</span>
												{/if}
											</div>
										</div>

										<div class="sell-row">
											<input
												type="number"
												min="0"
												step="0.01"
												max={remainingShares}
												placeholder="Qty to sell"
												bind:value={sellQty[e.pubkey]}
												disabled={sellingPubkey === e.pubkey}
											/>
											<button
												type="button"
												class="max-btn"
												on:click={() => {
													sellQty[e.pubkey] = remainingShares;
													sellQty = sellQty;
												}}
												disabled={sellingPubkey === e.pubkey}
											>
												MAX
											</button>
											<button
												class="sell-btn"
												disabled={sellingPubkey === e.pubkey || !live}
												on:click={() => sellPredictionEntry(e)}
											>
												{sellingPubkey === e.pubkey ? '…' : 'SELL'}
											</button>
										</div>

										<footer class="card-foot">
											<span>Opened {shortDate(e.openedAt)}</span>
											<span class="dot-sep">·</span>
											<span class="pid">#{rawNum(p.positionId)}</span>
										</footer>
									</article>
								{/if}
							{/each}
						</div>
					</section>
				{/if}

				<!-- ===================== HISTORY ===================== -->
				{#if closedEntries.length > 0}
					<section class="section">
						<div class="section-head">
							<div class="section-title">
								<span class="dot dot-closed"></span>
								Trade History
								<span class="section-count">({closedEntries.length})</span>
							</div>
						</div>

						<div class="table">
							<div class="row head-row">
								<div>OPENED</div>
								<div>TYPE</div>
								<div>MARKET</div>
								<div>SIDE</div>
								<div>SIZE</div>
								<div>ENTRY → EXIT</div>
								<div>STATUS</div>
								<div class="rt-num">REALIZED PNL</div>
							</div>
							{#each closedEntries as e (e.pubkey)}
								{#if e.kind === 'trading'}
									{@const t = e.data as TradingPositionAccount}
									{@const pnl = fmtPnl(t.realizedPnl)}
									{@const status = variantKey(t.status)}
									{@const tmode = variantKey(t.tradeMode)}
									{@const otype = variantKey(t.orderType)}
									{@const cat = tradingCategory(t)}
									{@const closePx = rawNum(t.closePrice) / PRICE_SCALE}
									<div class="row">
										<div class="cell-stack">
											<span class="dim">{shortDate(e.openedAt)}</span>
											{#if rawNum(t.closedAt) > 0}
												<span class="dim small">→ {shortDate(rawNum(t.closedAt))}</span>
											{/if}
										</div>
										<div>
											<span class="cat-badge cat-{cat}">{cat.toUpperCase()}</span>
											<span class="mode-tag">{tmode}/{otype}</span>
										</div>
										<div><span class="mono">{tradingSymbol(t)}</span></div>
										<div>
											<span class="side-pill side-{variantKey(t.direction)}">
												{variantKey(t.direction).toUpperCase()}
											</span>
											{#if tmode === 'perp'}<span class="lev-inline">{t.leverage}x</span>{/if}
										</div>
										<div class="cell-stack">
											<span>${fmtUsd(t.sizeUsd)}</span>
											<span class="dim small">margin ${fmtUsd(t.marginUsd)}</span>
										</div>
										<div class="cell-stack">
											<span>${fmtPrice(t.entryPrice)}</span>
											{#if closePx > 0}
												<span class="dim small">→ ${closePx.toFixed(4)}</span>
											{/if}
										</div>
										<div>
											<span class="status-badge s-{status}">
												{status.toUpperCase()}
											</span>
										</div>
										<div class="rt-num {pnl.cls}">{pnl.txt}</div>
									</div>
								{:else}
									{@const p = e.data as PredictionPositionAccount}
									{@const ptype = variantKey(p.predictionType)}
									{@const status = variantKey(p.status)}
									<div class="row">
										<div class="dim">{shortDate(e.openedAt)}</div>
										<div><span class="cat-badge cat-prediction">PREDICTION</span></div>
										<div>
											<span class="mono pred-name" title={predMarketName(p.marketId, predMeta)}>
												{predMarketName(p.marketId, predMeta)}
											</span>
										</div>
										<div>
											<span class="side-pill side-{ptype === 'yes' ? 'long' : 'short'}">
												{ptype.toUpperCase()}
											</span>
										</div>
										<div class="cell-stack">
											<span>${fmtUsd(p.amountUsd)}</span>
											<span class="dim small">
												{(rawNum(p.shares) / USD_SCALE).toLocaleString()} sh
											</span>
										</div>
										<div>${fmtPrice(p.pricePerShare)}</div>
										<div>
											<span class="status-badge s-{status}">
												{status === 'fullySold' ? 'SOLD' : status.toUpperCase()}
											</span>
										</div>
										<div class="rt-num flat">—</div>
									</div>
								{/if}
							{/each}
						</div>
					</section>
				{/if}
			{/if}
		{/if}
	</div>
</main>

<style>
	.history-page {
		min-height: calc(100vh - 100px);
		background: #0a0a0a;
		color: #d8d8d8;
		font-family: 'Courier New', monospace;
	}
	.inner {
		max-width: 1400px;
		margin: 0 auto;
		padding: 24px 16px 48px;
	}

	.head { margin-bottom: 20px; }
	.head h1 { color: #ff5a00; font-size: 22px; letter-spacing: 0.08em; margin-bottom: 4px; }

	.filter-nav {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 8px 0 16px;
		border-bottom: 1px solid #222;
		margin-bottom: 16px;
	}
	.fbtn {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
		transition: all 0.12s;
	}
	.fbtn:hover { color: #ccc; border-color: #444; }
	.fbtn.active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0, 0.05); }
	.spacer { flex: 1; }
	.action-msg {
		color: #ff5a00;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.04em;
	}
	.refresh {
		background: #000;
		border: 1px solid #333;
		border-radius: 6px;
		color: #ccc;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		cursor: pointer;
		letter-spacing: 0.06em;
	}
	.refresh:hover { border-color: #ff5a00; color: #ff5a00; }
	.refresh:disabled { opacity: 0.5; cursor: not-allowed; }

	.placeholder {
		padding: 3rem 1rem;
		text-align: center;
		color: #666;
		font-size: 12px;
		background: #121212;
		border: 1px solid #222;
		border-radius: 10px;
	}
	.placeholder.err { color: #ff6b6b; }

	/* ===== Sections ===== */
	.section { margin-bottom: 28px; }
	.section-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
		padding-bottom: 8px;
		border-bottom: 1px solid #1a1a1a;
	}
	.section-title {
		display: flex;
		align-items: center;
		gap: 10px;
		color: #e8e8e8;
		font-size: 12px;
		font-weight: bold;
		letter-spacing: 0.12em;
		text-transform: uppercase;
	}
	.section-count { color: #b0b0b0; font-weight: 500; }
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		display: inline-block;
	}
	.dot-live {
		background: #00ff64;
		box-shadow: 0 0 8px rgba(0, 255, 100, 0.6);
		animation: pulse 1.6s infinite;
	}
	.dot-closed { background: #444; }
	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
	.pnl-pill {
		font-size: 11px;
		font-weight: bold;
		padding: 4px 10px;
		border: 1px solid;
		border-radius: 999px;
		letter-spacing: 0.06em;
	}
	.pnl-pill.up { color: #00ff64; border-color: rgba(0, 255, 100, 0.4); background: rgba(0, 255, 100, 0.05); }
	.pnl-pill.down { color: #ff4444; border-color: rgba(255, 68, 68, 0.4); background: rgba(255, 68, 68, 0.05); }

	/* ===== Cards (Open positions) ===== */
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
		gap: 12px;
	}
	.card {
		background: linear-gradient(180deg, #141414 0%, #101010 100%);
		border: 1px solid #222;
		border-left: 2px solid #333;
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		transition: border-color 0.15s;
	}
	.card:hover { border-color: #2e2e2e; border-left-color: #ff5a00; }

	.card-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 10px;
	}
	.card-symbol {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.sym {
		color: #ff5a00;
		font-weight: bold;
		font-size: 14px;
		letter-spacing: 0.04em;
	}
	.card-actions { flex-shrink: 0; }
	.close-btn {
		background: transparent;
		border: 1px solid #ff4444;
		border-radius: 6px;
		color: #ff4444;
		padding: 5px 14px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
		transition: all 0.12s;
	}
	.close-btn:hover {
		background: #ff4444;
		color: #fff;
	}
	.close-btn.cancel {
		border-color: #ff5a00;
		color: #ff5a00;
	}
	.close-btn.cancel:hover {
		background: #ff5a00;
		color: #000;
	}
	.close-btn:disabled { opacity: 0.5; cursor: not-allowed; }

	.sell-row {
		display: flex;
		gap: 6px;
		align-items: center;
		padding: 8px 0 2px;
		border-top: 1px dashed #1f1f1f;
		margin-top: 2px;
	}
	.sell-row input {
		flex: 1;
		min-width: 0;
		background: #0a0a0a;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		color: #ececec;
		font-family: inherit;
		font-size: 12px;
		padding: 6px 8px;
		font-variant-numeric: tabular-nums;
	}
	.sell-row input:focus { outline: none; border-color: #ff5a00; }
	.sell-row .max-btn {
		background: transparent;
		border: 1px solid #2a2a2a;
		border-radius: 6px;
		color: #b0b0b0;
		padding: 5px 10px;
		font-family: inherit;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
	}
	.sell-row .max-btn:hover { border-color: #ff5a00; color: #ff5a00; }
	.sell-row .sell-btn {
		background: transparent;
		border: 1px solid #ff4444;
		border-radius: 6px;
		color: #ff4444;
		padding: 6px 16px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
		transition: all 0.12s;
	}
	.sell-row .sell-btn:hover { background: #ff4444; color: #fff; }
	.sell-row .sell-btn:disabled,
	.sell-row .max-btn:disabled,
	.sell-row input:disabled { opacity: 0.5; cursor: not-allowed; }

	.sym.pred-name {
		color: #ececec;
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.card-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 10px 14px;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.cell .k {
		color: #a0a0a0;
		font-size: 9px;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		font-weight: bold;
	}
	.cell .v {
		color: #ececec;
		font-size: 12px;
		font-weight: bold;
		font-variant-numeric: tabular-nums;
	}
	.cell .v.big { font-size: 14px; }
	.cell .v.soft { color: #b8b8b8; }
	.cell .v.warn { color: #ff5a00; }
	.cell .sub {
		color: #a8a8a8;
		font-size: 9px;
		font-variant-numeric: tabular-nums;
	}

	.pnl-cell {
		grid-column: span 2;
		padding-left: 10px;
		border-left: 1px solid #222;
	}

	/* Trading: 4×2 metrics, then full-width PnL row for alignment */
	.grid-trading {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.grid-trading .pnl-cell {
		grid-column: 1 / -1;
		border-left: none;
		padding-left: 0;
		padding-top: 8px;
		margin-top: 4px;
		border-top: 1px solid #222;
	}

	/* Prediction: first row 4 cols, second row current + wide PnL */
	.grid-prediction {
		grid-template-columns: repeat(4, minmax(0, 1fr));
	}
	.grid-prediction .pnl-cell {
		grid-column: 2 / -1;
		border-left: 1px solid #222;
		padding-left: 10px;
		padding-top: 0;
		margin-top: 0;
		border-top: none;
	}

	.up { color: #00ff64 !important; }
	.down { color: #ff4444 !important; }
	.flat { color: #666; }

	.card-foot {
		display: flex;
		gap: 6px;
		align-items: center;
		color: #b0b0b0;
		font-size: 10px;
		padding-top: 6px;
		border-top: 1px solid #1a1a1a;
	}
	.dot-sep { color: #6a6a6a; }
	.pid { color: #b0b0b0; font-family: 'Courier New', monospace; }

	/* ===== Badges ===== */
	.cat-badge {
		display: inline-block;
		padding: 2px 6px;
		font-size: 9px;
		font-weight: bold;
		letter-spacing: 0.08em;
		border-radius: 2px;
	}
	.cat-crypto { background: rgba(255, 90, 0, 0.15); color: #ff5a00; }
	.cat-stock, .cat-equity { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
	.cat-forex { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
	.cat-metal { background: rgba(234, 179, 8, 0.15); color: #fde047; }
	.cat-prediction { background: rgba(236, 72, 153, 0.15); color: #f472b6; }
	.mode-badge {
		display: inline-block;
		padding: 2px 6px;
		font-size: 9px;
		font-weight: bold;
		letter-spacing: 0.08em;
		border: 1px solid #2a2a2a;
		border-radius: 4px;
		color: #b0b0b0;
	}
	.mode-badge.alt { color: #ff5a00; border-color: rgba(255, 90, 0, 0.3); }
	.mode-tag { color: #a0a0a0; font-size: 10px; margin-left: 4px; text-transform: lowercase; }

	.side-pill {
		display: inline-block;
		padding: 3px 8px;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.08em;
		border-radius: 2px;
	}
	.side-pill.side-long { background: rgba(0, 255, 100, 0.12); color: #00ff64; }
	.side-pill.side-short { background: rgba(255, 68, 68, 0.12); color: #ff4444; }
	.lev-badge {
		background: rgba(255, 90, 0, 0.15);
		color: #ff5a00;
		padding: 2px 6px;
		font-size: 9px;
		font-weight: bold;
		letter-spacing: 0.06em;
	}
	.lev-inline { color: #ff5a00; margin-left: 4px; font-size: 10px; }

	.status-badge {
		display: inline-block;
		padding: 2px 6px;
		font-size: 9px;
		font-weight: bold;
		letter-spacing: 0.08em;
		border-radius: 2px;
		border: 1px solid;
	}
	.status-badge.s-active, .status-badge.s-partiallySold {
		color: #00ff64; border-color: rgba(0, 255, 100, 0.4); background: rgba(0, 255, 100, 0.05);
	}
	.status-badge.s-pendingFill {
		color: #ff5a00; border-color: rgba(255, 90, 0, 0.4); background: rgba(255, 90, 0, 0.05);
	}
	.status-badge.s-closed, .status-badge.s-fullySold {
		color: #888; border-color: #2a2a2a; background: #0a0a0a;
	}
	.status-badge.s-liquidated {
		color: #ff4444; border-color: rgba(255, 68, 68, 0.4); background: rgba(255, 68, 68, 0.05);
	}
	.status-badge.s-cancelled {
		color: #666; border-color: #222; background: #0a0a0a;
	}

	/* ===== History table ===== */
	.table { background: #121212; border: 1px solid #222; border-radius: 10px; overflow: hidden; }
	.row {
		display: grid;
		grid-template-columns:
			minmax(108px, 1fr)
			minmax(100px, 0.95fr)
			minmax(96px, 1.35fr)
			minmax(72px, 0.75fr)
			minmax(100px, 1fr)
			minmax(112px, 1.15fr)
			minmax(84px, 0.85fr)
			minmax(92px, 1fr);
		gap: 10px 12px;
		padding: 10px 12px;
		border-bottom: 1px solid #1a1a1a;
		font-size: 11px;
		align-items: center;
	}
	.row:last-child { border-bottom: 0; }
	.row:not(.head-row):hover { background: #161616; }
	.head-row {
		color: #666;
		background: #0a0a0a;
		font-size: 10px;
		letter-spacing: 0.1em;
		font-weight: bold;
		position: sticky;
		top: 0;
		z-index: 1;
	}
	.cell-stack { display: flex; flex-direction: column; gap: 2px; }
	.dim { color: #c8c8c8; }
	.dim.small { color: #909090; font-size: 9px; }
	.mono { color: #ff5a00; font-weight: bold; }
	.mono.pred-name { color: #ececec; font-weight: bold; }
	.rt-num { text-align: right; font-variant-numeric: tabular-nums; font-weight: bold; }

	@media (max-width: 1100px) {
		.cards { grid-template-columns: 1fr; }
		.card-grid { grid-template-columns: repeat(2, 1fr); }
		.grid-trading .pnl-cell,
		.grid-prediction .pnl-cell {
			grid-column: 1 / -1;
			border-left: 0;
			padding-left: 0;
			border-top: 1px solid #222;
			padding-top: 8px;
			margin-top: 4px;
		}
		.row { grid-template-columns: 1fr 1fr; }
		.head-row { display: none; }
	}
</style>
