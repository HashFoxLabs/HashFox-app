import type { Strategy } from '../index';

const strategy: Strategy = {
	id: 'momentum-roc',
	name: 'Momentum (ROC 200)',
	description: 'Buys when the 200-bar rate of change is positive (+2%), exits when momentum reverses.',
	difficulty: 'Intermediate',
	type: 'longrun',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"prices": []}

  prices = user_perso_parameter["prices"]
  prices.append(row["price"])
  signal = {"action": "HOLD", "quantity": 0.0}
  PERIOD = 200

  if len(prices) > PERIOD:
    roc  = (row["price"] - prices[-PERIOD]) / prices[-PERIOD]
    held = portfolio.positions.get(row["market"], 0.0)

    if roc > 0.02 and held == 0 and portfolio.cash >= row["price"] * 1.001:
      qty = portfolio.cash * 0.95 / (row["price"] * 1.001)
      signal = {"action": "BUY", "quantity": qty}
    elif roc < -0.01 and held > 0:
      signal = {"action": "SELL", "quantity": held}

    if len(prices) > 2000:
      user_perso_parameter["prices"] = prices[-2000:]`,
};

export default strategy;
