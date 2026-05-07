import type { Strategy } from '../index';

const strategy: Strategy = {
	id: 'mean-reversion',
	name: 'Mean Reversion (Z-Score)',
	description: 'Buys when price is 2 standard deviations below its 100-bar mean, sells when it reverts.',
	difficulty: 'Intermediate',
	type: 'longrun',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"prices": []}

  prices = user_perso_parameter["prices"]
  prices.append(row["price"])
  signal = {"action": "HOLD", "quantity": 0.0}
  PERIOD = 100

  if len(prices) >= PERIOD:
    window = prices[-PERIOD:]
    mean   = sum(window) / PERIOD
    std    = (sum((p - mean) ** 2 for p in window) / PERIOD) ** 0.5
    z      = (row["price"] - mean) / std if std > 0 else 0
    held   = portfolio.positions.get(row["market"], 0.0)

    if z < -2.0 and held == 0 and portfolio.cash >= row["price"] * 1.001:
      qty = portfolio.cash * 0.5 / (row["price"] * 1.001)
      signal = {"action": "BUY", "quantity": qty}
    elif z > 0.5 and held > 0:
      signal = {"action": "SELL", "quantity": held}

    if len(prices) > 2000:
      user_perso_parameter["prices"] = prices[-2000:]`,
};

export default strategy;
