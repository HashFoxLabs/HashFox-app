import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const cache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 60 * 60 * 1000;

export const GET: RequestHandler = async ({ url }) => {
	try {
		const NEWDATA_API_KEY = env.NEWDATA_API_KEY;
		if (!NEWDATA_API_KEY) {
			return json({ error: 'Missing NEWDATA_API_KEY' }, { status: 500 });
		}

		const category = url.searchParams.get('category') || 'top';
		const language = url.searchParams.get('language') || 'en';
		const cacheKey = `${category}-${language}`;

		const cached = cache.get(cacheKey);
		if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
			return json(cached.data);
		}

		const apiUrl = new URL('https://newsdata.io/api/1/news');
		apiUrl.searchParams.set('apikey', NEWDATA_API_KEY);
		apiUrl.searchParams.set('language', language);
		if (category !== 'all' && category !== 'top') apiUrl.searchParams.set('category', category);

		const response = await fetch(apiUrl.toString());
		if (!response.ok) {
			const errorText = await response.text();
			if (response.status === 429 && cached) {
				return json(cached.data, { headers: { 'X-Cache-Status': 'stale-due-to-rate-limit' } });
			}
			return json({ error: 'Failed to fetch news', status: response.status, message: errorText }, { status: response.status });
		}

		const data = await response.json();
		cache.set(cacheKey, { data, timestamp: Date.now() });
		if (cache.size > 50) cache.delete(Array.from(cache.keys())[0]);

		return json(data);
	} catch (error: any) {
		console.error('Error in newsdata API route:', error);
		return json({ error: 'Internal server error', message: error.message }, { status: 500 });
	}
};

