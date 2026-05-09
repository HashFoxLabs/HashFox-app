<script lang="ts">
	import { onMount } from 'svelte';
	import { BN } from '$lib/vendor/anchor';
	import { walletStore } from '$lib/wallet/stores';
	import { sessionKey } from '$lib/stores/sessionKey';
	import {
		buildConnection,
		buildProgram,
		buyYes,
		buyNo,
		initializeUserAccount,
		getUserAccount,
		priceScaled,
		usd
	} from '$lib/hashfox';
	import { polymarketClient, type PolyEvent, type PolyMarket } from '$lib/polymarket';
	import { compBuyYes, compBuyNo, fmtCountdown } from '$lib/competition';
	import { activeCompetition, refreshActiveCompetition } from '$lib/stores/activeCompetition';

	let wallet: any = {};
	walletStore.subscribe((s) => (wallet = s));

	let session: any = {};
	sessionKey.subscribe((s) => (session = s));

	let comp: any = { pubkey: null, view: null, loaded: false };
	activeCompetition.subscribe((s) => (comp = s));

	// Only Active routes through the per-cup PDA. Pending / settled fall
	// through to main-account betting so the user keeps full access to their
	// regular paper balance.
	$: inTournament = !!(comp?.pubkey && comp.view && comp.view.status === 'active');

	let events: PolyEvent[] = [];
	let loading = true;
	let selectedEvent: PolyEvent | null = null;
	let selectedMarket: PolyMarket | null = null;
	let side: 'yes' | 'no' = 'yes';
	let amountInput = 100;
	let busy = false;
	let message = '';

	onMount(async () => {
		refreshActiveCompetition();
		try {
			events = await polymarketClient.fetchEvents(20, 0);
			if (events[0]) selectEvent(events[0]);
		} finally {
			loading = false;
		}
	});

	function selectEvent(ev: PolyEvent) {
		selectedEvent = ev;
		selectedMarket = ev.markets?.[0] ?? null;
	}

	async function placeBet() {
		if (busy) return;
		if (!wallet.connected) {
			message = 'Connect a wallet first.';
			return;
		}
		if (!selectedMarket) {
			message = 'Select a market first.';
			return;
		}
		const priceDec = side === 'yes' ? selectedMarket.yesPrice ?? 0 : selectedMarket.noPrice ?? 0;
		if (priceDec <= 0) {
			message = 'Invalid market price.';
			return;
		}
		busy = true;
		message = 'Submitting…';
		try {
			const conn = buildConnection();
			const program = buildProgram(conn, wallet.adapter);
			let acc = await getUserAccount(program, wallet.publicKey);
			if (!acc) {
				message = 'Initializing paper account…';
				await initializeUserAccount(program, wallet.publicKey, new BN(10_000_000));
			}

			const marketId = (selectedMarket.id || selectedEvent?.slug || '').slice(0, 128);
			const amountUsd = usd(amountInput);
			const pricePerShare = priceScaled(priceDec);
			const sessionToken = session.active ? session.token : null;

			let sig: string;
			if (inTournament && comp.pubkey) {
				const compFn = side === 'yes' ? compBuyYes : compBuyNo;
				sig = await compFn(program, wallet.publicKey, comp.pubkey, {
					marketId,
					amountUsd,
					pricePerShare,
					stopLoss: new BN(0),
					takeProfit: new BN(0),
					sessionToken
				});
			} else {
				const fn = side === 'yes' ? buyYes : buyNo;
				sig = await fn(program, wallet.publicKey, {
					marketId,
					amountUsd,
					pricePerShare,
					stopLoss: new BN(0),
					takeProfit: new BN(0),
					sessionToken
				});
			}
			message = `Bet placed${inTournament ? ' · cup' : ''} · ${sig.slice(0, 8)}…`;
			refreshActiveCompetition();
		} catch (err: any) {
			console.error(err);
			message = err?.message ?? 'Bet failed.';
		} finally {
			busy = false;
		}
	}
</script>

