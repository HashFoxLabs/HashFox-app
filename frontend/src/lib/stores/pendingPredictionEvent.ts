import { writable } from 'svelte/store';
import type { PolyEvent } from '$lib/polymarket';

// Set when the global search hands a prediction event to the terminal.
// PredictionTerminalPro consumes this to open the event immediately and then
// resets it to null.
export const pendingPredictionEvent = writable<PolyEvent | null>(null);
