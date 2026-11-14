/** Selection-based edit operations shared by shortcuts, menus and the inspector. */
import {
  BarMap,
  addHits,
  addNotes,
  cmd,
  newId,
  setBars,
  removeHits,
  removeNotes,
  updateHits,
  updateNotes,
  DRUM_LANES,
  songScale,
  stepInScale,
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

/**
 * Ctrl+B (FL Studio): copy the selection so it starts exactly where its last note ends, and select the copy, so
 * pressing it again keeps going. Drum hits have no length: the copy starts one grid step after the last hit. The
 * song grows if the copy runs past its end. The clipboard is left alone.
 */
export function duplicateAfter(): boolean {
  const s = selected();
  if (!s || (!s.notes.length && !s.hits.length)) return false;
  const starts = [...s.notes.map((n) => n.start), ...s.hits.map((h) => h.start)];
  const ends = [...s.notes.map((n) => n.start + n.duration), ...s.hits.map((h) => h.start + s.st.snap)];
  const dt = Math.max(...ends) - Math.min(...starts);
  const notes = s.notes.map((n) => ({
    ...n,
    id: newId('n'),
    start: n.start + dt,
    pinnedString: n.pinnedString ?? null,
  }));
  const hits = s.hits.map((h) => ({ ...h, id: newId('h'), start: h.start + dt }));
  const last = Math.max(...notes.map((n) => n.start + n.duration), ...hits.map((h) => h.start + 1));
  const song = s.st.song;
  const bm = new BarMap(song.timeSigs, song.ppq);
  const grow = last > songEnd(song) ? setBars(bm.barAtTick(last - 1).index + 1) : null;
  const add = hits.length ? addHits(s.t.id, hits) : addNotes(s.t.id, notes);
  s.st.exec(cmd('Duplicate after', (x) => (grow ? grow.apply(add.apply(x)) : add.apply(x))));
  s.st.select([...notes.map((n) => n.id), ...hits.map((h) => h.id)], null);
  s.st.set({ status: `Duplicated ${notes.length + hits.length} after the selection` });
  return true;
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
/** Move the selected notes in time and/or pitch. With snap to scale on, semitone steps go to the next scale note. */
export function nudge(dTicks: number, dPitch: number, scaleStep = false) {
  const s = selected();
  if (!s || !s.notes.length) return false;
  const end = songEnd(s.st.song);
  const minStart = Math.min(...s.notes.map((n) => n.start));
  const maxEnd = Math.max(...s.notes.map((n) => n.start + n.duration));
  const dt = Math.max(-minStart, Math.min(end - maxEnd, dTicks));
  const scale = s.st.snapScale ? songScale(s.st.song) : null;
  const move = (p: number) => {
    if (!dPitch) return p;
    if (scale && scaleStep && Math.abs(dPitch) === 1) return stepInScale(p, dPitch, scale);
    return p + dPitch;
  };
  const ch: Record<string, Partial<Note>> = {};
  for (const n of s.notes)
    ch[n.id] = {
      start: n.start + dt,
      pitch: Math.max(0, Math.min(127, move(n.pitch))),
      ...(dPitch ? { pinnedString: null } : {}),
    };
  s.st.exec(updateNotes(s.t.id, ch, dPitch ? 'Transpose' : 'Move notes'));
  return true;
}

/** Drum grid: move the selected hits in time and/or to a neighbouring lane (+1 = the lane below). */
export function nudgeHits(dTicks: number, dLane: number) {
  const s = selected();
  if (!s || !s.hits.length) return false;
  const end = songEnd(s.st.song);
  const minStart = Math.min(...s.hits.map((h) => h.start));
  const maxStart = Math.max(...s.hits.map((h) => h.start));
  const dt = Math.max(-minStart, Math.min(end - 1 - maxStart, dTicks));
  const idx = (h: DrumHit) => DRUM_LANES.findIndex((l) => l.id === `${h.piece}:${h.articulation}`);
  const lanes = s.hits.map(idx);
  const dl = Math.max(-Math.min(...lanes), Math.min(DRUM_LANES.length - 1 - Math.max(...lanes), dLane));
  const ch: Record<string, Partial<DrumHit>> = {};
  for (const h of s.hits) {
    const lane = DRUM_LANES[Math.max(0, idx(h) + dl)];
    ch[h.id] = { start: h.start + dt, piece: lane.piece, articulation: lane.articulation };
  }
  s.st.exec(updateHits(s.t.id, ch, dl ? 'Move hits to another drum' : 'Move hits'));
  return true;
}
