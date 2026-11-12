// Bundles the Electron main + preload scripts to CommonJS (preload must be CJS when sandboxed).
import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', format: 'cjs', target: 'node22', external: ['electron'], sourcemap: true };
await build({ ...common, entryPoints: ['src/main.ts'], outfile: 'dist-electron/main.cjs' });
await build({ ...common, entryPoints: ['src/preload.ts'], outfile: 'dist-electron/preload.cjs' });
