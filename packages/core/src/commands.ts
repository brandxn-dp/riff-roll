import type { Command } from './history';
import type {
  DrumHit,
  Id,
  Note,
  Pedal,
  Section,
  Song,
  Stomp,
  TempoPoint,
  TimeSig,
  Tone,
  ToneChain,
  Track,
  Tuning,
} from './model';
import { BarMap } from './timesig';

/** Build a command from a label and a pure transform. */
export const cmd = (label: string, apply: (s: Song) => Song): Command => ({ label, apply });

function mapTrack(song: Song, trackId: Id, fn: (t: Track) => Track): Song {
  let changed = false;
  const tracks = song.tracks.map((t) => {
    if (t.id !== trackId) return t;
    const n = fn(t);
    if (n !== t) changed = true;
    return n;
  });
  return changed ? { ...song, tracks } : song;
}

const byStart = <T extends { start: number }>(a: T, b: T) => a.start - b.start;

// ---------------- notes ----------------
export const addNotes = (trackId: Id, notes: Note[], label = notes.length > 1 ? 'Add notes' : 'Add note') =>
  cmd(label, (s) =>
    notes.length ? mapTrack(s, trackId, (t) => ({ ...t, notes: [...t.notes, ...notes].sort(byStart) })) : s,
  );

export const removeNotes = (
  trackId: Id,
  ids: Id[],
  label = ids.length > 1 ? 'Delete notes' : 'Delete note',
) =>
  cmd(label, (s) => {
    const set = new Set(ids);
    return mapTrack(s, trackId, (t) =>
      t.notes.some((n) => set.has(n.id)) ? { ...t, notes: t.notes.filter((n) => !set.has(n.id)) } : t,
    );
  });

export const updateNotes = (trackId: Id, changes: Record<Id, Partial<Note>>, label = 'Edit notes') =>
  cmd(label, (s) =>
    mapTrack(s, trackId, (t) => {
      let any = false;
      const notes = t.notes.map((n) => {
        const c = changes[n.id];
        if (!c) return n;
        any = true;
        return { ...n, ...c, id: n.id };
      });
      return any ? { ...t, notes: notes.sort(byStart) } : t;
    }),
  );

// ---------------- drum hits ----------------
export const addHits = (trackId: Id, hits: DrumHit[], label = 'Add drum hits') =>
  cmd(label, (s) =>
    hits.length ? mapTrack(s, trackId, (t) => ({ ...t, hits: [...t.hits, ...hits].sort(byStart) })) : s,
  );

export const removeHits = (trackId: Id, ids: Id[], label = 'Delete drum hits') =>
  cmd(label, (s) => {
    const set = new Set(ids);
    return mapTrack(s, trackId, (t) =>
      t.hits.some((h) => set.has(h.id)) ? { ...t, hits: t.hits.filter((h) => !set.has(h.id)) } : t,
    );
  });

export const updateHits = (trackId: Id, changes: Record<Id, Partial<DrumHit>>, label = 'Edit drum hits') =>
  cmd(label, (s) =>
    mapTrack(s, trackId, (t) => ({
      ...t,
      hits: t.hits.map((h) => (changes[h.id] ? { ...h, ...changes[h.id], id: h.id } : h)).sort(byStart),
    })),
  );

// ---------------- pedal ----------------
const sortStomps = (st: Stomp[]) => [...st].sort((a, b) => a.tick - b.tick);

export const addStomp = (trackId: Id, stomp: Stomp) =>
  cmd('Add stomp', (s) =>
    mapTrack(s, trackId, (t) =>
      t.pedal.stomps.some((x) => x.tick === stomp.tick)
        ? t
        : { ...t, pedal: { ...t.pedal, stomps: sortStomps([...t.pedal.stomps, stomp]) } },
    ),
  );

export const removeStomp = (trackId: Id, stompId: Id) =>
  cmd('Remove stomp', (s) =>
    mapTrack(s, trackId, (t) => ({
      ...t,
      pedal: { ...t.pedal, stomps: t.pedal.stomps.filter((x) => x.id !== stompId) },
    })),
  );

export const updateStomp = (trackId: Id, stompId: Id, changes: Partial<Stomp>, label = 'Move stomp') =>
  cmd(label, (s) =>
    mapTrack(s, trackId, (t) => ({
      ...t,
      pedal: {
        ...t.pedal,
        stomps: sortStomps(
          t.pedal.stomps.map((x) => (x.id === stompId ? { ...x, ...changes, id: x.id } : x)),
        ),
      },
    })),
  );

export const setPedal = (trackId: Id, changes: Partial<Pedal>, label = 'Pedal settings') =>
  cmd(label, (s) => mapTrack(s, trackId, (t) => ({ ...t, pedal: { ...t.pedal, ...changes } })));

// ---------------- tones ----------------
export const addTone = (trackId: Id, tone: Tone) =>
  cmd('Add tone', (s) => mapTrack(s, trackId, (t) => ({ ...t, tones: [...t.tones, tone] })));

