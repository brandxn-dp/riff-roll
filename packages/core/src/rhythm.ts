/**
 * Rhythm quantisation for notation: turns a track's free-timed notes into bars of beats with standard durations
 * (whole … 64th, dotted, triplets), ties across beats and bars, and rests. Used by the notation view (AlphaTex),
 * MusicXML and Guitar Pro export, and ASCII tab.
 */
import { BarMap } from './timesig';
import type { Song } from './model';

export interface RhythmEvent {
  id: string;
  start: number;
  duration: number;
}

export type NoteValue = 1 | 2 | 4 | 8 | 16 | 32 | 64;

export interface RBeat<E extends RhythmEvent = RhythmEvent> {
  start: number;
  duration: number;
  value: NoteValue;
  dots: 0 | 1 | 2;
  tuplet?: 3;
  rest: boolean;
  /** events sounding in this beat; `tied` = continues from the previous beat (no new attack) */
  notes: { event: E; tied: boolean }[];
}

export interface RBar<E extends RhythmEvent = RhythmEvent> {
  index: number;
  start: number;
  length: number;
  num: number;
  den: number;
  beats: RBeat<E>[];
}

interface Dur {
  ticks: number;
  value: NoteValue;
  dots: 0 | 1 | 2;
  tuplet?: 3;
}

function durations(ppq: number): { plain: Dur[]; all: Dur[] } {
  const values: NoteValue[] = [1, 2, 4, 8, 16, 32, 64];
  const plain: Dur[] = [];
  const trip: Dur[] = [];
  for (const v of values) {
    const base = (ppq * 4) / v;
    plain.push({ ticks: base, value: v, dots: 0 });
    if (v <= 32) plain.push({ ticks: base * 1.5, value: v, dots: 1 });
    if (v <= 16) plain.push({ ticks: base * 1.75, value: v, dots: 2 });
    if (v >= 2) trip.push({ ticks: (base * 2) / 3, value: v, dots: 0, tuplet: 3 });
  }
  const byDesc = (a: Dur, b: Dur) => b.ticks - a.ticks || a.dots - b.dots;
  return { plain: plain.sort(byDesc), all: [...plain, ...trip].sort(byDesc) };
}

const cache = new Map<number, ReturnType<typeof durations>>();

/** Split a span into notatable durations. Prefers plain/dotted values; uses triplets when the span needs them. */
export function splitDuration(span: number, ppq: number): Dur[] {
  let d = cache.get(ppq);
  if (!d) cache.set(ppq, (d = durations(ppq)));
  const greedy = (list: Dur[]) => {
    const out: Dur[] = [];
    let rem = span;
    for (const x of list) {
      while (rem >= x.ticks - 1e-6) {
        out.push(x);
        rem -= x.ticks;
      }
      if (rem < 1e-6) break;
    }
    return { out, rem };
  };
  const p = greedy(d.plain);
  if (p.rem < 1e-6) return p.out;
  const t = greedy(d.all);
  if (t.rem < p.rem) return absorb(t.out, t.rem);
  return absorb(p.out, p.rem);
}

/** A tiny unrepresentable remainder is folded into the last value (notation can't show it anyway). */
function absorb(out: Dur[], rem: number): Dur[] {
  if (!out.length && rem > 0) return [{ ticks: rem, value: 64, dots: 0 }];
  if (out.length && rem > 0)
    out[out.length - 1] = { ...out[out.length - 1], ticks: out[out.length - 1].ticks + rem };
  return out;
}

/** Quantise events into bars of beats. Events should already be on (or near) a grid. */
export function rhythmize<E extends RhythmEvent>(
  events: readonly E[],
  song: Pick<Song, 'timeSigs' | 'ppq' | 'bars'>,
): RBar<E>[] {
  const bm = new BarMap(song.timeSigs, song.ppq);
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const bars: RBar<E>[] = [];
  let ei = 0;
  for (let b = 0; b < song.bars; b++) {
    const info = bm.bar(b);
    const s0 = info.start,
      s1 = info.start + info.length;
    while (ei < sorted.length && sorted[ei].start + sorted[ei].duration <= s0) ei++;
    const inBar: E[] = [];
    for (let i = ei; i < sorted.length && sorted[i].start < s1; i++)
      if (sorted[i].start + sorted[i].duration > s0) inBar.push(sorted[i]);
    const bounds = new Set<number>([s0, s1]);
    for (const e of inBar) {
      bounds.add(Math.max(s0, e.start));
      bounds.add(Math.min(s1, e.start + e.duration));
    }
    const pts = [...bounds].sort((x, y) => x - y);
    const beats: RBeat<E>[] = [];
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k],
        z = pts[k + 1];
      if (z - a < 1) continue;
      const sounding = inBar.filter((e) => e.start <= a && e.start + e.duration > a);
      const pieces = splitDuration(z - a, song.ppq);
      let t = a;
      pieces.forEach((d, pi) => {
        beats.push({
          start: t,
          duration: d.ticks,
          value: d.value,
          dots: d.dots,
          tuplet: d.tuplet,
          rest: sounding.length === 0,
          notes: sounding.map((e) => ({ event: e, tied: pi > 0 || e.start < a })),
        });
        t += d.ticks;
      });
    }
    bars.push({ index: b, start: s0, length: info.length, num: info.num, den: info.den, beats });
  }
  return bars;
}
