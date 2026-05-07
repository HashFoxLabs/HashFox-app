import type { Strategy } from '../index';

// Slot repurposed: SMA(5/20 ticks) was noise at HF resolution. Replaced with Volume Spike.
const strategy: Strategy = {
	id: 'volume-spike',
	name: 'Volume Spike Momentum',
	description:
		'Detects abnormally large individual trades (8× EMA of volume) — a signal invisible on aggregated minute bars. Exits via 3% trailing stop.',
	difficulty: 'Intermediate',
	type: 'highfrequency',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"vol_ema": None, "peak": None, "tick_count": 0}

  state = user_perso_parameter
  state["tick_count"] += 1
  # Use row["volume"] — for Crypto sources the key may be row["qty"] instead
  vol = row["volume"]
  K   = 2 / 1001  # EMA over ~1000 ticks ≈ 4 min at 4 ticks/sec

  if state["vol_ema"] is None:
    state["vol_ema"] = vol
  else:
    state["vol_ema"] = K * vol + (1 - K) * state["vol_ema"]

  signal = {"action": "HOLD", "quantity": 0.0}
  held   = portfolio.positions.get(row["market"], 0.0)

  if state["tick_count"] > 1000:
    is_spike = state["vol_ema"] > 0 and vol > state["vol_ema"] * 8

    if is_spike and held == 0 and portfolio.cash >= row["price"] * 1.001:
      qty = portfolio.cash * 0.5 / (row["price"] * 1.001)
      signal = {"action": "BUY", "quantity": qty}
      state["peak"] = row["price"]

    elif held > 0:
      if row["price"] > state["peak"]:
        state["peak"] = row["price"]
      if row["price"] <= state["peak"] * 0.97:  # 3% trailing stop
        signal = {"action": "SELL", "quantity": held}
        state["peak"] = None`,
};

export default strategy;
