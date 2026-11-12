/**
 * Guitar Pro style keyboard tab entry. Active while the tab cursor is shown (click a tab line, Esc leaves).
 *   ← →  move by the note at the cursor (or the entry length)      ↑ ↓  change string
 *   0-9  type a fret (two digits within 0.7 s → 10..24)            Del/Backspace  delete note on this string
 *   + −  longer / shorter entry length (applies to the note too)   .  dotted    T  triplet
 *   R    rest (clear this beat and move on)                        L  tie to previous note
 *   Ins  insert a beat (shift later notes right)                   Ctrl+Del  delete the beat (shift left)
 *   Technique toggles: H hammer/pull  S slide  B bend  V vibrato  P palm mute  X dead  G ghost  A accent
 *                      I let ring  N harmonic  K tap  O staccato  U/D pick up/down  F fade in  M tremolo
 */
import {
  PPQ,
  addNotes,
  newId,
  removeNotes,
  updateNotes,
  type Note,
  type Techniques,
  type Track,
} from '@riffroll/core';
import { trackFingering } from '@riffroll/core';
import { currentTrack, songEnd, useStore } from './store';
import { preview } from './audio-bridge';

let digitBuf = '';
let digitAt = 0;

function notesAt(t: Track, tick: number) {
  return t.notes.filter((n) => n.start <= tick && n.start + n.duration > tick);
}

export function noteOnString(t: Track, tick: number, string: number): Note | undefined {
  const f = trackFingering(t);
  return t.notes.find((n) => n.start === tick && f.get(n.id)?.string === string) ??
    t.notes.find((n) => n.start <= tick && n.start + n.duration > tick && f.get(n.id)?.string === string);
}

function setCursor(tick: number, string: number) {
  const st = useStore.getState();
  const t = currentTrack(st);
  if (!t) return;
  const n = t.tuning.strings.length;
  const c = { tick: Math.max(0, Math.min(songEnd(st.song) - 1, tick)), string: Math.max(0, Math.min(n - 1, string)) };
  const at = noteOnString(t, c.tick, c.string);
  st.set({ tabCursor: c, cursor: c.tick });
  st.select(at ? [at.id] : [], at?.id ?? null);
}

export function tabCursorTo(tick: number, string: number) {
  digitBuf = '';
  setCursor(tick, string);
}

const TOGGLES: Record<string, (t: Techniques) => Partial<Techniques>> = {
  h: (t) => ({ hammer: !t.hammer || undefined }),
  s: (t) => ({ slide: t.slide ? undefined : 'legato' }),
  b: (t) => ({ bend: t.bend ? undefined : [{ pos: 0, value: 0 }, { pos: 0.5, value: 2 }, { pos: 1, value: 2 }] }),
  v: (t) => ({ vibrato: t.vibrato ? undefined : 'normal' }),
  p: (t) => ({ palmMute: !t.palmMute || undefined }),
  x: (t) => ({ dead: !t.dead || undefined }),
  g: (t) => ({ ghost: !t.ghost || undefined }),
  a: (t) => ({ accent: t.accent ? undefined : 'normal' }),
  i: (t) => ({ letRing: !t.letRing || undefined }),
  n: (t) => ({ harmonic: t.harmonic ? undefined : 'natural' }),
  k: (t) => ({ tap: !t.tap || undefined }),
  o: (t) => ({ staccato: !t.staccato || undefined }),
  u: (t) => ({ pick: t.pick === 'up' ? undefined : 'up' }),
  d: (t) => ({ pick: t.pick === 'down' ? undefined : 'down' }),
  f: (t) => ({ fadeIn: !t.fadeIn || undefined }),
  m: (t) => ({ tremolo: t.tremolo ? undefined : 16 }),
  l: (t) => ({ tieFromPrevious: !t.tieFromPrevious || undefined }),
};

/** Apply a technique toggle to notes, dropping keys that become undefined. */
export function toggleTech(track: Track, notes: Note[], key: string, label = 'Technique') {
  const fn = TOGGLES[key];
  if (!fn || !notes.length) return;
  const first = notes[0].tech ?? {};
  const patch = fn(first);
  const ch: Record<string, Partial<Note>> = {};
  for (const n of notes) {
    const tech: Techniques = { ...(n.tech ?? {}), ...patch };
    for (const k of Object.keys(tech) as (keyof Techniques)[]) if (tech[k] === undefined) delete tech[k];
    ch[n.id] = { tech: Object.keys(tech).length ? tech : undefined };
  }
  useStore.getState().exec(updateNotes(track.id, ch, label));
}

function shiftFrom(t: Track, from: number, by: number, label: string) {
  const st = useStore.getState();
  const ch: Record<string, Partial<Note>> = {};
  for (const n of t.notes) if (n.start >= from) ch[n.id] = { start: n.start + by };
  st.exec(updateNotes(t.id, ch, label));
}

