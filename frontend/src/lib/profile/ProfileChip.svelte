<script lang="ts">
	import { onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { fetchProfile } from '$lib/supabase';

	export let walletAddress = '';
	export let username: string | null = null;
	export let avatarUrl: string | null = null;
	export let bannerUrl: string | null = null;

	function openProfile() {
		goto('/profile');
	}

	let dbUsername: string | null = null;
	let dbAvatarUrl: string | null = null;
	let dbBannerUrl: string | null = null;

	let refreshTimer: ReturnType<typeof setTimeout> | null = null;
	async function refreshFromDb() {
		if (!walletAddress) return;
		const p = await fetchProfile(walletAddress);
		dbUsername = p?.username ?? null;
		dbAvatarUrl = p?.avatar_url ?? null;
		dbBannerUrl = p?.banner_url ?? null;
	}

	// If parent hasn't hydrated yet, do a local lookup.
	$: if (walletAddress && !username && !refreshTimer) {
		// small delay to avoid double-fetch during connect/hydrate
		refreshTimer = setTimeout(() => {
			refreshTimer = null;
			void refreshFromDb();
		}, 300);
	}

	onDestroy(() => {
		if (refreshTimer) clearTimeout(refreshTimer);
	});

	$: displayName = username || dbUsername || 'Anonymous';
	$: avatar = avatarUrl || dbAvatarUrl;
	$: banner = bannerUrl || dbBannerUrl;
</script>

<div class="profile-chip">
	<div class="avatar" title={displayName}>
		{#if avatar}
			<img src={avatar} alt="profile" referrerpolicy="no-referrer" />
		{:else}
			<div class="avatar-fallback">{(displayName[0] || '?').toUpperCase()}</div>
		{/if}
	</div>
	<div class="who">
		<div class="name">{displayName}</div>
		<div class="tag">PROFILE</div>
	</div>
<button type="button" class="profile-btn" on:click={openProfile}>PROFILE</button>
</div>

<style>
	.profile-chip {
		display: flex;
		align-items: center;
		gap: 10px;
		background: #0a0a0a;
		border: 1px solid #222;
		border-radius: 3px;
		padding: 5px 8px 5px 6px;
		min-width: 190px;
	}
	.avatar {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		overflow: hidden;
		border: 1px solid #333;
		flex-shrink: 0;
		background: #000;
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
		font-family: 'Courier New', monospace;
		font-size: 13px;
		font-weight: bold;
	}
	.who {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
		flex: 1;
	}
	.name {
		color: #e8e8e8;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.04em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.tag {
		color: #555;
		font-family: 'Courier New', monospace;
		font-size: 9px;
		letter-spacing: 0.18em;
	}
	.profile-btn {
		background: transparent;
		color: #ff5a00;
		border: 1px solid rgba(255, 90, 0, 0.35);
		padding: 0 10px;
		height: 22px;
		font-family: 'Courier New', monospace;
		font-size: 10px;
		font-weight: bold;
		letter-spacing: 0.18em;
		cursor: pointer;
		border-radius: 3px;
		transition: all 0.15s ease;
	}
	.profile-btn:hover {
		background: rgba(255, 90, 0, 0.12);
		border-color: rgba(255, 90, 0, 0.7);
	}
	@media (max-width: 520px) {
		.profile-chip {
			min-width: 160px;
		}
		.tag { display: none; }
	}
</style>

