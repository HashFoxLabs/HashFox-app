import type { RequestHandler } from './$types';
import { getCachedAlerts, initStructAlerts, subscribeToAlerts } from '$lib/server/structAlerts';

export const GET: RequestHandler = ({ request }) => {
	initStructAlerts();
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		start(controller) {
			let closed = false;

			const send = (data: unknown) => {
				if (closed) return;
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
			};

			send({ type: 'init', alerts: getCachedAlerts() });

			const unsub = subscribeToAlerts((alert) => send(alert));

			request.signal.addEventListener('abort', () => {
				if (closed) return;
				closed = true;
				unsub();
				try { controller.close(); } catch { /* already closed */ }
			});
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache'
		}
	});
};