{#if comp.view}
	<div class="comp-banner {comp.view.status}">
		<div class="cb-left">
			<span class="cb-dot"></span>
			<span class="cb-tag">TOURNAMENT MODE</span>
			<span class="cb-name">{comp.view.name}</span>
		</div>
		<div class="cb-right">
			{#if comp.view.status === 'active'}
				<span class="cb-meta">Ends in {fmtCountdown(comp.view.endTs)}</span>
			{:else if comp.view.status === 'pending'}
				<span class="cb-meta">Pending fill ({comp.view.participantCount}/{comp.view.maxParticipants})</span>
			{:else}
				<span class="cb-meta">Settled — claim exit on /competition</span>
			{/if}
		</div>
	</div>
{/if}

<div class="pred-wrap">
	<aside class="event-list">
		<div class="list-header">Events</div>
		{#if loading}
			<div class="placeholder">Loading…</div>
		{:else}
			{#each events as ev (ev.id)}
				<button
					class="event-row"
					class:active={selectedEvent?.id === ev.id}
					on:click={() => selectEvent(ev)}
				>
					<span class="ev-title">{ev.title}</span>
					<span class="ev-vol">${(ev.volume ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
				</button>
			{/each}
		{/if}
	</aside>

	<section class="event-detail">
		{#if !selectedEvent || !selectedMarket}
			<div class="placeholder">Select an event to bet.</div>
		{:else}
			<h2 class="ev-h">{selectedEvent.title}</h2>
			{#if selectedEvent.description}
				<p class="ev-desc">{selectedEvent.description}</p>
			{/if}

			<div class="prices">
				<button class="pr yes" class:active={side === 'yes'} on:click={() => (side = 'yes')}>
					<div class="pr-lbl">YES</div>
					<div class="pr-val">{((selectedMarket.yesPrice ?? 0) * 100).toFixed(0)}¢</div>
				</button>
				<button class="pr no" class:active={side === 'no'} on:click={() => (side = 'no')}>
					<div class="pr-lbl">NO</div>
					<div class="pr-val">{((selectedMarket.noPrice ?? 0) * 100).toFixed(0)}¢</div>
				</button>
			</div>

			<label class="field">
				<span>Amount (USD)</span>
				<input type="number" min="1" step="1" bind:value={amountInput} />
			</label>

			<button class="submit" class:yes={side === 'yes'} class:no={side === 'no'} disabled={busy} on:click={placeBet}>
				{busy ? 'Submitting…' : `BUY ${side.toUpperCase()} · $${amountInput}`}
			</button>

			{#if message}
				<div class="msg">{message}</div>
			{/if}
		{/if}
	</section>
</div>

<style>
	.pred-wrap {
		display: grid;
		grid-template-columns: 320px 1fr;
		gap: 16px;
		min-height: 520px;
	}

	.event-list {
		background: #121212;
		border: 1px solid #222;
		border-radius: 10px;
		max-height: 620px;
		overflow-y: auto;
	}
	.list-header {
		padding: 10px 12px;
		color: #ff5a00;
		font-family: 'Courier New', monospace;
		font-size: 11px;
		font-weight: bold;
		letter-spacing: 0.12em;
		border-bottom: 1px solid #222;
		background: #0a0a0a;
		position: sticky;
		top: 0;
	}
	.event-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		text-align: left;
		padding: 10px 12px;
		border: none;
		background: transparent;
		color: #ccc;
		font-family: 'Courier New', monospace;
		cursor: pointer;
		border-bottom: 1px solid #1a1a1a;
		width: 100%;
	}
	.event-row:hover { background: #1a1a1a; }
	.event-row.active { background: rgba(255, 90, 0, 0.1); border-left: 2px solid #ff5a00; }
	.ev-title { font-size: 12px; font-weight: bold; line-height: 1.35; }
	.ev-vol { font-size: 10px; color: #666; }

	.event-detail {
		background: #121212;
		border: 1px solid #222;
		border-radius: 10px;
		padding: 20px;
		color: #ccc;
		font-family: 'Courier New', monospace;
	}
	.ev-h { color: #fff; font-size: 18px; font-weight: bold; margin-bottom: 8px; }
	.ev-desc { font-size: 12px; color: #777; line-height: 1.55; margin-bottom: 16px; }

	.prices { display: flex; gap: 12px; margin-bottom: 16px; }
	.pr {
		flex: 1;
		padding: 14px;
		background: #000;
		border: 1px solid #333;
		border-radius: 8px;
		color: #ccc;
		font-family: inherit;
		cursor: pointer;
	}
	.pr-lbl { font-size: 11px; letter-spacing: 0.08em; color: #888; }
	.pr-val { font-size: 22px; font-weight: bold; color: #fff; margin-top: 4px; }
	.pr.yes.active { border-color: #00ff64; background: rgba(0, 255, 100, 0.08); }
	.pr.yes.active .pr-val { color: #00ff64; }
	.pr.no.active { border-color: #ff4444; background: rgba(255, 68, 68, 0.08); }
	.pr.no.active .pr-val { color: #ff4444; }

	.field { display: flex; flex-direction: column; gap: 5px; margin-bottom: 14px; }
	.field span { font-size: 10px; color: #888; letter-spacing: 0.08em; }
	.field input {
		background: #000;
		border: 1px solid #333;
		border-radius: 6px;
		color: #fff;
		padding: 10px 12px;
		font-family: inherit;
		font-size: 13px;
		outline: none;
	}
	.field input:focus { border-color: #ff5a00; }

	.submit {
		width: 100%;
		padding: 13px;
		border: none;
		border-radius: 8px;
		font-family: inherit;
		font-size: 13px;
		font-weight: bold;
		letter-spacing: 0.08em;
		cursor: pointer;
	}
	.submit.yes { background: #00ff64; color: #000; }
	.submit.no { background: #ff4444; color: #fff; }
	.submit:disabled { opacity: 0.6; cursor: not-allowed; }

	.msg { margin-top: 12px; padding: 8px 10px; background: #0a0a0a; border: 1px solid #222; border-radius: 8px; font-size: 11px; }

	.placeholder { padding: 2rem 1rem; text-align: center; color: #666; font-family: 'Courier New', monospace; font-size: 12px; }

	@media (max-width: 860px) {
		.pred-wrap { grid-template-columns: 1fr; }
		.event-list { max-height: 260px; }
	}

	.comp-banner {
		display: flex; justify-content: space-between; align-items: center;
		gap: 8px; flex-wrap: wrap;
		padding: 8px 12px;
		margin-bottom: 12px;
		border-radius: 8px;
		background: linear-gradient(180deg, rgba(0, 255, 102, 0.06), rgba(255, 255, 255, 0.01));
		border: 1px solid rgba(0, 255, 102, 0.35);
	}
	.comp-banner.pending { background: linear-gradient(180deg, rgba(255, 90, 0, 0.06), rgba(255, 255, 255, 0.01)); border-color: rgba(255, 90, 0, 0.4); }
	.comp-banner.settled { background: linear-gradient(180deg, rgba(255, 102, 204, 0.06), rgba(255, 255, 255, 0.01)); border-color: rgba(255, 102, 204, 0.4); }
	.cb-left { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
	.cb-dot { width: 6px; height: 6px; border-radius: 50%; background: #00ff66; box-shadow: 0 0 8px rgba(0, 255, 102, 0.7); }
	.comp-banner.pending .cb-dot { background: #ff5a00; box-shadow: 0 0 8px rgba(255, 90, 0, 0.7); }
	.comp-banner.settled .cb-dot { background: #ff66cc; box-shadow: 0 0 8px rgba(255, 102, 204, 0.7); }
	.cb-tag { color: #00ff66; font-family: 'Courier New', monospace; font-size: 9px; font-weight: 900; letter-spacing: 0.16em; }
	.comp-banner.pending .cb-tag { color: #ff5a00; }
	.comp-banner.settled .cb-tag { color: #ff66cc; }
	.cb-name { color: #fff; font-family: 'Courier New', monospace; font-size: 11px; font-weight: 800; }
	.cb-meta { color: #aaa; font-family: 'Courier New', monospace; font-size: 10px; }
</style>
