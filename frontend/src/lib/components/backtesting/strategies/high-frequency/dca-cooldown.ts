import type { Strategy } from '../index';

// Slot repurposed: DCA belongs in long-run. Replaced with EMA Mean Reversion.
const strategy: Strategy = {
	id: 'ema-mean-reversion',
	name: 'EMA Mean Reversion',
	description:
		'Buys when price falls 0.5% below its ~20-min EMA and sells on recovery. O(1) per tick — designed for millions of ticks.',
	difficulty: 'Intermediate',
	type: 'highfrequency',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"ema": None, "tick_count": 0}

  state = user_perso_parameter
  state["tick_count"] += 1
  # K = 2/(N+1) where N=5000 ticks ≈ 20 min at ~4 ticks/sec
  K = 2 / 5001

  if state["ema"] is None:
    state["ema"] = row["price"]
  else:
    state["ema"] = K * row["price"] + (1 - K) * state["ema"]

  signal   = {"action": "HOLD", "quantity": 0.0}
  held     = portfolio.positions.get(row["market"], 0.0)
  deviation = (row["price"] - state["ema"]) / state["ema"] if state["ema"] > 0 else 0

  if state["tick_count"] > 5000:  # skip warmup
    if deviation < -0.005 and held == 0 and portfolio.cash >= row["price"] * 1.001:
      qty = portfolio.cash * 0.5 / (row["price"] * 1.001)
      signal = {"action": "BUY", "quantity": qty}
    elif deviation > 0.001 and held > 0:
      signal = {"action": "SELL", "quantity": held}`,
};

export default strategy;
