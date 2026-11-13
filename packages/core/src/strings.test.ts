import { describe, expect, it } from 'vitest';
import {
  makeTrack,
  newId,
  notesNearFret,
  notesToString,
  shiftStrings,
  trackFingering,
  type Note,
} from './index';

const note = (pitch: number, start = 0): Note => ({
  id: newId('n'),
  pitch,
  start,
  duration: 240,
  velocity: 100,
});

describe('bulk string edits', () => {
  // standard E: strings low→high E2 A2 D3 G3 B3 E4 = 40 45 50 55 59 64
  const t = { ...makeTrack('guitar', 'G', '#fff'), notes: [note(45), note(52, 240), note(40, 480)] };

  it('puts notes on one string where they fit', () => {
    const r = notesToString(t, t.notes, 0); // low E
    expect(Object.values(r.changes).map((c) => c.pinnedString)).toEqual([0, 0, 0]);
    const hi = notesToString(t, t.notes, 5); // high E: A2, E3 and E2 are below it
    expect(hi.skipped).toBe(3);
  });

  it('moves notes a string up or down at the same pitch', () => {
    const fing = trackFingering(t);
    const up = shiftStrings(t, t.notes, 1);
    for (const [id, c] of Object.entries(up.changes)) expect(c.pinnedString).toBe(fing.get(id)!.string + 1);
    // the open low E can't go lower
    expect(shiftStrings(t, [t.notes[2]], -1).skipped).toBe(1);
  });

  it('plays a passage around a fret', () => {
    const r = notesNearFret(t, t.notes, 7);
    // A2 → low E fret 5, E3 → A string fret 7, E2 → low E fret 0 (only place)
    expect(Object.values(r.changes).map((c) => c.pinnedString)).toEqual([0, 1, 0]);
  });
});
