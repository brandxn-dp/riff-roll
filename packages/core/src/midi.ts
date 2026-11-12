/**
 * Standard MIDI File import/export (format 1). Pedal stomps export as program changes (clean 27 / overdrive 29 /
 * distortion 30) plus CC 80 (0 = clean, 127 = driven) so DAWs and amp plug-ins can follow them.
 */
import { BarMap } from './timesig';
import { DRUM_LANES, laneById, laneForGm } from './drums';
import { toneChanges } from './pedal';
import { TRACK_COLORS, makeTrack, newSong } from './templates';
import { BASS_TUNINGS, GUITAR_TUNINGS } from './tunings';
import {
  PPQ,
  newId,
  type CurvePoint,
  type DrumHit,
  type Note,
  type Song,
  type Techniques,
  type Track,
  type Tuning,
} from './model';

// ---------------- writing ----------------
function vlq(n: number): number[] {
  const out = [n & 0x7f];
  while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
  return out;
}
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u16 = (n: number) => [(n >>> 8) & 255, n & 255];
const text = (s: string) => [...new TextEncoder().encode(s)];

interface Ev {
  tick: number;
  order: number; // tie-break: meta 0, program 1, cc 2, note-off 3, note-on 4
  data: number[];
}

function chunk(events: Ev[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body: number[] = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(Math.max(0, Math.round(e.tick - last))), ...e.data);
    last = Math.round(e.tick);
  }
  body.push(0, 0xff, 0x2f, 0);
  return [...text('MTrk'), ...u32(body.length), ...body];
}

const meta = (tick: number, type: number, data: number[]): Ev => ({
  tick,
  order: 0,
  data: [0xff, type, ...vlq(data.length), ...data],
});

function toneProgram(track: Track, toneId: string): { program: number; driven: boolean } {
  const tone = track.tones.find((t) => t.id === toneId);
  const ch = tone?.chain.amp.character ?? 'clean';
  if (track.type === 'bass') return { program: ch === 'clean' ? 33 : 34, driven: ch !== 'clean' };
  return { program: ch === 'clean' ? 27 : ch === 'crunch' ? 29 : 30, driven: ch !== 'clean' };
}

