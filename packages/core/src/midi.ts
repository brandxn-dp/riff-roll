/**
 * Standard MIDI File import/export (format 1). Pedal stomps export as program changes (clean 27 / overdrive 29 /
 * distortion 30) plus CC 80 (0 = clean, 127 = driven) so DAWs and amp plug-ins can follow them.
 */
import { BarMap } from './timesig';
import { DRUM_LANES, laneById, laneForGm } from './drums';
import { toneChanges } from './pedal';
import { TRACK_COLORS, makeTrack, newSong } from './templates';
import { tuningByName } from './tunings';
import { PPQ, newId, type DrumHit, type Note, type Song, type Track } from './model';

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
}

export function midiToSong(bytes: Uint8Array, title = 'Imported MIDI'): Song {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const str = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (str(0) !== 'MThd') throw new Error('Not a MIDI file.');
  const division = dv.getUint16(12);
  if (division & 0x8000) throw new Error('SMPTE-timed MIDI files are not supported.');
  const scale = PPQ / division;
  const ntrks = dv.getUint16(10);
  let p = 8 + dv.getUint32(4);
  const tempos: { tick: number; bpm: number }[] = [];
  const sigs: { tick: number; num: number; den: number }[] = [];
  const markers: { tick: number; name: string }[] = [];
  const names = new Map<number, string>();
  const programs = new Map<string, number>();
  const notes: RawNote[] = [];
  for (let ti = 0; ti < ntrks && p < bytes.length; ti++) {
    if (str(p) !== 'MTrk') break;
    const len = dv.getUint32(p + 4);
    let q = p + 8;
    const end = q + len;
    let tick = 0,
      status = 0;
    const open = new Map<string, RawNote[]>();
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
      if (status === 0xff) {
        const mt = bytes[q++];
        const ml = readVlq();
        const d = bytes.subarray(q, q + ml);
        q += ml;
        if (mt === 0x51 && ml === 3)
          tempos.push({ tick: tick * scale, bpm: 60_000_000 / ((d[0] << 16) | (d[1] << 8) | d[2]) });
        else if (mt === 0x58) sigs.push({ tick: tick * scale, num: d[0], den: 2 ** d[1] });
        else if (mt === 0x03 && !names.has(ti)) names.set(ti, new TextDecoder().decode(d));
        else if (mt === 0x06) markers.push({ tick: tick * scale, name: new TextDecoder().decode(d) });
        else if (mt === 0x2f) break;
      } else if (status === 0xf0 || status === 0xf7) {
        q += readVlq();
      } else if (type === 0x90 || type === 0x80) {
        const pitch = bytes[q++],
          vel = bytes[q++];
        const key = `${chn}:${pitch}`;
        if (type === 0x90 && vel > 0) {
          const n: RawNote = { track: ti, channel: chn, pitch, velocity: vel, start: tick * scale, end: -1 };
          (open.get(key) ?? open.set(key, []).get(key)!).push(n);
          notes.push(n);
        } else {
          const n = open.get(key)?.shift();
          if (n) n.end = tick * scale;
        }
      } else if (type === 0xc0) {
        const prog = bytes[q++];
        if (!programs.has(`${ti}:${chn}`)) programs.set(`${ti}:${chn}`, prog);
      } else if (type === 0xd0) q += 1;
      else q += 2; // 0xa0 0xb0 0xe0
    }
    for (const n of notes) if (n.end < 0) n.end = n.start + PPQ / 2;
    p = end;
  }

  const song = newSong(title);
  song.tracks = [];
  song.tempos = tempos.length
    ? dedupe(tempos.map((t) => ({ tick: Math.round(t.tick), bpm: Math.round(t.bpm * 100) / 100 })))
    : [{ tick: 0, bpm: 120 }];
  // time signatures: convert ticks to bars
  const firstSig = sigs.find((s) => s.tick === 0) ?? { tick: 0, num: 4, den: 4 };
  song.timeSigs = [{ bar: 0, num: firstSig.num, den: firstSig.den }];
  for (const s of sigs.filter((x) => x.tick > 0)) {
    const bm = new BarMap(song.timeSigs, PPQ);
    const bar = bm.barAtTick(s.tick);
    if (bar.start === Math.round(s.tick)) song.timeSigs.push({ bar: bar.index, num: s.num, den: s.den });
  }
  const groups = new Map<string, RawNote[]>();
  for (const n of notes) {
    const k = `${n.track}:${n.channel}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(n);
  }
  let ci = 0;
  for (const [k, list] of groups) {
    const [ti, chn] = k.split(':').map(Number);
    const program = programs.get(k) ?? 0;
    const name = names.get(ti) || (chn === 9 ? 'Drums' : `Track ${song.tracks.length + 1}`);
    const color = TRACK_COLORS[ci++ % TRACK_COLORS.length];
    if (chn === 9) {
      const t = makeTrack('drums', name, color);
      const hits: DrumHit[] = [];
      for (const n of list) {
        const lane = laneForGm(n.pitch) ?? DRUM_LANES.find((l) => l.id === 'snare:center')!;
        hits.push({
          id: newId('h'),
          start: Math.round(n.start),
          piece: lane.piece,
          articulation: lane.articulation,
          velocity: n.velocity,
        });
      }
      song.tracks.push({ ...t, hits: hits.sort((a, b) => a.start - b.start) });
    } else {
      const lowest = Math.min(...list.map((n) => n.pitch));
      const isBass = (program >= 32 && program <= 39) || lowest < 40;
      const t = makeTrack(isBass ? 'bass' : 'guitar', name, color);
      // 7-string range? pick a tuning that reaches the lowest note
      if (!isBass && lowest < 40)
        t.tuning = tuningByName(lowest >= 35 ? '7-string Standard B' : '8-string Standard F#')!;
      if (isBass && lowest < 28) t.tuning = tuningByName('5-string Bass Standard B')!;
      const ns: Note[] = list.map((n) => ({
        id: newId('n'),
        pitch: n.pitch,
        start: Math.round(n.start),
        duration: Math.max(1, Math.round(n.end - n.start)),
        velocity: Math.max(1, n.velocity),
      }));
      song.tracks.push({ ...t, notes: ns.sort((a, b) => a.start - b.start) });
    }
  }
  if (!song.tracks.length) song.tracks = newSong().tracks;
  const lastTick = Math.max(0, ...notes.map((n) => n.end));
  const bm = new BarMap(song.timeSigs, PPQ);
  song.bars = Math.max(1, bm.barAtTick(Math.max(0, lastTick - 1)).index + 1);
  song.sections = markers.map((m) => ({ id: newId('sec'), tick: Math.round(m.tick), name: m.name }));
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
