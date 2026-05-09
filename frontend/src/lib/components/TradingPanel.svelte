<script lang="ts">
	import { onMount } from 'svelte';
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
	import { compOpenMarketPosition, compOpenLimitOrder, fmtCountdown } from '$lib/competition';
	import { activeCompetition, refreshActiveCompetition } from '$lib/stores/activeCompetition';
	import { PERP_LEVERAGE_TIERS, type MarketEntry } from '$lib/markets';

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let session: any = {};
	sessionKey.subscribe((s) => (session = s));

	let prices: Record<string, any> = {};
	pythPrices.subscribe((p) => (prices = p));

	let market: MarketEntry;
	selectedMarket.subscribe((m) => (market = m));

	let comp: any = { pubkey: null, view: null, loaded: false };
	activeCompetition.subscribe((s) => (comp = s));

	// Only Active routes through the per-cup PDA. Pending / settled fall
	// through to main-account trading so the user keeps full access to their
	// regular paper balance.
	$: inTournament = !!(comp?.pubkey && comp.view && comp.view.status === 'active');

	onMount(() => {
		refreshActiveCompetition();
	});

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
				let sig: string;
				if (inTournament && comp.pubkey) {
					sig = await compOpenMarketPosition(program, wallet.publicKey, comp.pubkey, {
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
				} else {
					sig = await openMarketPosition(program, wallet.publicKey, {
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
				}
				message = `Opened${inTournament ? ' · cup' : ''} · ${sig.slice(0, 8)}…`;
			} else {
				if (!limitPrice) {
					message = 'Enter a limit price.';
					busy = false;
					return;
				}
				let sig: string;
				if (inTournament && comp.pubkey) {
					sig = await compOpenLimitOrder(program, wallet.publicKey, comp.pubkey, {
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
				} else {
					sig = await openLimitOrder(program, wallet.publicKey, {
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
				}
				message = `Limit placed${inTournament ? ' · cup' : ''} · ${sig.slice(0, 8)}…`;
			}
			refreshActiveCompetition();
		} catch (err: any) {
			console.error(err);
			message = err?.message ?? 'Trade failed.';
		} finally {
			busy = false;
		}
	}
</script>

<div class="panel">
	{#if comp.view}
		<div class="comp-banner {comp.view.status}">
			<div class="cb-left">
				<span class="cb-dot"></span>
				<span class="cb-tag">
					{#if inTournament}TOURNAMENT MODE{:else}CUP QUEUED · MAIN ACCOUNT{/if}
				</span>
				<span class="cb-name">{comp.view.name}</span>
			</div>
			<div class="cb-right">
				{#if comp.view.status === 'active'}
					<span class="cb-meta">Ends in {fmtCountdown(comp.view.endTs)}</span>
				{:else if comp.view.status === 'pending'}
					<span class="cb-meta">
						Pending fill ({comp.view.participantCount}/{comp.view.maxParticipants}) · trading on main until cup starts
					</span>
				{:else}
					<span class="cb-meta">Settled — trading on main · claim exit on /competition</span>
				{/if}
			</div>
		</div>
	{/if}
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
		border-radius: 10px;
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
	.m-sym { color: #ff5a00; font-size: 20px; font-weight: bold; margin-left: 8px; }
	.m-label { color: #666; font-size: 11px; margin-left: 6px; }
	.p-value { color: #00ff00; font-size: 18px; font-weight: bold; }
	.p-stream { color: #888; font-size: 9px; letter-spacing: 0.08em; margin-left: 8px; }

	.tab-row, .dir-row { display: flex; gap: 6px; margin-bottom: 10px; align-items: center; }
	.spacer { flex: 1; }

	.tab {
		background: #000;
		border: 1px solid #333;
		border-radius: 6px;
		color: #888;
		padding: 5px 12px;
		font-family: inherit;
		font-size: 11px;
		font-weight: bold;
		cursor: pointer;
		letter-spacing: 0.06em;
	}
	.tab.active { color: #ff5a00; border-color: #ff5a00; }
	.tab:disabled { opacity: 0.4; cursor: not-allowed; }

	.dir {
		flex: 1;
		background: #000;
		border: 1px solid #333;
		border-radius: 6px;
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
		border-radius: 6px;
		color: #fff;
		padding: 8px 10px;
		font-family: inherit;
		font-size: 12px;
		outline: none;
	}
	.field input:focus { border-color: #ff5a00; }

	.field-row { display: flex; gap: 10px; }

	.lev-row { display: flex; flex-wrap: wrap; gap: 4px; }
	.lev {
		background: #000;
		border: 1px solid #333;
		border-radius: 6px;
		color: #888;
		padding: 5px 9px;
		font-family: inherit;
		font-size: 11px;
		cursor: pointer;
	}
	.lev.active { color: #ff5a00; border-color: #ff5a00; }

	.submit {
		width: 100%;
		padding: 12px;
		font-family: inherit;
		font-size: 13px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
		border: none;
		border-radius: 8px;
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
		border-radius: 8px;
		color: #ccc;
		font-size: 11px;
	}

	.comp-banner {
		display: flex; justify-content: space-between; align-items: center;
		gap: 8px; flex-wrap: wrap;
		padding: 8px 12px;
		margin-bottom: 12px;
		border-radius: 8px;
		background: linear-gradient(180deg, rgba(0, 255, 102, 0.06), rgba(255, 255, 255, 0.01));
		border: 1px solid rgba(0, 255, 102, 0.35);
	}
	.comp-banner.pending { background: linear-gradient(180deg, rgba(255, 90, 0, 0.06), rgba(255, 255, 255, 0.01)); border-color: rgba(255, 90, 0, 0.4); }
	.comp-banner.settled { background: linear-gradient(180deg, rgba(255, 102, 204, 0.06), rgba(255, 255, 255, 0.01)); border-color: rgba(255, 102, 204, 0.4); }
	.cb-left { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
	.cb-dot { width: 6px; height: 6px; border-radius: 50%; background: #00ff66; box-shadow: 0 0 8px rgba(0, 255, 102, 0.7); }
	.comp-banner.pending .cb-dot { background: #ff5a00; box-shadow: 0 0 8px rgba(255, 90, 0, 0.7); }
	.comp-banner.settled .cb-dot { background: #ff66cc; box-shadow: 0 0 8px rgba(255, 102, 204, 0.7); }
	.cb-tag { color: #00ff66; font-family: 'Courier New', monospace; font-size: 9px; font-weight: 900; letter-spacing: 0.16em; }
	.comp-banner.pending .cb-tag { color: #ff5a00; }
	.comp-banner.settled .cb-tag { color: #ff66cc; }
	.cb-name { color: #fff; font-family: 'Courier New', monospace; font-size: 11px; font-weight: 800; }
	.cb-meta { color: #aaa; font-family: 'Courier New', monospace; font-size: 10px; }
</style>
