import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildServer } from './app.js';
import { fetchInstruments, installedIds, readManifest, type FetchProgress } from './instruments/fetch.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const uiDir = process.env.UI_DIR ?? path.join(repoRoot, 'packages/ui/dist');
const projectsDir = process.env.PROJECTS_DIR ?? path.join(repoRoot, 'data/projects');
const instrumentsDir = process.env.INSTRUMENTS_DIR ?? path.join(repoRoot, 'instruments/packs');
const bundledDir = process.env.BUNDLED_INSTRUMENTS_DIR;
const manifestPath = process.env.MANIFEST_PATH ?? path.join(repoRoot, 'instruments/manifest.json');

let status: FetchProgress = { state: 'ready', done: [] };

const app = await buildServer({
  uiDir,
  projectsDir,
  instrumentsDirs: [instrumentsDir, ...(bundledDir ? [bundledDir] : [])],
  basicAuth: process.env.RIFFROLL_BASIC_AUTH || undefined,
  openSignup: process.env.RIFFROLL_SIGNUP === 'open',
  resetPassword: process.env.RIFFROLL_RESET_PASSWORD || undefined,
  logger: true,
  instrumentStatus: () => status,
});

await app.listen({ port, host });

// First start without bundled instruments: download the default packs into the volume in the background.
if (process.env.RIFFROLL_AUTO_FETCH !== '0' && existsSync(manifestPath)) {
  const manifest = await readManifest(manifestPath);
  const have = new Set([
    ...(await installedIds(instrumentsDir)),
    ...(bundledDir ? await installedIds(bundledDir) : []),
  ]);
  const missing = manifest.instruments.filter((i) => i.default !== false && !have.has(i.id)).map((i) => i.id);
  if (missing.length && (bundledDir || process.env.RIFFROLL_AUTO_FETCH === '1')) {
    app.log.info(`downloading instruments into ${instrumentsDir}: ${missing.join(', ')}`);
    status = { state: 'downloading', done: [] };
    fetchInstruments({
      manifestPath,
      outDir: instrumentsDir,
      only: missing,
      onProgress: (p) => (status = p),
      log: (m) => app.log.info(m),
    }).catch((e) => app.log.error(e));
  }
}
