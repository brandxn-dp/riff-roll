/**
 * SFZ subset parser. Supports headers <control> <global> <master> <group> <region>, `#define`, comments,
 * and the opcodes the sampler uses (see SfzRegion). Unknown opcodes are kept in `raw` so nothing is lost.
 */

export interface SfzRegion {
  sample: string; // resolved path (default_path applied), forward slashes
  lokey: number;
  hikey: number;
  pitchKeycenter: number;
  lovel: number;
  hivel: number;
  lorand: number;
  hirand: number;
  seqLength: number;
  seqPosition: number;
  trigger: 'attack' | 'release' | 'first' | 'legato';
  group: number;
  offBy: number;
  offMode: 'fast' | 'normal';
  ampeg: { attack: number; hold: number; decay: number; sustain: number; release: number; delay: number };
  ampVeltrack: number; // percent
  tune: number; // cents
  transpose: number; // semitones
  volume: number; // dB
  pan: number; // -100..100
  offset: number; // samples
  loopMode: 'no_loop' | 'one_shot' | 'loop_continuous' | 'loop_sustain';
  loopStart?: number;
  loopEnd?: number;
  /** Pitch tracking in cents per key (100 = normal). 0 for unpitched (drums). */
  pitchKeytrack: number;
  raw: Record<string, string>;
}

const NOTE_OFFSETS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/** "c4" = 60, "f#2", "eb3", or a plain number. */
export function sfzNote(v: string): number {
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(v.trim());
  if (!m) return NaN;
  return (
    (Number(m[3]) + 1) * 12 + NOTE_OFFSETS[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0)
  );
}

type Opcodes = Record<string, string>;

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Split a header's body into opcode=value pairs. Values may contain spaces (sample paths), so a value runs until the
 * next `name=` token or the end of the line.
 */
function parseOpcodes(body: string, into: Opcodes) {
  for (const line of body.split(/\r?\n/)) {
    const re = /([A-Za-z0-9_]+)=/g;
    const marks: { name: string; start: number; valueStart: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) marks.push({ name: m[1], start: m.index, valueStart: m.index + m[0].length });
    for (let i = 0; i < marks.length; i++) {
      const end = i + 1 < marks.length ? marks[i + 1].start : line.length;
      let v = line.slice(marks[i].valueStart, end).trim();
      // only `sample` legitimately contains spaces; other opcodes end at the first space
      if (marks[i].name !== 'sample' && v.includes(' ')) v = v.split(/\s+/)[0];
      into[marks[i].name] = v;
    }
  }
}

const num = (o: Opcodes, k: string, d: number) =>
  o[k] !== undefined && !Number.isNaN(Number(o[k])) ? Number(o[k]) : d;
const key = (o: Opcodes, k: string, d: number) => (o[k] !== undefined ? sfzNote(o[k]) : d);