export function songToMidi(song: Song): Uint8Array {
  const bm = new BarMap(song.timeSigs, song.ppq);
  const scale = PPQ / song.ppq;
  const conductor: Ev[] = [meta(0, 0x03, text(song.title || 'Riff Roll'))];
  for (const t of song.tempos) {
    const us = Math.round(60_000_000 / t.bpm);
    conductor.push(meta(t.tick * scale, 0x51, [(us >> 16) & 255, (us >> 8) & 255, us & 255]));
  }
  for (const ts of song.timeSigs)
    conductor.push(meta(bm.barStart(ts.bar) * scale, 0x58, [ts.num, Math.round(Math.log2(ts.den)), 24, 8]));
  conductor.push(meta(0, 0x59, [song.keySig.fifths & 255, song.keySig.minor ? 1 : 0]));
  for (const s of song.sections) conductor.push(meta(s.tick * scale, 0x06, text(s.name)));

  const chunks = [chunk(conductor)];
  let nextCh = 0;
  const allocChannel = () => {
    if (nextCh % 16 === 9) nextCh++; // channel 10 is reserved for drums
    return nextCh++ % 16;
  };
  for (const t of song.tracks) {
    const channel = t.type === 'drums' ? 9 : allocChannel();
    const evs: Ev[] = [meta(0, 0x03, text(t.name))];
    const vol = Math.round(Math.min(1, t.volume / 1.25) * 127);
    const pan = Math.round((t.pan + 1) * 63.5);
    evs.push(
      { tick: 0, order: 2, data: [0xb0 | channel, 7, vol] },
      { tick: 0, order: 2, data: [0xb0 | channel, 10, Math.min(127, pan)] },
    );
    if (t.type === 'drums') {
      for (const h of t.hits) {
        const lane = laneById.get(`${h.piece}:${h.articulation}`);
        const key = lane?.gm ?? 38;
        const vel = Math.max(1, Math.min(127, Math.round(h.velocity * (lane?.velScale ?? 1))));
        evs.push({ tick: h.start * scale, order: 4, data: [0x90 | channel, key, vel] });
        evs.push({ tick: (h.start + song.ppq / 8) * scale, order: 3, data: [0x80 | channel, key, 0] });
      }
    } else {
      for (const c of toneChanges(t.pedal)) {
        const { program, driven } = toneProgram(t, c.toneId);
        evs.push({ tick: c.tick * scale, order: 1, data: [0xc0 | channel, program] });
        evs.push({ tick: c.tick * scale, order: 2, data: [0xb0 | channel, 80, driven ? 127 : 0] });
      }
      for (const n of t.notes) {
        evs.push({ tick: n.start * scale, order: 4, data: [0x90 | channel, n.pitch, n.velocity] });
        evs.push({ tick: (n.start + n.duration) * scale, order: 3, data: [0x80 | channel, n.pitch, 0] });
      }
    }
    chunks.push(chunk(evs));
  }
  const header = [...text('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)];
  return new Uint8Array([...header, ...chunks.flat()]);
}

// ---------------- reading ----------------
interface RawNote {
  track: number;
  channel: number;
  pitch: number;
  velocity: number;
  start: number;
  end: number;
  /** Pitch-bend values (semitones) while the note sounds; the first entry may be a bend already set at note-on. */
  bends?: { tick: number; value: number }[];
  /** How far the start was moved back to line up a strummed chord. */
  strum?: number;
}

/** General MIDI percussion keys without a lane of their own, mapped to the closest piece. */
const GM_DRUM_ALIASES: Record<number, string> = {
  31: 'snare:crossstick', // sticks
  39: 'snare:center', // hand clap
  45: 'tom3:hit', // low tom
  47: 'tom2:hit', // low-mid tom
  54: 'hihat:closed', // tambourine
  56: 'ride:bell', // cowbell
  59: 'ride:bow', // ride 2
  60: 'tom1:hit', // bongos, congas, timbales
  61: 'tom2:hit',
  62: 'tom1:hit',
  63: 'tom2:hit',
  64: 'tom3:hit',
  65: 'tom1:hit',
  66: 'tom2:hit',
  67: 'ride:bell', // agogo
  68: 'ride:bell',
  69: 'hihat:closed', // cabasa, maracas
  70: 'hihat:closed',
  75: 'snare:crossstick', // claves, wood blocks
  76: 'snare:crossstick',
  77: 'snare:crossstick',
  80: 'ride:bell', // triangle
  81: 'ride:bell',
};

/** "Player | Instrument model | Part" (Songsterr exports) → "Part". */
function cleanName(s: string | undefined): string | undefined {
  const parts = (s ?? '')
    .split('|')
    .map((x) => x.trim())
    .filter(Boolean);
  return parts[parts.length - 1];
}

/**
 * Songsterr / Guitar Pro style exports put each string on its own channel (channel 0 = highest string) so bends
 * can be per string. Recognise that: several channels, each (almost always) one note at a time, pitches falling
 * as the channel number rises.
 */
function isStringPerChannel(list: RawNote[]): boolean {
  const chans = [...new Set(list.map((n) => n.channel))].sort((a, b) => a - b);
  if (chans.length < 2 || chans.some((c) => c > 8)) return false;
  const mins: number[] = [];
  for (const c of chans) {
    const ns = list.filter((n) => n.channel === c).sort((a, b) => a.start - b.start);
    let overlaps = 0;
    for (let i = 1; i < ns.length; i++) if (ns[i].start < ns[i - 1].end - PPQ / 32) overlaps++;
    if (overlaps > ns.length * 0.1) return false;
    // the lowest note on a string is near its open pitch, so it falls string by string
    const min = Math.min(...ns.map((n) => n.pitch));
    if (mins.length && min > mins[mins.length - 1]) return false;
    mins.push(min);
  }
  return mins[0] > mins[mins.length - 1];
}

/** Standard tuning shape for any string count (extra strings go below in fourths; a 6th bass string goes above). */
function standardShape(type: 'guitar' | 'bass', n: number): number[] {
  const s = type === 'bass' ? [28, 33, 38, 43] : [40, 45, 50, 55, 59, 64];
  if (type === 'bass' && n >= 6) s.push(48);
  while (s.length < n) s.unshift(s[0] - 5);
  return s.slice(s.length - n);
}

/**
 * Best tunings for the notes played: each string's open pitch must be at or below the lowest note on it, and the
 * closer the better. `mins[i]` is the lowest pitch on string i (0 = lowest string), undefined when unknown.
 * Returns every equally good known tuning, or a lowered standard tuning when none fits.
 */
function tuningCandidates(type: 'guitar' | 'bass', n: number, mins: (number | undefined)[]): Tuning[] {
  const known = (type === 'bass' ? BASS_TUNINGS : GUITAR_TUNINGS).filter((t) => t.strings.length === n);
  let best: Tuning[] = [];
  let bestScore = Infinity;
  for (const t of known) {
    let score = 0;
    for (let i = 0; i < n && score < Infinity; i++) {
      const m = mins[i];
      if (m === undefined) continue;
      score = m < t.strings[i] ? Infinity : score + m - t.strings[i];
    }
    if (score < bestScore) [best, bestScore] = [[t], score];
    else if (score === bestScore && score < Infinity) best.push(t);
  }
  if (best.length) return best.map((t) => ({ name: t.name, strings: [...t.strings] }));
  const shape = standardShape(type, n);
  const down = Math.max(0, ...shape.map((o, i) => (mins[i] === undefined ? 0 : o - mins[i]!)));
  return [{ name: `Custom (${n}-string)`, strings: shape.map((o) => o - down) }];
}

/** Strummed chords arrive as notes a few ticks apart. Line them up on the first note's start (ends stay put). */
function alignStrums(list: RawNote[]) {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  let head = -Infinity,
    prev = -Infinity;
  for (const n of sorted) {
    const at = n.start;
    if (at > head && at - prev <= PPQ / 60 && at - head <= PPQ / 12) {
      n.start = head;
      n.strum = at - head;
    } else head = at;
    prev = at;
  }
}

/**
 * Guitar Pro / Songsterr render dead ("x") notes as blips a few ticks long. Mark them dead and give them their
 * written length (up to the next note in the part) so the score doesn't fill with 128th notes; dead notes are
 * choked on playback anyway.
 */
function markDeadNotes(list: RawNote[]): Set<RawNote> {
  const dead = new Set<RawNote>();
  const starts = [...new Set(list.map((n) => n.start))].sort((a, b) => a - b);
  for (const n of list) {
    const sounded = n.end - n.start - (n.strum ?? 0);
    if (sounded > PPQ / 24) continue;
    let lo = 0,
      hi = starts.length; // first start after this note
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] > n.start) hi = mid;
      else lo = mid + 1;
    }
    const next = starts[lo] ?? n.start + PPQ / 2;
    if (next - n.start < sounded * 3) continue; // fast passage, not a blip
    n.end = n.start + Math.min(PPQ, next - n.start);
    dead.add(n);
  }
  return dead;
}

