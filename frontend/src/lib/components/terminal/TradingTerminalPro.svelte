<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { BN } from '$lib/vendor/anchor';
	import { walletStore } from '$lib/wallet/stores';
	import { pythPrices } from '$lib/stores/pythPrices';
	import { sessionKey } from '$lib/stores/sessionKey';
	import { setUserBalance, clearUserBalance } from '$lib/stores/userBalance';
	import { selectedMarket } from '$lib/stores/selectedMarket';
	import { hashfoxClient } from '$lib/hashfoxClient';
	import { sessionKeyManager } from '$lib/solana/session-keys';
	import {
		buildConnection,
		buildProgram,
		buildKeypairProgram,
		openMarketPosition,
		openLimitOrder,
		closeTradingPosition as closeTradingPositionRpc,
		cancelLimitOrder as cancelLimitOrderRpc,
		initializeUserAccount,
		getUserAccount,
		decodeBalance,
		priceScaled,
		usd,
		type BalanceBreakdown,
		type EnrichedTradingPosition,
		type MarketCategoryVariant
	} from '$lib/hashfox';
	import {
		MARKETS_BY_CATEGORY,
		PERP_LEVERAGE_TIERS,
		type MarketCategory,
		type MarketEntry
	} from '$lib/markets';
	import PythChart from '$lib/components/terminal/PythChart.svelte';
	import {
		binanceOrderBook,
		binanceTrades,
		binanceStatus,
		connectBinance,
		disconnectBinance,
		type OrderBookData,
		type TradeRow
	} from '$lib/stores/binanceOrderbook';
	import {
		syntheticOrderBook,
		syntheticTrades,
		syntheticStatus,
		connectSynthetic,
		disconnectSynthetic
	} from '$lib/stores/syntheticOrderbook';
	import {
		stocksOrderBook,
		stocksTrades,
		stocksStatus,
		stocksUnconfigured,
		connectStocks,
		disconnectStocks
	} from '$lib/stores/stocksOrderbook';
	import { syncClosedTradingPositions } from '$lib/social/syncClosedTrades';

	/** Which category this terminal serves. */
	export let category: MarketCategory = 'crypto';

	let market: MarketEntry = MARKETS_BY_CATEGORY[category][0];
	selectedMarket.subscribe((m) => {
		if (m.category === category) market = m;
	});

	let prices: Record<string, any> = {};
	pythPrices.subscribe((p) => (prices = p));

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let session: any = {};
	sessionKey.subscribe((s) => (session = s));

	const isCrypto = category === 'crypto';

	/** Resolve which orderbook source a market uses. */
	type BookSource = 'binance' | 'stocks' | 'synthetic';
	function bookSourceFor(m: MarketEntry | undefined): BookSource {
		if (!m) return 'synthetic';
		if (m.sub === 'crypto') return 'binance';
		if (m.sub === 'stock' || m.sub === 'equity') return 'stocks';
		return 'synthetic';
	}

	/** Map traditional-market symbols to TradingView identifiers. */
	const TV_SYMBOLS: Record<string, string> = {
		AAPL: 'NASDAQ:AAPL', TSLA: 'NASDAQ:TSLA', NVDA: 'NASDAQ:NVDA',
		AMZN: 'NASDAQ:AMZN', MSFT: 'NASDAQ:MSFT', GOOGL: 'NASDAQ:GOOGL',
		META: 'NASDAQ:META', NFLX: 'NASDAQ:NFLX', JPM: 'NYSE:JPM',
		AMD: 'NASDAQ:AMD', BABA: 'NYSE:BABA', COIN: 'NASDAQ:COIN',
		EURUSD: 'FX:EURUSD', GBPUSD: 'FX:GBPUSD', USDJPY: 'FX:USDJPY',
		AUDUSD: 'FX:AUDUSD', USDCHF: 'FX:USDCHF', USDCAD: 'FX:USDCAD',
		XAUUSD: 'COMEX:GC1!', XAGUSD: 'COMEX:SI1!'
	};
	function tradingViewSymbol(m: MarketEntry | undefined): string {
		if (!m) return '';
		if (m.category === 'crypto') return `BINANCE:${m.symbol}USDT`;
		return TV_SYMBOLS[m.symbol] ?? m.symbol;
	}

	// Default the chart to Pyth Live for traditional markets — the chart now
	// bootstraps history from Pyth Benchmarks so it works for stocks/forex/metals.
	let chartView: 'tradingview' | 'pyth' = isCrypto ? 'tradingview' : 'pyth';
	let orderBookColumn: 'book' | 'trades' = 'book';
	let orderBookData: OrderBookData = { asks: [], bids: [], spreadAbs: 0, spreadPct: 0 };
	let liveTrades: TradeRow[] = [];
	let bookStatus = 'Connecting…';

	/* ---- trading form state ---- */
	let tradingTabUI: 'spot' | 'limit' | 'perps' = 'spot';
	let tradeSurface: 'spot' | 'perp' = 'spot';
	let tradeSide: 'buy' | 'sell' = 'buy';
	let sizeDenom: 'USDT' | 'BASE' = 'USDT';
	let tradeSize = '';
	let limitPriceInput = '';
	let perpLeverage: number = 10;
	let takeProfit = '';
	let stopLoss = '';
	let selectedPercentage = 0;

	/* ---- balances + positions ---- */
	let balance: BalanceBreakdown = { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };
	let positions: EnrichedTradingPosition[] = [];
	let solBalance = 0;
	let statusMessage = '';
	let busy = false;
	let positionsDockTab: 'orders' | 'balance' = 'balance';
	let accountInitialized = false;
	let closingPubkey = '';

	/* ---- refresh plumbing ---- */
	let statusPoll: ReturnType<typeof setInterval> | null = null;

	$: currentPrice = prices[market?.symbol]?.price ?? 0;
	$: emaPrice = prices[market?.symbol]?.emaPrice ?? 0;
	$: change24h = prices[market?.symbol]?.change ?? 0;
	$: spreadConf = prices[market?.symbol]?.spread ?? 0;
	$: publishTime = prices[market?.symbol]?.publishTime ?? 0;

	/* Market orderbook wiring — pick source per sub-category. */
	let activeBookSource: BookSource = 'synthetic';
	function wireOrderbook(m: MarketEntry | undefined) {
		const sym = m?.symbol;
		if (!sym) return;
		const next = bookSourceFor(m);
		// Tear down all sources we're not using.
		if (next !== 'binance') disconnectBinance();
		if (next !== 'stocks') disconnectStocks();
		if (next !== 'synthetic') disconnectSynthetic();
		activeBookSource = next;
		if (next === 'binance') connectBinance(sym);
		else if (next === 'stocks') connectStocks(sym);
		else connectSynthetic(sym);
	}

	$: if (market?.symbol) wireOrderbook(market);

	// If the server reports that Alpaca isn't configured, fall back to the
	// synthetic book for stocks so the panel still renders something useful.
	stocksUnconfigured.subscribe((unconfigured) => {
		if (unconfigured && activeBookSource === 'stocks' && market?.symbol) {
			disconnectStocks();
			activeBookSource = 'synthetic';
			connectSynthetic(market.symbol);
		}
	});

	/* Subscribe to the right orderbook store per active source. */
	$: bookStore =
		activeBookSource === 'binance'
			? binanceOrderBook
			: activeBookSource === 'stocks'
				? stocksOrderBook
				: syntheticOrderBook;
	$: tradesStore =
		activeBookSource === 'binance'
			? binanceTrades
			: activeBookSource === 'stocks'
				? stocksTrades
				: syntheticTrades;
	$: statusStore =
		activeBookSource === 'binance'
			? binanceStatus
			: activeBookSource === 'stocks'
				? stocksStatus
				: syntheticStatus;

	let unsubBook: (() => void) | null = null;
	let unsubTrades: (() => void) | null = null;
	let unsubStatus: (() => void) | null = null;

	$: {
		if (unsubBook) unsubBook();
		if (unsubTrades) unsubTrades();
		if (unsubStatus) unsubStatus();
		unsubBook = bookStore.subscribe((b) => (orderBookData = b));
		unsubTrades = tradesStore.subscribe((t) => (liveTrades = t));
		unsubStatus = statusStore.subscribe((s) => (bookStatus = s));
	}

	function pick(sym: string) {
		const m = MARKETS_BY_CATEGORY[category].find((x) => x.symbol === sym);
		if (m) selectedMarket.set(m);
	}

	function fmtPrice(price: number, decimals?: number): string {
		if (!price || price <= 0) return '—';
		const d = decimals ?? (price >= 1000 ? 2 : price >= 10 ? 3 : price >= 1 ? 4 : 6);
		return price.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
	}

	function fmtUsd(n: number, decimals = 2): string {
		return n.toLocaleString('en-US', {
			minimumFractionDigits: decimals,
			maximumFractionDigits: decimals
		});
	}

	function notionalFromSizeInput(): number {
		const raw = parseFloat(tradeSize);
		if (!raw || raw <= 0) return 0;
		if (sizeDenom === 'BASE') {
			if (!currentPrice) return 0;
			return raw * currentPrice;
		}
		return raw;
	}

	function setTradingTab(tab: 'spot' | 'limit' | 'perps') {
		tradingTabUI = tab;
		tradeSurface = tab === 'perps' ? 'perp' : 'spot';
		if (tab === 'limit' && currentPrice > 0 && !limitPriceInput) {
			limitPriceInput = currentPrice.toFixed(4);
		}
		selectedPercentage = 0;
	}

	function setPercentageSize(pct: number) {
		selectedPercentage = pct;
		const lev = tradeSurface === 'perp' ? Number(perpLeverage) : 1;
		const margin = (balance.availableUsd * pct) / 100;
		const notional = margin * lev;
		if (sizeDenom === 'USDT') {
			tradeSize = Math.max(0.01, Math.floor(notional * 100) / 100).toFixed(2);
		} else if (currentPrice > 0) {
			tradeSize = (notional / currentPrice).toFixed(market.decimals);
		}
	}

	function subCategoryToVariant(sub: string): MarketCategoryVariant {
		if (sub === 'crypto') return 'crypto';
		if (sub === 'stock') return 'stock';
		if (sub === 'forex') return 'forex';
		if (sub === 'metal') return 'metal';
		return 'equity';
	}

	async function ensureAccount() {
		const conn = buildConnection();
		const program = buildProgram(conn, wallet.adapter);
		const acc = await getUserAccount(program, wallet.publicKey);
		if (!acc) {
			statusMessage = 'Initializing paper account…';
			await initializeUserAccount(program, wallet.publicKey, new BN(10_000_000));
			statusMessage = 'Paper account initialized.';
			accountInitialized = true;
		}
		return program;
	}

	/** Build the program + tx signer for trade execution. When the fast-trade
	 *  session is active, sign locally with the session keypair so the wallet
	 *  popup is skipped. The on-chain authority (PDA derivation) stays the
	 *  wallet pubkey. */
	function buildTradeRuntime(): { program: any; signer: import('@solana/web3.js').PublicKey; sessionToken: import('@solana/web3.js').PublicKey | null } {
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

	async function submitOrder() {
		if (busy) return;
		if (!wallet?.connected) {
			statusMessage = 'Connect a wallet first.';
			return;
		}

		// Spot sell: you can only sell what you actually hold. Route a market
		// sell to close the matching long spot position(s) instead of opening a
		// new short, and block the action entirely when there are no holdings.
		if (tradeSurface === 'spot' && tradeSide === 'sell') {
			if (currentSymbolHoldings.length === 0) {
				statusMessage = `You don't own ${market.symbol} to sell.`;
				return;
			}
			if (tradingTabUI === 'spot') {
				await executeSpotSell();
				return;
			}
			// Limit sell falls through to the standard flow below — the user owns
			// the asset, so placing a limit short order is at least permitted.
		}

		const notional = notionalFromSizeInput();
		if (notional <= 0) {
			statusMessage = 'Enter a valid size.';
			return;
		}
		if (tradingTabUI === 'limit' && !parseFloat(limitPriceInput)) {
			statusMessage = 'Enter a limit price.';
			return;
		}
		const lev = tradeSurface === 'perp' ? Number(perpLeverage) : 1;
		const requiredMargin = notional / lev;
		if (requiredMargin > balance.availableUsd + 0.01) {
			statusMessage = `Insufficient available USDT (need ${requiredMargin.toFixed(2)}).`;
			return;
		}
		busy = true;
		statusMessage = 'Submitting order…';
		try {
			await ensureAccount();
			const { program, signer, sessionToken } = buildTradeRuntime();
			const direction = tradeSide === 'buy' ? 'long' : 'short';
			const tp =
				takeProfit && parseFloat(takeProfit) > 0 ? priceScaled(parseFloat(takeProfit)) : new BN(0);
			const sl =
				stopLoss && parseFloat(stopLoss) > 0 ? priceScaled(parseFloat(stopLoss)) : new BN(0);
			const marginUsd = usd(requiredMargin);

			let sig = '';
			if (tradingTabUI === 'limit') {
				sig = await openLimitOrder(program, wallet.publicKey, {
					marketCategory: subCategoryToVariant(market.sub),
					pairIndex: market.pairIndex,
					tradeMode: tradeSurface,
					direction,
					marginUsd,
					leverage: lev,
					limitPrice: priceScaled(parseFloat(limitPriceInput)),
					takeProfitPrice: tp,
					stopLossPrice: sl,
					sessionToken,
					signer
				});
			} else {
				sig = await openMarketPosition(program, wallet.publicKey, {
					marketCategory: subCategoryToVariant(market.sub),
					pairIndex: market.pairIndex,
					tradeMode: tradeSurface,
					direction,
					marginUsd,
					leverage: lev,
					takeProfitPrice: tp,
					stopLossPrice: sl,
					entryPrice: priceScaled(currentPrice),
					sessionToken,
					signer
				});
			}
			statusMessage = `Order submitted · ${sig.slice(0, 8)}…`;
			tradeSize = '';
			limitPriceInput = '';
			takeProfit = '';
			stopLoss = '';
			selectedPercentage = 0;
			await refreshAccount();
		} catch (err: any) {
			console.error(err);
			statusMessage = err?.message ?? 'Order failed.';
		} finally {
			busy = false;
		}
	}

	/** Sell the user's full spot holding of the active market. The on-chain
	 *  program only supports full position closes, so partial sells are not
	 *  permitted here — every matching long position is closed at market. */
	async function executeSpotSell() {
		if (busy) return;
		const totalQty = currentSymbolHoldings.reduce((s, h) => s + h.qty, 0);
		if (totalQty <= 0) {
			statusMessage = `You don't own ${market.symbol} to sell.`;
			return;
		}

		const px = prices[market.symbol]?.price ?? currentPrice;
		if (!px || px <= 0) {
			statusMessage = 'Waiting for a price feed…';
			return;
		}

		busy = true;
		statusMessage = 'Selling…';
		try {
			await ensureAccount();
			const { program, signer, sessionToken } = buildTradeRuntime();
			for (const h of currentSymbolHoldings) {
				const pos = positions.find((p) => p.pubkey === h.pubkey);
				if (!pos) continue;
				await closeTradingPositionRpc(
					program,
					wallet.publicKey,
					new BN(pos.positionId),
					priceScaled(px),
					sessionToken,
					signer
				);
			}
			statusMessage = `Sold ${totalQty.toFixed(market.decimals)} ${market.symbol} @ $${px.toFixed(2)}`;
			tradeSize = '';
			selectedPercentage = 0;
			await refreshAccount();
		} catch (err: any) {
			console.error(err);
			statusMessage = err?.message ?? 'Sell failed.';
		} finally {
			busy = false;
		}
	}

	async function sellHolding(h: { pubkey: string; positionId: number; pairSymbol: string; currentPrice: number }) {
		if (closingPubkey) return;
		const pos = positions.find((p) => p.pubkey === h.pubkey);
		if (!pos) return;
		await closePosition(pos);
	}

	async function closePosition(pos: EnrichedTradingPosition) {
		if (closingPubkey) return;
		closingPubkey = pos.pubkey;
		try {
			const { program, signer, sessionToken } = buildTradeRuntime();
			if (pos.status === 'pending') {
				await cancelLimitOrderRpc(
					program,
					wallet.publicKey,
					new BN(pos.positionId),
					sessionToken,
					signer
				);
				statusMessage = `Cancelled #${pos.positionId}`;
			} else {
				const px = prices[pos.pairSymbol]?.price ?? currentPrice;
				await closeTradingPositionRpc(
					program,
					wallet.publicKey,
					new BN(pos.positionId),
					priceScaled(px),
					sessionToken,
					signer
				);
				statusMessage = `Closed #${pos.positionId} at $${px.toFixed(2)}`;
			}
			await refreshAccount();
		} catch (err: any) {
			console.error(err);
			statusMessage = err?.message ?? 'Close failed.';
		} finally {
			closingPubkey = '';
		}
	}

	async function refreshAccount() {
		if (!wallet?.connected) {
			balance = { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };
			clearUserBalance();
			positions = [];
			accountInitialized = false;
			return;
		}
		try {
			solBalance = await hashfoxClient.getBalance();
			accountInitialized = await hashfoxClient.isAccountInitialized();
			if (accountInitialized) {
				balance = await hashfoxClient.getBalanceBreakdown();
				setUserBalance(balance);
				positions = await hashfoxClient.fetchTradingPositions();
				const addr = wallet.publicKey?.toBase58?.();
				if (addr && positions.length > 0) {
					void syncClosedTradingPositions(addr, positions);
				}
			} else {
				balance = { totalUsd: 0, lockedUsd: 0, availableUsd: 0 };
				clearUserBalance();
				positions = [];
			}
		} catch (err) {
			console.warn('refresh failed', err);
		}
	}

	/* All open or pending positions for this category. Used to derive
	 * holdings (active spot) and open orders (perps + pending limits). */
	$: visiblePositions = positions.filter((p) => {
		if (p.status !== 'active' && p.status !== 'pending') return false;
		if (category === 'crypto') return p.marketCategory === 'crypto';
		return ['stock', 'forex', 'metal', 'equity'].includes(p.marketCategory);
	});

	/* Open Orders panel: only perps + pending limits (active spot belongs in
	 * the Balance tab as a held asset, not as an order). */
	$: ordersList = visiblePositions.filter(
		(p) => p.tradeMode === 'perp' || p.status === 'pending'
	);

	/** Active spot positions in this category, grouped by asset.
	 *  Each spot fill is essentially "you bought X tokens" — surface this in the
	 *  Balance tab so users can see their holdings under the chart. */
	type SpotHolding = {
		pubkey: string;
		positionId: number;
		pairSymbol: string;
		symbol: string;
		side: 'long' | 'short';
		qty: number;
		entryPrice: number;
		costUsd: number;
		currentPrice: number;
		valueUsd: number;
		unrealizedPnl: number;
	};
	$: spotHoldings = (() => {
		const out: SpotHolding[] = [];
		for (const p of visiblePositions) {
			if (p.tradeMode !== 'spot' || p.status !== 'active') continue;
			if (!p.entryPrice || p.entryPrice <= 0) continue;
			const qty = p.sizeUsd / p.entryPrice;
			const currentPrice = prices[p.pairSymbol]?.price ?? 0;
			const valueUsd = currentPrice > 0 ? qty * currentPrice : p.sizeUsd;
			const upnl =
				currentPrice > 0
					? p.direction === 'long'
						? (currentPrice - p.entryPrice) * qty
						: (p.entryPrice - currentPrice) * qty
					: 0;
			out.push({
				pubkey: p.pubkey,
				positionId: p.positionId,
				pairSymbol: p.pairSymbol,
				symbol: p.pairSymbol,
				side: p.direction,
				qty,
				entryPrice: p.entryPrice,
				costUsd: p.sizeUsd,
				currentPrice,
				valueUsd,
				unrealizedPnl: upnl
			});
		}
		return out;
	})();

	/** Long spot holdings of the currently displayed market — what the Sell
	 *  button actually has available to dispose of. */
	$: currentSymbolHoldings = spotHoldings.filter(
		(h) => h.symbol === market.symbol && h.side === 'long'
	);
	$: ownedQty = currentSymbolHoldings.reduce((s, h) => s + h.qty, 0);
	$: isSpotSell = tradeSurface === 'spot' && tradeSide === 'sell';
	$: isSpotMarketSell = tradingTabUI === 'spot' && tradeSide === 'sell';
	$: sellBlocked = isSpotSell && currentSymbolHoldings.length === 0;

	$: unrealizedPnl = (() => {
		let sum = 0;
		for (const p of visiblePositions) {
			if (p.status !== 'active' || p.tradeMode !== 'perp') continue;
			const markPx = prices[p.pairSymbol]?.price ?? 0;
			if (!markPx || !p.entryPrice) continue;
			sum +=
				p.direction === 'long'
					? ((markPx - p.entryPrice) / p.entryPrice) * p.sizeUsd
					: ((p.entryPrice - markPx) / p.entryPrice) * p.sizeUsd;
		}
		return sum;
	})();

	/** Re-interpret on-chain `locked_margin_usd` for display:
	 * the program locks USDT for both spot and perp (and for pending limit
	 * orders), but to the user a spot buy is "I now hold the asset" and only
	 * perp margin should appear as Locked. Both totals include pending limit
	 * orders so cash + spot + perp = on-chain total. */
	$: perpLockedUsd = positions
		.filter(
			(p) =>
				p.tradeMode === 'perp' && (p.status === 'active' || p.status === 'pending')
		)
		.reduce((s, p) => s + p.marginUsd, 0);
	$: spotCostUsd = positions
		.filter(
			(p) =>
				p.tradeMode === 'spot' && (p.status === 'active' || p.status === 'pending')
		)
		.reduce((s, p) => s + p.marginUsd, 0);
	/** Live mark value of all spot holdings (this category only — used for the chart's holdings card). */
	$: spotValueUsd = spotHoldings.reduce((s, h) => s + h.valueUsd, 0);
	/** "Cash USDT" the user can spend right now. The on-chain `availableUsd`
	 * already subtracts both spot and perp locks; that is the cash. */
	$: cashUsd = balance.availableUsd;

	onMount(() => {
		wireOrderbook(market);
		void refreshAccount();
		statusPoll = setInterval(() => {
			if (wallet?.connected) void refreshAccount();
		}, 10_000);
	});

	onDestroy(() => {
		if (statusPoll) clearInterval(statusPoll);
		if (unsubBook) unsubBook();
		if (unsubTrades) unsubTrades();
		if (unsubStatus) unsubStatus();
		disconnectBinance();
		disconnectStocks();
		disconnectSynthetic();
	});

	$: if (wallet?.connected) void refreshAccount();
</script>

<div class="pro">
	<!-- Market tabs strip + balance display -->
	<div class="market-strip">
		<div class="market-line">
			<span class="ml-sym">{market.symbol}</span>
			<span class="ml-sep">·</span>
			<span class="ml-label">{market.label}</span>
			<span class="ml-sep">·</span>
			<span class="ml-cat ml-cat-{market.sub}">{market.sub}</span>
			<span class="ml-sep">·</span>
			<span class="ml-k">Type</span>
			<span class="ml-v">{market.perpEnabled ? 'Spot · Perp' : 'Spot'}</span>
			<span class="ml-sep">·</span>
			<span class="ml-k">Quote</span>
			<span class="ml-v">{market.quote}</span>
			<span class="ml-sep">·</span>
			<span class="ml-k">Tick</span>
			<span class="ml-v">{(10 ** -market.decimals).toFixed(market.decimals)}</span>
			<span class="ml-sep">·</span>
			<span class="ml-k">Pair #</span>
			<span class="ml-v">{market.pairIndex}</span>
		</div>
		<div class="balance-strip">
			<div class="bs-cell">
				<span class="bs-label">USDT</span>
				<span class="bs-value bs-usdt">{fmtUsd(cashUsd)}</span>
			</div>
			{#if spotValueUsd > 0}
				<div class="bs-cell">
					<span class="bs-label">Spot value</span>
					<span class="bs-value bs-avail">{fmtUsd(spotValueUsd)}</span>
				</div>
			{/if}
			<div class="bs-cell">
				<span class="bs-label">Perp lock</span>
				<span class="bs-value bs-lock" class:is-lock={perpLockedUsd > 0}>
					{fmtUsd(perpLockedUsd)}
				</span>
			</div>
		</div>
	</div>

	<!-- Main grid: chart | orderbook | trade panel -->
	<div class="main-grid">
		<!-- CHART -->
		<div class="panel chart-panel">
			<div class="panel-header">
				<div class="chart-header-left">
					<span class="chart-title">{market.symbol}/{market.quote}</span>
					<div class="chart-view-toggle">
						<button
							type="button"
							class="cv-btn"
							class:cv-active={chartView === 'tradingview'}
							on:click={() => (chartView = 'tradingview')}>TradingView</button
						>
						<button
							type="button"
							class="cv-btn"
							class:cv-active={chartView === 'pyth'}
							on:click={() => (chartView = 'pyth')}>Pyth Live</button
						>
					</div>
				</div>
				<div class="chart-stats">
					<div class="stat-box">
						<span class="stat-label">SPOT</span>
						<span class="stat-value price-value">${fmtPrice(currentPrice)}</span>
						<span class={change24h >= 0 ? 'change-up' : 'change-down'}>
							{change24h >= 0 ? '▲' : '▼'} {Math.abs(change24h).toFixed(2)}%
						</span>
					</div>
					<div class="stat-box">
						<span class="stat-label">EMA</span>
						<span class="stat-value ema-value">${fmtPrice(emaPrice)}</span>
					</div>
					<div class="stat-box">
						<span class="stat-label">CONFIDENCE</span>
						<span class="stat-value conf-value">±{spreadConf.toFixed(3)}%</span>
					</div>
					{#if publishTime > 0}
						<div class="stat-box">
							<span class="stat-label">FRESH</span>
							<span class="stat-value fresh-value"
								>{Math.max(0, Math.floor(Date.now() / 1000 - publishTime))}s</span
							>
						</div>
					{/if}
				</div>
			</div>
			<div class="chart-container">
				{#if chartView === 'tradingview'}
					<iframe
						src={isCrypto
							? `https://www.tradingview.com/widgetembed/?symbol=BINANCE:${market.symbol}USDT&interval=15&theme=dark&style=1&locale=en&allow_symbol_change=0`
							: `https://www.tradingview.com/widgetembed/?symbol=${tradingViewSymbol(market)}&interval=15&theme=dark&style=1&locale=en&allow_symbol_change=0`}
						style="width:100%;height:100%;border:none;"
						title="{market.symbol} Chart"
						allow="fullscreen"
					></iframe>
				{:else}
					<PythChart symbol={market.symbol} interval="15m" />
				{/if}
			</div>
		</div>

		<!-- ORDERBOOK -->
		<div class="panel orderbook-panel">
			<div class="ob-top">
				<span class="ob-title">{market.symbol}/{isCrypto ? 'USDT' : market.quote}</span>
				<span
					class="ob-status"
					class:sim={activeBookSource === 'synthetic'}
					class:l1={activeBookSource === 'stocks'}
				>
					{#if activeBookSource === 'stocks'}L1 · {/if}{bookStatus}
				</span>
			</div>
			<div class="ob-tabs">
				<button
					type="button"
					class="ob-tab"
					class:active={orderBookColumn === 'book'}
					on:click={() => (orderBookColumn = 'book')}>Order Book</button
				>
				<button
					type="button"
					class="ob-tab"
					class:active={orderBookColumn === 'trades'}
					on:click={() => (orderBookColumn = 'trades')}>Trades</button
				>
			</div>
			<div class="ob-body">
				{#if orderBookColumn === 'book'}
					{@const maxSz = Math.max(
						...orderBookData.asks.map((a) => a.size),
						...orderBookData.bids.map((b) => b.size),
						1e-12
					)}
					<div class="ob-col-hdr">
						<span>Price</span>
						<span class="ob-hdr-mid">Size</span>
						<span class="ob-hdr-end">Total</span>
					</div>
					<div class="ob-scroll">
						<div class="ob-side ob-asks-wrap">
							{#each [...orderBookData.asks].reverse() as row}
								<div
									class="ob-row ob-ask-row"
									style="--ob-depth-pct: {Math.min(100, (row.size / maxSz) * 100)}%"
								>
									<span class="ob-p ob-ask-p">{fmtPrice(row.price)}</span>
									<span class="ob-s">{row.size.toFixed(4)}</span>
									<span class="ob-t">{row.total.toFixed(4)}</span>
								</div>
							{/each}
						</div>
						<div class="ob-spread-row">
							Spread {orderBookData.spreadAbs.toFixed(4)}
							<span class="ob-spread-pct">{orderBookData.spreadPct.toFixed(3)}%</span>
						</div>
						<div class="ob-side ob-bids-wrap">
							{#each orderBookData.bids as row}
								<div
									class="ob-row ob-bid-row"
									style="--ob-depth-pct: {Math.min(100, (row.size / maxSz) * 100)}%"
								>
									<span class="ob-p ob-bid-p">{fmtPrice(row.price)}</span>
									<span class="ob-s">{row.size.toFixed(4)}</span>
									<span class="ob-t">{row.total.toFixed(4)}</span>
								</div>
							{/each}
						</div>
					</div>
				{:else}
					<div class="ob-col-hdr ob-trades-hdr">
						<span>Price</span>
						<span class="ob-hdr-mid">Size</span>
						<span class="ob-hdr-end">Time</span>
					</div>
					<div class="ob-scroll ob-trades-scroll">
						{#each liveTrades as t}
							<div
								class="ob-trade-line"
								class:trade-buy={t.side === 'buy'}
								class:trade-sell={t.side === 'sell'}
							>
								<span>{fmtPrice(t.price)}</span>
								<span class="ob-hdr-mid">{t.size.toFixed(4)}</span>
								<span class="ob-hdr-end">{t.t}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>

		<!-- TRADING PANEL -->
		<div class="panel trade-column-panel">
			<div class="trading-panel-hl">
				<div class="hl-trading-form-scroll">
					<div class="hl-order-tabs">
						<button
							type="button"
							class="hl-ot"
							class:active={tradingTabUI === 'spot'}
							on:click={() => setTradingTab('spot')}>Spot</button
						>
						<button
							type="button"
							class="hl-ot"
							class:active={tradingTabUI === 'limit'}
							on:click={() => setTradingTab('limit')}>Limit</button
						>
						<button
							type="button"
							class="hl-ot"
							class:active={tradingTabUI === 'perps'}
							disabled={!market.perpEnabled}
							on:click={() => setTradingTab('perps')}>Perps</button
						>
					</div>

					<div class="hl-buy-sell">
						<button
							type="button"
							class="hl-bs hl-bs-buy"
							class:active={tradeSide === 'buy'}
							on:click={() => (tradeSide = 'buy')}
						>
							{tradingTabUI === 'perps' ? 'Long' : 'Buy'}
						</button>
						<button
							type="button"
							class="hl-bs hl-bs-sell"
							class:active={tradeSide === 'sell'}
							on:click={() => (tradeSide = 'sell')}
						>
							{tradingTabUI === 'perps' ? 'Short' : 'Sell'}
						</button>
					</div>

					{#if tradingTabUI === 'limit'}
						<div class="hl-field hl-field-limit-priority">
							<span class="hl-label">Limit price (USD)</span>
							<input
								type="number"
								class="hl-input hl-input-full"
								bind:value={limitPriceInput}
								min="0"
								step="0.0001"
								placeholder={currentPrice > 0 ? currentPrice.toFixed(4) : '0.00'}
							/>
						</div>
					{/if}

					<p class="hl-available">
						{#if isSpotSell}
							You own:
							<strong
								>{ownedQty.toFixed(market.decimals)} {market.symbol}{currentPrice > 0
									? ` (≈ ${fmtUsd(ownedQty * currentPrice)} USDT)`
									: ''}</strong
							>
						{:else}
							Available to trade:
							<strong>{fmtUsd(balance.availableUsd)} USDT</strong>
						{/if}
					</p>

					{#if !isSpotMarketSell}
						<div class="hl-size-block">
							<span class="hl-label">Size</span>
							<div class="hl-size-input-row">
								<input
									type="number"
									class="hl-input"
									bind:value={tradeSize}
									placeholder="0.00"
									step="0.01"
								/>
								<select class="hl-unit-select" bind:value={sizeDenom}>
									<option value="USDT">USDT</option>
									<option value="BASE">{market.symbol}</option>
								</select>
							</div>
						</div>
					{/if}

					{#if tradingTabUI !== 'perps' && !isSpotMarketSell}
						<div class="hl-pct-row">
							{#each [25, 50, 75] as pct}
								<button
									type="button"
									class="hl-pct-btn"
									class:hl-pct-active={selectedPercentage === pct}
									on:click={() => setPercentageSize(pct)}>{pct}%</button
								>
							{/each}
							<button
								type="button"
								class="hl-pct-btn hl-pct-max"
								class:hl-pct-active={selectedPercentage === 100}
								on:click={() => setPercentageSize(100)}>Max</button
							>
						</div>
					{/if}

					{#if tradingTabUI === 'perps'}
						<div class="hl-field">
							<span class="hl-label">Leverage</span>
							<div class="hl-lev-row">
								{#each PERP_LEVERAGE_TIERS as lev}
									<button
										type="button"
										class="hl-lev-btn"
										class:active={perpLeverage === lev}
										on:click={() => (perpLeverage = lev)}>{lev}x</button
									>
								{/each}
							</div>
						</div>
					{/if}

					<div class="hl-field">
						<span class="hl-label">Take profit (price)</span>
						<input
							type="number"
							class="hl-input hl-input-full"
							bind:value={takeProfit}
							placeholder="Optional"
						/>
					</div>
					<div class="hl-field">
						<span class="hl-label">Stop loss (price)</span>
						<input
							type="number"
							class="hl-input hl-input-full"
							bind:value={stopLoss}
							placeholder="Optional"
						/>
					</div>
				</div>

				<div class="hl-trading-footer">
					<div class="hl-summary">
						{#if tradeSize}
							{@const n = notionalFromSizeInput()}
							{@const lev = tradeSurface === 'perp' ? Number(perpLeverage) : 1}
							<span>Est. margin lock: {n > 0 ? (n / lev).toFixed(2) : '—'} USDT</span>
						{/if}
					</div>
					<button
						type="button"
						class="hl-submit"
						class:hl-submit-buy={tradeSide === 'buy'}
						class:hl-submit-sell={tradeSide === 'sell'}
						disabled={busy ||
							!wallet?.connected ||
							sellBlocked ||
							(!isSpotMarketSell && (!tradeSize || notionalFromSizeInput() <= 0))}
						on:click={submitOrder}
					>
						{#if busy}
							Submitting…
						{:else if !wallet?.connected}
							Connect wallet
						{:else if sellBlocked}
							You don't own {market.symbol}
						{:else if tradingTabUI === 'perps'}
							{tradeSide === 'buy' ? 'Long' : 'Short'}
							{market.symbol} @ {currentPrice > 0 ? '$' + fmtPrice(currentPrice) : '…'}
						{:else if tradingTabUI === 'limit'}
							{@const limPx = parseFloat(limitPriceInput || '0')}
							{tradeSide === 'buy' ? 'Buy' : 'Sell'}
							{market.symbol} limit @ ${limPx > 0 ? fmtPrice(limPx) : '…'}
						{:else if isSpotMarketSell}
							Sell {ownedQty.toFixed(market.decimals)} {market.symbol} @ {currentPrice > 0
								? '$' + fmtPrice(currentPrice)
								: '…'}
						{:else}
							Buy {market.symbol} @ {currentPrice > 0 ? '$' + fmtPrice(currentPrice) : '…'}
						{/if}
					</button>
					{#if statusMessage}
						<div class="hl-msg">{statusMessage}</div>
					{/if}
				</div>
			</div>
		</div>

		<!-- BOTTOM POSITIONS STRIP -->
		{#if wallet?.connected}
			<div class="positions-strip">
				<div class="chart-positions-panel positions-strip-inner">
					<div class="chart-positions-header">
						<div class="dock-tab-btns">
							<button
								type="button"
								class="dock-tab-btn"
								class:dock-tab-active={positionsDockTab === 'balance'}
								on:click={() => (positionsDockTab = 'balance')}>Balance</button
							>
							<button
								type="button"
								class="dock-tab-btn"
								class:dock-tab-active={positionsDockTab === 'orders'}
								on:click={() => (positionsDockTab = 'orders')}
								>Open Orders {ordersList.length > 0 ? `(${ordersList.length})` : ''}</button
							>
							{#if unrealizedPnl !== 0}
								<span
									class="dock-upnl-pill"
									class:pnl-pos={unrealizedPnl >= 0}
									class:pnl-neg={unrealizedPnl < 0}
								>
									uPnL {unrealizedPnl >= 0 ? '+' : ''}{unrealizedPnl.toFixed(2)} USDT
								</span>
							{/if}
						</div>
						<div class="chart-positions-header-actions">
							<button
								type="button"
								class="chart-positions-refresh"
								on:click={() => refreshAccount()}
							>
								↻ Refresh
							</button>
						</div>
					</div>

					{#if positionsDockTab === 'orders'}
						{#if ordersList.length === 0}
							<div class="chart-positions-empty">
								No open perp positions or pending limit orders.
							</div>
						{:else}
							<div class="chart-positions-list">
								{#each ordersList as p (p.pubkey)}
									{@const markPx = prices[p.pairSymbol]?.price ?? 0}
									{@const rawPnl =
										p.status === 'active' && markPx > 0 && p.entryPrice > 0
											? p.direction === 'long'
												? ((markPx - p.entryPrice) / p.entryPrice) * p.sizeUsd
												: ((p.entryPrice - markPx) / p.entryPrice) * p.sizeUsd
											: null}
									{@const refPx =
										p.entryPrice > 0 ? p.entryPrice : p.limitPrice > 0 ? p.limitPrice : 0}
									{@const sizeTokens = refPx > 0 ? p.sizeUsd / refPx : 0}
									<div class="chart-position-row">
										<div class="cp-title">
											<span
												class="cp-side"
												class:cp-side-long={p.direction === 'long'}
												class:cp-side-short={p.direction === 'short'}
											>
												{p.tradeMode === 'perp'
													? p.direction.toUpperCase()
													: p.direction === 'long'
														? 'BUY'
														: 'SELL'}
											</span>
											<span class="cp-pair-main">{p.pairSymbol}</span>
											<span class="cp-ctx-soft">
												{p.tradeMode === 'perp' ? 'Perp' : 'Spot'}
												{#if p.tradeMode === 'perp' && p.leverage > 1}
													<span class="cp-lev-inline">{p.leverage}x</span>
												{/if}
												· {p.orderType === 'limit' ? 'Limit' : 'Mkt'}
												{#if p.status === 'pending'}· Open order{/if}
											</span>
										</div>
										<div class="cp-block">
											<span class="cp-block-label">Pos. size</span>
											<span class="cp-block-value"
												>{sizeTokens.toFixed(4)} {p.pairSymbol}</span
											>
										</div>
										<div class="cp-block">
											<span class="cp-block-label"
												>{p.status === 'pending' ? 'Limit' : 'Entry'}</span
											>
											<span class="cp-block-value"
												>${(p.status === 'pending' ? p.limitPrice : p.entryPrice).toFixed(4)}</span
											>
										</div>
										<div class="cp-block">
											<span class="cp-block-label">Current</span>
											<span class="cp-block-value"
												>{markPx > 0 ? '$' + fmtPrice(markPx) : '—'}</span
											>
										</div>
										<div class="cp-block">
											<span class="cp-block-label">TP</span>
											<span class="cp-block-value"
												>{p.takeProfitPrice > 0 ? '$' + p.takeProfitPrice.toFixed(2) : '—'}</span
											>
										</div>
										<div class="cp-block">
											<span class="cp-block-label">SL</span>
											<span class="cp-block-value"
												>{p.stopLossPrice > 0 ? '$' + p.stopLossPrice.toFixed(2) : '—'}</span
											>
										</div>
										<div class="cp-block">
											<span class="cp-block-label">Liq</span>
											<span
												class="cp-block-value"
												class:cp-liq-warn={p.tradeMode === 'perp' && p.liquidationPrice > 0}
											>
												{p.tradeMode === 'perp' && p.liquidationPrice > 0
													? '$' + fmtPrice(p.liquidationPrice)
													: '—'}
											</span>
										</div>
										<div class="cp-block">
											<span class="cp-block-label">uPnL</span>
											{#if rawPnl !== null}
												<span
													class="cp-block-value"
													class:pnl-pos={rawPnl >= 0}
													class:pnl-neg={rawPnl < 0}
												>
													{rawPnl >= 0 ? '+' : ''}{rawPnl.toFixed(2)}
												</span>
											{:else}
												<span class="cp-block-value">—</span>
											{/if}
										</div>
										<div class="cp-block">
											<span class="cp-block-label"
												>{p.tradeMode === 'perp' ? 'Margin' : 'Cost'}</span
											>
											<span class="cp-block-value">${p.marginUsd.toFixed(2)}</span>
										</div>
										<button
											type="button"
											class="cp-action"
											class:cp-action-cancel={p.status === 'pending'}
											disabled={closingPubkey === p.pubkey}
											on:click={() => closePosition(p)}
										>
											{#if closingPubkey === p.pubkey}
												…
											{:else if p.status === 'pending'}
												Cancel
											{:else}
												Close
											{/if}
										</button>
									</div>
								{/each}
							</div>
						{/if}
					{/if}

					{#if positionsDockTab === 'balance'}
						{#if accountInitialized}
							<div class="balance-tab-content">
								<div class="bal-list">
									<div class="bal-card bal-card-main">
										<div class="bal-block">
											<span class="bal-block-label">Asset</span>
											<span class="bal-block-value bal-asset-name">USDT</span>
										</div>
										<div class="bal-block">
											<span class="bal-block-label">Cash</span>
											<span class="bal-block-value bal-green">{fmtUsd(cashUsd)}</span>
										</div>
										<div class="bal-block">
											<span class="bal-block-label">Spot cost</span>
											<span class="bal-block-value">{fmtUsd(spotCostUsd)}</span>
										</div>
										<div class="bal-block">
											<span class="bal-block-label">Perp lock</span>
											<span
												class="bal-block-value"
												class:bal-orange={perpLockedUsd > 0.01}>{fmtUsd(perpLockedUsd)}</span
											>
										</div>
										<div class="bal-block">
											<span class="bal-block-label">Wallet SOL</span>
											<span class="bal-block-value">{solBalance.toFixed(4)}</span>
										</div>
									</div>
								</div>

								{#if spotHoldings.length > 0}
									<div class="holdings-section">
										<div class="holdings-title">
											{category === 'crypto' ? 'CRYPTO' : 'TRADITIONAL'} HOLDINGS
											<span class="holdings-sub">({spotHoldings.length})</span>
										</div>
										<div class="holdings-head">
											<span>Asset</span>
											<span>Side</span>
											<span class="hd-num">Qty</span>
											<span class="hd-num">Avg entry</span>
											<span class="hd-num">Current</span>
											<span class="hd-num">Cost</span>
											<span class="hd-num">Value</span>
											<span class="hd-num">uPnL</span>
											<span class="hd-action-hdr">&nbsp;</span>
										</div>
										{#each spotHoldings as h (h.pubkey)}
											<div class="holdings-row">
												<span class="hr-asset">{h.symbol}</span>
												<span
													class="hr-side"
													class:hr-side-long={h.side === 'long'}
													class:hr-side-short={h.side === 'short'}
												>
													{h.side === 'long' ? 'BUY' : 'SELL'}
												</span>
												<span class="hd-num">{h.qty.toFixed(6)}</span>
												<span class="hd-num">${fmtPrice(h.entryPrice)}</span>
												<span class="hd-num"
													>{h.currentPrice > 0 ? '$' + fmtPrice(h.currentPrice) : '—'}</span
												>
												<span class="hd-num">${fmtUsd(h.costUsd)}</span>
												<span class="hd-num">${fmtUsd(h.valueUsd)}</span>
												<span
													class="hd-num"
													class:pnl-pos={h.unrealizedPnl > 0}
													class:pnl-neg={h.unrealizedPnl < 0}
												>
													{h.unrealizedPnl >= 0 ? '+' : ''}{h.unrealizedPnl.toFixed(2)}
												</span>
												<button
													type="button"
													class="hr-sell"
													disabled={closingPubkey === h.pubkey || h.currentPrice <= 0}
													on:click={() => sellHolding(h)}
												>
													{closingPubkey === h.pubkey ? '…' : 'Sell'}
												</button>
											</div>
										{/each}
									</div>
								{/if}
							</div>
						{:else}
							<p class="dock-hint">Initialize your paper account from the top bar to trade.</p>
						{/if}
					{/if}
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.pro {
		background: #000;
		color: #ccc;
		font-family: 'Courier New', monospace;
		min-height: calc(100vh - 100px);
	}

	.market-strip {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 12px;
		align-items: center;
		padding: 10px 14px;
		border-bottom: 1px solid #1a1a1a;
		background: #0a0a0a;
	}
	.market-line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		flex-wrap: nowrap;
		overflow-x: auto;
		scrollbar-width: none;
		white-space: nowrap;
	}
	.market-line::-webkit-scrollbar { display: none; }
	.ml-sym {
		color: #ff5a00;
		font-size: 14px;
		font-weight: 800;
		letter-spacing: 0.06em;
	}
	.ml-label {
		color: #cfcfcf;
		font-size: 11px;
		font-weight: 500;
	}
	.ml-cat {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		padding: 2px 6px;
		border-radius: 4px;
	}
	.ml-cat-crypto { background: rgba(255, 90, 0, 0.15); color: #ff5a00; }
	.ml-cat-stock { background: rgba(59, 130, 246, 0.15); color: #60a5fa; }
	.ml-cat-forex { background: rgba(168, 85, 247, 0.15); color: #c084fc; }
	.ml-cat-metal { background: rgba(234, 179, 8, 0.15); color: #fde047; }
	.ml-cat-equity { background: rgba(16, 185, 129, 0.15); color: #34d399; }
	.ml-k {
		color: #666;
		font-size: 10px;
		letter-spacing: 0.08em;
		font-weight: 700;
		text-transform: uppercase;
	}
	.ml-v {
		color: #e8e8e8;
		font-size: 11px;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}
	.ml-sep {
		color: #333;
		font-size: 11px;
	}

	.balance-strip {
		display: flex;
		gap: 8px;
		padding-left: 8px;
		border-left: 1px solid #1a1a1a;
	}
	.bs-cell {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 12px;
		background: #000;
		border: 1px solid #1f1f1f;
		border-radius: 8px;
		min-width: 96px;
	}
	.bs-label {
		color: #666;
		font-size: 9px;
		letter-spacing: 0.14em;
		font-weight: 900;
	}
	.bs-value { color: #e8e8e8; font-size: 13px; font-weight: 900; }
	.bs-usdt { color: #ff5a00; }
	.bs-avail { color: #00ff64; }
	.bs-lock.is-lock { color: #ffb84d; }

	.main-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 280px minmax(280px, 320px);
		grid-template-rows: minmax(min(72vh, 760px), auto) auto;
		background: #000;
		align-items: stretch;
	}

	.panel {
		background: #000;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.chart-panel {
		grid-column: 1;
		grid-row: 1;
		min-height: min(72vh, 760px);
		border-right: 1px solid #1a1a1a;
	}
	.panel-header {
		display: flex;
		justify-content: space-between;
		padding: 10px 14px;
		border-bottom: 1px solid #1a1a1a;
		flex-wrap: wrap;
		gap: 8px;
	}
	.chart-header-left { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
	.chart-title { color: #ff5a00; font-weight: 900; letter-spacing: 0.1em; font-size: 13px; }
	.chart-view-toggle { display: flex; gap: 4px; }
	.cv-btn {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 4px 10px;
		font-family: inherit;
		font-size: 10px;
		letter-spacing: 0.1em;
		cursor: pointer;
		font-weight: 900;
	}
	.cv-btn:hover { color: #ccc; border-color: #444; }
	.cv-btn.cv-active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0, 0.06); }

	.chart-stats { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
	.stat-box {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 10px;
		border: 1px solid #1f1f1f;
		background: #0a0a0a;
		border-radius: 4px;
		min-width: 60px;
	}
	.stat-label { color: #666; font-size: 8px; letter-spacing: 0.12em; font-weight: 900; }
	.stat-value { color: #e8e8e8; font-size: 11px; font-weight: 900; }
	.price-value { color: #ff5a00; }
	.ema-value { color: #6aa9ff; }
	.conf-value { color: #eaecef; }
	.fresh-value { color: #00c076; }
	.change-up { color: #00ff64; font-size: 10px; }
	.change-down { color: #ff4444; font-size: 10px; }

	.chart-container {
		flex: 1;
		min-height: 0;
		background: #0a0a0a;
	}

	/* Orderbook */
	.orderbook-panel {
		grid-column: 2;
		grid-row: 1;
		border-right: 1px solid #1a1a1a;
		min-height: 0;
		max-height: min(72vh, 760px);
	}
	.ob-top {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 10px;
		border-bottom: 1px solid #1a1a1a;
	}
	.ob-title { font-size: 11px; font-weight: 900; color: #eaecef; letter-spacing: 0.08em; }
	.ob-status {
		font-size: 9px;
		color: #00ff64;
		padding: 2px 8px;
		border: 1px solid #1a1a1a;
		border-radius: 999px;
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.ob-status.sim { color: #ffb84d; }
	.ob-status.l1 { color: #60a5fa; }
	.ob-tabs { display: flex; border-bottom: 1px solid #1a1a1a; }
	.ob-tab {
		flex: 1;
		background: transparent;
		border: none;
		color: #848e9c;
		font-size: 10px;
		padding: 8px 4px;
		cursor: pointer;
		font-family: inherit;
		letter-spacing: 0.08em;
	}
	.ob-tab.active { color: #ff5a00; border-bottom: 2px solid #ff5a00; }
	.ob-body { flex: 1; display: flex; flex-direction: column; min-height: 0; font-size: 10px; }
	.ob-col-hdr {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		padding: 4px 8px;
		color: #848e9c;
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}
	.ob-hdr-mid { text-align: center; }
	.ob-hdr-end { text-align: right; }
	.ob-scroll { flex: 1; overflow-y: auto; min-height: 0; }
	.ob-row {
		position: relative;
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		padding: 1px 8px;
		align-items: center;
	}
	.ob-ask-row {
		background: linear-gradient(
			90deg,
			rgba(246, 70, 93, 0.14) 0%,
			rgba(246, 70, 93, 0.07) min(var(--ob-depth-pct, 0%), 100%),
			rgba(246, 70, 93, 0.035) 100%
		);
	}
	.ob-bid-row {
		background: linear-gradient(
			90deg,
			rgba(0, 255, 100, 0.12) 0%,
			rgba(0, 255, 100, 0.06) min(var(--ob-depth-pct, 0%), 100%),
			rgba(0, 255, 100, 0.03) 100%
		);
	}
	.ob-ask-p { color: #f6465d; }
	.ob-bid-p { color: #00ff64; }
	.ob-s { text-align: center; color: #eaecef; }
	.ob-t { text-align: right; color: #848e9c; }
	.ob-spread-row {
		text-align: center;
		padding: 4px 4px;
		color: #848e9c;
		font-size: 9px;
		border-top: 1px solid #1a1a1a;
		border-bottom: 1px solid #1a1a1a;
	}
	.ob-spread-pct { margin-left: 6px; color: #5e6673; }
	.ob-trade-line {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		padding: 2px 8px;
		font-size: 10px;
	}
	.trade-buy { color: #00ff64; }
	.trade-sell { color: #f6465d; }

	/* Trading panel */
	.trade-column-panel {
		grid-column: 3;
		grid-row: 1;
		border-right: none;
		min-height: 0;
	}
	.trading-panel-hl {
		display: flex;
		flex-direction: column;
		height: 100%;
		padding: 10px 12px;
		background: #0a0a0a;
	}
	.hl-trading-form-scroll {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.hl-order-tabs {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
	}
	.hl-ot {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 7px 0;
		font-family: inherit;
		font-size: 11px;
		font-weight: 900;
		letter-spacing: 0.08em;
		cursor: pointer;
	}
	.hl-ot.active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0, 0.05); }
	.hl-ot:disabled { opacity: 0.35; cursor: not-allowed; }

	.hl-buy-sell { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
	.hl-bs {
		background: #0a0a0a;
		border: 1px solid #1f1f1f;
		color: #9aa0a6;
		padding: 9px 0;
		font-family: inherit;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
		border-radius: 8px;
		transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
	}
	.hl-bs:hover { color: #e5e5e5; border-color: #2a2a2a; }
	.hl-bs-buy.active {
		color: #10c980;
		border-color: rgba(16, 201, 128, 0.55);
		background: rgba(16, 201, 128, 0.08);
	}
	.hl-bs-sell.active {
		color: #ef4f5f;
		border-color: rgba(239, 79, 95, 0.55);
		background: rgba(239, 79, 95, 0.08);
	}

	.hl-available {
		color: #848e9c;
		font-size: 10px;
		margin: 4px 0;
	}
	.hl-available strong { color: #e8e8e8; font-weight: 900; }

	.hl-field { display: flex; flex-direction: column; gap: 4px; }
	.hl-label { color: #666; font-size: 9px; letter-spacing: 0.12em; font-weight: 900; }
	.hl-input, .hl-input-full {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #fff;
		padding: 8px 10px;
		font-family: inherit;
		font-size: 12px;
		outline: none;
		width: 100%;
		box-sizing: border-box;
	}
	.hl-input:focus { border-color: #ff5a00; }

	.hl-size-block { display: flex; flex-direction: column; gap: 4px; }
	.hl-size-input-row { display: grid; grid-template-columns: 1fr 80px; gap: 4px; }
	.hl-unit-select {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #e8e8e8;
		padding: 8px 10px;
		font-family: inherit;
		font-size: 11px;
		outline: none;
	}

	.hl-pct-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
	.hl-pct-btn {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 6px 0;
		font-family: inherit;
		font-size: 10px;
		font-weight: 900;
		cursor: pointer;
	}
	.hl-pct-btn:hover { border-color: #444; color: #ccc; }
	.hl-pct-active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0, 0.06); }

	.hl-lev-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
	.hl-lev-btn {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 6px 0;
		font-family: inherit;
		font-size: 10px;
		font-weight: 900;
		cursor: pointer;
	}
	.hl-lev-btn.active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0, 0.06); }

	.hl-trading-footer {
		border-top: 1px solid #1a1a1a;
		margin-top: 8px;
		padding-top: 8px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.hl-summary { color: #848e9c; font-size: 10px; }

	.hl-submit {
		width: 100%;
		padding: 13px 14px;
		border: 1px solid transparent;
		border-radius: 10px;
		font-family: inherit;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
		background: #111;
		color: #666;
		transition:
			transform 0.12s ease,
			filter 0.12s ease,
			box-shadow 0.12s ease;
	}
	.hl-submit-buy {
		background: linear-gradient(180deg, #10c980 0%, #0a9a63 100%);
		border-color: rgba(16, 201, 128, 0.55);
		color: #03180f;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 2px 10px rgba(16, 201, 128, 0.18);
	}
	.hl-submit-sell {
		background: linear-gradient(180deg, #ef4f5f 0%, #c73848 100%);
		border-color: rgba(239, 79, 95, 0.55);
		color: #ffffff;
		box-shadow: 0 1px 0 rgba(255, 255, 255, 0.12) inset, 0 2px 10px rgba(239, 79, 95, 0.18);
	}
	.hl-submit:not(:disabled):hover { filter: brightness(1.07); transform: translateY(-1px); }
	.hl-submit:not(:disabled):active { transform: translateY(0); filter: brightness(0.96); }
	.hl-submit:disabled { opacity: 0.45; cursor: not-allowed; }

	.hl-msg {
		padding: 6px 8px;
		background: #000;
		border: 1px solid #1a1a1a;
		color: #ccc;
		font-size: 10px;
		border-radius: 4px;
	}

	/* Positions strip */
	.positions-strip {
		grid-column: 1 / -1;
		grid-row: 2;
		border-top: 1px solid #1a1a1a;
		background: #0a0a0a;
	}
	.chart-positions-panel { padding: 10px 14px; }
	.chart-positions-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
	}
	.dock-tab-btns { display: flex; gap: 6px; align-items: center; }
	.dock-tab-btn {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #888;
		padding: 6px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: 900;
		letter-spacing: 0.08em;
		cursor: pointer;
	}
	.dock-tab-active { color: #ff5a00; border-color: #ff5a00; background: rgba(255, 90, 0, 0.06); }
	.dock-upnl-pill {
		padding: 4px 10px;
		font-size: 10px;
		font-weight: 900;
		border-radius: 999px;
		border: 1px solid #222;
	}
	.pnl-pos { color: #00ff64; border-color: #00ff64; background: rgba(0, 255, 100, 0.06); }
	.pnl-neg { color: #ff4444; border-color: #ff4444; background: rgba(255, 68, 68, 0.06); }

	.chart-positions-refresh {
		background: #000;
		border: 1px solid #222;
		border-radius: 6px;
		color: #ccc;
		padding: 5px 10px;
		font-family: inherit;
		font-size: 10px;
		cursor: pointer;
	}
	.chart-positions-refresh:hover { border-color: #ff5a00; color: #ff5a00; }

	.chart-positions-empty,
	.dock-hint {
		color: #666;
		font-size: 11px;
		padding: 14px;
		text-align: center;
	}

	.chart-positions-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.chart-position-row {
		display: grid;
		grid-template-columns: 1.3fr repeat(8, minmax(78px, 1fr)) 70px;
		gap: 8px;
		padding: 8px 10px;
		background: #000;
		border: 1px solid #1a1a1a;
		border-radius: 6px;
		align-items: center;
	}
	.cp-title { display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
	.cp-side {
		display: inline-block;
		padding: 2px 7px;
		font-size: 9px;
		letter-spacing: 0.1em;
		font-weight: 900;
		border-radius: 4px;
		margin-right: 4px;
	}
	.cp-side-long { background: rgba(0, 255, 100, 0.14); color: #00ff64; }
	.cp-side-short { background: rgba(255, 68, 68, 0.14); color: #ff4444; }
	.cp-pair-main { color: #eaecef; font-weight: 900; }
	.cp-ctx-soft { color: #848e9c; font-size: 9px; margin-left: 6px; }
	.cp-lev-inline { color: #ff5a00; margin-left: 3px; font-weight: 900; }
	.cp-block { display: flex; flex-direction: column; gap: 2px; }
	.cp-block-label { color: #666; font-size: 8px; letter-spacing: 0.12em; font-weight: 900; }
	.cp-block-value { color: #eaecef; font-size: 11px; font-weight: 900; }
	/* .cp-block-value color must beat .pnl-pos / .pnl-neg when both classes apply (open orders uPnL). */
	.cp-block-value.pnl-pos {
		color: #00ff64;
		background: rgba(0, 255, 100, 0.08);
	}
	.cp-block-value.pnl-neg {
		color: #ff4444;
		background: rgba(255, 68, 68, 0.08);
	}
	.cp-action {
		background: #000;
		border: 1px solid #ff4444;
		border-radius: 6px;
		color: #ff4444;
		padding: 6px 10px;
		font-family: inherit;
		font-size: 10px;
		font-weight: 900;
		cursor: pointer;
		letter-spacing: 0.08em;
	}
	.cp-action:hover { background: rgba(255, 68, 68, 0.1); }
	.cp-action-cancel { border-color: #ffb84d; color: #ffb84d; }
	.cp-action-cancel:hover { background: rgba(255, 184, 77, 0.1); }
	.cp-liq-warn { color: #ff8b44; }
	.cp-action:disabled { opacity: 0.5; cursor: not-allowed; }

	.balance-tab-content { padding: 4px 0; }
	.bal-list { display: flex; flex-direction: column; gap: 6px; }
	.bal-card {
		display: grid;
		grid-template-columns: repeat(5, 1fr);
		gap: 10px;
		padding: 10px 12px;
		background: #000;
		border: 1px solid #1a1a1a;
		border-radius: 6px;
	}
	.bal-card-main { border-color: #2a1f0a; }
	.bal-block { display: flex; flex-direction: column; gap: 3px; }
	.bal-block-label { color: #666; font-size: 9px; letter-spacing: 0.12em; font-weight: 900; }
	.bal-block-value { color: #eaecef; font-size: 13px; font-weight: 900; }
	.bal-asset-name { color: #ff5a00; }
	.bal-green { color: #00ff64; }
	.bal-orange { color: #ffb84d; }

	.holdings-section {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid #1a1a1a;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.holdings-title {
		color: #ff5a00;
		font-size: 10px;
		letter-spacing: 0.16em;
		font-weight: 900;
		padding: 0 12px 6px;
	}
	.holdings-sub { color: #666; margin-left: 4px; font-weight: 700; }
	.holdings-head,
	.holdings-row {
		display: grid;
		grid-template-columns: 1.1fr 0.7fr repeat(6, minmax(80px, 1fr)) 70px;
		gap: 8px;
		padding: 6px 12px;
		font-size: 11px;
		font-weight: 900;
		align-items: center;
	}
	.hd-action-hdr { display: block; }
	.hr-sell {
		background: #000;
		border: 1px solid #ff4444;
		border-radius: 6px;
		color: #ff4444;
		padding: 6px 10px;
		font-family: inherit;
		font-size: 10px;
		font-weight: 900;
		cursor: pointer;
		letter-spacing: 0.08em;
	}
	.hr-sell:hover { background: rgba(255, 68, 68, 0.1); }
	.hr-sell:disabled { opacity: 0.5; cursor: not-allowed; }
	.holdings-head {
		color: #666;
		font-size: 9px;
		letter-spacing: 0.12em;
		border-bottom: 1px dashed #1a1a1a;
		font-weight: 900;
	}
	.holdings-row {
		background: #000;
		border: 1px solid #1a1a1a;
		border-radius: 6px;
	}
	.hd-num { text-align: right; font-variant-numeric: tabular-nums; }
	.hr-asset { color: #ff5a00; font-weight: 900; }
	.hr-side {
		display: inline-block;
		padding: 2px 6px;
		font-size: 9px;
		letter-spacing: 0.1em;
		border-radius: 4px;
		font-weight: 900;
		text-align: center;
	}
	.hr-side-long { background: rgba(0, 255, 100, 0.14); color: #00ff64; }
	.hr-side-short { background: rgba(255, 68, 68, 0.14); color: #ff4444; }

	@media (max-width: 1100px) {
		.main-grid {
			grid-template-columns: 1fr;
			grid-template-rows: auto auto auto auto;
		}
		.chart-panel { grid-column: 1; grid-row: 1; border-right: none; min-height: 480px; }
		.orderbook-panel { grid-column: 1; grid-row: 2; border-right: none; max-height: 420px; }
		.trade-column-panel { grid-column: 1; grid-row: 3; border-top: 1px solid #1a1a1a; }
		.positions-strip { grid-column: 1; grid-row: 4; }
		.chart-position-row { grid-template-columns: repeat(2, 1fr); }
	}

	@media (max-width: 720px) {
		.market-strip { grid-template-columns: 1fr; }
		.balance-strip { padding-left: 0; border-left: 0; flex-wrap: wrap; }
		.bal-card { grid-template-columns: repeat(2, 1fr); }
	}
</style>
