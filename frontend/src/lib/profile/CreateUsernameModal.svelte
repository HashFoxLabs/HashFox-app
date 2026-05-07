<script lang="ts">
	import { onMount } from 'svelte';
	import { upsertUsername, isUsernameAvailable } from '$lib/supabase';

	export let walletAddress: string;
	export let defaultName: string | null = null;
	export let onSave: (username: string) => void = () => {};
	export let onDismiss: () => void = () => {};

	const MIN = 3;
	const MAX = 20;
	const PATTERN = /^[a-zA-Z0-9_]+$/;

	function sanitizeSuggestion(name: string | null): string {
		if (!name) return '';
		return name.normalize('NFKD').replace(/[^a-zA-Z0-9_]/g, '').slice(0, MAX);
	}

	let draft = sanitizeSuggestion(defaultName);
	let saving = false;
	let error: string | null = null;
	let checking = false;
	let checkedAvailable: boolean | null = null;
	let inputEl: HTMLInputElement | null = null;

	let checkToken = 0;

	$: clientError = (() => {
		const v = draft.trim();
		if (!v) return null;
		if (v.length < MIN) return `At least ${MIN} characters`;
		if (v.length > MAX) return `Max ${MAX} characters`;
		if (!PATTERN.test(v)) return 'Letters, numbers, underscore only';
		return null;
	})();

	$: canSubmit =
		!saving &&
		!checking &&
		draft.trim().length >= MIN &&
		draft.trim().length <= MAX &&
		PATTERN.test(draft.trim()) &&
		checkedAvailable === true;

	$: debouncedCheck(draft);

	async function debouncedCheck(value: string) {
		const v = value.trim();
		checkedAvailable = null;
		error = null;
		if (!v || clientError) {
			checking = false;
			return;
		}
		const myToken = ++checkToken;
		checking = true;
		await new Promise((r) => setTimeout(r, 300));
		if (myToken !== checkToken) return;
		try {
			const avail = await isUsernameAvailable(v, walletAddress);
			if (myToken !== checkToken) return;
			checkedAvailable = avail;
			if (!avail) error = 'Username already taken';
		} catch {
			if (myToken !== checkToken) return;
			checkedAvailable = null;
		} finally {
			if (myToken === checkToken) checking = false;
		}
	}

	async function submit() {
		if (!canSubmit) return;
		const v = draft.trim();
		saving = true;
		error = null;
		try {
			const res = await upsertUsername(walletAddress, v);
			if (res.ok) {
				onSave(v);
			} else {
				error = res.error;
				checkedAvailable = false;
			}
		} catch (err: any) {
			error = err?.message || 'Failed to save';
		} finally {
			saving = false;
		}
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && canSubmit) {
			e.preventDefault();
			submit();
		} else if (e.key === 'Escape') {
			onDismiss();
		}
	}

	onMount(() => {
		setTimeout(() => inputEl?.focus(), 40);
	});
</script>

<div
	class="cu-overlay"
	role="dialog"
	aria-modal="true"
	aria-label="Create username"
	tabindex="-1"
	on:keydown={onKeydown}
