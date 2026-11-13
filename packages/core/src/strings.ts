/**
 * Bulk string / position edits for guitar and bass notes: put a selection on one string, move it a string up or
 * down at the same pitch, or play it around a fret. Results are pins (Note.pinnedString), so the fingering engine
 * keeps them; notes that can't go where asked are left as they were and counted.
 */
import { candidates, openStrings } from './fingering';
import { trackFingering } from './derived';
import type { Note, Track } from './model';

export interface StringEdit {
  /** note id → new pinned string (0 = lowest) */
  changes: Record<string, { pinnedString: number }>;
  /** notes that couldn't move */
  skipped: number;
}

const playable = (t: Track) => ({ strings: openStrings(t.tuning, t.capo), maxFret: t.maxFret - t.capo });

/** Every note on string `index` (0 = lowest) where it fits. */
export function notesToString(track: Track, notes: Note[], index: number): StringEdit {
  const { strings, maxFret } = playable(track);
  const out: StringEdit = { changes: {}, skipped: 0 };
  for (const n of notes) {
    const fret = n.pitch - (strings[index] ?? Infinity);
    if (fret >= 0 && fret <= maxFret) out.changes[n.id] = { pinnedString: index };
    else out.skipped++;
  }
  return out;
}

/** Each note one string higher (+1) or lower (−1) than where it is now, same pitch. */
export function shiftStrings(track: Track, notes: Note[], dir: 1 | -1): StringEdit {
  const { strings, maxFret } = playable(track);
  const fing = trackFingering(track);
  const out: StringEdit = { changes: {}, skipped: 0 };
  for (const n of notes) {
    const now = fing.get(n.id)?.string ?? n.pinnedString;
    const to = now == null ? -1 : now + dir;
    const fret = to >= 0 && to < strings.length ? n.pitch - strings[to] : -1;
    if (fret >= 0 && fret <= maxFret) out.changes[n.id] = { pinnedString: to };
    else out.skipped++;
  }
  return out;
}

/** Each note on the string that puts it closest to `fret` (a position on the neck). */
export function notesNearFret(track: Track, notes: Note[], fret: number): StringEdit {
  const { strings, maxFret } = playable(track);
  const out: StringEdit = { changes: {}, skipped: 0 };
  for (const n of notes) {
    const c = candidates(n.pitch, strings, maxFret);
    if (!c.length) {
      out.skipped++;
      continue;
    }
    // closest fret; on a tie the thicker string (lower frets feel the same, fuller sound)
    c.sort((a, b) => Math.abs(a.fret - fret) - Math.abs(b.fret - fret) || a.string - b.string);
    out.changes[n.id] = { pinnedString: c[0].string };
  }
  return out;
}
