export interface Strategy {
	id: string;
	name: string;
	description: string;
	difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
	type: 'highfrequency' | 'longrun';
	code: string; // Python body — indented with 2 spaces, no signature/return
}

// ── High-Frequency (tick-level data: Crypto, Forex, Stocks, Polymarket) ──────
// All strategies here are O(1) per tick and use window sizes calibrated for
// ~4 trades/sec (1 000 000 trades ≈ 3 days).  SMA/RSI/BB on raw ticks are
// noise — those belong in long-run where 1 bar = 1 minute.
import emaMeanReversion from './high-frequency/dca-cooldown';   // file repurposed
import volumeSpike      from './high-frequency/sma-crossover';  // file repurposed
import tickVelocity     from './high-frequency/rsi-reversal';   // file repurposed
import emaBollinger     from './high-frequency/bollinger-bands'; // file repurposed
import trailingStop     from './high-frequency/trailing-stop';

// ── Long-Run (1-minute bars: CryptoMinute, Polymarket) ───────────────────────
import dca30day        from './long-run/dca-30day';
import emaGoldenCross  from './long-run/ema-golden-cross';
import donchianBreakout from './long-run/donchian-breakout';
import meanReversion   from './long-run/mean-reversion';
import momentumRoc     from './long-run/momentum-roc';
import gridDca         from './long-run/grid-dca';

export const HIGH_FREQ_STRATEGIES: Strategy[] = [
	emaMeanReversion,
	volumeSpike,
	tickVelocity,
	emaBollinger,
	trailingStop,
];

export const LONGRUN_STRATEGIES: Strategy[] = [
	dca30day,
	emaGoldenCross,
	donchianBreakout,
	meanReversion,
	momentumRoc,
	gridDca,
];

export function strategiesForType(type: 'highfrequency' | 'longrun'): Strategy[] {
	return type === 'highfrequency' ? HIGH_FREQ_STRATEGIES : LONGRUN_STRATEGIES;
}
