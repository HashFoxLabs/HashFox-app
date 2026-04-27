<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import type { ConnectedSocialUser, FeedUserProfile } from '$lib/social/types';
	import VideoCall from './VideoCall.svelte';

	export let connectedUser: ConnectedSocialUser | null = null;
	export let profiles: FeedUserProfile[] = [];
	export let embedded: boolean = false;
	export let onClose: () => void = () => {};
	export let onExpand: (() => void) | null = null;

	const CHANNEL_ID = 'hashfox-global';
	let videoCallOpen = false;

	let client: any = null;
	let channel: any = null;
	let messages: any[] = [];
	let draft = '';
	let connecting = true;
	let error: string | null = null;
	let listEl: HTMLDivElement | null = null;
	let inputEl: HTMLInputElement | null = null;
	let sending = false;
	let onlineCount = 0;

	let replyTo: any = null;
	let editingId: string | null = null;
	let editText = '';

	$: messageById = (() => {
		const map = new Map<string, any>();
		for (const m of messages) if (m?.id) map.set(m.id, m);
		return map;
	})();

	$: pnlByUsername = (() => {
		const map = new Map<string, number>();
		for (const p of profiles) map.set(p.username, p.totalPnl);
		return map;
	})();

	function pnlClass(p: number | undefined) {
		if (p == null) return '';
		return p >= 0 ? 'up' : 'down';
	}
	function fmtPnl(p: number | undefined) {
		if (p == null) return null;
		return `${p >= 0 ? '+' : ''}${p.toFixed(1)}%`;
	}

	function fmtTime(d: Date | string | undefined) {
		if (!d) return '';
		const date = typeof d === 'string' ? new Date(d) : d;
		return date.toLocaleTimeString('en-US', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false
		});
	}

	async function scrollToBottom() {
		await tick();
		if (listEl) listEl.scrollTop = listEl.scrollHeight;
	}

	let initializedFor: string | null = null;

	async function teardown() {
		try {
			if (channel) await channel.stopWatching();
		} catch {
			/* ignore */
		}
		try {
			if (client) await client.disconnectUser();
		} catch {
			/* ignore */
		}
		channel = null;
		client = null;
		messages = [];
		onlineCount = 0;
		initializedFor = null;
	}

	async function init() {
		try {
			if (!connectedUser) {
				connecting = false;
				return;
			}
			const cu = connectedUser;
			const res = await fetch('/api/stream/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: cu.userId,
					username: cu.username,
					avatarUrl: cu.avatarUrl
				})
			});
			if (!res.ok) throw new Error(`token request failed: ${res.status}`);
			const { token, userId, apiKey } = await res.json();
			if (!apiKey) throw new Error('Stream API key missing on server');

			const { StreamChat } = await import('stream-chat');
			client = StreamChat.getInstance(apiKey);
			await client.connectUser(
				{ id: userId, name: cu.username, image: cu.avatarUrl || undefined },
				token
			);

			channel = client.channel('livestream', CHANNEL_ID, {
				name: 'HashFox Live'
			} as any);
			await channel.watch({ presence: true } as any);

			messages = [...(channel.state.messages as any[])];
			onlineCount = channel.state.watcher_count || 0;

			channel.on('message.new', (e: any) => {
				if (e.message) {
					messages = [...messages, e.message];
					scrollToBottom();
				}
			});
			channel.on('message.deleted', (e: any) => {
				if (e.message?.id) {
					messages = messages.filter((m) => m.id !== e.message.id);
				}
			});
			channel.on('message.updated', (e: any) => {
				if (e.message?.id) {
					messages = messages.map((m) => (m.id === e.message.id ? e.message : m));
				}
			});
			channel.on('user.watching.start', () => {
				onlineCount = channel.state.watcher_count || onlineCount + 1;
			});
			channel.on('user.watching.stop', () => {
				onlineCount = channel.state.watcher_count || Math.max(0, onlineCount - 1);
			});

			connecting = false;
			scrollToBottom();
		} catch (err: any) {
			console.warn('[LiveChat] init failed', err);
			error = err?.message || 'Failed to connect to chat';
			connecting = false;
		}
	}

	async function send() {
		const text = draft.trim();
		if (!text || !channel || sending) return;
		sending = true;
		try {
			const payload: any = { text };
			if (replyTo?.id) {
				payload.parent_id = replyTo.id;
				payload.show_in_channel = true;
			}
			await channel.sendMessage(payload);
			draft = '';
			replyTo = null;
		} catch (err) {
			console.warn('[LiveChat] send failed', err);
		} finally {
			sending = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			if (replyTo) replyTo = null;
			return;
		}
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send();
		}
	}

	function startReply(m: any) {
		replyTo = m;
		editingId = null;
		setTimeout(() => inputEl?.focus(), 0);
	}

	function cancelReply() {
		replyTo = null;
	}

	function startEdit(m: any) {
		editingId = m.id;
		editText = m.text || '';
		replyTo = null;
	}

	function cancelEdit() {
		editingId = null;
		editText = '';
	}

	async function saveEdit(m: any) {
		const next = editText.trim();
		if (!next || !client) return;
		const prev = m.text;
		messages = messages.map((it) => (it.id === m.id ? { ...it, text: next } : it));
		editingId = null;
		editText = '';
		try {
			await client.partialUpdateMessage(m.id, { set: { text: next } });
		} catch (err) {
			console.warn('[LiveChat] edit failed', err);
			messages = messages.map((it) => (it.id === m.id ? { ...it, text: prev } : it));
		}
	}

	function onEditKeydown(e: KeyboardEvent, m: any) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			saveEdit(m);
		} else if (e.key === 'Escape') {
			cancelEdit();
		}
	}

	async function deleteMsg(m: any) {
		if (!client) return;
		const id = m.id;
		messages = messages.filter((it) => it.id !== id);
		try {
			await client.deleteMessage(id);
		} catch (err) {
			console.warn('[LiveChat] delete failed', err);
		}
	}

	$: void maybeInit(connectedUser);

	async function maybeInit(user: ConnectedSocialUser | null) {
		if (!user) {
			if (initializedFor) await teardown();
			error = 'Connect your wallet to join the chat';
			connecting = false;
			return;
		}
		if (initializedFor === user.userId) return;
		if (initializedFor) await teardown();
		initializedFor = user.userId;
		error = null;
		connecting = true;
		await init();
	}

	onDestroy(() => {
		teardown();
	});

	function isOwn(m: any) {
		return connectedUser && m?.user?.id && m.user.id === connectedUser.userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
	}
