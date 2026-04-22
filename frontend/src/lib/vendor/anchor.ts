// @coral-xyz/anchor ships its main entry as CommonJS. When Node externalizes it for
// SvelteKit SSR, named imports fail ("Named export 'BN' not found"). When Vite bundles
// it, the CJS body runs in an ESM context and throws "exports is not defined". Going
// through a namespace import sidesteps both: Node can satisfy it via CJS interop, and
// Vite can pick up the ESM build when bundling.
import * as anchorPkg from '@coral-xyz/anchor';

type AnchorNs = typeof import('@coral-xyz/anchor');

// In the browser ESM build, Anchor does NOT have a `default` export.
// In Node SSR, the namespace import still works via CJS interop.
const ns: AnchorNs = anchorPkg as unknown as AnchorNs;

export const AnchorProvider = ns.AnchorProvider;
export const BN = ns.BN;
export const Program = ns.Program;
export type { Idl } from '@coral-xyz/anchor';
export type BNType = InstanceType<typeof BN>;
