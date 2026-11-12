/**
 * Bar-level editing for the global view (Guitar Pro style): copy / cut / paste whole bars across tracks, insert,
 * delete, duplicate. Inserting or deleting bars changes the song's structure, so everything with a position moves
 * with it: notes, drum hits, pedal stomps, sections, tempo changes, time signatures, repeats and the loop.
 */
import { BarMap } from './timesig';
import { cmd } from './commands';
import {
  isFretted,
  newId,
  type DrumHit,
  type Note,
  type Song,
  type Stomp,
  type TimeSig,
  type Track,
  type TrackType,
} from './model';

type Sig = { num: number; den: number };

export interface BarClipTrack {
  type: TrackType;
  /** positions relative to the start of the copied range */
  notes: Note[];
  hits: DrumHit[];
  stomps: Stomp[];
}
export interface BarClip {
  bars: number;
  /** time signature of each copied bar (an insert-paste recreates them) */
  sigs: Sig[];
  tracks: BarClipTrack[];
}

const bmOf = (s: Song) => new BarMap(s.timeSigs, s.ppq);
const sigLen = (s: Song, g: Sig) => (s.ppq * 4 * g.num) / g.den;

/** Start and end tick of bars `from`..`to` (inclusive). */
export function barSpan(song: Song, from: number, to: number): { start: number; end: number } {
  const bm = bmOf(song);
  return { start: bm.barStart(from), end: bm.barStart(to + 1) };
}

/** Time signature of every bar, one entry per bar. */
function expandSigs(s: Song, bars = s.bars): Sig[] {
  const bm = bmOf(s);
  return Array.from({ length: bars }, (_, i) => {
    const b = bm.bar(i);
    return { num: b.num, den: b.den };
  });
}
function compressSigs(list: Sig[]): TimeSig[] {
  const out: TimeSig[] = [];
  list.forEach((g, i) => {
    const prev = out[out.length - 1];
    if (!prev || prev.num !== g.num || prev.den !== g.den) out.push({ bar: i, num: g.num, den: g.den });
  });
  return out.length ? out : [{ bar: 0, num: 4, den: 4 }];
}

/** Bars with something in them, per track (for the global view's filled cells). */
export function filledBars(song: Song): Map<string, Set<number>> {
  const bm = bmOf(song);
  const out = new Map<string, Set<number>>();
  for (const t of song.tracks) {
    const set = new Set<number>();
    for (const n of t.notes) {
      // a long note fills every bar it sounds in
      const a = bm.barAtTick(n.start).index,
        b = bm.barAtTick(Math.max(n.start, n.start + n.duration - 1)).index;
      for (let i = a; i <= b; i++) set.add(i);
    }
    for (const h of t.hits) set.add(bm.barAtTick(h.start).index);
    out.set(t.id, set);
  }
  return out;
}

export function copyBars(song: Song, trackIds: string[], from: number, to: number): BarClip {
  const { start, end } = barSpan(song, from, to);
  const tracks = trackIds
    .map((id) => song.tracks.find((t) => t.id === id))
    .filter((t): t is Track => !!t)
    .map((t) => ({
      type: t.type,
      notes: t.notes
        .filter((n) => n.start >= start && n.start < end)
        .map((n) => ({ ...n, start: n.start - start, duration: Math.min(n.duration, end - n.start) })),
      hits: t.hits
        .filter((h) => h.start >= start && h.start < end)
        .map((h) => ({ ...h, start: h.start - start })),
      stomps: t.pedal.stomps
        .filter((x) => x.tick >= start && x.tick < end)
        .map((x) => ({ ...x, tick: x.tick - start })),
    }));
  return { bars: to - from + 1, sigs: expandSigs(song).slice(from, to + 1), tracks };
}

/** Remove what starts in [start, end); notes ringing into the range from before are cut at its start. */
function clearTrack(t: Track, start: number, end: number): Track {
  return {
    ...t,
    notes: t.notes
      .filter((n) => n.start < start || n.start >= end)
      .map((n) =>
        n.start < start && n.start + n.duration > start ? { ...n, duration: start - n.start } : n,
      ),
    hits: t.hits.filter((h) => h.start < start || h.start >= end),
    pedal: { ...t.pedal, stomps: t.pedal.stomps.filter((x) => x.tick < start || x.tick >= end) },
  };
}

