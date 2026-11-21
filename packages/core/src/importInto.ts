/**
 * Bring the tracks of another file (a MIDI file, usually) into the open song: each source track becomes a new
 * track of the type and instrument you pick, goes into one of the song's tracks, or is skipped. Everything lands
 * from a chosen tick on, as one undo step. The song keeps its own tempo and time signatures unless asked to take
 * the file's from that point on.
 */
import { cmd, setBars } from './commands';
import { convertTrack } from './convert';
import { BarMap } from './timesig';
import { TRACK_COLORS } from './templates';
import { newId, type Song, type Track, type TrackType } from './model';

export type ImportAction =
  | { kind: 'skip' }
  | { kind: 'new'; type: TrackType; instrument?: string; name?: string }
  | { kind: 'into'; trackId: string };

export interface ImportOptions {
  /** where the file's first beat lands (ticks of the open song) */
  at: number;
  /** one per source track, in order */
  actions: ImportAction[];
  /** also take the file's tempo and time signatures from `at` on */
  takeTempo?: boolean;
}

/** The source tracks with what they hold, for the import dialog. */
export function describeSource(src: Song) {
  return src.tracks.map((t) => {
    const pitches = t.notes.map((n) => n.pitch);
    return {
      name: t.name,
      type: t.type,
      count: t.type === 'drums' ? t.hits.length : t.notes.length,
      low: pitches.length ? Math.min(...pitches) : null,
      high: pitches.length ? Math.max(...pitches) : null,
    };
  });
}

/** A source track's events moved by `dt` ticks with fresh ids (so a file can be imported twice). */
function shifted(t: Track, dt: number): Pick<Track, 'notes' | 'hits'> {
  return {
    notes: t.notes.map((n) => ({ ...n, id: newId('n'), start: n.start + dt })),
    hits: t.hits.map((h) => ({ ...h, id: newId('h'), start: h.start + dt })),
  };
}

export function importIntoSong(src: Song, o: ImportOptions) {
  return cmd('Import MIDI', (song: Song) => {
    const at = Math.max(0, Math.round(o.at));
    const scale = song.ppq / src.ppq;
    let tracks = [...song.tracks];
    let added = 0;
    let end = 0;
    src.tracks.forEach((raw, i) => {
      const a = o.actions[i] ?? { kind: 'skip' };
      if (a.kind === 'skip') return;
      // the file's ticks in the song's resolution
      const s: Track =
        scale === 1
          ? raw
          : {
              ...raw,
              notes: raw.notes.map((n) => ({
                ...n,
                start: Math.round(n.start * scale),
                duration: Math.round(n.duration * scale),
              })),
              hits: raw.hits.map((h) => ({ ...h, start: Math.round(h.start * scale) })),
            };
      for (const n of s.notes) end = Math.max(end, at + n.start + n.duration);
      for (const h of s.hits) end = Math.max(end, at + h.start + 1);
      if (a.kind === 'new') {
        const conv = convertTrack(s, a.type, song.ppq);
        const t: Track = {
          ...conv,
          ...shifted(conv, at),
          id: newId('trk'),
          name: a.name?.trim() || conv.name,
          color: TRACK_COLORS[(song.tracks.length + added) % TRACK_COLORS.length],
          instrument: a.instrument || conv.instrument,
          mute: false,
          solo: false,
        };
        // a fresh string choice for the new tuning
        t.notes = t.notes.map((n) => ({ ...n, pinnedString: null }));
        tracks.push(t);
        added++;
        return;
      }
      const target = tracks.find((t) => t.id === a.trackId);
      if (!target) return;
      const conv = convertTrack(s, target.type, song.ppq);
      const ev = shifted(conv, at);
      // what the track already plays isn't doubled (a doubled drum hit or note plays twice as loud)
      const hitKey = (h: { start: number; piece: string; articulation: string }) =>
        `${h.start}:${h.piece}:${h.articulation}`;
      const noteKey = (n: { start: number; pitch: number }) => `${n.start}:${n.pitch}`;
      const haveHits = new Set(target.hits.map(hitKey));
      const haveNotes = new Set(target.notes.map(noteKey));
      ev.hits = ev.hits.filter((h) => !haveHits.has(hitKey(h)));
      ev.notes = ev.notes.filter((n) => !haveNotes.has(noteKey(n)));
      tracks = tracks.map((t) =>
        t.id === target.id
          ? {
              ...t,
              notes: [...t.notes, ...ev.notes.map((n) => ({ ...n, pinnedString: null }))].sort(
                (x, y) => x.start - y.start,
              ),
              hits: [...t.hits, ...ev.hits].sort((x, y) => x.start - y.start),
            }
          : t,
      );
    });
    let next: Song = { ...song, tracks };
    if (o.takeTempo) {
      const bm = new BarMap(song.timeSigs, song.ppq);
      const atBar = bm.barAtTick(at).index;
      next = {
        ...next,
        tempos: [
          ...song.tempos.filter((t) => t.tick < at),
          ...src.tempos.map((t) => ({ ...t, tick: at + Math.round(t.tick * scale) })),
        ],
        timeSigs: [
          ...song.timeSigs.filter((t) => t.bar < atBar),
          ...src.timeSigs.map((t) => ({ ...t, bar: atBar + t.bar })),
        ],
      };
    }
    // grow the song to fit what came in
    const bm = new BarMap(next.timeSigs, next.ppq);
    if (end > bm.barStart(next.bars)) next = setBars(bm.barAtTick(end - 1).index + 1).apply(next);
    return next;
  });
}
