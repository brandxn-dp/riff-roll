/**
 * Instrument asset pipeline: download the packs listed in instruments/manifest.json, verify, unpack,
 * and write a normalised descriptor per instrument plus an index the UI reads.
 *
 * Used by `pnpm fetch-instruments` (build time) and by the server on first start when the Docker image
 * was built with INCLUDE_INSTRUMENTS=false.
 */
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { RemoteZip, pool } from './zipremote.js';
import { BIG_RUSTY, kitSfz, selectKitFiles } from './drumkit.js';

export interface ManifestEntry {
  id: string;
  name: string;
  role: 'guitar' | 'bass' | 'drums' | 'ir' | 'other';
  url: string;
  sha256: string | null;
  /** zip-range: read only the needed files out of a remote zip with HTTP range requests */
  format: '7z' | 'zip' | 'zip-range';
  /** zip-range: which normalised-kit generator to use */
  generator?: 'big-rusty';
  /** zip-range: round robins to keep */
  roundRobins?: number;
  /** Main SFZ path inside the archive. null = auto-detect. */
  sfz: string | null;
  license: string;
  author: string;
  homepage: string;
  attribution: string;
  default?: boolean;
  large?: boolean;
  /** 7-Zip include wildcards; extract only these (used to trim huge kits). */
  extract?: string[];
  /** Extra per-instrument data passed through to the UI (e.g. drum mapping). */
  meta?: Record<string, unknown>;
}

export interface Manifest {
  version: number;
  instruments: ManifestEntry[];
}

export interface InstalledInstrument {
  id: string;
  name: string;
  role: ManifestEntry['role'];
  license: string;
  author: string;
  homepage: string;
  attribution: string;
  /** SFZ path relative to the instruments root, using forward slashes. */
  sfz: string;
  sfzFiles: string[];
  meta?: Record<string, unknown>;
}

export interface FetchProgress {
  state: 'idle' | 'downloading' | 'extracting' | 'ready' | 'error';
  instrument?: string;
  received?: number;
  total?: number;
  done: string[];
  error?: string;
}

export interface FetchOptions {
  manifestPath: string;
  outDir: string;
  only?: string[];
  skipLarge?: boolean;
  onProgress?: (p: FetchProgress) => void;
  log?: (msg: string) => void;
}

const DESCRIPTOR = 'instrument.json';

function sevenZipPath(): string {
  const require = createRequire(import.meta.url);
  const bin = require('7zip-bin') as { path7za: string };
  return bin.path7za;
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err}`))));
  });
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  await pipeline(createReadStream(file), h);
  return h.digest('hex');
}

async function download(url: string, dest: string, onBytes: (received: number, total: number) => void) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'riffroll-fetch-instruments' } });
  if (!res.ok || !res.body) throw new Error(`download failed ${res.status} ${url}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  let received = 0;
  const tmp = dest + '.part';
  const body = Readable.fromWeb(res.body as import('node:stream/web').ReadableStream);
  body.on('data', (chunk: Buffer) => {
    received += chunk.length;
    onBytes(received, total);
  });
  await pipeline(body, createWriteStream(tmp));
  await rename(tmp, dest);
}

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

/** Pick the main SFZ: prefer the shallowest file, then the shortest name. */
export function pickMainSfz(files: string[]): string | undefined {
  const sfz = files.filter((f) => f.toLowerCase().endsWith('.sfz'));
  return sfz.sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length || a.localeCompare(b))[0];
}

export async function readManifest(file: string): Promise<Manifest> {
  return JSON.parse(await readFile(file, 'utf8')) as Manifest;
}

export async function writeIndex(outDir: string): Promise<InstalledInstrument[]> {
  const list: InstalledInstrument[] = [];
  if (existsSync(outDir)) {
    for (const e of await readdir(outDir, { withFileTypes: true })) {
      const d = path.join(outDir, e.name, DESCRIPTOR);
      if (e.isDirectory() && existsSync(d)) list.push(JSON.parse(await readFile(d, 'utf8')));
    }
  }
  await writeFile(path.join(outDir, 'index.json'), JSON.stringify({ instruments: list }, null, 2));
  return list;
}

export async function installedIds(outDir: string): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!existsSync(outDir)) return ids;
  for (const e of await readdir(outDir, { withFileTypes: true }))
    if (e.isDirectory() && existsSync(path.join(outDir, e.name, DESCRIPTOR))) ids.add(e.name);
  return ids;
}