function toRegion(o: Opcodes, defaultPath: string): SfzRegion | null {
  if (!o.sample) return null;
  let lokey = key(o, 'lokey', 0),
    hikey = key(o, 'hikey', 127),
    center = key(o, 'pitch_keycenter', 60);
  if (o.key !== undefined) {
    lokey = hikey = center = sfzNote(o.key);
    if (o.pitch_keycenter !== undefined) center = key(o, 'pitch_keycenter', center);
  }
  const sample = (defaultPath + o.sample).replace(/\\/g, '/');
  return {
    sample,
    lokey,
    hikey,
    pitchKeycenter: center,
    lovel: num(o, 'lovel', 1),
    hivel: num(o, 'hivel', 127),
    lorand: num(o, 'lorand', 0),
    hirand: num(o, 'hirand', 1),
    seqLength: num(o, 'seq_length', 1),
    seqPosition: num(o, 'seq_position', 1),
    trigger: (o.trigger as SfzRegion['trigger']) ?? 'attack',
    group: num(o, 'group', 0),
    offBy: num(o, 'off_by', 0),
    offMode: o.off_mode === 'normal' ? 'normal' : 'fast',
    ampeg: {
      delay: num(o, 'ampeg_delay', 0),
      attack: num(o, 'ampeg_attack', 0),
      hold: num(o, 'ampeg_hold', 0),
      decay: num(o, 'ampeg_decay', 0),
      sustain: num(o, 'ampeg_sustain', 100),
      release: num(o, 'ampeg_release', 0.001),
    },
    ampVeltrack: num(o, 'amp_veltrack', 100),
    tune: num(o, 'tune', 0),
    transpose: num(o, 'transpose', 0),
    volume: num(o, 'volume', 0),
    pan: num(o, 'pan', 0),
    offset: num(o, 'offset', 0),
    loopMode: (o.loop_mode ?? o.loopmode ?? 'no_loop') as SfzRegion['loopMode'],
    loopStart:
      o.loop_start !== undefined || o.loopstart !== undefined
        ? num(o, o.loop_start ? 'loop_start' : 'loopstart', 0)
        : undefined,
    loopEnd:
      o.loop_end !== undefined || o.loopend !== undefined
        ? num(o, o.loop_end ? 'loop_end' : 'loopend', 0)
        : undefined,
    pitchKeytrack: num(o, 'pitch_keytrack', 100),
    raw: o,
  };
}

export interface SfzInstrument {
  regions: SfzRegion[];
}

export function parseSfz(text: string): SfzInstrument {
  text = stripComments(text);
  // #define $NAME value
  const defines: Record<string, string> = {};
  text = text.replace(/^\s*#define\s+(\$\w+)\s+(\S+).*$/gm, (_m, k: string, v: string) => {
    defines[k] = v;
    return '';
  });
  if (Object.keys(defines).length)
    text = text.replace(/\$\w+/g, (k) => (defines[k] !== undefined ? defines[k] : k));
  text = text.replace(/^\s*#include\s+.*$/gm, ''); // includes are resolved by the loader if needed

  const control: Opcodes = {};
  let global: Opcodes = {},
    master: Opcodes = {},
    group: Opcodes = {};
  const regions: SfzRegion[] = [];
  const re = /<(\w+)>/g;
  const parts: { header: string; body: string }[] = [];
  let m: RegExpExecArray | null,
    last: { header: string; start: number } | null = null;
  while ((m = re.exec(text))) {
    if (last) parts.push({ header: last.header, body: text.slice(last.start, m.index) });
    last = { header: m[1].toLowerCase(), start: m.index + m[0].length };
  }
  if (last) parts.push({ header: last.header, body: text.slice(last.start) });

  for (const p of parts) {
    const ops: Opcodes = {};
    parseOpcodes(p.body, ops);
    switch (p.header) {
      case 'control':
        Object.assign(control, ops);
        break;
      case 'global':
        global = ops;
        master = {};
        group = {};
        break;
      case 'master':
        master = ops;
        group = {};
        break;
      case 'group':
        group = ops;
        break;
      case 'region': {
        const r = toRegion({ ...global, ...master, ...group, ...ops }, control.default_path ?? '');
        if (r) regions.push(r);
        break;
      }
    }
  }
  return { regions };
}

/** Pick candidate regions for a note (key, velocity, random, round-robin position). */
export function selectRegions(
  inst: SfzInstrument,
  pitch: number,
  velocity: number,
  rand: number,
  seqCounter: (r: SfzRegion) => number,
  trigger: SfzRegion['trigger'] = 'attack',
): SfzRegion[] {
  const out: SfzRegion[] = [];
  for (const r of inst.regions) {
    if (pitch < r.lokey || pitch > r.hikey) continue;
    if (velocity < r.lovel || velocity > r.hivel) continue;
    if (r.trigger !== trigger && !(trigger === 'attack' && r.trigger === 'first')) continue;
    if (rand < r.lorand || (rand >= r.hirand && r.hirand < 1)) continue;
    if (r.seqLength > 1 && (seqCounter(r) % r.seqLength) + 1 !== r.seqPosition) continue;
    out.push(r);
  }
  return out;
}
