import type { Strategy } from '../index';

const strategy: Strategy = {
	id: 'trailing-stop',
	name: 'Trailing Stop (5%)',
	description: 'Enters fully on the first tick, then trails a 5% stop below the running peak to lock in gains.',
	difficulty: 'Intermediate',
	type: 'highfrequency',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"peak": None}

  signal = {"action": "HOLD", "quantity": 0.0}
  held   = portfolio.positions.get(row["market"], 0.0)

  if held == 0 and portfolio.cash >= row["price"] * 1.001:
    qty = portfolio.cash * 0.95 / (row["price"] * 1.001)
    signal = {"action": "BUY", "quantity": qty}
    user_perso_parameter["peak"] = row["price"]

  elif held > 0:
    if row["price"] > user_perso_parameter["peak"]:
      user_perso_parameter["peak"] = row["price"]

    stop = user_perso_parameter["peak"] * 0.95
    if row["price"] <= stop:
      signal = {"action": "SELL", "quantity": held}
      user_perso_parameter["peak"] = None`,
};

export default strategy;
