import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { StreamChat } from 'stream-chat';
import type { RequestHandler } from './$types';

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

	const server = StreamChat.getInstance(apiKey, apiSecret);
	await server.upsertUser({ id: safeId, name: username, image: avatarUrl });
	const token = server.createToken(safeId);

	return json({ token, userId: safeId, apiKey });
};