/** Move everything at or after `from` by `delta` ticks. */
function shiftTrack(t: Track, from: number, delta: number): Track {
  return {
    ...t,
    notes: t.notes.map((n) => (n.start >= from ? { ...n, start: n.start + delta } : n)),
    hits: t.hits.map((h) => (h.start >= from ? { ...h, start: h.start + delta } : h)),
    pedal: {
      ...t.pedal,
      stomps: t.pedal.stomps.map((x) => (x.tick >= from ? { ...x, tick: x.tick + delta } : x)),
    },
  };
}

export const clearBars = (trackIds: string[], from: number, to: number, label = 'Clear bars') =>
  cmd(label, (s) => {
    const { start, end } = barSpan(s, from, to);
    return { ...s, tracks: s.tracks.map((t) => (trackIds.includes(t.id) ? clearTrack(t, start, end) : t)) };
  });

function insertBarsFn(s: Song, at: number, sigs: Sig[]): Song {
  if (!sigs.length) return s;
  at = Math.max(0, Math.min(s.bars, at));
  const n = sigs.length;
  const start = bmOf(s).barStart(at);
  const L = sigs.reduce((a, g) => a + sigLen(s, g), 0);
  const list = expandSigs(s);
  list.splice(at, 0, ...sigs);
  const moveBar = (b: number) => (b >= at ? b + n : b);
  return {
    ...s,
    bars: s.bars + n,
    timeSigs: compressSigs(list),
    tempos: s.tempos.map((p) => (p.tick > 0 && p.tick >= start ? { ...p, tick: p.tick + L } : p)),
    sections: s.sections.map((x) => (x.tick >= start ? { ...x, tick: x.tick + L } : x)),
    repeats: s.repeats.map((r) => ({
      ...r,
      startBar: moveBar(r.startBar),
      endBar: r.endBar >= at ? r.endBar + n : r.endBar,
      endings: r.endings?.map((e) => ({ ...e, bar: moveBar(e.bar) })),
    })),
    loop: s.loop && {
      ...s.loop,
      start: s.loop.start >= start ? s.loop.start + L : s.loop.start,
      end: s.loop.end > start ? s.loop.end + L : s.loop.end,
    },
    tracks: s.tracks.map((t) => shiftTrack(t, start, L)),
  };
}

/** Insert empty bars before bar `at` (in the time signature found there, or the ones given). */
export const insertBars = (at: number, count: number, sigs?: Sig[], label = 'Insert bars') =>
  cmd(label, (s) => {
    const here = expandSigs(s, Math.max(s.bars, at + 1))[Math.min(at, s.bars - 1)] ?? { num: 4, den: 4 };
    return insertBarsFn(s, at, sigs ?? Array.from({ length: count }, () => here));
  });

/** Delete bars `from`..`to` (inclusive) from the whole song; what follows moves left. At least one bar stays. */
export const deleteBars = (from: number, to: number, label = 'Delete bars') =>
  cmd(label, (s) => {
    from = Math.max(0, from);
    to = Math.min(s.bars - 1, to);
    let n = to - from + 1;
    if (n >= s.bars) n = s.bars - 1;
    if (n <= 0) return s;
    to = from + n - 1;
    const { start, end } = barSpan(s, from, to);
    const L = end - start;
    const list = expandSigs(s);
    list.splice(from, n);
    // tempo: drop changes inside the range, but keep the tempo that was in effect at its end
    const inside = s.tempos.filter((p) => p.tick > 0 && p.tick >= start && p.tick < end);
    const tempos = s.tempos
      .filter((p) => !(p.tick > 0 && p.tick >= start && p.tick < end))
      .map((p) => (p.tick >= end ? { ...p, tick: p.tick - L } : p));
    const last = inside[inside.length - 1];
    if (last && !tempos.some((p) => p.tick === start)) tempos.push({ ...last, tick: start });
    tempos.sort((a, b) => a.tick - b.tick);
    const mapBar = (b: number) => (b < from ? b : b > to ? b - n : null);
    const repeats = s.repeats
      .map((r) => {
        const a = mapBar(r.startBar) ?? from;
        const b = mapBar(r.endBar) ?? from - 1;
        return {
          ...r,
          startBar: a,
          endBar: b,
          endings: r.endings
            ?.map((e) => ({ ...e, bar: mapBar(e.bar) }))
            .filter((e): e is { bar: number; passes: number[] } => e.bar != null),
        };
      })
      .filter((r) => r.endBar >= r.startBar);
    const mapTick = (t: number) => (t < start ? t : t >= end ? t - L : start);
    let loop = s.loop && { ...s.loop, start: mapTick(s.loop.start), end: mapTick(s.loop.end) };
    if (loop && loop.end <= loop.start) loop = null;
    return {
      ...s,
      bars: s.bars - n,
      timeSigs: compressSigs(list),
      tempos,
      sections: s.sections
        .filter((x) => x.tick < start || x.tick >= end)
        .map((x) => (x.tick >= end ? { ...x, tick: x.tick - L } : x)),
      repeats,
      loop,
      tracks: s.tracks.map((t) => shiftTrack(clearTrack(t, start, end), end, -L)),
    };
  });

