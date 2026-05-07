import type { Strategy } from '../index';

const strategy: Strategy = {
	id: 'ema-golden-cross',
	name: 'EMA Golden Cross (50/200)',
	description: 'Classic trend-following: buys the golden cross (EMA50 > EMA200) and sells the death cross.',
	difficulty: 'Beginner',
	type: 'longrun',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"ema50": None, "ema200": None, "prev_cross": None}

  state = user_perso_parameter
  price = row["price"]
  k50   = 2 / 51
  k200  = 2 / 201

  if state["ema50"] is None:
    state["ema50"]  = price
    state["ema200"] = price
  else:
    state["ema50"]  = k50  * price + (1 - k50)  * state["ema50"]
    state["ema200"] = k200 * price + (1 - k200) * state["ema200"]

  cross  = "above" if state["ema50"] > state["ema200"] else "below"
  signal = {"action": "HOLD", "quantity": 0.0}
  held   = portfolio.positions.get(row["market"], 0.0)

  if state["prev_cross"] is not None and cross != state["prev_cross"]:
    if cross == "above" and portfolio.cash >= price * 1.001:
      qty = portfolio.cash * 0.95 / (price * 1.001)
      signal = {"action": "BUY", "quantity": qty}
    elif cross == "below" and held > 0:
      signal = {"action": "SELL", "quantity": held}

  state["prev_cross"] = cross`,
};

export default strategy;