</script>

<div class="chat-shell" class:embedded>
	<div class="chat-head-wrap">
		<div class="chat-head" class:embedded>
			<div class="head-left">
				<span class="dot live"></span>
				<span class="title">LIVE CHAT</span>
				<span class="online">{onlineCount} online</span>
			</div>
			<div class="head-actions">
				{#if connectedUser && !error}
					<button
						class="icon-btn video-btn"
						on:click={() => (videoCallOpen = true)}
						aria-label="Start video call"
						title="Start video call"
						disabled={connecting}
					>
						<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M23 7l-7 5 7 5V7z" />
							<rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
						</svg>
					</button>
				{/if}
				{#if embedded && onExpand}
					<button class="icon-btn" on:click={onExpand} aria-label="Expand chat" title="Expand">
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4" />
						</svg>
					</button>
				{/if}
				{#if !embedded}
					<button class="icon-btn" on:click={onClose} aria-label="Close chat">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				{/if}
			</div>
		</div>
	</div>

	<div class="chat-body" class:embedded bind:this={listEl}>
		{#if connecting}
			<div class="state">Connecting…</div>
		{:else if error}
			<div class="state err">{error}</div>
		{:else if messages.length === 0}
			<div class="state">No messages yet. Say hi 👋</div>
		{:else}
			{#each messages as m (m.id)}
				{@const own = isOwn(m)}
				{@const username = m.user?.name || m.user?.id || 'anon'}
				{@const avatar = m.user?.image}
				{@const pnl = pnlByUsername.get(username)}
				{@const parent = m.parent_id ? messageById.get(m.parent_id) : null}
				<div class="msg" class:own>
					{#if avatar}
						<img class="m-avatar" src={avatar} alt={username} />
					{:else}
						<div class="m-avatar fallback" class:own>{username[0]?.toUpperCase()}</div>
					{/if}
					<div class="m-body">
						<div class="m-head">
							<span class="m-user">@{username}</span>
							{#if pnl != null}
								<span class="pnl-badge {pnlClass(pnl)}">{fmtPnl(pnl)}</span>
							{/if}
							<span class="m-time">{fmtTime(m.created_at)}</span>
							{#if m.message_text_updated_at && m.message_text_updated_at !== m.created_at}
								<span class="edited">(edited)</span>
							{/if}
						</div>
						{#if parent}
							<div class="quote">
								<span class="q-bar"></span>
								<div class="q-body">
									<span class="q-user">@{parent.user?.name || parent.user?.id || 'anon'}</span>
									<span class="q-text">{parent.text}</span>
								</div>
							</div>
						{/if}
						{#if editingId === m.id}
							<div class="edit-row">
								<input
									type="text"
									bind:value={editText}
									on:keydown={(e) => onEditKeydown(e, m)}
								/>
								<button class="ok" on:click={() => saveEdit(m)}>Save</button>
								<button class="cancel" on:click={cancelEdit}>Cancel</button>
							</div>
						{:else}
							<p class="m-text">{m.text}</p>
						{/if}
					</div>
					<div class="m-actions">
						<button title="Reply" on:click={() => startReply(m)}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h12a5 5 0 015 5v0a5 5 0 01-5 5h-3M3 10l4-4M3 10l4 4" />
							</svg>
						</button>
						{#if own}
							<button title="Edit" on:click={() => startEdit(m)}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
								</svg>
							</button>
							<button title="Delete" class="del" on:click={() => deleteMsg(m)}>
								<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
							</svg>
							</button>
						{/if}
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<div class="chat-foot-wrap">
		{#if replyTo}
			<div class="reply-bar-wrap">
				<div class="reply-bar" class:embedded>
					<div class="rb-left">
						<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M3 10h12a5 5 0 015 5v0a5 5 0 01-5 5h-3M3 10l4-4M3 10l4 4" />
						</svg>
						<span class="rb-label">Replying to</span>
						<span class="rb-user">@{replyTo.user?.name || replyTo.user?.id || 'anon'}</span>
						<span class="rb-text">{replyTo.text}</span>
					</div>
					<button class="rb-close" on:click={cancelReply} aria-label="Cancel reply">
						<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
						</svg>
					</button>
				</div>
			</div>
		{/if}
		<div class="chat-foot" class:embedded>
			{#if connectedUser}
				<input
					type="text"
					placeholder={connecting ? 'Connecting…' : replyTo ? `Reply to @${replyTo.user?.name || 'anon'}…` : 'Type a message…'}
					bind:this={inputEl}
					bind:value={draft}
					on:keydown={onKeydown}
					disabled={connecting || !!error}
				/>
				<button on:click={send} disabled={!draft.trim() || connecting || sending || !!error}>
					Send
				</button>
			{:else}
				<div class="connect-prompt">Connect your wallet to chat</div>
			{/if}
		</div>
	</div>
</div>

{#if videoCallOpen && connectedUser}
	<VideoCall
		{connectedUser}
		callId={CHANNEL_ID}
		onClose={() => (videoCallOpen = false)}
	/>
{/if}

<style>
	.chat-shell {
		display: flex; flex-direction: column;
		width: 100%; height: 100%;
		min-height: 0;
		background: #0a0a0a;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		overflow: hidden;
	}
	.chat-shell.embedded {
		border: 1px solid #222;
		border-radius: 12px;
	}

	.chat-head-wrap {
		flex: 0 0 auto;
		border-bottom: 1px solid #1f1f1f;
		background: #0d0d0d;
	}
	.chat-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 16px 24px;
		max-width: 900px; width: 100%;
		margin: 0 auto;
	}
	.chat-head.embedded { padding: 12px 14px; max-width: none; }
	.head-left { display: flex; align-items: center; gap: 10px; }
	.head-actions { display: flex; gap: 4px; align-items: center; }

	.dot.live {
		width: 8px; height: 8px; border-radius: 50%;
		background: #ff3b3b;
		box-shadow: 0 0 8px rgba(255,59,59,0.7);
		animation: pulse 1.6s infinite;
	}
	@keyframes pulse {
		0% { opacity: 1; }
		50% { opacity: 0.4; }
		100% { opacity: 1; }
	}
	.title {
		color: #fff; font-weight: 800; font-size: 13px;
		letter-spacing: 0.12em; font-family: 'Courier New', monospace;
	}
	.online { color: #888; font-size: 11px; font-family: 'Courier New', monospace; }
	.icon-btn {
		background: transparent; border: none; color: #888;
		cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;
	}
	.icon-btn:hover { color: #ff5a00; }
	.icon-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.icon-btn.video-btn:hover:not(:disabled) { color: #00ff66; }

	.chat-body {
		flex: 1 1 0;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 18px 24px;
		display: flex; flex-direction: column; gap: 14px;
		background: #050505;
		max-width: 900px; width: 100%;
		margin: 0 auto;
	}
	.chat-body.embedded { padding: 14px 12px; max-width: none; gap: 10px; }
	.chat-body::-webkit-scrollbar { width: 6px; }
	.chat-body::-webkit-scrollbar-thumb { background: #2a2a2a; border-radius: 3px; }

	.state {
		text-align: center; color: #777; font-size: 12px;
		font-family: 'Courier New', monospace; padding: 24px 0;
	}
	.state.err { color: #ff6b6b; }

	.msg {
		display: flex; gap: 12px; align-items: flex-start;
		position: relative;
		padding: 4px 6px;
		border-radius: 8px;
	}
	.msg:hover { background: rgba(255,255,255,0.02); }
	.msg:hover .m-actions { opacity: 1; pointer-events: auto; }
	.m-avatar {
		width: 36px; height: 36px; border-radius: 50%;
		object-fit: cover; flex-shrink: 0;
		border: 1px solid #2a2a2a;
	}
	.m-avatar.fallback {
		display: flex; align-items: center; justify-content: center;
		background: rgba(255, 90, 0,0.15); color: #ff5a00;
		font-family: 'Courier New', monospace; font-weight: 800; font-size: 13px;
	}
	.m-avatar.fallback.own {
		background: rgba(0,255,102,0.15); color: #00ff66;
	}
	.m-body { flex: 1; min-width: 0; }
	.m-head {
		display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
		margin-bottom: 3px;
	}
	.m-user { color: #fff; font-weight: 700; font-size: 13px; }
	.m-time { color: #666; font-size: 11px; font-family: 'Courier New', monospace; }
	.pnl-badge {
		padding: 1px 7px; border-radius: 999px;
		font-size: 9px; font-weight: 800; letter-spacing: 0.04em;
		font-family: 'Courier New', monospace;
		border: 1px solid #2a2a2a;
		background: rgba(255,255,255,0.04); color: #888;
	}
	.pnl-badge.up { color: #00ff66; border-color: rgba(0,255,102,0.35); background: rgba(0,255,102,0.08); }
	.pnl-badge.down { color: #ff6b6b; border-color: rgba(255,107,107,0.35); background: rgba(255,107,107,0.08); }
	.m-text {
		color: #e8e8e8; font-size: 14px; line-height: 1.5;
		margin: 0;
		word-wrap: break-word; word-break: break-word;
	}
	.edited { color: #555; font-size: 10px; font-family: 'Courier New', monospace; }

	.quote { display: flex; gap: 8px; align-items: stretch; padding: 4px 0 6px; }
	.q-bar { width: 2px; background: #2a2a2a; border-radius: 2px; flex-shrink: 0; }
	.q-body { display: flex; gap: 8px; align-items: baseline; min-width: 0; overflow: hidden; }
	.q-user { color: #ff5a00; font-size: 11px; font-weight: 700; flex-shrink: 0; }
	.q-text { color: #888; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

	.m-actions {
		display: flex; gap: 2px;
		opacity: 0; pointer-events: none;
		transition: opacity 0.12s;
		position: absolute; top: -10px; right: 8px;
		background: #111; border: 1px solid #2a2a2a; border-radius: 8px;
		padding: 2px;
		box-shadow: 0 4px 14px rgba(0,0,0,0.5);
	}
	.m-actions button {
		display: flex; align-items: center; justify-content: center;
		width: 26px; height: 26px;
		background: transparent; border: none; color: #888;
		cursor: pointer; border-radius: 6px;
	}
	.m-actions button:hover { color: #ff5a00; background: rgba(255,255,255,0.04); }
	.m-actions button.del:hover { color: #ff6b6b; }

	.edit-row { display: flex; gap: 6px; margin-top: 2px; }
	.edit-row input {
		flex: 1;
		background: rgba(255,255,255,0.04);
		border: 1px solid rgba(255, 90, 0,0.5);
		padding: 7px 12px; border-radius: 8px;
		color: #fff; font-size: 13px;
		font-family: inherit;
	}
	.edit-row input:focus { outline: none; border-color: #ff5a00; }
	.edit-row .ok, .edit-row .cancel {
		background: transparent; border: none; cursor: pointer;
		font-size: 11px; font-weight: 700;
		font-family: 'Courier New', monospace;
		padding: 0 8px;
	}
	.edit-row .ok { color: #00ff66; }
	.edit-row .cancel { color: #888; }

	.reply-bar-wrap {
		border-top: 1px solid #1f1f1f;
		background: #0d0d0d;
	}
	.reply-bar {
		display: flex; justify-content: space-between; align-items: center;
		gap: 12px;
		padding: 8px 24px;
		max-width: 900px; width: 100%;
		margin: 0 auto;
	}
	.reply-bar.embedded { padding: 7px 12px; max-width: none; }
	.rb-left { display: flex; gap: 6px; align-items: center; min-width: 0; flex: 1; color: #ff5a00; }
	.rb-label { font-family: 'Courier New', monospace; font-size: 11px; color: #888; letter-spacing: 0.05em; }
	.rb-user { color: #ff5a00; font-weight: 700; font-size: 12px; }
	.rb-text { color: #888; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
	.rb-close { background: transparent; border: none; color: #666; cursor: pointer; flex-shrink: 0; padding: 2px; }
	.rb-close:hover { color: #fff; }

	.chat-foot-wrap {
		flex: 0 0 auto;
		border-top: 1px solid #1f1f1f;
		background: #0d0d0d;
	}
	.chat-foot {
		display: flex; gap: 8px;
		padding: 14px 24px;
		max-width: 900px; width: 100%;
		margin: 0 auto;
	}
	.chat-foot.embedded { padding: 10px 12px; max-width: none; }
	.chat-foot input {
		flex: 1;
		background: rgba(255,255,255,0.04);
		border: 1px solid #2a2a2a; border-radius: 10px;
		color: #fff; font-size: 13px;
		padding: 10px 14px;
		font-family: inherit;
	}
	.chat-foot input::placeholder { color: #666; }
	.chat-foot input:focus { outline: none; border-color: rgba(255, 90, 0,0.5); }
	.chat-foot input:disabled { opacity: 0.5; cursor: not-allowed; }
	.chat-foot button {
		background: rgba(255, 90, 0,0.12); color: #ff5a00;
		border: 1px solid rgba(255, 90, 0,0.4);
		padding: 10px 18px; border-radius: 10px;
		font-weight: 700; font-size: 12px;
		font-family: 'Courier New', monospace; letter-spacing: 0.06em;
		cursor: pointer; transition: all 0.15s;
	}
	.chat-foot button:hover:not(:disabled) { background: rgba(255, 90, 0,0.2); }
	.chat-foot button:disabled { opacity: 0.4; cursor: not-allowed; }
	.connect-prompt {
		flex: 1; text-align: center; color: #888;
		font-family: 'Courier New', monospace; font-size: 12px;
		padding: 8px 0;
	}
</style>
