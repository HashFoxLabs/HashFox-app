<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import LiveChat from './LiveChat.svelte';
	import type { ConnectedSocialUser, FeedUserProfile } from '$lib/social/types';

	export let connectedUser: ConnectedSocialUser | null = null;
	export let profiles: FeedUserProfile[] = [];
	export let onClose: () => void = () => {};

	function handleBackdropClick(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function handleBackdropKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}

	onMount(() => {
		if (typeof document !== 'undefined') document.body.style.overflow = 'hidden';
	});

	onDestroy(() => {
		if (typeof document !== 'undefined') document.body.style.overflow = '';
	});
</script>

<div
	class="chat-backdrop"
	on:click={handleBackdropClick}
	on:keydown={handleBackdropKey}
	role="dialog"
	aria-modal="true"
	aria-label="Live chat"
	tabindex="-1"
>
	<LiveChat {connectedUser} {profiles} {onClose} />
</div>

<style>
	.chat-backdrop {
		position: fixed; inset: 0; background: #000;
		display: flex;
		z-index: 250;
	}
</style>
