/**
 * Native project format: `.riff` = a zip containing `song.json` (versioned, validated with zod, migrated on load)
 * plus any user-imported assets under `assets/` (custom IRs, instruments).
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { parseSong } from './schema';
import type { Song } from './model';

export const RIFF_MIME = 'application/x-riffroll';

export interface RiffFile {
  song: Song;
  assets: Record<string, Uint8Array>;
}

export function packRiff(song: Song, assets: Record<string, Uint8Array> = {}): Uint8Array {
  const files: Zippable = {
    'song.json': [strToU8(JSON.stringify(song, null, 1)), { level: 6 }],
    mimetype: [strToU8(RIFF_MIME), { level: 0 }],
  };
  // audio assets are already compressed: store them
  for (const [name, data] of Object.entries(assets)) files[`assets/${name}`] = [data, { level: 0 }];
  return zipSync(files);
}

export function unpackRiff(bytes: Uint8Array): RiffFile {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('Not a Riff Roll file (expected a .riff zip archive).');
  }
  const json = entries['song.json'];
  if (!json) throw new Error('This .riff file has no song.json.');
  let raw: unknown;
  try {
    raw = JSON.parse(strFromU8(json));
  } catch {
    throw new Error('song.json in this .riff file is not valid JSON.');
  }
  const assets: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(entries))
    if (name.startsWith('assets/') && data.length) assets[name.slice(7)] = data;
  return { song: parseSong(raw), assets };
}

/** True if the bytes look like a zip (PK\x03\x04). */
export const isZip = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
