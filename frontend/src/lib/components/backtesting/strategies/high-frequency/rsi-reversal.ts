import type { Strategy } from '../index';

// Slot repurposed: RSI(14 ticks) = RSI over ~3 seconds — meaningless. Replaced with Tick Velocity.
const strategy: Strategy = {
	id: 'tick-velocity',
	name: 'Tick Velocity Breakout',
	description:
		'Monitors inter-trade timing via row["timestamp"]. When trades accelerate to 10× their normal pace (activity burst), enters a momentum trade with a 3% trailing stop.',
	difficulty: 'Advanced',
	type: 'highfrequency',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"last_ts": None, "interval_ema": None, "peak": None, "tick_count": 0}

  state = user_perso_parameter
  state["tick_count"] += 1
  K      = 2 / 1001  # EMA over ~1000 ticks
  ts_ms  = row["timestamp"]
  signal = {"action": "HOLD", "quantity": 0.0}

  if state["last_ts"] is not None:
    interval = max(ts_ms - state["last_ts"], 1)  # ms between consecutive trades

    if state["interval_ema"] is None:
      state["interval_ema"] = interval
    else:
      state["interval_ema"] = K * interval + (1 - K) * state["interval_ema"]

    held = portfolio.positions.get(row["market"], 0.0)

    if state["tick_count"] > 1000:
      # Burst: current gap is 10× shorter than the rolling average
      is_burst = state["interval_ema"] > 0 and interval < state["interval_ema"] * 0.10

      if is_burst and held == 0 and portfolio.cash >= row["price"] * 1.001:
        qty = portfolio.cash * 0.5 / (row["price"] * 1.001)
        signal = {"action": "BUY", "quantity": qty}
        state["peak"] = row["price"]
      elif held > 0:
        if row["price"] > state["peak"]:
          state["peak"] = row["price"]
        if row["price"] <= state["peak"] * 0.97:
          signal = {"action": "SELL", "quantity": held}
          state["peak"] = None

  state["last_ts"] = ts_ms`,
};

export default strategy;
