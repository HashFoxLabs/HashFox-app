<svelte:head>
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&display=swap" rel="stylesheet" />
</svelte:head>

<script lang="ts">
	// NOTE: This is a self-contained port of the Polymock backtesting strategy editor.
	// It intentionally lives inside `frontend/` and does not import from `apps/`.

	let {
		dataSource,
		useTimePeriod,
		timestampStartStr,
		timestampEndStr,
		filterTitleSearch,
		filterCategories,
		filterVolumeInf,
		filterVolumeSup,
		selectedMarkets = [],
		onEditConfig,
		onRunBacktest
	}: {
		dataSource: 'synthesis' | 'parquet';
		useTimePeriod: boolean;
		timestampStartStr: string;
		timestampEndStr: string;
		filterTitleSearch: string;
		filterCategories: Set<string>;
		filterVolumeInf: number | null;
		filterVolumeSup: number | null;
		selectedMarkets?: any[];
		onEditConfig: () => void;
		onRunBacktest: (
			strategyCode: string,
			strategyType: string | null,
			strategyParams?: Record<string, unknown>
		) => void | Promise<void>;
	} = $props();

	type Strategy = {
		id: string;
		name: string;
		description: string;
		code: string;
	};

	// Strategies matching the Rust backtest engine examples.
	const strategies: Strategy[] = [
		{
			id: 'mean_reversion',
			name: 'Mean Reversion',
			description: 'Buy when price drops below threshold, betting on reversion to the mean.',
			code: `def mean_reversion(trade, trade_log, portfolio, user_perso_parameters):
    threshold_low = 0.01
    amount = 10
    if trade.get("price") <= threshold_low:
        market_id = trade.get("market_id")
        position = trade.get("position")
    else:
        market_id = trade.get("market_id")
        position = "hold"
    return {"market_id": market_id, "position": position, "amount": amount}`
		},
		{
			id: 'mean_reversion_with_portfolio_positions',
			name: 'No Duplicates',
			description: 'Skip markets where you already hold a position.',
			code: `def mean_reversion_with_portfolio_positions(trade, trade_log, portfolio, user_perso_parameters):
    threshold_low = 0.01
    if trade.get("price") <= threshold_low:
        market_id = trade.get("market_id")
        position = trade.get("position")
        if (market_id, position) in portfolio["positions"]:
            position = "hold"
            amount = 0
        else:
            amount = 10
    else:
        market_id = trade.get("market_id")
        position = "hold"
        amount = 0
    return {"market_id": market_id, "position": position, "amount": amount}`
		},
		{
			id: 'mean_reversion_with_trade_log',
			name: 'Better Price',
			description: 'Only buy if current price is lower than your previous minimum paid.',
			code: `def mean_reversion_with_trade_log(trade, trade_log, portfolio, user_perso_parameters):
    threshold_low = 0.01
    if trade.get("price") <= threshold_low:
        market_id = trade.get("market_id")
        position = trade.get("position")
        trades_on_market = [t for t in trade_log if t["market_id"] == market_id and t["position"] == position]
        if len(trades_on_market) > 0:
            min_price = min(int(t["cost"])/int(t["amount"]) for t in trades_on_market)
            if trade.get("price") < min_price:
                amount = 10
            else:
                position = "hold"
                amount = 0
        else:
            amount = 10
    else:
        market_id = trade.get("market_id")
        position = "hold"
        amount = 0
    return {"market_id": market_id, "position": position, "amount": amount}`
		},
		{
			id: 'mean_reversion_with_trade_log_time',
			name: 'Cooldown',
			description: 'Enforce a cooldown between trades on the same market.',
			code: `def mean_reversion_with_trade_log_time(trade, trade_log, portfolio, user_perso_parameters):
    threshold_low = 0.01
    if trade.get("price") <= threshold_low:
        market_id = trade.get("market_id")
        position = trade.get("position")
        trades_on_market = [t for t in trade_log if t["market_id"] == market_id and t["position"] == position]
        if len(trades_on_market) > 0:
            from datetime import timedelta
            latest = max(t["time"] for t in trades_on_market)
            if trade.get("timestamp") - latest > timedelta(days=1):
                amount = 10
            else:
                position = "hold"
                amount = 0
        else:
            amount = 10
    else:
        market_id = trade.get("market_id")
        position = "hold"
        amount = 0
    return {"market_id": market_id, "position": position, "amount": amount}`
		},
		{
			id: 'mean_reversion_with_user_perso_parameter_internal',
			name: 'Scaled Entry',
			description: 'Scale position amount based on trade count in a market.',
			code: `def mean_reversion_with_user_perso_parameter_internal(trade, trade_log, portfolio, user_perso_parameters):
    threshold_low = 0.01
    amount = 10
    if "trade_count" not in user_perso_parameters:
        user_perso_parameters["trade_count"] = {}
    if trade.get("market_id") not in user_perso_parameters["trade_count"]:
        user_perso_parameters["trade_count"][trade.get("market_id")] = 0
    user_perso_parameters["trade_count"][trade.get("market_id")] += 1
    if trade.get("price") <= threshold_low:
        market_id = trade.get("market_id")
        position = trade.get("position")
        amount = min(amount, user_perso_parameters["trade_count"][market_id])
    else:
        market_id = trade.get("market_id")
        position = "hold"
        amount = 0
    return {"market_id": market_id, "position": position, "amount": amount, "user_perso_parameters": user_perso_parameters}`
		}
	];

	let selectedIdx = $state(0);
	let strategyCode = $state(strategies[0].code);

	// Strategy execution params
	let initialCash = $state(10000);
	let reimburseOpenPositions = $state(false);
	let priceInf: number | null = $state(null);
	let priceSup: number | null = $state(null);
	let stopLoss: number | null = $state(null);
	let takeProfit: number | null = $state(null);
	let trailingStop: number | null = $state(null);
	let maxHoldHours: number | null = $state(null);

	function selectStrategy(i: number) {
		selectedIdx = i;
		strategyCode = strategies[i].code;
	}

	function parseOptionalNumber(v: string): number | null {
		const t = v.trim();
		if (!t) return null;
		const n = Number(t.replace(',', '.'));
		return Number.isFinite(n) ? n : null;
	}

	async function run() {
		const s = strategies[selectedIdx];
		await onRunBacktest(strategyCode, s?.id ?? null, {
			initialCash,
			reimburseOpenPositions,
			priceInf,
			priceSup,
			stopLoss,
			takeProfit,
			trailingStop,
			maxHoldHours,
			strategyParams: null
		});
	}
