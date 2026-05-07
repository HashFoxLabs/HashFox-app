import type { Strategy } from '../index';

const strategy: Strategy = {
	id: 'donchian-breakout',
	name: 'Donchian Breakout (1440)',
	description: 'Buys when price breaks above the prior day\'s high (1440 bars), exits on the prior day\'s low. 1 bar = 1 minute.',
	difficulty: 'Beginner',
	type: 'longrun',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"prices": []}

  prices = user_perso_parameter["prices"]
  prices.append(row["price"])
  signal = {"action": "HOLD", "quantity": 0.0}
  PERIOD = 1440  # 1440 minutes = 1 full trading day

  if len(prices) > PERIOD:
    window = prices[-PERIOD-1:-1]  # previous PERIOD bars, not the current one
    high   = max(window)
    low    = min(window)
    held   = portfolio.positions.get(row["market"], 0.0)

    if row["price"] > high and held == 0 and portfolio.cash >= row["price"] * 1.001:
      qty = portfolio.cash * 0.95 / (row["price"] * 1.001)
      signal = {"action": "BUY", "quantity": qty}
    elif row["price"] < low and held > 0:
      signal = {"action": "SELL", "quantity": held}

    if len(prices) > 3000:
      user_perso_parameter["prices"] = prices[-3000:]`,
};

export default strategy;
