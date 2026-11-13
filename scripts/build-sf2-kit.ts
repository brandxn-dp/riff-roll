/**
 * pnpm build-sf2-kit <kit.sf2> --id drums-bread --preset 0 --out <dir>
 * pnpm build-sf2-kit <guitar.sf2> --id guitar-x --preset-name L_ALL --melodic --drop "/[0-9]+-R_" --out <dir>
 *
 * Turns a General MIDI SoundFont drum kit into a Riff Roll drum pack: the preset is converted to SFZ + WAV
 * samples, laid out on Riff Roll's drum keymap (packages/core/src/drums.ts), with stand-ins for pieces the kit
 * doesn't have (cross-stick, half-open hi-hat, cymbal chokes, china, splash). The result is zipped for hosting;
 * instruments/manifest.json downloads it like any other pack. Used for Bread Bread's Drum Kit (public domain),
 * which can't be downloaded from Polyphone without an account.
 */
import path from 'node:path';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseSoundFont, soundFontPresetToSfz } from '../packages/audio/src/soundfont.ts';

const args = process.argv.slice(2);
const arg = (name: string, def?: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
};
const input = args.find((a) => a.toLowerCase().endsWith('.sf2'));
if (!input) throw new Error('usage: build-sf2-kit <kit.sf2> --id <id> [--preset 0] [--out dir]');
const id = arg('--id', 'drums-sf2')!;
const presetIndex = Number(arg('--preset', '0'));
const outRoot = path.resolve(arg('--out', 'instruments/build')!);

/** Riff Roll keys taken straight from the kit's General MIDI keys. */
const DIRECT = [35, 36, 38, 40, 42, 44, 46, 49, 57, 51, 53, 50, 48, 43, 41];
/** Pieces the kit lacks, made from its own samples. */
const STANDINS: {
  key: number;
  from: number;
  tune?: number;
  volume?: number;
  extra?: string;
  keepGroup?: boolean;
}[] = [
  // cross-stick: the rimshot, higher, quieter, short
  { key: 37, from: 40, tune: 450, volume: -8, extra: 'ampeg_hold=0 ampeg_decay=0.1 ampeg_sustain=0' },
  // half-open hi-hat: the open hat cut short (stays in the hi-hat choke group)
  { key: 26, from: 46, volume: -1, extra: 'ampeg_hold=0 ampeg_decay=0.5 ampeg_sustain=0', keepGroup: true },
  // crash chokes: a grabbed crash
  { key: 24, from: 49, extra: 'ampeg_hold=0 ampeg_decay=0.14 ampeg_sustain=0' },
  { key: 25, from: 57, extra: 'ampeg_hold=0 ampeg_decay=0.14 ampeg_sustain=0' },
  // china: the second crash tuned down; splash: the first crash tuned up and shorter
  { key: 52, from: 57, tune: -300, volume: -1 },
  { key: 55, from: 49, tune: 700, volume: -5, extra: 'ampeg_hold=0 ampeg_decay=1.2 ampeg_sustain=0' },
];

const sf = parseSoundFont(new Uint8Array(await readFile(input)));
// --preset-name picks a preset by name (the file's preset order isn't its index order)
const byName = arg('--preset-name');
const pIndex = byName ? (sf.presets.find((p) => p.name === byName)?.index ?? -1) : presetIndex;
const preset = sf.presets.find((p) => p.index === pIndex) ?? (() => { throw new Error(`no preset ${byName ?? presetIndex}`); })(); // prettier-ignore
const conv = soundFontPresetToSfz(sf, pIndex);

/** zip a pack folder with the 7-Zip binary the instrument fetcher uses */
async function zipPack(dir: string) {
  const { path7za } = createRequire(path.resolve('apps/server/package.json'))('7zip-bin') as {
    path7za: string;
  };
  const zip = path.join(outRoot, `${id}.zip`);
  await rm(zip, { force: true });
  execFileSync(path7za, ['a', '-tzip', '-mx=9', zip, './*'], { cwd: dir, stdio: 'ignore' });
  return zip;
}

