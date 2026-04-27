import { env } from '$env/dynamic/private';
import WebSocket from 'ws';

export interface AlertEvent {
	id: string;
	event: string;
	data: Record<string, unknown>;
	receivedAt: number;
}

const MAX_CACHE = 50;
const PING_INTERVAL_MS = 30_000;
const RECONNECT_DELAY_MS = 5_000;

const alertCache: AlertEvent[] = [];
const subscribers = new Set<(alert: AlertEvent) => void>();

// condition_id → question label
const marketQuestionCache = new Map<string, string>();

let ws: WebSocket | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

const SUBSCRIPTIONS: Record<string, unknown>[] = [
	{ op: 'subscribe', event: 'trader_whale_trade', min_usd_value: 25000 },
	{ op: 'subscribe', event: 'price_spike', min_price_change_pct: 10 },
	{ op: 'subscribe', event: 'market_volume_spike', spike_ratio: 2.0 }
];

async function resolveQuestion(conditionId: string): Promise<string | null> {
	if (marketQuestionCache.has(conditionId)) return marketQuestionCache.get(conditionId)!;

	try {
		const apiKey = env.STRUCT_API_KEY;
		const url = `https://api.struct.to/v1/polymarket/market/${conditionId}?include_tags=false&include_event=false&include_metrics=false${apiKey ? `&api-key=${apiKey}` : ''}`;
		const res = await fetch(url);
		if (!res.ok) {
			console.warn(`[structAlerts] resolveQuestion failed: ${res.status} for ${conditionId}`);
			return null;
		}
		const markets = await res.json();
		const question = markets?.[0]?.question ?? null;
		if (question) {
			marketQuestionCache.set(conditionId, question);
			console.log(`[structAlerts] resolved question: "${question}"`);
		}
		return question;
	} catch (err) {
		console.warn('[structAlerts] resolveQuestion error:', err);
		return null;
	}
}

async function enrichAndDispatch(alert: AlertEvent) {
	if (alert.event === 'price_spike') {
		if (Number(alert.data.previous_price ?? 0) < 0.15) return;
		if (alert.data.condition_id) {
			const question = await resolveQuestion(String(alert.data.condition_id));
			if (question) alert.data = { ...alert.data, question };
		}
	}

	alertCache.push(alert);
	if (alertCache.length > MAX_CACHE) alertCache.shift();

	for (const cb of subscribers) cb(alert);
}

function connect() {
	const apiKey = env.STRUCT_API_KEY;
	if (!apiKey) {
		console.warn('[structAlerts] STRUCT_API_KEY not set — skipping connection');
		return;
	}

	ws = new WebSocket(`wss://api.struct.to/ws/alerts?api-key=${apiKey}`);

	ws.on('open', () => {
		console.log('[structAlerts] Connected to Struct WebSocket');

		for (const sub of SUBSCRIPTIONS) {
			ws!.send(JSON.stringify(sub));
		}

		pingTimer = setInterval(() => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: 'ping' }));
			}
		}, PING_INTERVAL_MS);
	});

	ws.on('message', (raw: Buffer | string) => {
		try {
			const data = JSON.parse(raw.toString());
			console.log('[structAlerts] message:', JSON.stringify(data).slice(0, 200));

			if (data.type === 'pong' || data.op === 'subscribed' || data.op === 'unsubscribed' || data.error) return;
			if (!data.event) return;

			const alert: AlertEvent = {
				id: crypto.randomUUID(),
				event: data.event,
				data: data.data ?? {},
				receivedAt: data.timestamp ?? Date.now()
			};

			enrichAndDispatch(alert);
		} catch {
			// ignore malformed messages
		}
	});

	ws.on('close', () => {
		console.warn('[structAlerts] WebSocket closed — reconnecting in 5s');
		cleanup();
		setTimeout(connect, RECONNECT_DELAY_MS);
	});

	ws.on('error', (err) => {
		console.error('[structAlerts] WebSocket error:', err.message);
		ws?.terminate();
	});
}

function cleanup() {
	if (pingTimer) {
		clearInterval(pingTimer);
		pingTimer = null;
	}
	ws = null;
}

export function subscribeToAlerts(cb: (alert: AlertEvent) => void): () => void {
	subscribers.add(cb);
	return () => subscribers.delete(cb);
}

export function getCachedAlerts(): AlertEvent[] {
	return [...alertCache];
}

export function initStructAlerts() {
	if (initialized) return;
	initialized = true;
	connect();
}

initStructAlerts();
