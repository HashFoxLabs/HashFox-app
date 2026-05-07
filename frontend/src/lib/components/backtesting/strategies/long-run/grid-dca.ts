import type { Strategy } from '../index';

const strategy: Strategy = {
	id: 'grid-dca',
	name: 'Grid DCA',
	description: 'Buys 20% of cash at every 5% price drop (up to 5 grid levels), sells all when price recovers +2%.',
	difficulty: 'Advanced',
	type: 'longrun',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"ref_price": None, "grid_level": 0}

  state  = user_perso_parameter
  signal = {"action": "HOLD", "quantity": 0.0}
  held   = portfolio.positions.get(row["market"], 0.0)

  if state["ref_price"] is None:
    state["ref_price"] = row["price"]

  ref          = state["ref_price"]
  drop_pct     = (ref - row["price"]) / ref if ref > 0 else 0
  target_level = min(int(drop_pct / 0.05), 5)

  if target_level > state["grid_level"] and portfolio.cash >= row["price"] * 1.001:
    budget = portfolio.cash * 0.2
    qty    = budget / (row["price"] * 1.001)
    signal = {"action": "BUY", "quantity": qty}
    state["grid_level"] = target_level

  elif row["price"] >= ref * 1.02 and held > 0:
    signal = {"action": "SELL", "quantity": held}
    state["ref_price"]  = row["price"]
    state["grid_level"] = 0`,
};

export default strategy;
