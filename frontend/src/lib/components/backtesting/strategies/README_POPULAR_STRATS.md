# Popular Strategies — HashFox Backtesting

Each strategy is a Python function body that runs on every market tick. The engine calls your code with the current price, portfolio state, and your persistent state (`user_perso_parameter`). You return a signal (`BUY`, `SELL`, or `HOLD`).

No external libraries are allowed — only pure arithmetic.

---

## Why the two categories exist

| | High-Frequency | Long-Run |
|---|---|---|
| **Data** | Individual trades (tick level) | 1-minute aggregated bars |
| **Scale** | ~1 000 000 trades in 3 days (~4/sec) | ~1 440 bars/day |
| **Window of 20 "bars"** | ~5 seconds — **noise** | ~20 minutes — signal |
| **Unique data** | Per-trade volume, inter-trade timing | — |
| **Sources** | Crypto, Forex, Stocks, Polymarket | CryptoMinute, ForexMinute, StocksMinute, Polymarket |

**Available fields in `row`:**

| Field | Type | Notes |
|---|---|---|
| `row["price"]` | float | Last traded price |
| `row["timestamp"]` | int | Unix ms — divide by 1000 for seconds |
| `row["market"]` | str | Market identifier |
| `row["volume"]` | float | Trade size (key may be `qty` for some Crypto sources) |

---

## High-Frequency Strategies

---

### 1. EMA Mean Reversion
**Difficulty:** Intermediate

**The idea:**
Maintains a running Exponential Moving Average of price over ~5000 ticks (≈ 20 minutes). When price drops 0.5% below this short-term mean, the market is temporarily oversold at tick resolution → buy. Exit when price recovers back above the mean.

**Why it belongs in HF:**
The EMA window is calibrated to ~20 minutes of real time at 4 ticks/sec. On minute bars (LR), the same N=5000 would span ~3.5 days — a completely different regime. The strategy is meaningless without tuning the window to the data frequency.

**Why it's O(1):**
An EMA requires only one stored value (the previous EMA). No list grows. On 1 million ticks, memory stays constant.

**When does it work well?**
In stable, mean-reverting markets where price oscillates around a short-term fair value. Works best when there's no strong directional trend.

**When does it struggle?**
In trending markets. If price is genuinely breaking out, the EMA "fair value" lags behind and the strategy keeps buying into a falling market.

**Key parameters:**
- `K = 2 / 5001` — EMA period ≈ 5000 ticks ≈ 20 min. Smaller K = slower EMA = longer memory.
- `-0.005` buy threshold — 0.5% below EMA. Tighten to `-0.003` for more frequent signals.
- `+0.001` exit threshold — exits very quickly after recovery. Raise to `+0.005` to hold longer.

---

### 2. Volume Spike Momentum
**Difficulty:** Intermediate

**The idea:**
Tracks the rolling EMA of trade volume (per individual trade, not aggregated). When a single trade is 8× larger than the rolling average, a large player is active — enter in the direction of momentum. Exit via a 3% trailing stop.

**Why it belongs in HF:**
This strategy is **impossible on minute bars**. Minute-bar volume is the sum of all trades in that minute, making individual large trades invisible. Tick data preserves individual trade sizes, enabling detection of institutional orders.

**Why it's O(1):**
Uses an EMA of volume — one stored value. The peak tracker is a single float.

**When does it work well?**
When large institutional trades genuinely predict short-term direction — common in liquid crypto markets where whale activity has observable price impact.

**When does it struggle?**
When large trades are hedges or noise rather than directional bets. The strategy can also trigger repeatedly during a sustained high-volume period.

**Key parameters:**
- `K = 2 / 1001` — volume EMA over ~1000 ticks ≈ 4 minutes. Very fast to adapt to volatility regime changes.
- `8×` spike multiplier — raise to 15× for rarer but more extreme entries.
- `0.97` trailing stop — 3% below peak. Tighten to `0.98` for faster exits.

---

### 3. Tick Velocity Breakout
**Difficulty:** Advanced

**The idea:**
Monitors the time gap between consecutive trades (in milliseconds). Maintains an EMA of typical inter-trade intervals. When the current interval is 10× shorter than the rolling average — trades are arriving at 10× normal speed — a burst of market activity is underway. Enter momentum long, exit via 3% trailing stop.

**Why it belongs in HF:**
Uses `row["timestamp"]` at millisecond resolution. On minute bars, every timestamp is exactly 60 000ms apart — no velocity information exists. This signal is completely invisible at LR resolution.

**Why it's O(1):**
Stores only `last_ts`, `interval_ema`, and `peak`. Constant memory.

**When does it work well?**
During genuine liquidity events — news releases, large order executions, liquidation cascades. These events produce abnormally rapid trade sequences before a significant price move.

