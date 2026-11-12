/**
 * pnpm fetch-instruments [--out <dir>] [--only id1,id2] [--skip-large] [--keep-cache]
 *
 * Downloads the instrument packs from instruments/manifest.json. Sample audio is never committed to git.
 */
import path from 'node:path';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { fetchInstruments } from '../apps/server/src/instruments/fetch.ts';
import { generateNotices } from './gen-notices.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const outDir = path.resolve(arg('--out') ?? path.join(root, 'instruments/packs'));
const only = arg('--only')?.split(',').filter(Boolean);
let lastPct = -1;

const list = await fetchInstruments({
  manifestPath: path.join(root, 'instruments/manifest.json'),
  outDir,
  only,
  skipLarge: args.includes('--skip-large') || process.env.RIFFROLL_SKIP_LARGE === '1',
  log: (m) => console.log(m),
  onProgress: (p) => {
    if (p.state === 'downloading' && p.total) {
      const pct = Math.floor(((p.received ?? 0) / p.total) * 10) * 10;
      if (pct !== lastPct) {
        lastPct = pct;
        console.log(`  ${p.instrument}: ${pct}%`);
      }
    }
  },
});
if (!args.includes('--keep-cache')) await rm(path.join(outDir, '.cache'), { recursive: true, force: true });
await generateNotices();
console.log(`\n${list.length} instrument(s) installed in ${outDir}`);
