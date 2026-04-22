<script lang="ts">
	import WalletButton from '$lib/wallet/WalletButton.svelte';
	export let active: 'home' | 'trading' | 'terminal' | 'history' = 'home';
</script>

<nav class="navbar">
	<div class="nav-content">
		<div class="logo">
			<img src="/favicon.png" alt="HASHFOX" class="logo-icon" />
			<span class="logo-text">HASHFOX</span>
		</div>
		<div class="nav-links">
			<a href="/" class="nav-link" class:active={active === 'home'}>Home</a>
			<a href="/#trading" class="nav-link" class:active={active === 'trading'}>Trading</a>
			<a href="/crypto/terminal" class="nav-link" class:active={active === 'terminal'}>Terminal</a>
			<a href="/crypto/dashboard" class="nav-link" class:active={active === 'history'}>History</a>
		</div>
		<div class="nav-wallet">
			<WalletButton />
		</div>
	</div>
</nav>

<style>
	.navbar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		background: rgba(255, 255, 255, 0.95);
		backdrop-filter: blur(10px);
		border-bottom: 1px solid #e0e0e0;
		z-index: 1000;
	}
	.nav-content {
		max-width: 1400px;
		margin: 0 auto;
		padding: 1rem 2rem;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-weight: bold;
		font-size: 1.2rem;
	}
	.logo-icon {
		width: 48px;
		height: 48px;
	}
	.logo-text {
		color: #ff9500;
		letter-spacing: 2px;
	}
	.nav-links {
		display: flex;
		align-items: center;
		gap: 2rem;
	}
	.nav-link {
		color: #666;
		text-decoration: none;
		font-size: 0.95rem;
		transition: color 0.2s;
		font-weight: 500;
	}
	.nav-link:hover {
		color: #000;
	}
	.nav-link.active {
		color: #ff9500;
	}
	.nav-wallet {
		display: flex;
		align-items: center;
	}
	@media (max-width: 768px) {
		.nav-content {
			flex-wrap: wrap;
			gap: 1rem;
		}
		.nav-links {
			order: 3;
			width: 100%;
			justify-content: center;
			gap: 1rem;
		}
		.nav-wallet {
			order: 2;
		}
	}
</style>