/** Ramer–Douglas–Peucker on a bend curve (value distance only). */
function simplify(p: CurvePoint[], eps: number): CurvePoint[] {
  if (p.length <= 2) return p;
  const a = p[0],
    b = p[p.length - 1];
  let idx = 0,
    max = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const t = b.pos === a.pos ? 0 : (p[i].pos - a.pos) / (b.pos - a.pos);
    const d = Math.abs(p[i].value - (a.value + (b.value - a.value) * t));
    if (d > max) [max, idx] = [d, i];
  }
  if (max <= eps) return [a, b];
  return [...simplify(p.slice(0, idx + 1), eps).slice(0, -1), ...simplify(p.slice(idx), eps)];
}

/** Pitch-bend events during a note → a bend curve, or vibrato when the pitch wobbles. */
function bendTech(n: RawNote): Techniques | undefined {
  const dur = n.end - n.start;
  const ev = (n.bends ?? []).filter((b) => b.tick >= n.start && b.tick < n.end);
  if (dur <= 0 || !ev.some((b) => Math.abs(b.value) >= 0.1)) return undefined;
  const pts = ev.map((b) => ({ pos: (b.tick - n.start) / dur, value: b.value }));
  if (pts[0].pos > 0) pts.unshift({ pos: 0, value: 0 });
  let turns = 0,
    dir = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.sign(pts[i].value - pts[i - 1].value);
    if (d && dir && d !== dir) turns++;
    if (d) dir = d;
  }
  const values = pts.map((p) => p.value);
  const amp = Math.max(...values) - Math.min(...values);
  if (turns >= 3 && amp < 1.2) return { vibrato: amp > 0.6 ? 'wide' : 'normal' };
  const r = (x: number) => Math.round(x * 100) / 100;
  return { bend: simplify(pts, 0.06).map((p) => ({ pos: r(p.pos), value: r(p.value) })) };
}