// --melodic: a pitched instrument (e.g. a guitar) keeps its own layout; --drop leaves out regions whose sample
// name matches (e.g. release-noise layers, which the sampler would play at note-on)
if (args.includes('--melodic')) {
  const drop = arg('--drop') ? new RegExp(arg('--drop')!) : null;
  const lines = conv.sfz.split('\n').filter((l) => !(l.startsWith('<region>') && drop?.test(l)));
  const used = new Set(lines.flatMap((l) => /sample=(\S+)/.exec(l)?.[1] ?? []));
  const dir = path.join(outRoot, id);
  await rm(dir, { recursive: true, force: true });
  await mkdir(path.join(dir, 'samples'), { recursive: true });
  for (const f of conv.files) if (used.has(f.path)) await writeFile(path.join(dir, f.path), f.data);
  await writeFile(path.join(dir, 'riffroll.sfz'), lines.join('\n') + '\n');
  const zip = await zipPack(dir);
  console.log(
    `${id}: ${lines.filter((l) => l.startsWith('<region>')).length} regions, ${used.size} samples → ${zip}`,
  );
  process.exit(0);
}

interface Region {
  ops: Map<string, string>;
}
const regions: Region[] = conv.sfz
  .split('\n')
  .filter((l) => l.startsWith('<region>'))
  .map((l) => ({
    ops: new Map(
      l
        .slice('<region>'.length)
        .trim()
        .split(/\s+/)
        .map((kv) => kv.split('=') as [string, string]),
    ),
  }));

/** The kit's regions for one GM key, re-pinned to `key` so they sound exactly as they did at `from`. */
function regionsFor(from: number, key: number, tune = 0, volume = 0, extra = '', keepGroup = true): string[] {
  const out: string[] = [];
  for (const r of regions) {
    const lo = Number(r.ops.get('lokey')),
      hi = Number(r.ops.get('hikey'));
    if (from < lo || from > hi) continue;
    const o = new Map(r.ops);
    const keytrack = o.get('pitch_keytrack') === '0' ? 0 : 1;
    const center = Number(o.get('pitch_keycenter') ?? from);
    // fixed pitch: what the kit played at `from`, plus the stand-in's tuning
    const cents = Number(o.get('tune') ?? 0) + keytrack * (from - center) * 100 + tune;
    o.delete('lokey');
    o.delete('hikey');
    o.delete('tune');
    o.set('pitch_keytrack', '0');
    if (cents) o.set('tune', String(Math.round(cents)));
    if (volume) o.set('volume', String(Number(o.get('volume') ?? 0) + volume));
    if (!keepGroup) {
      o.delete('group');
      o.delete('off_by');
    }
    // one-shot: a drum hit plays out however short the note is
    o.delete('loop_mode');
    o.delete('loop_start');
    o.delete('loop_end');
    for (const kv of extra.split(/\s+/).filter(Boolean)) {
      const [k, v] = kv.split('=');
      o.set(k, v);
    }
    const sample = o.get('sample')!;
    o.delete('sample');
    out.push(`<region> key=${key} ${[...o].map(([k, v]) => `${k}=${v}`).join(' ')} sample=${sample}`);
  }
  if (!out.length) throw new Error(`the kit has nothing on key ${from}`);
  return out;
}

const lines = [
  `// ${preset.name} from "${sf.name}", laid out on Riff Roll's drum keymap by scripts/build-sf2-kit.ts`,
  '<global> loop_mode=one_shot off_mode=fast amp_veltrack=60',
];
for (const k of DIRECT) lines.push(...regionsFor(k, k));
for (const s of STANDINS) lines.push(...regionsFor(s.from, s.key, s.tune, s.volume, s.extra, !!s.keepGroup));

// only the samples the kit file uses
const used = new Set(lines.flatMap((l) => /sample=(\S+)/.exec(l)?.[1] ?? []));
const dir = path.join(outRoot, id);
await rm(dir, { recursive: true, force: true });
await mkdir(path.join(dir, 'samples'), { recursive: true });
for (const f of conv.files) if (used.has(f.path)) await writeFile(path.join(dir, f.path), f.data);
await writeFile(path.join(dir, 'riffroll-kit.sfz'), lines.join('\n') + '\n');

const zip = await zipPack(dir);
console.log(`${id}: ${lines.length - 2} regions, ${used.size} samples → ${zip}`);
