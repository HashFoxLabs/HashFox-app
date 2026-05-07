<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { onMount } from 'svelte';
	export let show = false;
	export let walletAddress = '';
	export let username: string | null = null;
	export let avatarUrl: string | null = null;
	export let bannerUrl: string | null = null;

	const dispatch = createEventDispatcher();

	function close() {
		show = false;
		dispatch('close');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}

	function fmtAddress(addr: string) {
		if (!addr) return '';
		return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
	}

	$: displayName = username || 'Anonymous';

	let dialogEl: HTMLDivElement | null = null;
	onMount(() => {
		if (show) dialogEl?.focus();
	});
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
	<div
		class="modal-backdrop"
		role="button"
		tabindex="0"
		aria-label="Close profile"
		on:click={close}
		on:keydown={(e) => e.key === 'Enter' && close()}
	>
		<div
			class="modal-content"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			bind:this={dialogEl}
			on:click|stopPropagation
			on:keydown|stopPropagation
		>
			<div class="modal-header">
				<div class="header-left">
					<span class="header-dot"></span>
					<h3>PROFILE</h3>
				</div>
				<button class="close-button" on:click={close} aria-label="Close">×</button>
			</div>

			<div class="modal-body">
				<div class="hero">
					{#if bannerUrl}
						<div class="banner">
							<img src={bannerUrl} alt="" referrerpolicy="no-referrer" />
						</div>
					{:else}
						<div class="banner banner-fallback"></div>
					{/if}

					<div class="identity">
						<div class="avatar">
							{#if avatarUrl}
								<img src={avatarUrl} alt="profile" referrerpolicy="no-referrer" />
							{:else}
								<div class="avatar-fallback">{(displayName[0] || '?').toUpperCase()}</div>
							{/if}
						</div>
						<div class="meta">
							<div class="name">{displayName}</div>
							<div class="addr">{fmtAddress(walletAddress)}</div>
						</div>
					</div>
				</div>

				<div class="section">
					<div class="section-title">ACCOUNT</div>
					<div class="row">
						<span class="label">Wallet</span>
						<span class="value mono">{walletAddress}</span>
					</div>
					<div class="row">
						<span class="label">Username</span>
						<span class="value">{displayName}</span>
					</div>
				</div>
			</div>

			<div class="modal-footer">
				<span class="footer-dim">HASHFOX · PROFILE</span>
			</div>
		</div>
	</div>
{/if}

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.78);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 10000;
		padding: 20px;
	}
	.modal-content {
		background: #0a0a0a;
		border: 1px solid #333;
		border-radius: 4px;
		width: 100%;
		max-width: 520px;
		max-height: 90vh;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 90, 0, 0.06) inset;
		font-family: 'Courier New', monospace;
	}
	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid #222;
		background: #000;
	}
	.header-left {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.header-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: #ff5a00;
		box-shadow: 0 0 10px rgba(255, 90, 0, 0.7);
	}
	.modal-header h3 {
		margin: 0;
		color: #ff5a00;
		font-size: 12px;
		font-weight: bold;
		letter-spacing: 0.25em;
	}
	.close-button {
		background: none;
		border: 1px solid #333;
		color: #888;
		font-size: 14px;
		cursor: pointer;
		width: 24px;
		height: 24px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 3px;
		transition: all 0.15s ease;
	}
	.close-button:hover {
		color: #ff5a00;
		border-color: #ff5a00;
	}
	.modal-body {
		padding: 16px;
		color: #e8e8e8;
	}
	.hero {
		border: 1px solid #222;
		border-radius: 4px;
		overflow: hidden;
		background: #000;
	}
	.banner {
		height: 92px;
		background: #060606;
		border-bottom: 1px solid #222;
	}
	.banner img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.banner-fallback {
		background: radial-gradient(circle at 30% 30%, rgba(255, 90, 0, 0.25), transparent 55%),
			linear-gradient(180deg, #080808 0%, #000 100%);
	}
	.identity {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px;
	}
	.avatar {
		width: 44px;
		height: 44px;
		border-radius: 50%;
		overflow: hidden;
		border: 1px solid #333;
		background: #0a0a0a;
		flex-shrink: 0;
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.avatar-fallback {
		width: 100%;
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #ff5a00;
		color: #000;
		font-size: 16px;
		font-weight: bold;
	}
	.meta { min-width: 0; }
	.name {
		color: #ff5a00;
		font-weight: bold;
		letter-spacing: 0.04em;
		font-size: 12px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 360px;
	}
	.addr {
		color: #777;
		font-size: 10px;
		letter-spacing: 0.14em;
		margin-top: 2px;
	}
	.section {
		margin-top: 14px;
		border: 1px solid #222;
		border-radius: 4px;
		background: #0a0a0a;
		padding: 12px;
	}
	.section-title {
		color: #666;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.2em;
		margin-bottom: 10px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
		border-top: 1px solid #151515;
	}
	.row:first-of-type { border-top: none; }
	.label { color: #777; font-size: 11px; }
	.value { color: #e8e8e8; font-size: 11px; text-align: right; min-width: 0; }
	.value.mono { font-family: 'Courier New', monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.modal-footer {
		padding: 10px 16px;
		border-top: 1px solid #222;
		background: #000;
		display: flex;
		justify-content: flex-end;
	}
	.footer-dim {
		color: #444;
		font-size: 10px;
		letter-spacing: 0.2em;
	}
</style>