export function handleTabKey(e: KeyboardEvent): boolean {
  const st = useStore.getState();
  const c = st.tabCursor;
  const t = currentTrack(st);
  if (!c || !t || t.type === 'drums' || (st.view !== 'split' && st.view !== 'tab')) return false;
  if (e.altKey) return false;
  const mod = e.ctrlKey || e.metaKey;
  const here = noteOnString(t, c.tick, c.string);
  const end = songEnd(st.song);
  const len = st.noteLen;

  if (e.key === 'Escape') {
    st.set({ tabCursor: null });
    return true;
  }
  if (e.key === 'ArrowRight') {
    const step = notesAt(t, c.tick).filter((n) => n.start === c.tick).reduce((m, n) => Math.max(m, n.duration), 0) || len;
    tabCursorTo(c.tick + step, c.string);
    return true;
  }
  if (e.key === 'ArrowLeft') {
    // previous beat: the latest note start before the cursor if it's within one entry length, else one entry length
    const prevStart = t.notes.filter((n) => n.start < c.tick).reduce((m, n) => Math.max(m, n.start), -1);
    tabCursorTo(prevStart >= 0 && c.tick - prevStart <= len * 2 ? prevStart : c.tick - len, c.string);
    return true;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    tabCursorTo(c.tick, c.string + (e.key === 'ArrowUp' ? 1 : -1));
    return true;
  }
  if (/^[0-9]$/.test(e.key) && !mod) {
    const now = Date.now();
    let fret = Number(e.key);
    if (digitBuf && now - digitAt < 700 && Number(digitBuf + e.key) <= t.maxFret) fret = Number(digitBuf + e.key);
    digitBuf = String(fret).length === 1 && fret <= Math.floor(t.maxFret / 10) ? e.key : '';
    digitAt = now;
    const pitch = t.tuning.strings[c.string] + t.capo + fret;
    if (here && here.start === c.tick) {
      st.exec(updateNotes(t.id, { [here.id]: { pitch, pinnedString: c.string } }, 'Enter fret'));
    } else {
      const n: Note = { id: newId('n'), pitch, start: c.tick, duration: Math.min(len, end - c.tick), velocity: 100, pinnedString: c.string };
      st.exec(addNotes(t.id, [n], 'Enter fret'));
      st.select([n.id], n.id);
    }
    preview(t, pitch, c.tick, len);
    return true;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !mod) {
    if (here) st.exec(removeNotes(t.id, [here.id], 'Delete note'));
    digitBuf = '';
    return true;
  }
  if (e.key === 'Delete' && mod) {
    const beat = t.notes.filter((n) => n.start >= c.tick && n.start < c.tick + len);
    st.begin('Delete beat');
    st.exec(removeNotes(t.id, beat.map((n) => n.id)));
    shiftFrom(currentTrack()!, c.tick + len, -len, 'Delete beat');
    st.commit();
    return true;
  }
  if (e.key === 'Insert') {
    shiftFrom(t, c.tick, len, 'Insert beat');
    return true;
  }
  if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
    const longer = e.key === '+' || e.key === '=';
    const next = Math.max(PPQ / 16, Math.min(PPQ * 4, longer ? len * 2 : len / 2));
    st.set({ noteLen: next });
    if (here && here.start === c.tick)
      st.exec(updateNotes(t.id, { [here.id]: { duration: Math.min(end - here.start, longer ? here.duration * 2 : Math.max(PPQ / 16, here.duration / 2)) } }, 'Note length'));
    return true;
  }
  if (e.key === '.' || e.key === 't' || e.key === 'T') {
    const dotted = e.key === '.';
    // plain values are PPQ/16 × 2^k; dotted = plain × 1.5; triplet = plain × 2/3
    const plain = (d: number) => Number.isInteger(Math.log2(d / (PPQ / 16)));
    const apply = (d: number) => {
      if (dotted) return plain(d / 1.5) ? d / 1.5 : plain(d) ? d * 1.5 : d;
      return plain(d * 1.5) ? d * 1.5 : plain(d) ? (d * 2) / 3 : d;
    };
    st.set({ noteLen: apply(len) });
    if (here && here.start === c.tick) st.exec(updateNotes(t.id, { [here.id]: { duration: apply(here.duration) } }, dotted ? 'Dotted' : 'Triplet'));
    return true;
  }
  if ((e.key === 'r' || e.key === 'R') && !mod) {
    const beat = t.notes.filter((n) => n.start === c.tick);
    if (beat.length) st.exec(removeNotes(t.id, beat.map((n) => n.id), 'Rest'));
    tabCursorTo(c.tick + len, c.string);
    return true;
  }
  const k = e.key.toLowerCase();
  if (!mod && TOGGLES[k] && here) {
    toggleTech(t, [here], k);
    return true;
  }
  return false;
}
