<script lang="ts">
	import { onMount } from 'svelte';
	import { walletStore, walletManager } from './stores';
	import { WEB3AUTH_CLIENT_ID } from '$lib/env';
	import { initWeb3Auth } from './web3auth';
	import WalletModal from './WalletModal.svelte';
	import ProfileChip from '../profile/ProfileChip.svelte';

	let showModal = false;
	let wallets: any[] = [];

	let walletState: any = {};
	walletStore.subscribe((state) => {
		walletState = state;
	});

	onMount(() => {
		wallets = walletManager.getWallets();
		// Prevent "reconnect" loops on route changes (TopChrome remounts).
		if (!walletState.connected) {
			walletManager.autoConnect();
		}
		if (WEB3AUTH_CLIENT_ID) {
			void initWeb3Auth();
		}
	});

	function openModal() {
		showModal = true;
	}

	function closeModal() {
		showModal = false;
	}

	async function handleWalletSelect(event: CustomEvent) {
		const walletName = event.detail;
		try {
			await walletManager.connect(walletName);
			closeModal();
		} catch (error: any) {
			if (error?.message?.includes('not installed')) {
				alert(error.message);
			} else if (
				error?.message?.includes('User rejected') ||
				error?.message?.includes('User closed') ||
				error?.message?.includes('not been authorized')
			) {
				// Silently cancel — user backed out
			} else if (error?.message?.includes('Unexpected error')) {
				alert('Connection failed. Make sure your wallet is unlocked and try again.');
			} else {
				alert(`Failed to connect: ${error?.message || 'Unknown error'}`);
			}
		}
	}

	async function handleDisconnect() {
		try {
			await walletManager.disconnect();
		} catch {}
	}

	function formatAddress(address: string) {
		if (!address) return '';
		return `${address.slice(0, 4)}…${address.slice(-4)}`;
	}

	$: walletAddress = walletState.publicKey ? walletState.publicKey.toBase58() : '';
	$: walletAddressShort = walletAddress ? formatAddress(walletAddress) : '';
</script>

{#if walletState.connected && walletState.publicKey}
	<div class="wallet-row">
		<div class="wallet-connected">
			<div class="wallet-info">
				<div class="wallet-address">{walletAddressShort}</div>
				<div class="wallet-name">
					{#if walletState.isEmbedded}
						EMBEDDED
					{:else}
						{walletState.adapter?.name?.toUpperCase() || 'CONNECTED'}
					{/if}
				</div>
			</div>
			<button class="disconnect-button" on:click={handleDisconnect} title="Disconnect">✕</button>
		</div>

		<ProfileChip walletAddress={walletAddress} username={walletState.username} avatarUrl={walletState.avatarUrl} />
	</div>
{:else}
	<button
		class="connect-button"
		class:connecting={walletState.connecting}
		on:click={openModal}
		disabled={walletState.connecting}
	>
		{#if walletState.connecting}
			<div class="spinner"></div>
			CONNECTING…
		{:else}
			CONNECT
		{/if}
	</button>
{/if}

<WalletModal
	bind:show={showModal}
	{wallets}
	connecting={walletState.connecting}
	embeddedAvailable={!!WEB3AUTH_CLIENT_ID}
	on:select={handleWalletSelect}
	on:close={closeModal}
/>

<style>
	.connect-button {
		background: #ff9500;
		color: #000;
		border: none;
		padding: 8px 18px;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.18em;
		cursor: pointer;
		border-radius: 3px;
		transition: all 0.15s ease;
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 110px;
		justify-content: center;
	}
	.connect-button:hover:not(:disabled) {
		background: #ffb733;
		transform: translateY(-1px);
		box-shadow: 0 0 12px rgba(255, 149, 0, 0.3);
	}
	.connect-button:disabled {
		opacity: 0.7;
		cursor: not-allowed;
		transform: none;
	}
	.wallet-row {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.wallet-connected {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 3px;
		padding: 5px 10px 5px 6px;
	}
	.wallet-info {
		display: flex;
		flex-direction: column;
		gap: 1px;
		max-width: 140px;
	}
	.wallet-address {
		color: #ff9500;
		font-family: 'Courier New', monospace;
		font-size: 12px;
		font-weight: bold;
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.wallet-name {
		color: #555;
		font-family: 'Courier New', monospace;
		font-size: 9px;
		letter-spacing: 0.18em;
	}
	.disconnect-button {
		background: transparent;
		color: #666;
		border: 1px solid #333;
		padding: 0;
		width: 22px;
		height: 22px;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		cursor: pointer;
		border-radius: 3px;
		transition: all 0.15s ease;
	}
	.disconnect-button:hover {
		background: #220000;
		border-color: #ff4444;
		color: #ff6666;
	}
	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid rgba(0, 0, 0, 0.3);
		border-top: 2px solid #000;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
