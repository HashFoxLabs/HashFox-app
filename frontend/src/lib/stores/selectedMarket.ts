import { writable } from 'svelte/store';
import { ALL_MARKETS, type MarketEntry } from '$lib/markets';

export const selectedMarket = writable<MarketEntry>(ALL_MARKETS[0]);
