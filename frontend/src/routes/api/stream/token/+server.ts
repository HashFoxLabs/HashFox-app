import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import type { RequestHandler } from './$types';

// Avoid the `stream-chat` Node SDK here: it pulls axios + Node http internals
// that don't fully work on Cloudflare Workers (even with nodejs_compat) and
// makes `upsertUser` 500. We sign the JWT and upsert via fetch instead.

const b64url = (input: ArrayBuffer | Uint8Array | string): string => {
	const bytes =
		typeof input === 'string'
			? new TextEncoder().encode(input)
			: input instanceof Uint8Array
				? input
				: new Uint8Array(input);
	let bin = '';
	for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signStreamToken(userId: string, secret: string): Promise<string> {
	const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const payload = b64url(JSON.stringify({ user_id: userId }));
	const data = `${header}.${payload}`;
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
	return `${data}.${b64url(sig)}`;
}

export const POST: RequestHandler = async ({ request }) => {
	const apiKey = pubEnv.PUBLIC_STREAM_API_KEY;
	const apiSecret = env.STREAM_API_SECRET;
	if (!apiKey || !apiSecret) {
		return json({ error: 'Stream API keys not configured' }, { status: 500 });
	}

	const body = await request.json().catch(() => null);
	const userId = body?.userId as string | undefined;
	const username = (body?.username as string | undefined) || 'anon';
	const avatarUrl = (body?.avatarUrl as string | undefined) || undefined;
	if (!userId) return json({ error: 'Missing userId' }, { status: 400 });

	const safeId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

	let token: string;
	try {
		token = await signStreamToken(safeId, apiSecret);
	} catch (e) {
		return json(
			{ error: 'token sign failed', details: e instanceof Error ? e.message : 'unknown' },
			{ status: 500 }
		);
	}

	// Server-side upsert so the user has the right name/avatar before they connect.
	// Failure here is non-fatal — Stream will auto-create on first connectUser.
	try {
		const serverToken = await signStreamToken('!server', apiSecret);
		const upsertUrl = `https://chat.stream-io-api.com/users?api_key=${encodeURIComponent(apiKey)}`;
		await fetch(upsertUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Stream-Auth-Type': 'jwt',
				Authorization: serverToken
			},
			body: JSON.stringify({
				users: {
					[safeId]: { id: safeId, name: username, ...(avatarUrl ? { image: avatarUrl } : {}) }
				}
			})
		});
	} catch {
		// ignore — token is still valid
	}

	return json({ token, userId: safeId, apiKey });
};