export function midiToSong(bytes: Uint8Array, title = 'Imported MIDI'): Song {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (str(0) !== 'MThd') throw new Error('Not a MIDI file.');
  const format = dv.getUint16(8);
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
  const scale = PPQ / division;
  const ntrks = dv.getUint16(10);
  let p = 8 + dv.getUint32(4);
  const tempos: { tick: number; bpm: number }[] = [];
  const sigs = new Map<number, { tick: number; num: number; den: number }>();
  const markers = new Map<string, { tick: number; name: string }>();
  const names = new Map<number, string>();
  const instNames = new Map<number, string>();
  const programs = new Map<string, number>();
  const notes: RawNote[] = [];
  for (let ti = 0; ti < ntrks && p + 8 <= bytes.length;) {
    const len = dv.getUint32(p + 4);
    if (str(p) !== 'MTrk') {
      p += 8 + len; // skip unknown chunks
      continue;
    }
    let q = p + 8;
    const end = Math.min(bytes.length, q + len);
    let tick = 0,
      status = 0;
    const open = new Map<string, RawNote[]>();
    const sounding: RawNote[][] = Array.from({ length: 16 }, () => []);
    const bendNow = new Array<number>(16).fill(0);
    const bendRange = new Array<number>(16).fill(2);
    const rpn = Array.from({ length: 16 }, () => [127, 127]);
    const readVlq = () => {
      let v = 0,
        b: number;
      do {
        b = bytes[q++];
        v = (v << 7) | (b & 0x7f);
      } while (b & 0x80 && q < end);
      return v;
    };
    while (q < end) {
      tick += readVlq();
      // running status: a data byte here reuses the previous status
      if (bytes[q] & 0x80) status = bytes[q++];
      const type = status & 0xf0,
        chn = status & 0x0f;
      const at = tick * scale;
      if (status === 0xff) {
        const mt = bytes[q++];
        const ml = readVlq();
        const d = bytes.subarray(q, q + ml);
        q += ml;
        const txt = () => new TextDecoder().decode(d).trim();
        if (mt === 0x51 && ml === 3)
          tempos.push({ tick: at, bpm: 60_000_000 / ((d[0] << 16) | (d[1] << 8) | d[2]) });
        else if (mt === 0x58) sigs.set(Math.round(at), { tick: at, num: d[0], den: 2 ** d[1] });
        else if (mt === 0x03 && !names.has(ti)) names.set(ti, txt());
        else if (mt === 0x04 && !instNames.has(ti)) instNames.set(ti, txt());
        else if (mt === 0x06 && !/^(MEASURE_\d+|END_OF_VOICE)$/i.test(txt())) {
          // markers are often repeated in every track; Songsterr adds one per bar ("MEASURE_12") and an end mark
          markers.set(`${Math.round(at)}:${txt()}`, { tick: at, name: txt() });
        } else if (mt === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        q += readVlq();
      } else if (type === 0x90 || type === 0x80) {
        const pitch = bytes[q++],
          vel = bytes[q++];
        const key = `${chn}:${pitch}`;
        if (type === 0x90 && vel > 0) {
          const n: RawNote = { track: ti, channel: chn, pitch, velocity: vel, start: at, end: -1 };
          if (bendNow[chn]) n.bends = [{ tick: at, value: bendNow[chn] }];
          (open.get(key) ?? open.set(key, []).get(key)!).push(n);
          sounding[chn].push(n);
          notes.push(n);
        } else {
          const n = open.get(key)?.shift();
          if (n) {
            n.end = at;
            sounding[chn] = sounding[chn].filter((x) => x !== n);
          }
        }
      } else if (type === 0xc0) {
        const prog = bytes[q++];
        if (!programs.has(`${ti}:${chn}`)) programs.set(`${ti}:${chn}`, prog);
      } else if (type === 0xe0) {
        const v = ((bytes[q + 1] << 7) | bytes[q]) - 8192;
        q += 2;
        bendNow[chn] = (v / 8192) * bendRange[chn];
        for (const n of sounding[chn]) (n.bends ??= []).push({ tick: at, value: bendNow[chn] });
      } else if (type === 0xb0) {
        const cc = bytes[q++],
          val = bytes[q++];
        if (cc === 101) rpn[chn][0] = val;
        else if (cc === 100) rpn[chn][1] = val;
        else if (cc === 6 && rpn[chn][0] === 0 && rpn[chn][1] === 0) bendRange[chn] = val || 2; // bend range
      } else if (type === 0xd0) q += 1;
      else q += 2; // 0xa0
    }
    for (const n of notes) if (n.end < 0) n.end = n.start + PPQ / 2;
    p += 8 + len;
    ti++;
  }

  const song = newSong(title);
  song.tracks = [];
  song.tempos = tempos.length
    ? dedupe(tempos.map((t) => ({ tick: Math.round(t.tick), bpm: Math.round(t.bpm * 100) / 100 })))
    : [{ tick: 0, bpm: 120 }];
  // time signatures (often repeated in every track): convert ticks to bars
  const sigList = [...sigs.values()].sort((a, b) => a.tick - b.tick);
  const firstSig = sigList.find((s) => s.tick === 0) ?? { tick: 0, num: 4, den: 4 };
  song.timeSigs = [{ bar: 0, num: firstSig.num, den: firstSig.den }];
  for (const s of sigList.filter((x) => x.tick > 0)) {
    const bar = new BarMap(song.timeSigs, PPQ).barAtTick(s.tick);
    const last = song.timeSigs[song.timeSigs.length - 1];
    if (bar.start !== Math.round(s.tick) || (last.num === s.num && last.den === s.den)) continue;
    song.timeSigs.push({ bar: bar.index, num: s.num, den: s.den });
  }

  // Group notes into tracks. Format 0 keeps every instrument in one MTrk, told apart by channel. Format 1 has one
  // MTrk per instrument, which may still use several channels (one per string in Songsterr exports).
  const groups = new Map<string, RawNote[]>();
  const add = (k: string, n: RawNote) => (groups.get(k) ?? groups.set(k, []).get(k)!).push(n);
  for (let ti = 0; ti < ntrks; ti++) {
    const mine = notes.filter((n) => n.track === ti);
    for (const n of mine) if (n.channel === 9) add(`${ti}:drums`, n);
    const melodic = mine.filter((n) => n.channel !== 9);
    const progs = new Set(melodic.map((n) => programs.get(`${ti}:${n.channel}`) ?? 0));
    const oneTrack = format !== 0 && (progs.size <= 1 || isStringPerChannel(melodic));
    for (const n of melodic) add(oneTrack ? `${ti}:all` : `${ti}:${n.channel}`, n);
  }

  interface Plan {
    track: Track;
    list: RawNote[];
    perString: boolean;
    options: Tuning[];
  }
  const plans: Plan[] = [];
  let ci = 0;
  for (const [k, list] of groups) {
    const [tiS, part] = k.split(':');
    const ti = Number(tiS);
    const program = programs.get(`${ti}:${list[0].channel}`);
    const own = format === 0 && groups.size > 1 ? undefined : cleanName(names.get(ti) || instNames.get(ti));
    const color = TRACK_COLORS[ci++ % TRACK_COLORS.length];
    if (part === 'drums') {
      const t = makeTrack('drums', own || 'Drums', color);
      // GM 40 is "electric snare": the main snare when a part has no 38, a rimshot alongside 38
      const has38 = list.some((n) => n.pitch === 38);
      const hits: DrumHit[] = list.map((n) => {
        const alias = n.pitch === 40 && !has38 ? 'snare:center' : GM_DRUM_ALIASES[n.pitch];
        const lane =
          (alias ? laneById.get(alias) : undefined) ??
          laneForGm(n.pitch) ??
          DRUM_LANES.find((l) => l.id === 'snare:center')!;
        return {
          id: newId('h'),
          start: Math.round(n.start),
          piece: lane.piece,
          articulation: lane.articulation,
          velocity: n.velocity,
        };
      });
      song.tracks.push({ ...t, hits: hits.sort((a, b) => a.start - b.start) });
      continue;
    }
    const perString = isStringPerChannel(list);
    const lowest = Math.min(...list.map((n) => n.pitch));
    const guitarProgram = program !== undefined && program >= 24 && program <= 31;
    const isBass =
      (program !== undefined && program >= 32 && program <= 39) || (!guitarProgram && lowest < 35);
    const type = isBass ? 'bass' : 'guitar';
    const t = makeTrack(type, own || `Track ${song.tracks.length + 1}`, color);
    // overdriven / distortion / harmonics guitar programs start on the driven tone
    if (program !== undefined && program >= 29 && program <= 31) t.pedal.startTone = t.pedal.toggle[1];
    let options: Tuning[] = [];
    if (perString) {
      const maxCh = Math.max(...list.map((n) => n.channel));
      const n = Math.max(type === 'bass' ? 4 : 6, maxCh + 1);
      const mins: (number | undefined)[] = new Array(n).fill(undefined);
      for (const x of list) {
        const s = n - 1 - x.channel;
        mins[s] = Math.min(mins[s] ?? 999, x.pitch);
      }
      options = tuningCandidates(type, n, mins);
    } else {
      // only the lowest note is known: the fewest strings that reach it
      for (const n of type === 'bass' ? [4, 5, 6] : [6, 7, 8]) {
        options = tuningCandidates(type, n, [lowest]);
        if (!options[0].name.startsWith('Custom')) break;
      }
    }
    plans.push({ track: t, list, perString, options });
    song.tracks.push(t);
  }

  // a part that only uses the top strings fits several tunings: prefer the one the other parts clearly use
  const clear = new Map<string, number>();
  for (const pl of plans)
    if (pl.perString && pl.options.length === 1) {
      const key = `${pl.track.type}:${pl.options[0].name}`;
      clear.set(key, (clear.get(key) ?? 0) + 1);
    }
  for (const pl of plans) {
    const votes = (x: Tuning) => clear.get(`${pl.track.type}:${x.name}`) ?? 0;
    const tuning = [...pl.options].sort((a, b) => votes(b) - votes(a))[0];
    const t = pl.track;
    t.tuning = tuning;
    alignStrums(pl.list);
    if (pl.perString) {
      // one note at a time per string: a ringing note stops where the next one on its string starts
      const byString = new Map<number, RawNote[]>();
      for (const n of pl.list)
        (byString.get(n.channel) ?? byString.set(n.channel, []).get(n.channel)!).push(n);
      for (const ns of byString.values()) {
        ns.sort((a, b) => a.start - b.start);
        for (let i = 1; i < ns.length; i++)
          ns[i - 1].end = Math.min(ns[i - 1].end, Math.max(ns[i].start, ns[i - 1].start + 1));
      }
    }
    const dead = pl.perString ? markDeadNotes(pl.list) : new Set<RawNote>();
    t.notes = pl.list
      .map((n) => {
        const note: Note = {
          id: newId('n'),
          pitch: n.pitch,
          start: Math.round(n.start),
          duration: Math.max(1, Math.round(n.end - n.start)),
          velocity: Math.max(1, n.velocity),
        };
        if (pl.perString) {
          // keep the string the tab was written on
          const s = tuning.strings.length - 1 - n.channel;
          const fret = n.pitch - tuning.strings[s] - t.capo;
          if (s >= 0 && fret >= 0 && fret <= t.maxFret) note.pinnedString = s;
        }
        const tech = { ...bendTech(n), ...(dead.has(n) ? { dead: true } : {}) };
        if (Object.keys(tech).length) note.tech = tech;
        return note;
      })
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
  }
  if (!song.tracks.length) song.tracks = newSong().tracks;
  const lastTick = Math.max(0, ...notes.map((n) => n.end));
  const bm = new BarMap(song.timeSigs, PPQ);
  song.bars = Math.max(1, bm.barAtTick(Math.max(0, lastTick - 1)).index + 1);
  song.sections = [...markers.values()]
    .sort((a, b) => a.tick - b.tick)
    .map((m) => ({ id: newId('sec'), tick: Math.round(m.tick), name: m.name }));
  return song;
}

function dedupe(t: { tick: number; bpm: number }[]) {
  const out: { tick: number; bpm: number }[] = [];
  for (const x of t.sort((a, b) => a.tick - b.tick)) {
    if (out.length && out[out.length - 1].tick === x.tick) out[out.length - 1] = x;
    else if (!out.length || out[out.length - 1].bpm !== x.bpm) out.push(x);
  }
  if (!out.length || out[0].tick > 0) out.unshift({ tick: 0, bpm: out[0]?.bpm ?? 120 });
  return out;
}
