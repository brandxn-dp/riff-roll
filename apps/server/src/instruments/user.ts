/**
 * User-added instruments (an SFZ file + its samples), stored in the writable instruments folder
 * (Docker: /data/instruments, desktop: <userData>/instruments). Shared by the server and the Electron main process.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const INSTRUMENT_ID = /^user-[A-Za-z0-9_-]{1,72}$/;
const ALLOWED = /\.(sfz|wav|flac|ogg|txt|md)$/i;

export interface UserInstrumentInfo {
  name: string;
  role: 'guitar' | 'bass' | 'drums' | 'other';
  /** main SFZ path relative to the instrument folder */
  sfz: string;
  author?: string;
  license?: string;
}

/** Resolve `rel` inside `root/id`, refusing traversal and unexpected file types. */
export function userFilePath(root: string, id: string, rel: string): string {
  if (!INSTRUMENT_ID.test(id)) throw new Error('bad instrument id');
  const clean = path.posix.normalize('/' + rel.replace(/\\/g, '/')).slice(1);
  if (!clean || clean.startsWith('..') || !ALLOWED.test(clean))
    throw new Error(`file type not allowed: ${rel}`);
  const base = path.resolve(root, id);
  const full = path.resolve(base, clean);
  if (!full.startsWith(base + path.sep)) throw new Error('bad path');
  return full;
}

export async function putUserFile(root: string, id: string, rel: string, data: Uint8Array) {
  const file = userFilePath(root, id, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function finalizeUserInstrument(root: string, id: string, info: UserInstrumentInfo) {
  const sfzFile = userFilePath(root, id, info.sfz);
  if (!existsSync(sfzFile)) throw new Error(`missing ${info.sfz}`);
  if (!['guitar', 'bass', 'drums', 'other'].includes(info.role)) throw new Error('bad role');
  const descriptor = {
    id,
    name: String(info.name || id).slice(0, 80),
    role: info.role,
    license: info.license || 'user-provided',
    author: info.author || '',
    homepage: '',
    attribution: 'Added by the user.',
    sfz: `${id}/${info.sfz.replace(/\\/g, '/')}`,
    sfzFiles: [`${id}/${info.sfz.replace(/\\/g, '/')}`],
    user: true,
  };
  await writeFile(path.join(root, id, 'instrument.json'), JSON.stringify(descriptor, null, 2));
  await writeUserIndex(root);
  return descriptor;
}

export async function removeUserInstrument(root: string, id: string) {
  if (!INSTRUMENT_ID.test(id)) throw new Error('bad instrument id');
  await rm(path.join(root, id), { recursive: true, force: true });
  await writeUserIndex(root);
}

/** Rewrite root/index.json from every instrument.json in root. */
export async function writeUserIndex(root: string) {
  const list: unknown[] = [];
  if (existsSync(root))
    for (const e of await readdir(root, { withFileTypes: true })) {
      const d = path.join(root, e.name, 'instrument.json');
      if (e.isDirectory() && existsSync(d)) list.push(JSON.parse(await readFile(d, 'utf8')));
    }
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'index.json'), JSON.stringify({ instruments: list }, null, 2));
}

/** Merge index.json files: earlier directories win on id clashes. */
export async function mergedIndex(dirs: string[]): Promise<{ instruments: unknown[] }> {
  const seen = new Map<string, unknown>();
  for (const dir of dirs) {
    const f = path.join(dir, 'index.json');
    if (!existsSync(f)) continue;
    try {
      for (const i of JSON.parse(await readFile(f, 'utf8')).instruments ?? [])
        if (!seen.has(i.id)) seen.set(i.id, i);
    } catch {
      /* ignore a broken index */
    }
  }
  return { instruments: [...seen.values()] };
}