**When does it struggle?**
Many triggers are noise: a brief network burst or exchange glitch can produce rapid timestamps without any market significance. Also, in highly liquid markets, "normal" speed is already fast, so the threshold may never fire.

**Key parameters:**
- `0.10` burst ratio — fires when current interval < 10% of rolling average (10× faster). Relax to `0.20` for 5× faster.
- `K = 2 / 1001` — interval EMA over ~1000 ticks ≈ 4 minutes.
- `0.97` trailing stop — same as Volume Spike.

---

### 4. EMA Bollinger Bands (O(1))
**Difficulty:** Advanced

**The idea:**
A classical Bollinger Band uses a rolling mean ± 2 standard deviations. Computing a true rolling std-dev requires storing N prices (O(N) memory) and iterating each tick (O(N) time). This strategy approximates it using two EMAs:
- `ema` — exponential mean of price
- `ema_dev` — exponential mean of |price − ema| (mean absolute deviation proxy)

Lower band = `ema − 2 × ema_dev`. Upper band = `ema + 2 × ema_dev`.

Buy below the lower band, sell above the upper band.

**Why it belongs in HF:**
The EMA window is set to ~5000 ticks ≈ 20 minutes. On LR minute data, the same N represents 3.5 days — an entirely different time regime.

**Why it's O(1):**
Only two floats stored. True rolling BB would require a 5000-element list and O(5000) computation per tick — unacceptably slow for 1M ticks.

**When does it work well?**
Same as classical BB: range-bound markets with predictable oscillation around a mean.

**When does it struggle?**
Same as classical BB: volatility expansions. During a price crash or explosive move, the bands widen and price can remain outside them for a long time, generating repeated losing buys.

**Key parameters:**
- `K = 2 / 5001` — band EMA period ≈ 5000 ticks ≈ 20 min. Increase to `2/20001` for a slower, wider band.
- `2 × ema_dev` — multiplier for band width. Use `1.5` for tighter bands (more signals), `3` for wider (fewer but more extreme).

---

### 5. Trailing Stop (5%)
**Difficulty:** Intermediate

**The idea:**
Enters a full position on the first available tick, then tracks the highest price since entry (the "peak"). Stop is set 5% below that peak and rises as price rises — it never moves down.

When price falls more than 5% from its peak → sell.

**Why it belongs in HF (and also works in LR):**
The strategy is purely price-based. The stop is a price level, not a time window. It works identically at any tick frequency — but on HF data it monitors every individual trade for the stop trigger rather than relying on 1-minute snapshots, meaning it reacts instantly to a sudden price drop.

**When does it work well?**
In strongly trending markets. If you catch a long uptrend, the trailing stop lets you ride most of the move and exits automatically when the trend breaks.

**When does it struggle?**
In volatile markets. A 5% swing during a normal correction can trigger the stop even if the trend resumes immediately afterward.

**Key parameters:**
- `0.95` stop multiplier — 5% trailing stop. Use `0.90` for 10% (less sensitive), `0.98` for 2% (very tight).

---

## Long-Run Strategies

These strategies operate on **1-minute bar data** (CryptoMinute, Polymarket). Each tick represents one minute. Window sizes that would be noise at HF resolution become meaningful multi-hour or multi-day periods here.

---

### 1. DCA — 30-day Cooldown
**Difficulty:** Beginner

**The idea:**
Dollar-Cost Averaging: buy a fixed amount every 30 days regardless of price. Over time you buy more units when cheap and fewer when expensive, naturally averaging your cost.

**Why it belongs in LR (not HF):**
On HF data with 1M trades in 3 days, a 30-day cooldown fires once after ~10M ticks — pointless. On minute bars, the cooldown fires every ~43 200 bars (30 days × 1440 bars/day), which is a reasonable and practical interval.

**When does it work well?**
Long upward-trending markets (e.g., Bitcoin over 5 years). It is not designed to beat the market — it is designed to be consistent and emotionless.

**When does it struggle?**
In prolonged bear markets, you keep buying into falling prices.

**Key parameters:**
- `COOLDOWN = 30 * 24 * 3600` — change to `7 * 24 * 3600` for weekly DCA.
- `budget_per_buy` — fixed spend per purchase in dollars.

---

### 2. EMA Golden Cross (50/200)
**Difficulty:** Beginner

**The idea:**
Two Exponential Moving Averages — fast (50 bars) and slow (200 bars). A "Golden Cross" (fast crosses above slow) signals an uptrend. A "Death Cross" (fast falls below slow) signals a downtrend.

On minute data: EMA(50) ≈ 50-minute trend, EMA(200) ≈ 3.3-hour trend. This is a short-term crossover, not the classic multi-month golden cross used on daily charts — but it is meaningful and tradeable on minute bars.

