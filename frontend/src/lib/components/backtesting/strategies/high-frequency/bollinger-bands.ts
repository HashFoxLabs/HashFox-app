import type { Strategy } from '../index';

// Slot repurposed: BB(20 ticks) = std-dev over ~5 seconds — noise. Replaced with O(1) EMA-BB.
const strategy: Strategy = {
	id: 'ema-bollinger',
	name: 'EMA Bollinger Bands (O(1))',
	description:
		'Approximates Bollinger Bands using EMA of price and EMA of |deviation| — no list storage, constant memory per tick. Bands span ~20 min at HF resolution.',
	difficulty: 'Advanced',
	type: 'highfrequency',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"ema": None, "ema_dev": None, "tick_count": 0}

  state = user_perso_parameter
  state["tick_count"] += 1
  # N=5000 ticks ≈ 20 min at ~4 ticks/sec
  K     = 2 / 5001
  price = row["price"]

  if state["ema"] is None:
    state["ema"]     = price
    state["ema_dev"] = 0.0
  else:
    state["ema"]     = K * price + (1 - K) * state["ema"]
    state["ema_dev"] = K * abs(price - state["ema"]) + (1 - K) * state["ema_dev"]

  lower  = state["ema"] - 2 * state["ema_dev"]
  upper  = state["ema"] + 2 * state["ema_dev"]
  signal = {"action": "HOLD", "quantity": 0.0}
  held   = portfolio.positions.get(row["market"], 0.0)

  if state["tick_count"] > 5000:  # skip warmup
    if price < lower and held == 0 and portfolio.cash >= price * 1.001:
      qty = portfolio.cash * 0.95 / (price * 1.001)
      signal = {"action": "BUY", "quantity": qty}
    elif price > upper and held > 0:
      signal = {"action": "SELL", "quantity": held}`,
};

export default strategy;
