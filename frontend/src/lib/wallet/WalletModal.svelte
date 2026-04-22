<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import type { Adapter } from '@solana/wallet-adapter-base';
	import { EMBEDDED_WALLET_NAME } from './stores';

	export let show = false;
	export let wallets: Adapter[] = [];
	export let connecting = false;
	export let embeddedAvailable = true;

	const dispatch = createEventDispatcher();

	function selectWallet(name: string) {
		dispatch('select', name);
	}

	function closeModal() {
		show = false;
		dispatch('close');
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') closeModal();
	}
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
	<div
		class="modal-backdrop"
		role="button"
		tabindex="0"
		aria-label="Close wallet modal"
		on:click={closeModal}
		on:keydown={(e) => e.key === 'Enter' && closeModal()}
	>
		<div
			class="modal-content"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			on:click|stopPropagation
			on:keydown|stopPropagation
		>
			<div class="modal-header">
				<div class="header-left">
					<span class="header-dot"></span>
					<h3>CONNECT</h3>
				</div>
				<button class="close-button" on:click={closeModal} aria-label="Close">×</button>
			</div>

			<div class="modal-body">
				{#if connecting}
					<div class="connecting-state">
						<div class="spinner"></div>
						<p>ESTABLISHING SESSION…</p>
					</div>
				{:else}
					{#if embeddedAvailable}
						<div class="section-label">EMBEDDED WALLET</div>
						<button
							class="wallet-button embedded"
							on:click={() => selectWallet(EMBEDDED_WALLET_NAME)}
							disabled={connecting}
						>
							<div class="wallet-info">
								<div class="wallet-icon embedded-icon" aria-hidden="true">
									<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
										<polyline points="22,6 12,13 2,6" />
									</svg>
								</div>
								<div class="wallet-text">
									<span class="wallet-name">CONTINUE WITH EMAIL</span>
									<span class="wallet-sub">Google · Twitter · Email · Apple</span>
								</div>
							</div>
							<span class="status-embedded">NEW</span>
						</button>

						<div class="divider">
							<span class="divider-line"></span>
							<span class="divider-text">OR EXTERNAL WALLET</span>
							<span class="divider-line"></span>
						</div>
					{/if}

					<div class="wallet-list">
						{#each wallets as wallet}
							<button
								class="wallet-button"
								on:click={() => selectWallet(wallet.name)}
								disabled={connecting}
							>
								<div class="wallet-info">
									<div class="wallet-icon">
										{#if wallet.icon}
											<img src={wallet.icon} alt={wallet.name} />
										{:else if wallet.name === 'Phantom'}
											<svg width="22" height="22" viewBox="0 0 128 128" fill="currentColor">
												<path d="M64 0C28.66 0 0 28.66 0 64s28.66 64 64 64c3.21 0 6.35-.24 9.42-.7v-32.7c0-5.28 1.87-9.74 5.6-13.37 3.73-3.64 8.24-5.45 13.53-5.45 5.28 0 9.74 1.81 13.37 5.45 1.62 1.62 2.79 3.42 3.51 5.4C115.43 76.62 128 62.58 128 45.16 128 20.22 99.34 0 64 0z" />
											</svg>
										{:else if wallet.name === 'Solflare'}
											<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
												<circle cx="12" cy="12" r="10" />
											</svg>
										{:else}
											<div class="wallet-icon-placeholder">{wallet.name.charAt(0)}</div>
										{/if}
									</div>
									<div class="wallet-text">
										<span class="wallet-name">{wallet.name.toUpperCase()}</span>
										<span class="wallet-sub">Browser extension</span>
									</div>
								</div>
								{#if wallet.readyState === 'Installed'}
									<span class="status-installed">DETECTED</span>
								{:else}
									<span class="status-not-installed">INSTALL</span>
								{/if}
							</button>
						{/each}
					</div>
				{/if}
			</div>

			<div class="modal-footer">
				<span class="footer-dim">SOLANA · DEVNET</span>
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
		max-width: 440px;
		max-height: 90vh;
		overflow: hidden;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(255, 149, 0, 0.06) inset;
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
		background: #ff9500;
		box-shadow: 0 0 10px rgba(255, 149, 0, 0.7);
	}
	.modal-header h3 {
		margin: 0;
		color: #ff9500;
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
		color: #ff9500;
		border-color: #ff9500;
	}
	.modal-body {
		padding: 16px;
	}
	.section-label {
		color: #666;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.2em;
		margin: 4px 0 8px;
	}
	.connecting-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		padding: 40px 20px;
		color: #ff9500;
		font-size: 11px;
		letter-spacing: 0.18em;
	}
	.spinner {
		width: 28px;
		height: 28px;
		border: 2px solid #222;
		border-top: 2px solid #ff9500;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.wallet-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.wallet-button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 12px 14px;
		background: #000;
		border: 1px solid #222;
		border-radius: 4px;
		color: #e8e8e8;
		font-family: 'Courier New', monospace;
		cursor: pointer;
		transition: all 0.15s ease;
		text-align: left;
	}
	.wallet-button:hover:not(:disabled) {
		border-color: #ff9500;
		background: #0f0a00;
		transform: translateY(-1px);
	}
	.wallet-button:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}
	.wallet-button.embedded {
		border-color: #ff9500;
		background: linear-gradient(180deg, #120a00 0%, #000 100%);
	}
	.wallet-button.embedded:hover {
		box-shadow: 0 0 14px rgba(255, 149, 0, 0.18);
	}
	.wallet-info {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.wallet-icon {
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		color: #ff9500;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 3px;
	}
	.wallet-icon img {
		width: 22px;
		height: 22px;
		display: block;
	}
	.embedded-icon {
		color: #ff9500;
		background: rgba(255, 149, 0, 0.1);
		border-color: rgba(255, 149, 0, 0.4);
	}
	.wallet-icon-placeholder {
		width: 22px;
		height: 22px;
		background: #ff9500;
		color: #000;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: bold;
		font-size: 11px;
	}
	.wallet-text {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.wallet-name {
		font-size: 12px;
		font-weight: bold;
		color: #ff9500;
		letter-spacing: 0.08em;
	}
	.wallet-sub {
		font-size: 10px;
		color: #666;
		letter-spacing: 0.05em;
	}
	.status-installed {
		font-size: 9px;
		color: #00ff64;
		background: rgba(0, 255, 100, 0.08);
		padding: 3px 6px;
		border-radius: 3px;
		border: 1px solid rgba(0, 255, 100, 0.4);
		letter-spacing: 0.12em;
	}
	.status-not-installed {
		font-size: 9px;
		color: #888;
		background: rgba(136, 136, 136, 0.08);
		padding: 3px 6px;
		border-radius: 3px;
		border: 1px solid #333;
		letter-spacing: 0.12em;
	}
	.status-embedded {
		font-size: 9px;
		color: #000;
		background: #ff9500;
		padding: 3px 6px;
		border-radius: 3px;
		letter-spacing: 0.12em;
		font-weight: bold;
	}
	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		margin: 16px 0 10px;
	}
	.divider-line {
		flex: 1;
		height: 1px;
		background: #222;
	}
	.divider-text {
		font-size: 9px;
		color: #555;
		letter-spacing: 0.2em;
	}
	.modal-footer {
		padding: 10px 16px;
		border-top: 1px solid #222;
		background: #000;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.footer-dim {
		font-size: 9px;
		color: #444;
		letter-spacing: 0.2em;
	}
</style>
