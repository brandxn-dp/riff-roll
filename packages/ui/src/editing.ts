/** Selection-based edit operations shared by shortcuts, menus and the inspector. */
import {
  addHits,
  addNotes,
  newId,
  removeHits,
  removeNotes,
  updateHits,
  updateNotes,
  type DrumHit,
  type Note,
} from '@riffroll/core';
import { currentTrack, songEnd, useStore } from './store';

interface Clip {
  kind: 'notes' | 'hits';
  origin: number;
  notes: Note[];
  hits: DrumHit[];
}
let clipboard: Clip | null = null;

function selected() {
  const st = useStore.getState();
  const t = currentTrack(st);
  if (!t) return null;
  return {
    st,
    t,
    notes: t.notes.filter((n) => st.selection.has(n.id)),
    hits: t.hits.filter((h) => st.selection.has(h.id)),
  };
}

export function deleteSelection() {
  const s = selected();
  if (!s) return;
  if (s.notes.length)
    s.st.exec(
      removeNotes(
        s.t.id,
        s.notes.map((n) => n.id),
      ),
    );
  if (s.hits.length)
    s.st.exec(
      removeHits(
        s.t.id,
        s.hits.map((h) => h.id),
      ),
    );
  s.st.select([]);
}

/**
 * Ctrl+A: every note (or hit) of the track in the editor, and every bar of every track in the global view, so
 * copy / cut / delete there act on the whole song.
 */
export function selectAll() {
  const s = selected();
  if (!s) return;
  s.st.select([...s.t.notes.map((n) => n.id), ...s.t.hits.map((h) => h.id)], null);
  const { song } = s.st;
  s.st.set({
    barSel: { t0: 0, t1: song.tracks.length - 1, b0: 0, b1: song.bars - 1 },
    status: `Selected all ${s.t.notes.length + s.t.hits.length} notes in “${s.t.name}” and every bar of every track (global view)`,
  });
}

export function copy(): boolean {
  const s = selected();
  if (!s || (!s.notes.length && !s.hits.length)) return false;
  const origin = Math.min(...s.notes.map((n) => n.start), ...s.hits.map((h) => h.start));
  clipboard = { kind: s.hits.length ? 'hits' : 'notes', origin, notes: s.notes, hits: s.hits };
  s.st.set({ status: `Copied ${s.notes.length + s.hits.length} event(s)` });
  return true;
}

export function cut() {
  if (copy()) deleteSelection();
}

/** Paste at the cursor (playback start marker). */
export function paste(at?: number) {
  const s = selected();
  if (!s || !clipboard) return;
  const pos = at ?? s.st.cursor;
  const end = songEnd(s.st.song);
  const dt = pos - clipboard.origin;
  const ids: string[] = [];
  if (s.t.type === 'drums') {
    const hits = clipboard.hits
      .map((h) => ({ ...h, id: newId('h'), start: h.start + dt }))
      .filter((h) => h.start >= 0 && h.start < end);
    hits.forEach((h) => ids.push(h.id));
    s.st.exec(addHits(s.t.id, hits, 'Paste'));
  } else {
    const notes = clipboard.notes
      .map((n) => ({ ...n, id: newId('n'), start: n.start + dt, pinnedString: n.pinnedString ?? null }))
      .filter((n) => n.start >= 0 && n.start < end)
      .map((n) => ({ ...n, duration: Math.min(n.duration, end - n.start) }));
    notes.forEach((n) => ids.push(n.id));
    s.st.exec(addNotes(s.t.id, notes, 'Paste'));
  }
  s.st.select(ids, null);
}

/** Ctrl+D: copy the selection to right after its own end (snapped to the grid). */
export function duplicate() {
  const s = selected();
  if (!s || (!s.notes.length && !s.hits.length)) return;
  const starts = [...s.notes.map((n) => n.start), ...s.hits.map((h) => h.start)];
  const ends = [...s.notes.map((n) => n.start + n.duration), ...s.hits.map((h) => h.start + s.st.snap)];
  const span = Math.max(...ends) - Math.min(...starts);
  const step = Math.ceil(span / s.st.snap) * s.st.snap;
  copy();
  paste(Math.min(...starts) + step);
}

/** Q: snap selected (or all) note starts to the grid; lengths are snapped too, never below one grid step. */
export function quantize() {
  const s = selected();
  if (!s) return;
  const q = s.st.snap;
  const notes = s.notes.length || s.hits.length ? s.notes : s.t.notes;
  const hits = s.notes.length || s.hits.length ? s.hits : s.t.hits;
  const ch: Record<string, Partial<Note>> = {};
  for (const n of notes)
    ch[n.id] = { start: Math.round(n.start / q) * q, duration: Math.max(q, Math.round(n.duration / q) * q) };
  if (notes.length) s.st.exec(updateNotes(s.t.id, ch, 'Quantize'));
  const hch: Record<string, Partial<DrumHit>> = {};
  for (const h of hits) hch[h.id] = { start: Math.round(h.start / q) * q };
  if (hits.length) s.st.exec(updateHits(s.t.id, hch, 'Quantize'));
}

/** Arrow keys: move selection in time (grid steps) and pitch (semitones). */
export function nudge(dTicks: number, dPitch: number) {
  const s = selected();
  if (!s || !s.notes.length) return false;
  const end = songEnd(s.st.song);
  const minStart = Math.min(...s.notes.map((n) => n.start));
  const maxEnd = Math.max(...s.notes.map((n) => n.start + n.duration));
  const dt = Math.max(-minStart, Math.min(end - maxEnd, dTicks));
  const ch: Record<string, Partial<Note>> = {};
  for (const n of s.notes)
    ch[n.id] = {
      start: n.start + dt,
      pitch: Math.max(0, Math.min(127, n.pitch + dPitch)),
      ...(dPitch ? { pinnedString: null } : {}),
    };
  s.st.exec(updateNotes(s.t.id, ch, dPitch ? 'Transpose' : 'Move notes'));
  return true;
}