export const updateTone = (
  trackId: Id,
  toneId: Id,
  changes: Partial<Omit<Tone, 'chain'>> & { chain?: Partial<ToneChain> },
  label = 'Edit tone',
) =>
  cmd(label, (s) =>
    mapTrack(s, trackId, (t) => ({
      ...t,
      tones: t.tones.map((x) =>
        x.id === toneId ? { ...x, ...changes, chain: { ...x.chain, ...(changes.chain ?? {}) } } : x,
      ),
    })),
  );

export const removeTone = (trackId: Id, toneId: Id) =>
  cmd('Remove tone', (s) =>
    mapTrack(s, trackId, (t) => {
      if (t.tones.length <= 1) return t;
      const tones = t.tones.filter((x) => x.id !== toneId);
      const fallback = tones[0].id;
      const fix = (id: Id) => (id === toneId ? fallback : id);
      const toggle: [Id, Id] = [fix(t.pedal.toggle[0]), fix(t.pedal.toggle[1])];
      return {
        ...t,
        tones,
        pedal: {
          ...t.pedal,
          startTone: fix(t.pedal.startTone),
          toggle,
          stomps: t.pedal.stomps.map((x) => (x.toneId === toneId ? { ...x, toneId: fallback } : x)),
        },
      };
    }),
  );

// ---------------- tracks ----------------
export const updateTrack = (trackId: Id, changes: Partial<Track>, label = 'Track settings') =>
  cmd(label, (s) => mapTrack(s, trackId, (t) => ({ ...t, ...changes, id: t.id })));

export const setTuning = (trackId: Id, tuning: Tuning) =>
  cmd('Change tuning', (s) =>
    mapTrack(s, trackId, (t) => ({
      ...t,
      tuning,
      // pins to strings that no longer exist are dropped
      notes: t.notes.map((n) =>
        n.pinnedString != null && n.pinnedString >= tuning.strings.length ? { ...n, pinnedString: null } : n,
      ),
    })),
  );

export const addTrack = (track: Track, index?: number) =>
  cmd('Add track', (s) => {
    const tracks = [...s.tracks];
    tracks.splice(index ?? tracks.length, 0, track);
    return { ...s, tracks };
  });

export const removeTrack = (trackId: Id) =>
  cmd('Delete track', (s) => ({ ...s, tracks: s.tracks.filter((t) => t.id !== trackId) }));

export const moveTrack = (trackId: Id, toIndex: number) =>
  cmd('Move track', (s) => {
    const from = s.tracks.findIndex((t) => t.id === trackId);
    if (from < 0 || from === toIndex) return s;
    const tracks = [...s.tracks];
    const [t] = tracks.splice(from, 1);
    tracks.splice(toIndex, 0, t);
    return { ...s, tracks };
  });

// ---------------- song ----------------
export const updateSong = (changes: Partial<Omit<Song, 'tracks'>>, label = 'Song settings') =>
  cmd(label, (s) => ({ ...s, ...changes }));

export const setTempos = (tempos: TempoPoint[]) =>
  cmd('Change tempo', (s) => ({
    ...s,
    tempos: [...tempos]
      .sort((a, b) => a.tick - b.tick)
      .map((p) => ({ ...p, bpm: Math.max(20, Math.min(400, p.bpm)) })),
  }));

export const setTimeSigs = (timeSigs: TimeSig[]) =>
  cmd('Change time signature', (s) => ({ ...s, timeSigs: [...timeSigs].sort((a, b) => a.bar - b.bar) }));

/** Change song length. Events past the new end are removed (undo restores them). */
export const setBars = (bars: number) =>
  cmd('Change length', (s) => {
    bars = Math.max(1, Math.min(2000, Math.round(bars)));
    if (bars === s.bars) return s;
    const end = new BarMap(s.timeSigs, s.ppq).barStart(bars);
    return {
      ...s,
      bars,
      sections: s.sections.filter((x) => x.tick < end),
      tracks: s.tracks.map((t) => ({
        ...t,
        notes: t.notes
          .filter((n) => n.start < end)
          .map((n) => (n.start + n.duration > end ? { ...n, duration: end - n.start } : n)),
        hits: t.hits.filter((h) => h.start < end),
        pedal: { ...t.pedal, stomps: t.pedal.stomps.filter((x) => x.tick < end) },
      })),
    };
  });

export const addSection = (section: Section) =>
  cmd('Add section', (s) => ({ ...s, sections: [...s.sections, section].sort((a, b) => a.tick - b.tick) }));
export const updateSection = (id: Id, changes: Partial<Section>) =>
  cmd('Edit section', (s) => ({
    ...s,
    sections: s.sections
      .map((x) => (x.id === id ? { ...x, ...changes, id } : x))
      .sort((a, b) => a.tick - b.tick),
  }));
export const removeSection = (id: Id) =>
  cmd('Delete section', (s) => ({ ...s, sections: s.sections.filter((x) => x.id !== id) }));

export const setLoop = (loop: Song['loop']) => cmd('Set loop', (s) => ({ ...s, loop }));