>
	<div class="cu-modal" role="document" on:click|stopPropagation on:keydown|stopPropagation>
		<div class="cu-head">
			<div class="cu-head-left">
				<span class="cu-dot"></span>
				<h3 class="cu-title">CHOOSE USERNAME</h3>
			</div>
			<span class="cu-badge">REQUIRED</span>
		</div>

		<div class="cu-body">
			<p class="cu-desc">
				Pick a username so other traders can find you in the feed, chat, and leaderboard.
				You can change it later from your profile.
			</p>

			<div class="cu-field">
				<div class="cu-input-row" class:err={!!(clientError || error) && draft.length > 0} class:ok={checkedAvailable === true}>
					<span class="cu-at">@</span>
					<input
						bind:this={inputEl}
						bind:value={draft}
						type="text"
						maxlength={MAX}
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
						placeholder="trader_01"
						disabled={saving}
					/>
					{#if checking}
						<span class="cu-status muted">checking…</span>
					{:else if checkedAvailable === true}
						<span class="cu-status ok">available</span>
					{:else if error || clientError}
						<span class="cu-status err">×</span>
					{/if}
				</div>
				<p class="cu-hint" class:err={!!(clientError || error)}>
					{#if error}
						{error}
					{:else if clientError}
						{clientError}
					{:else}
						{MIN}–{MAX} chars · letters, numbers, underscore
					{/if}
				</p>
			</div>

			<div class="cu-actions">
				<button type="button" class="cu-btn-secondary" disabled={saving} on:click={onDismiss}>
					LATER
				</button>
				<button type="button" class="cu-btn-primary" disabled={!canSubmit} on:click={submit}>
					{saving ? 'SAVING…' : 'CONFIRM'}
				</button>
			</div>
		</div>

		<div class="cu-foot">
			<span class="cu-foot-dim">HASHFOX · PROFILE</span>
		</div>
	</div>
</div>

<style>
	.cu-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.82);
		backdrop-filter: blur(6px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10001;
		padding: 20px;
		animation: cuFade 0.18s ease-out;
	}
	@keyframes cuFade {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	.cu-modal {
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		width: 100%;
		max-width: 440px;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 90, 0, 0.06) inset;
		font-family: 'Courier New', monospace;
		display: flex;
		flex-direction: column;
		animation: cuSlide 0.22s ease-out;
	}
	@keyframes cuSlide {
		from { opacity: 0; transform: translateY(10px); }
		to { opacity: 1; transform: translateY(0); }
	}

	.cu-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid #222;
		background: #000;
	}
	.cu-head-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.cu-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ff5a00;
		box-shadow: 0 0 10px rgba(255, 90, 0, 0.7);
	}
	.cu-title {
		margin: 0;
		color: #ff5a00;
		font-size: 12px;
		font-weight: bold;
		letter-spacing: 0.25em;
	}
	.cu-badge {
		font-size: 9px;
		font-weight: bold;
		letter-spacing: 0.18em;
		color: #000;
		background: #ff5a00;
		padding: 3px 8px;
		border-radius: 3px;
	}

	.cu-body {
		padding: 18px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.cu-desc {
		color: #aaa;
		font-size: 12px;
		line-height: 1.6;
		margin: 0;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
	}

	.cu-field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.cu-input-row {
		display: flex;
		align-items: center;
		gap: 8px;
		background: #000;
		border: 1px solid #333;
		border-radius: 3px;
		padding: 8px 12px;
		transition: border-color 0.12s ease;
	}
	.cu-input-row:focus-within { border-color: #ff5a00; }
	.cu-input-row.err { border-color: #ff6b6b; }
	.cu-input-row.ok { border-color: #00ff66; }

	.cu-at {
		color: #666;
		font-size: 14px;
		font-weight: bold;
		letter-spacing: 0.04em;
	}
	.cu-input-row input {
		flex: 1;
		background: transparent;
		border: none;
		outline: none;
		color: #ff5a00;
		font-size: 15px;
		font-weight: bold;
		font-family: inherit;
		letter-spacing: 0.03em;
		padding: 2px 0;
		min-width: 0;
	}
	.cu-input-row input::placeholder { color: #444; }
	.cu-input-row input:disabled { opacity: 0.5; }

	.cu-status {
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.1em;
		flex-shrink: 0;
	}
	.cu-status.muted { color: #666; }
	.cu-status.ok { color: #00ff66; }
	.cu-status.err { color: #ff6b6b; font-size: 14px; line-height: 1; }

	.cu-hint {
		margin: 0;
		font-size: 10px;
		color: #666;
		letter-spacing: 0.05em;
	}
	.cu-hint.err { color: #ff6b6b; }

	.cu-actions {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}
	.cu-btn-primary,
	.cu-btn-secondary {
		flex: 1;
		padding: 11px 14px;
		border-radius: 3px;
		font-size: 11px;
		font-weight: bold;
		font-family: inherit;
		letter-spacing: 0.18em;
		cursor: pointer;
		border: 1px solid transparent;
		transition: all 0.15s ease;
	}
	.cu-btn-primary {
		background: #ff5a00;
		color: #000;
		border-color: #ff5a00;
	}
	.cu-btn-primary:hover:not(:disabled) {
		background: #ffb733;
		border-color: #ffb733;
		box-shadow: 0 0 12px rgba(255, 90, 0, 0.4);
	}
	.cu-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

	.cu-btn-secondary {
		background: #000;
		color: #888;
		border-color: #333;
	}
	.cu-btn-secondary:hover:not(:disabled) { color: #fff; border-color: #555; }
	.cu-btn-secondary:disabled { opacity: 0.5; cursor: not-allowed; }

	.cu-foot {
		padding: 8px 16px;
		border-top: 1px solid #222;
		background: #000;
	}
	.cu-foot-dim {
		font-size: 9px;
		color: #444;
		letter-spacing: 0.2em;
	}
</style>