</script>

<div class="editor">
	<aside class="left">
		<div class="left-head">
			<div class="title">STRATEGIES</div>
			<button class="btn ghost" on:click={onEditConfig}>Edit config</button>
		</div>
		<div class="list">
			{#each strategies as s, i}
				<button class="item" class:active={i === selectedIdx} on:click={() => selectStrategy(i)}>
					<div class="name">{i + 1}. {s.name}</div>
					<div class="desc">{s.description}</div>
				</button>
			{/each}
		</div>
		<div class="meta">
			<div><span class="k">Data</span> <span class="v">{dataSource}</span></div>
			<div><span class="k">Markets</span> <span class="v">{selectedMarkets?.length ?? 0}</span></div>
			{#if useTimePeriod}
				<div><span class="k">Window</span> <span class="v">{timestampStartStr} → {timestampEndStr}</span></div>
			{/if}
		</div>
	</aside>

	<section class="right">
		<div class="right-head">
			<div class="title">STRATEGY CODE</div>
			<button class="btn run" on:click={run}>Run backtest</button>
		</div>

		<textarea class="code" bind:value={strategyCode} spellcheck="false"></textarea>

		<div class="params">
			<div class="phead">RUN PARAMETERS</div>
			<div class="grid">
				<label>
					<span>Initial cash</span>
					<input type="number" min="0" bind:value={initialCash} />
				</label>
				<label class="check">
					<input type="checkbox" bind:checked={reimburseOpenPositions} />
					<span>Reimburse open positions</span>
				</label>
				<label>
					<span>Price min (optional)</span>
					<input
						value={priceInf ?? ''}
						on:input={(e) => (priceInf = parseOptionalNumber((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label>
					<span>Price max (optional)</span>
					<input
						value={priceSup ?? ''}
						on:input={(e) => (priceSup = parseOptionalNumber((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label>
					<span>Stop loss (e.g. 0.2)</span>
					<input
						value={stopLoss ?? ''}
						on:input={(e) => (stopLoss = parseOptionalNumber((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label>
					<span>Take profit (e.g. 0.5)</span>
					<input
						value={takeProfit ?? ''}
						on:input={(e) => (takeProfit = parseOptionalNumber((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label>
					<span>Trailing stop (e.g. 0.1)</span>
					<input
						value={trailingStop ?? ''}
						on:input={(e) =>
							(trailingStop = parseOptionalNumber((e.target as HTMLInputElement).value))}
					/>
				</label>
				<label>
					<span>Max hold hours</span>
					<input
						value={maxHoldHours ?? ''}
						on:input={(e) =>
							(maxHoldHours = parseOptionalNumber((e.target as HTMLInputElement).value))}
					/>
				</label>
			</div>
		</div>
	</section>
</div>

<style>
	.editor {
		flex: 1;
		min-height: 0;
		display: grid;
		grid-template-columns: 360px 1fr;
		background: #000;
	}
	.left {
		border-right: 1px solid #1a1a1a;
		background: #060606;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.left-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 12px;
		border-bottom: 1px solid #1a1a1a;
	}
	.title {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.12em;
		font-size: 11px;
		color: #ff9500;
	}
	.btn {
		background: #111;
		border: 1px solid #333;
		color: #e8e8e8;
		padding: 6px 10px;
		border-radius: 8px;
		font-size: 12px;
		cursor: pointer;
	}
	.btn.ghost { background: transparent; }
	.btn.run {
		background: linear-gradient(180deg, rgba(249,115,22,0.95), rgba(249,115,22,0.72));
		border-color: rgba(249,115,22,0.6);
		color: #000;
		font-weight: 900;
	}
	.list {
		padding: 10px;
		overflow: auto;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.item {
		text-align: left;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 10px;
		padding: 10px 10px;
		cursor: pointer;
		color: #e8e8e8;
	}
	.item.active { border-color: rgba(255,149,0,0.6); background: rgba(255,255,255,0.02); }
	.name { font-weight: 900; font-size: 13px; }
	.desc { color: #9a9a9a; font-size: 12px; margin-top: 4px; line-height: 1.3; }
	.meta {
		padding: 10px 12px 14px;
		border-top: 1px solid #1a1a1a;
		color: #bdbdbd;
		font-family: 'Share Tech Mono', monospace;
		font-size: 11px;
		display: grid;
		gap: 6px;
	}
	.k { color: #777; margin-right: 6px; }
	.v { color: #e8e8e8; }

	.right {
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	.right-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 14px;
		border-bottom: 1px solid #1a1a1a;
		background: #000;
	}
	.code {
		flex: 1;
		min-height: 0;
		background: #040404;
		color: #e8e8e8;
		border: none;
		outline: none;
		padding: 14px 14px;
		font-family: 'Share Tech Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 13px;
		line-height: 1.4;
		border-bottom: 1px solid #1a1a1a;
		resize: none;
	}
	.params {
		background: #060606;
		padding: 10px 14px 14px;
	}
	.phead {
		font-family: 'Share Tech Mono', monospace;
		letter-spacing: 0.12em;
		font-size: 11px;
		color: #9a9a9a;
		margin-bottom: 10px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 10px;
	}
	label { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: #bdbdbd; }
	label.check { flex-direction: row; align-items: center; gap: 10px; padding-top: 22px; }
	input {
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8e8;
		outline: none;
		font-family: 'Share Tech Mono', monospace;
	}

	@media (max-width: 1020px) {
		.editor { grid-template-columns: 1fr; }
		.left { border-right: none; border-bottom: 1px solid #1a1a1a; }
		.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
	}
</style>