export async function fetchInstruments(opts: FetchOptions): Promise<InstalledInstrument[]> {
  const log = opts.log ?? (() => {});
  const manifest = await readManifest(opts.manifestPath);
  const outDir = path.resolve(opts.outDir);
  const cache = path.join(outDir, '.cache');
  await mkdir(cache, { recursive: true });
  const progress: FetchProgress = { state: 'idle', done: [] };
  const emit = () => opts.onProgress?.({ ...progress, done: [...progress.done] });

  const wanted = manifest.instruments.filter(
    (i) => (opts.only?.length ? opts.only.includes(i.id) : i.default !== false) && !(opts.skipLarge && i.large),
  );
  const have = await installedIds(outDir);

  try {
    for (const inst of wanted) {
      if (have.has(inst.id)) {
        log(`✓ ${inst.id} already installed`);
        progress.done.push(inst.id);
        continue;
      }
      if (inst.format === 'zip-range') {
        await installFromRemoteZip(inst, outDir, progress, emit, log);
        progress.done.push(inst.id);
        continue;
      }
      const archive = path.join(cache, `${inst.id}.${inst.format}`);
      if (!existsSync(archive)) {
        log(`↓ ${inst.name}  ${inst.url}`);
        progress.state = 'downloading';
        progress.instrument = inst.id;
        let last = 0;
        await download(inst.url, archive, (received, total) => {
          progress.received = received;
          progress.total = total;
          const now = Date.now();
          if (now - last > 250) {
            last = now;
            emit();
          }
        });
      }
      const hash = await sha256(archive);
      if (inst.sha256 && inst.sha256 !== hash) {
        await rm(archive, { force: true });
        throw new Error(`${inst.id}: sha256 mismatch (expected ${inst.sha256}, got ${hash})`);
      }
      if (!inst.sha256) log(`  sha256 ${hash} (add this to manifest.json to pin it)`);

      progress.state = 'extracting';
      emit();
      const target = path.join(outDir, inst.id);
      const staging = target + '.staging';
      await rm(staging, { recursive: true, force: true });
      await mkdir(staging, { recursive: true });
      const args = ['x', archive, `-o${staging}`, '-y', '-bso0', '-bsp0'];
      for (const inc of inst.extract ?? []) args.push(`-ir!${inc}`);
      log(`  extracting…`);
      await run(sevenZipPath(), args);

      const files = await walk(staging);
      const main = inst.sfz ?? pickMainSfz(files);
      if (!main) throw new Error(`${inst.id}: no .sfz file found in archive`);
      const descriptor: InstalledInstrument = {
        id: inst.id,
        name: inst.name,
        role: inst.role,
        license: inst.license,
        author: inst.author,
        homepage: inst.homepage,
        attribution: inst.attribution,
        sfz: `${inst.id}/${main}`,
        sfzFiles: files.filter((f) => f.toLowerCase().endsWith('.sfz')).map((f) => `${inst.id}/${f}`),
        meta: inst.meta,
      };
      await writeFile(path.join(staging, DESCRIPTOR), JSON.stringify(descriptor, null, 2));
      await rm(target, { recursive: true, force: true });
      await rename(staging, target);
      const size = (await stat(archive)).size;
      log(`✓ ${inst.id} (${(size / 1e6).toFixed(1)} MB archive) → ${main}`);
      progress.done.push(inst.id);
      emit();
    }
    const list = await writeIndex(outDir);
    progress.state = 'ready';
    progress.instrument = undefined;
    emit();
    return list;
  } catch (e) {
    progress.state = 'error';
    progress.error = (e as Error).message;
    emit();
    throw e;
  }
}

/** Install a trimmed subset of a huge zip (e.g. a 620 MB drum kit) without downloading the whole archive. */
async function installFromRemoteZip(
  inst: ManifestEntry,
  outDir: string,
  progress: FetchProgress,
  emit: () => void,
  log: (m: string) => void,
) {
  if (inst.generator !== 'big-rusty') throw new Error(`${inst.id}: unknown kit generator ${inst.generator}`);
  log(`↓ ${inst.name} (selected files only)  ${inst.url}`);
  const zip = new RemoteZip(inst.url);
  const entries = await zip.open();
  const rr = inst.roundRobins ?? 2;
  const wanted = selectKitFiles(
    entries.map((e) => e.name),
    BIG_RUSTY,
    rr,
  );
  const byName = new Map(entries.map((e) => [e.name, e]));
  const total = wanted.reduce((a, n) => a + (byName.get(n)?.compressedSize ?? 0), 0);
  log(`  ${wanted.length} files, ${(total / 1e6).toFixed(1)} MB (of ${entries.length} entries in the archive)`);
  const target = path.join(outDir, inst.id);
  const staging = target + '.staging';
  await rm(staging, { recursive: true, force: true });
  progress.state = 'downloading';
  progress.instrument = inst.id;
  progress.received = 0;
  progress.total = total;
  let last = 0;
  await pool(wanted, 8, async (name) => {
    const e = byName.get(name)!;
    const data = await zip.read(e);
    const file = path.join(staging, ...name.split('/'));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    progress.received = (progress.received ?? 0) + e.compressedSize;
    if (Date.now() - last > 250) {
      last = Date.now();
      emit();
    }
  });
  await writeFile(path.join(staging, 'riffroll-kit.sfz'), kitSfz(wanted, BIG_RUSTY, rr));
  const descriptor: InstalledInstrument = {
    id: inst.id,
    name: inst.name,
    role: inst.role,
    license: inst.license,
    author: inst.author,
    homepage: inst.homepage,
    attribution: inst.attribution,
    sfz: `${inst.id}/riffroll-kit.sfz`,
    sfzFiles: [`${inst.id}/riffroll-kit.sfz`],
    meta: { ...inst.meta, keymap: 'riffroll-drums-v1' },
  };
  await writeFile(path.join(staging, DESCRIPTOR), JSON.stringify(descriptor, null, 2));
  await rm(target, { recursive: true, force: true });
  await rename(staging, target);
  log(`✓ ${inst.id}`);
  emit();
}
