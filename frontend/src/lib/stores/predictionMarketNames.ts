/** Lightweight localStorage cache of `marketId → question` so the history page
 * can render the human-readable market name even if the Synthesis lookup fails
 * or the market has rolled off the active list. Written at buy time, read on
 * history load. */
const KEY = 'hashfox:predMarketNames:v1';

function readAll(): Record<string, string> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(KEY);
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? (parsed as Record<string, string>) : {};
	} catch {
		return {};
	}
}

function writeAll(map: Record<string, string>) {
	if (typeof window === 'undefined') return;
	try {
		window.localStorage.setItem(KEY, JSON.stringify(map));
	} catch {
		// Quota or privacy mode — ignore; lookup will fall back to the API.
	}
}

export function rememberPredictionMarketName(marketId: string, question: string) {
	if (!marketId || !question) return;
	const all = readAll();
	if (all[marketId] === question) return;
	all[marketId] = question;
	writeAll(all);
}

export function getRememberedMarketName(marketId: string): string | undefined {
	return readAll()[marketId];
}

export function getAllRememberedMarketNames(): Record<string, string> {
	return readAll();
}
