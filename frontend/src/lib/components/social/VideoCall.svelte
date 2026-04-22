<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { ConnectedSocialUser } from '$lib/social/types';

	export let connectedUser: ConnectedSocialUser;
	export let callId: string = 'hashfox-global';
	export let onClose: () => void = () => {};

	let client: any = null;
	let call: any = null;
	let participants: any[] = [];
	let connecting = true;
	let error: string | null = null;
	let micOn = true;
	let camOn = true;
	let leaving = false;
	let unsubParticipants: (() => void) | null = null;

	const safeUserId = connectedUser.userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

	async function init() {
		try {
			const res = await fetch('/api/stream/token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					userId: connectedUser.userId,
					username: connectedUser.username,
					avatarUrl: connectedUser.avatarUrl
				})
			});
			if (!res.ok) throw new Error(`token request failed: ${res.status}`);
			const { token, apiKey } = await res.json();
			if (!apiKey) throw new Error('Stream API key missing');

			const { StreamVideoClient } = await import('@stream-io/video-client');
			client = new StreamVideoClient({
				apiKey,
				user: {
					id: safeUserId,
					name: connectedUser.username,
					image: connectedUser.avatarUrl || undefined
				},
				token
			});

			call = client.call('default', callId);
			await call.join({ create: true });

			const sub = call.state.participants$.subscribe((list: any[]) => {
				participants = [...list];
			});
			unsubParticipants = () => sub.unsubscribe();

			try {
				await call.camera.enable();
			} catch (e) {
				camOn = false;
				console.warn('[VideoCall] camera enable failed', e);
			}
			try {
				await call.microphone.enable();
			} catch (e) {
				micOn = false;
				console.warn('[VideoCall] mic enable failed', e);
			}

			connecting = false;
		} catch (err: any) {
			console.warn('[VideoCall] init failed', err);
			error = err?.message || 'Failed to start call';
			connecting = false;
		}
	}

	async function toggleMic() {
		if (!call) return;
		try {
			if (micOn) await call.microphone.disable();
			else await call.microphone.enable();
			micOn = !micOn;
		} catch (e) {
			console.warn('[VideoCall] mic toggle failed', e);
		}
	}

	async function toggleCam() {
		if (!call) return;
		try {
			if (camOn) await call.camera.disable();
			else await call.camera.enable();
			camOn = !camOn;
		} catch (e) {
			console.warn('[VideoCall] cam toggle failed', e);
		}
	}

	async function hangup() {
		if (leaving) return;
		leaving = true;
		try {
			unsubParticipants?.();
			unsubParticipants = null;
			if (call) await call.leave();
		} catch (e) {
			console.warn('[VideoCall] leave failed', e);
		}
		try {
			if (client) await client.disconnectUser();
		} catch {
			/* ignore */
		}
		call = null;
		client = null;
		participants = [];
		onClose();
	}

	function attachVideo(el: HTMLVideoElement | null, stream: MediaStream | undefined) {
		if (!el) return;
		if (el.srcObject !== (stream ?? null)) {
			el.srcObject = stream ?? null;
		}
	}

	function attachAudio(el: HTMLAudioElement | null, stream: MediaStream | undefined) {
		if (!el) return;
		if (el.srcObject !== (stream ?? null)) {
			el.srcObject = stream ?? null;
		}
	}

	init();

	onDestroy(() => {
		hangup();
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_interactive_supports_focus -->
<div
	class="vc-backdrop"
	on:click|self={hangup}
	role="dialog"
	aria-modal="true"
	tabindex="-1"
>
	<div class="vc-shell">
		<div class="vc-head">
			<div class="vc-left">
				<span class="dot live"></span>
				<span class="title">VIDEO CALL</span>
				<span class="sub">{participants.length} in call</span>
			</div>
			<button class="icon-btn" on:click={hangup} aria-label="Close">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
				</svg>
			</button>
		</div>

		<div class="vc-body">
			{#if connecting}
				<div class="state">Connecting…</div>
			{:else if error}
				<div class="state err">{error}</div>
			{:else if participants.length === 0}
				<div class="state">Waiting for participants…</div>
			{:else}
				<div class="grid" style="--n: {participants.length}">
					{#each participants as p (p.sessionId)}
						{@const name = p.name || p.userId || 'anon'}
						{@const hasVideo = !!p.videoStream}
						<div class="tile" class:local={p.isLocalParticipant}>
							{#if hasVideo}
								<!-- svelte-ignore a11y-media-has-caption -->
								<video
									autoplay
									playsinline
									muted={p.isLocalParticipant}
									use:attachVideo={p.videoStream}
								></video>
							{:else}
								<div class="avatar-fallback">
									{#if p.image}
										<img src={p.image} alt={name} />
									{:else}
										<span>{name[0]?.toUpperCase()}</span>
									{/if}
								</div>
							{/if}

							{#if !p.isLocalParticipant && p.audioStream}
								<!-- svelte-ignore a11y-media-has-caption -->
								<audio autoplay use:attachAudio={p.audioStream}></audio>
							{/if}

							<div class="tile-tag">
								<span>@{name}</span>
								{#if p.isLocalParticipant}<span class="you">you</span>{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<div class="vc-foot">
			<button
				class="ctrl"
				class:off={!micOn}
				on:click={toggleMic}
				disabled={connecting || !!error}
				title={micOn ? 'Mute mic' : 'Unmute mic'}
			>
				{#if micOn}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
						<path stroke-linecap="round" stroke-linejoin="round" d="M19 10v2a7 7 0 01-14 0v-2M12 19v4M8 23h8" />
					</svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M1 1l22 22M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6M17 16.95A7 7 0 015 12v-2m14 0v2a7.07 7.07 0 01-.11 1.23M12 19v4M8 23h8" />
					</svg>
				{/if}
			</button>
			<button
				class="ctrl"
				class:off={!camOn}
				on:click={toggleCam}
				disabled={connecting || !!error}
				title={camOn ? 'Turn off camera' : 'Turn on camera'}
			>
				{#if camOn}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M23 7l-7 5 7 5V7z" />
						<rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
					</svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
						<path stroke-linecap="round" stroke-linejoin="round" d="M1 1l22 22M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h1m4 0h6a2 2 0 012 2v3.34M23 7v10l-7-5 7-5z" />
					</svg>
				{/if}
			</button>
			<button class="ctrl hangup" on:click={hangup} title="Leave call">
				<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
					<path stroke-linecap="round" stroke-linejoin="round" d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 004.24.76 2 2 0 012 2V21a2 2 0 01-2 2A18 18 0 013 5a2 2 0 012-2h2.08a2 2 0 012 1.72 12.84 12.84 0 00.76 4.24 2 2 0 01-.45 2.11l-1.27 1.27" />
					<path stroke-linecap="round" stroke-linejoin="round" d="M23 1L1 23" />
				</svg>
			</button>
		</div>
	</div>
</div>

<style>
	.vc-backdrop {
		position: fixed; inset: 0;
		background: rgba(0, 0, 0, 0.72);
		backdrop-filter: blur(4px);
		display: flex; align-items: center; justify-content: center;
		z-index: 9999;
		padding: 24px;
	}
	.vc-shell {
		width: 100%; max-width: 980px;
		max-height: 90vh;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 14px;
		display: flex; flex-direction: column;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
		overflow: hidden;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
	}
	.vc-head {
		display: flex; justify-content: space-between; align-items: center;
		padding: 14px 18px;
		background: #0d0d0d;
		border-bottom: 1px solid #1f1f1f;
	}
	.vc-left { display: flex; align-items: center; gap: 10px; }
	.dot.live {
		width: 8px; height: 8px; border-radius: 50%;
		background: #ff3b3b; box-shadow: 0 0 8px rgba(255,59,59,0.7);
		animation: pulse 1.6s infinite;
	}
	@keyframes pulse { 0% { opacity: 1; } 50% { opacity: 0.4; } 100% { opacity: 1; } }
	.title {
		color: #fff; font-weight: 800; font-size: 13px;
		letter-spacing: 0.12em; font-family: 'Courier New', monospace;
	}
	.sub { color: #888; font-size: 11px; font-family: 'Courier New', monospace; }
	.icon-btn {
		background: transparent; border: none; color: #888;
		cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center;
	}
	.icon-btn:hover { color: #ff9500; }

	.vc-body {
		flex: 1; min-height: 0;
		background: #050505;
		overflow: hidden;
		display: flex; align-items: stretch; justify-content: center;
		padding: 14px;
	}
	.state {
		flex: 1; display: flex; align-items: center; justify-content: center;
		color: #777; font-family: 'Courier New', monospace; font-size: 12px;
	}
	.state.err { color: #ff6b6b; }

	.grid {
		display: grid; gap: 10px;
		width: 100%;
		grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	}
	.tile {
		position: relative;
		background: #0f0f0f;
		border: 1px solid #1f1f1f;
		border-radius: 10px;
		overflow: hidden;
		aspect-ratio: 16 / 9;
		display: flex; align-items: center; justify-content: center;
	}
	.tile.local { border-color: rgba(255, 149, 0, 0.45); }
	.tile video { width: 100%; height: 100%; object-fit: cover; background: #000; }
	.avatar-fallback {
		width: 72px; height: 72px; border-radius: 50%;
		background: rgba(255, 149, 0, 0.15);
		color: #ff9500;
		display: flex; align-items: center; justify-content: center;
		font-family: 'Courier New', monospace; font-size: 28px; font-weight: 800;
		overflow: hidden;
	}
	.avatar-fallback img { width: 100%; height: 100%; object-fit: cover; }
	.tile-tag {
		position: absolute; bottom: 8px; left: 8px;
		display: flex; gap: 6px; align-items: center;
		padding: 3px 8px;
		background: rgba(0, 0, 0, 0.6);
		border-radius: 999px;
		color: #fff; font-size: 11px; font-family: 'Courier New', monospace;
	}
	.tile-tag .you {
		color: #ff9500; font-size: 10px; letter-spacing: 0.05em;
	}

	.vc-foot {
		display: flex; justify-content: center; gap: 10px;
		padding: 14px;
		background: #0d0d0d;
		border-top: 1px solid #1f1f1f;
	}
	.ctrl {
		width: 44px; height: 44px;
		display: flex; align-items: center; justify-content: center;
		background: rgba(255, 255, 255, 0.06);
		border: 1px solid #2a2a2a;
		border-radius: 50%;
		color: #e8e8e8;
		cursor: pointer;
		transition: all 0.15s;
	}
	.ctrl:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
	.ctrl:disabled { opacity: 0.4; cursor: not-allowed; }
	.ctrl.off {
		background: rgba(255, 107, 107, 0.12);
		border-color: rgba(255, 107, 107, 0.5);
		color: #ff6b6b;
	}
	.ctrl.hangup {
		background: rgba(255, 59, 59, 0.16);
		border-color: rgba(255, 59, 59, 0.55);
		color: #ff6b6b;
	}
	.ctrl.hangup:hover { background: rgba(255, 59, 59, 0.28); }
</style>