/**
 * Paste a clip at bar `at`. Clip track i goes to targetTrackIds[i]; drum parts only paste onto drum tracks and
 * pitched parts onto pitched tracks. Overwrite replaces what's in those bars; insert makes room first (in every
 * track) with the clip's own time signatures. The song grows if the paste runs past the end.
 */
export const pasteBars = (clip: BarClip, targetTrackIds: string[], at: number, insert: boolean) =>
  cmd(insert ? 'Paste bars (insert)' : 'Paste bars', (s0) => {
    let s = insert ? insertBarsFn(s0, at, clip.sigs) : s0;
    if (at + clip.bars > s.bars) {
      const list = expandSigs(s);
      for (let i = s.bars; i < at + clip.bars; i++) list.push(clip.sigs[i - at] ?? list[list.length - 1]);
      s = { ...s, bars: at + clip.bars, timeSigs: compressSigs(list) };
    }
    const { start, end } = barSpan(s, at, at + clip.bars - 1);
    const tracks = s.tracks.map((t) => {
      const i = targetTrackIds.indexOf(t.id);
      const part = i >= 0 ? clip.tracks[i] : undefined;
      if (!part || (part.type === 'drums') !== (t.type === 'drums')) return t;
      const base = insert ? t : clearTrack(t, start, end);
      const notes = part.notes
        .map((n) => ({ ...n, id: newId('n'), start: n.start + start }))
        .filter((n) => n.start < end)
        .map((n) => ({ ...n, duration: Math.min(n.duration, end - n.start) }));
      const hits = part.hits
        .map((h) => ({ ...h, id: newId('h'), start: h.start + start }))
        .filter((h) => h.start < end);
      const stomps =
        isFretted(t.type) && isFretted(part.type)
          ? part.stomps
              .map((x) => {
                const keepTone = t.pedal.mode === 'advanced' && t.tones.some((tn) => tn.id === x.toneId);
                return {
                  id: newId('stomp'),
                  tick: x.tick + start,
                  ...(keepTone ? { toneId: x.toneId } : {}),
                };
              })
              .filter((x) => x.tick < end && !base.pedal.stomps.some((y) => y.tick === x.tick))
          : [];
      return {
        ...base,
        notes: [...base.notes, ...notes].sort((a, b) => a.start - b.start),
        hits: [...base.hits, ...hits].sort((a, b) => a.start - b.start),
        pedal: { ...base.pedal, stomps: [...base.pedal.stomps, ...stomps].sort((a, b) => a.tick - b.tick) },
      };
    });
    return { ...s, tracks };
  });

/** Copy bars `from`..`to` of every track and insert the copy right after them. */
export const duplicateBars = (from: number, to: number) =>
  cmd('Duplicate bars', (s) => {
    const clip = copyBars(
      s,
      s.tracks.map((t) => t.id),
      from,
      to,
    );
    return pasteBars(
      clip,
      s.tracks.map((t) => t.id),
      to + 1,
      true,
    ).apply(s);
  });
