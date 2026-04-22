<script lang="ts">
	import { BN } from '$lib/vendor/anchor';
	import { walletStore } from '$lib/wallet/stores';
	import { pythPrices } from '$lib/stores/pythPrices';
	import { sessionKey } from '$lib/stores/sessionKey';
	import { selectedMarket } from '$lib/stores/selectedMarket';
	import {
		buildConnection,
		buildProgram,
		openMarketPosition,
		openLimitOrder,
		initializeUserAccount,
		getUserAccount,
		priceScaled,
		usd,
		USD_SCALE,
		type MarketCategoryVariant
	} from '$lib/hashfox';
	import { PERP_LEVERAGE_TIERS, type MarketEntry } from '$lib/markets';

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let session: any = {};
	sessionKey.subscribe((s) => (session = s));

	let prices: Record<string, any> = {};
	pythPrices.subscribe((p) => (prices = p));

	let market: MarketEntry;
	selectedMarket.subscribe((m) => (market = m));

	let tradeMode: 'spot' | 'perp' = 'spot';
	let orderType: 'market' | 'limit' = 'market';
	let direction: 'long' | 'short' = 'long';
	let marginInput = 100;
	let leverage: number = 1;
	let limitPrice = 0;
	let takeProfit = 0;
	let stopLoss = 0;
	let busy = false;
	let message = '';

	$: if (tradeMode === 'spot') leverage = 1;

	$: current = market ? prices[market.symbol]?.price ?? 0 : 0;

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
			message = 'Initializing paper account…';
			await initializeUserAccount(program, wallet.publicKey, new BN(10_000_000)); // 0.01 SOL entry fee
			message = 'Account initialized.';
		}
		return program;
	}

	async function placeOrder() {
		if (busy) return;
		if (!wallet.connected) {
			message = 'Connect a wallet first.';
			return;
		}
		if (!current) {
			message = 'Price not available yet — waiting for Pyth stream.';
			return;
		}
		busy = true;
		message = 'Submitting…';
		try {
			const program = await ensureAccount();
			const sessionToken = session.active ? session.token : null;
			const marginUsd = usd(marginInput);
			const tp = takeProfit > 0 ? priceScaled(takeProfit) : new BN(0);
			const sl = stopLoss > 0 ? priceScaled(stopLoss) : new BN(0);

			if (orderType === 'market') {
				const sig = await openMarketPosition(program, wallet.publicKey, {
					marketCategory: subCategoryToVariant(market.sub),
					pairIndex: market.pairIndex,
					tradeMode,
					direction,
					marginUsd,
					leverage,
					takeProfitPrice: tp,
					stopLossPrice: sl,
					entryPrice: priceScaled(current),
					sessionToken
				});
				message = `Opened · ${sig.slice(0, 8)}…`;
			} else {
				if (!limitPrice) {
					message = 'Enter a limit price.';
					busy = false;
					return;
				}
				const sig = await openLimitOrder(program, wallet.publicKey, {
					marketCategory: subCategoryToVariant(market.sub),
					pairIndex: market.pairIndex,
					tradeMode,
					direction,
					marginUsd,
					leverage,
					limitPrice: priceScaled(limitPrice),
					takeProfitPrice: tp,
					stopLossPrice: sl,
					sessionToken
				});
				message = `Limit placed · ${sig.slice(0, 8)}…`;
			}
		} catch (err: any) {
			console.error(err);
			message = err?.message ?? 'Trade failed.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="panel">
	<div class="panel-header">
		<div class="market-title">
			<span class="m-cat">{market.category.toUpperCase()}</span>
			<span class="m-sym">{market.symbol}</span>
			<span class="m-label">{market.label}</span>
		</div>
		<div class="market-price">
			<span class="p-value">${current ? current.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '--'}</span>
			<span class="p-stream">LIVE · PYTH</span>
		</div>
	</div>

	<div class="form">
		<div class="tab-row">
			<button class="tab" class:active={tradeMode === 'spot'} on:click={() => (tradeMode = 'spot')}>SPOT</button>
			<button
				class="tab"
				class:active={tradeMode === 'perp'}
				disabled={!market.perpEnabled}
				on:click={() => (tradeMode = 'perp')}
			>
				PERP
			</button>
			<span class="spacer"></span>
			<button class="tab" class:active={orderType === 'market'} on:click={() => (orderType = 'market')}>MARKET</button>
			<button class="tab" class:active={orderType === 'limit'} on:click={() => (orderType = 'limit')}>LIMIT</button>
		</div>

		<div class="dir-row">
			<button class="dir long" class:active={direction === 'long'} on:click={() => (direction = 'long')}>LONG</button>
			<button class="dir short" class:active={direction === 'short'} on:click={() => (direction = 'short')}>SHORT</button>
		</div>

		<label class="field">
			<span>Margin (USD)</span>
			<input type="number" min="1" step="1" bind:value={marginInput} />
		</label>

		{#if tradeMode === 'perp'}
			<label class="field">
				<span>Leverage</span>
				<div class="lev-row">
					{#each PERP_LEVERAGE_TIERS as l}
						<button class="lev" class:active={leverage === l} on:click={() => (leverage = l)}>{l}x</button>
					{/each}
				</div>
			</label>
		{/if}

		{#if orderType === 'limit'}
			<label class="field">
				<span>Limit price</span>
				<input type="number" step="0.0001" bind:value={limitPrice} />
			</label>
		{/if}

		<div class="field-row">
			<label class="field">
				<span>Take profit</span>
				<input type="number" step="0.0001" bind:value={takeProfit} placeholder="optional" />
			</label>
			<label class="field">
				<span>Stop loss</span>
				<input type="number" step="0.0001" bind:value={stopLoss} placeholder="optional" />
			</label>
		</div>

		<button
			class="submit"
			class:long={direction === 'long'}
			class:short={direction === 'short'}
			disabled={busy}
			on:click={placeOrder}
		>
			{busy ? 'Submitting…' : `${direction === 'long' ? 'BUY / LONG' : 'SELL / SHORT'} ${market.symbol}`}
		</button>

		{#if message}
			<div class="msg">{message}</div>
		{/if}
	</div>
</div>

<style>
	.panel {
		background: #121212;
		border: 1px solid #222;
		padding: 16px;
		color: #ccc;
		font-family: 'Courier New', monospace;
	}

	.panel-header {
		display: flex;
		justify-content: space-between;
		align-items: flex-end;
		border-bottom: 1px solid #222;
		padding-bottom: 10px;
		margin-bottom: 14px;
	}
	.m-cat { color: #888; font-size: 10px; letter-spacing: 0.1em; }
	.m-sym { color: #ff9500; font-size: 20px; font-weight: bold; margin-left: 8px; }
	.m-label { color: #666; font-size: 11px; margin-left: 6px; }
	.p-value { color: #00ff00; font-size: 18px; font-weight: bold; }
	.p-stream { color: #888; font-size: 9px; letter-spacing: 0.08em; margin-left: 8px; }

	.tab-row, .dir-row { display: flex; gap: 6px; margin-bottom: 10px; align-items: center; }
	.spacer { flex: 1; }

	.tab {
		background: #000;
		border: 1px solid #333;
		color: #888;
		padding: 5px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		cursor: pointer;
		letter-spacing: 0.06em;
	}
	.tab.active { color: #ff9500; border-color: #ff9500; }
	.tab:disabled { opacity: 0.4; cursor: not-allowed; }

	.dir {
		flex: 1;
		background: #000;
		border: 1px solid #333;
		color: #666;
		padding: 8px;
		font-family: inherit;
		font-size: 12px;
		font-weight: bold;
		cursor: pointer;
	}
	.dir.long.active { background: #003b1e; border-color: #00ff64; color: #00ff64; }
	.dir.short.active { background: #3b0000; border-color: #ff4444; color: #ff4444; }

	.field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 10px;
		flex: 1;
	}
	.field span {
		font-size: 10px;
		color: #888;
		letter-spacing: 0.08em;
	}
	.field input {
		background: #000;
		border: 1px solid #333;
		color: #fff;
		padding: 8px 10px;
		font-family: inherit;
		font-size: 12px;
		outline: none;
	}
	.field input:focus { border-color: #ff9500; }

	.field-row { display: flex; gap: 10px; }

	.lev-row { display: flex; flex-wrap: wrap; gap: 4px; }
	.lev {
		background: #000;
		border: 1px solid #333;
		color: #888;
		padding: 5px 9px;
		font-family: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	.lev.active { color: #ff9500; border-color: #ff9500; }

	.submit {
		width: 100%;
		padding: 12px;
		font-family: inherit;
		font-size: 13px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
		border: none;
		margin-top: 6px;
	}
	.submit.long { background: #00ff64; color: #000; }
	.submit.short { background: #ff4444; color: #fff; }
	.submit:disabled { opacity: 0.6; cursor: not-allowed; }

	.msg {
		margin-top: 10px;
		padding: 8px 10px;
		background: #0a0a0a;
		border: 1px solid #222;
		color: #ccc;
		font-size: 11px;
	}
</style>