**When does it work well?**
Clear intraday or multi-day trends in crypto. BTC hourly momentum produces usable crosses.

**When does it struggle?**
Sideways markets. The two EMAs oscillate around each other, generating repeated false crosses with fees on each.

**Key parameters:**
- `k50 = 2 / 51`, `k200 = 2 / 201` — to use daily equivalents on minute data: `k50 = 2 / (50*1440+1)`.

---

### 3. Donchian Breakout (1440 bars = 1 day)
**Difficulty:** Beginner

**The idea:**
Buy when price breaks above the highest price of the previous 1440 bars (= 1 full day). Sell when price breaks below the previous day's low.

A new 1-day high means buyers are willing to pay more than at any point in the past 24 hours — a strong momentum signal. This is the original Donchian breakout concept (20 *trading days* in his system, here adapted to 1 calendar day of minutes).

**Original mistake:** this strategy was initially written with `PERIOD = 20` — meaning "new 20-minute high." A new 20-minute high happens dozens of times per day and is not a meaningful breakout.

**When does it work well?**
After consolidation periods when price finally breaks out of a tight range.

**When does it struggle?**
In ranging markets, price repeatedly touches daily highs and lows without sustained directional follow-through.

**Key parameters:**
- `PERIOD = 1440` — 1 day. Use `4320` for a 3-day breakout (stronger signal, fewer trades).

---

### 4. Mean Reversion (Z-Score, 100 bars)
**Difficulty:** Intermediate

**The idea:**
Computes a Z-score: how many standard deviations is the current price from its 100-bar mean? A Z of −2 means price is 2 standard deviations *below* its 100-minute average — statistically rare, likely to revert → buy. Exit when Z recovers above +0.5.

**When does it work well?**
Range-bound markets. If crypto is consolidating between support and resistance, Z-score catches the edges cleanly.

**When does it struggle?**
Trending markets. A low Z-score in a downtrend just means "cheaper than recently" — and it keeps going lower.

**Key parameters:**
- `PERIOD = 100` — 100 minutes ≈ 1.7 hours. Increase to 1440 for a daily mean.
- `-2.0` entry, `+0.5` exit — asymmetric by design: wait for extreme entry, take profit early.

---

### 5. Momentum (Rate of Change, 200 bars)
**Difficulty:** Intermediate

**The idea:**
Rate of Change (ROC): how much has price changed over the last 200 minutes (≈ 3.3 hours)? If ROC > +2%, the market has sustained upward momentum → buy. Exit when momentum reverses to −1%.

**When does it work well?**
In trending markets with persistent momentum — common in crypto during bull runs.

**When does it struggle?**
At trend reversals. Momentum strategies are always late — you enter after the trend starts and exit after it ends.

**Key parameters:**
- `PERIOD = 200` — 200 minutes ≈ 3.3 hours. Increase to `1440` for daily momentum.
- `0.02` buy threshold — +2%. Raise for stronger confirmation.
- `-0.01` exit threshold — −1%. Raise to `-0.02` to hold through small dips.

---

### 6. Grid DCA
**Difficulty:** Advanced

**The idea:**
Records an initial reference price. Buys 20% of remaining cash each time price drops another 5% (up to 5 levels = max 25% total drop). When price recovers to reference +2%, sells everything.

You end up with a lower average cost than the reference, so a small recovery is profitable.

**Example:** Reference = $100, $1000 cash.
- Drop to $95 (−5%) → buy $200. Average cost: $95.
- Drop to $90 (−10%) → buy $160. Average cost: ~$92.
- Price recovers to $102 (+2%) → sell all at profit.

**When does it work well?**
Volatile but range-bound markets — dip-and-recover cycles.

**When does it struggle?**
Sustained downtrends. If price falls through all 5 grid levels and never returns to reference +2%, all capital is trapped at a loss.

**Key parameters:**
- `0.05` grid spacing — every 5% drop triggers a buy. Use `0.02` for tighter grids.
- `0.2` per-level budget — 20% of remaining cash per buy. Reduce to spread across more levels.
- `5` max levels — max 5 buys before stopping. Increase if you want more averaging.
- `1.02` take-profit — sell at reference +2%. Raise to `1.05` to wait for a stronger recovery.

---

## How to Add Your Own Strategy

1. Create a `.ts` file in `high-frequency/` or `long-run/`.
2. Export a `Strategy` object: `id`, `name`, `description`, `difficulty`, `type`, `code`.
3. Import it in `index.ts` and add it to the appropriate array.

The `code` field is the Python function **body only** — no `def` line, no `return` line (added by the platform). Indent with 2 spaces. Assign `signal` before the end.

**For HF strategies:** keep everything O(1). Avoid `list.append` + `sum(prices[-N:])` — on 1M ticks, O(N) per tick means O(N×M) total operations. Use EMA instead.
