import type { Strategy } from '../index';

const strategy: Strategy = {
	id: 'dca-30day',
	name: 'DCA — 30-day Cooldown',
	description:
		'Buys a fixed budget every 30 days. At 1440 ticks/day the cooldown fires every ~43 200 bars — well-suited for minute-level long-run data.',
	difficulty: 'Beginner',
	type: 'longrun',
	code: `  if user_perso_parameter is None:
    user_perso_parameter = {"last_buy_ts": 0, "budget_per_buy": 200.0}

  COOLDOWN = 30 * 24 * 3600  # 30 days in seconds
  ts_sec   = row["timestamp"] / 1000
  signal   = {"action": "HOLD", "quantity": 0.0}

  if ts_sec - user_perso_parameter["last_buy_ts"] >= COOLDOWN:
    budget = user_perso_parameter["budget_per_buy"]
    cost   = row["price"] * 1.001
    if portfolio.cash >= cost:
      qty = min(budget, portfolio.cash) / cost
      signal = {"action": "BUY", "quantity": qty}
      user_perso_parameter["last_buy_ts"] = ts_sec`,
};

export default strategy;
