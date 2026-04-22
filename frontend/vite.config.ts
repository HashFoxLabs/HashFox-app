import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
	resolve: {
		// Force "exports" resolution towards browser builds for client bundles.
		conditions: ['browser', 'module', 'import', 'default']
	},
	plugins: [
		sveltekit(),
		nodePolyfills({
			// Omit `process` from polyfills: injecting `globalThis.process` breaks Node SSR
			// (`process.cwd is not a function` in SvelteKit), and stdlib's `process/` proxy
			// breaks esbuild's dependency scan for some wallet deps.
			include: ['buffer', 'util', 'stream', 'events', 'crypto'],
			globals: {
				process: false,
				Buffer: true,
				global: true
			}
		})
	],
	define: {
		// Some wallet/embed deps still reference `process.nextTick` in browser builds.
		// Provide the minimal shim needed to avoid runtime crashes in the client.
		// (We keep SSR on the real Node `process` below.)
		// IMPORTANT: esbuild "define" only allows identifiers or JS *literals*.
		// Do NOT define `process` itself (object expressions are rejected and also affect SSR).
		// Instead, replace the specific property accesses used by browser-only deps.
		'process.env': '{}',
		'process.nextTick': 'queueMicrotask'
	},
	ssr: {
		resolve: {
			// Keep SSR on Node-friendly entrypoints. Drop the `module` condition so
			// @coral-xyz/anchor resolves to its CJS build (main) instead of the hybrid
			// dist/esm/index.js, which references `exports.workspace = require(...)` and
			// crashes with "exports is not defined" when evaluated as ESM.
			conditions: ['node', 'import', 'default']
		},
		noExternal: [
			'@solana/wallet-adapter-wallets',
			'@solana/wallet-adapter-base',
			'@web3auth/base',
			'@web3auth/modal',
			'@web3auth/solana-provider'
		]
	},
	optimizeDeps: {
		esbuildOptions: {
			conditions: ['browser', 'module', 'import', 'default'],
			target: 'esnext'
		}
	}
});
