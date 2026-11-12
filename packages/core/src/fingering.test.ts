import { describe, expect, it } from 'vitest';
import { assignFingering, type FingerNote, type Position } from './fingering';
import { parsePitch, PPQ } from './model';
import { tuningByName } from './tunings';

const STD = tuningByName('Standard E')!.strings;
const DROP_D = tuningByName('Drop D')!.strings;
const EIGHTH = PPQ / 2;
// string indices: 0 = low E, 1 = A, 2 = D, 3 = G, 4 = B, 5 = high e
const [E, A, D, G, B, e] = [0, 1, 2, 3, 4, 5];

let nid = 0;
const n = (pitch: string, start: number, extra: Partial<FingerNote> = {}): FingerNote => ({
  id: `n${nid++}`,
  pitch: parsePitch(pitch),
  start,
  duration: EIGHTH,
  ...extra,
});
/** Sequential 1/8 notes. */
const seq = (...pitches: string[]) => pitches.map((p, i) => n(p, i * EIGHTH));
/** Notes starting together. */
const chord = (...pitches: string[]) => pitches.map((p) => n(p, 0));

const run = (notes: FingerNote[], strings = STD) => {
  const f = assignFingering(notes, { strings, maxFret: 24, startHand: 2 });
  return notes.map((x) => f.get(x.id) ?? null);
};
const pos = (string: number, fret: number): Position => ({ string, fret });

describe('fingering engine (Standard E, 1/8 notes, hand near fret 2)', () => {
  it('Em arpeggio E2 B2 E3 G3 B3 → low E 0, A 2, D 2, G 0, B 0', () => {
    expect(run(seq('E2', 'B2', 'E3', 'G3', 'B3'))).toEqual([
      pos(E, 0),
      pos(A, 2),
      pos(D, 2),
      pos(G, 0),
      pos(B, 0),
    ]);
  });

  it('C3 G3 C4 E4 → A 3, G 0, B 1, high e 0', () => {
    expect(run(seq('C3', 'G3', 'C4', 'E4'))).toEqual([pos(A, 3), pos(G, 0), pos(B, 1), pos(e, 0)]);
  });

  it('power chord G2+D3 → low E 3 + A 5 (not open D)', () => {
    expect(run(chord('G2', 'D3'))).toEqual([pos(E, 3), pos(A, 5)]);
  });

  it('power chord A2+E3 → A 0 + D 2', () => {
    expect(run(chord('A2', 'E3'))).toEqual([pos(A, 0), pos(D, 2)]);
  });

  it('power chord C3+G3 → A 3 + D 5', () => {
    expect(run(chord('C3', 'G3'))).toEqual([pos(A, 3), pos(D, 5)]);
  });

  it('power chord B2+F#3 → A 2 + D 4', () => {
    expect(run(chord('B2', 'F#3'))).toEqual([pos(A, 2), pos(D, 4)]);
  });

  it('a pinned note stays on its string even if another string is cheaper', () => {
    // E3 is cheapest on D 2; pin it to the A string (fret 7)
    const [p] = run([n('E3', 0, { pinnedString: A })]);
    expect(p).toEqual(pos(A, 7));
    // and on the low E string (fret 12)
    expect(run([n('E3', 0, { pinnedString: E })])[0]).toEqual(pos(E, 12));
  });

  it('the engine works around a pinned note in a chord', () => {
    // A2 pinned to low E (fret 5): E3 must then avoid the low E string
    const r = run([n('A2', 0, { pinnedString: E }), n('E3', 0)]);
    expect(r[0]).toEqual(pos(E, 5));
    expect(r[1]!.string).not.toBe(E);
  });

  it('two notes ringing at the same time never share a string when another option exists', () => {
    // a long D3 (open D) rings while a second D3-range note starts: A3 would be cheapest on... make it collide
    const long = n('E3', 0, { duration: PPQ * 4 }); // D string fret 2, rings for a bar
    const next = n('E3', EIGHTH); // same pitch, starts while the first still rings
    const [a, b] = run([long, next]);
    expect(a).toEqual(pos(D, 2));
    expect(b!.string).not.toBe(a!.string);
  });

  it('notes of a chord always use distinct strings', () => {
    const r = run(chord('E2', 'B2', 'E3', 'G#3', 'B3', 'E4'));
    expect(new Set(r.map((p) => p!.string)).size).toBe(6);
    expect(r).toEqual([pos(E, 0), pos(A, 2), pos(D, 2), pos(G, 1), pos(B, 0), pos(e, 0)]);
  });

  it('out-of-range notes are unplayable', () => {
    expect(run([n('C2', 0)])).toEqual([null]); // below low E
    expect(run([n('C7', 0)])).toEqual([null]); // above high e fret 24
  });

  it('Drop D: D2 → low string open', () => {
    expect(run([n('D2', 0)], DROP_D)).toEqual([pos(E, 0)]);
  });

  it('more chord notes than strings: extras are unplayable, the rest are placed', () => {
    const r = run(chord('E2', 'A2', 'D3', 'G3', 'B3', 'E4', 'G4'));
    expect(r.filter(Boolean).length).toBe(6);
    expect(r.filter((x) => x === null).length).toBe(1);
  });

  it('stays in position for a riff instead of jumping to open strings high up the neck', () => {
    // A minor pentatonic box at fret 5: A2 C3 D3 E3 G3 A3
    const r = run(seq('A2', 'C3', 'D3', 'E3', 'G3', 'A3'), STD);
    // first note can be open A; after that the hand should be around the low frets, all frets <= 5
    for (const p of r) expect(p!.fret).toBeLessThanOrEqual(5);
  });

  it('benchmark: 2,000 notes re-assigned in under 20 ms', () => {
    const notes: FingerNote[] = [];
    const pitches = ['E2', 'G2', 'A2', 'B2', 'D3', 'E3', 'G3', 'A3', 'B3', 'D4', 'E4', 'G4'].map(parsePitch);
    let t = 0;
    for (let i = 0; notes.length < 2000; i++) {
      if (i % 4 === 0) {
        // power chord
        const r = pitches[i % 6];
        notes.push({ id: `b${notes.length}`, pitch: r, start: t, duration: EIGHTH });
        notes.push({ id: `b${notes.length}`, pitch: r + 7, start: t, duration: EIGHTH });
        notes.push({ id: `b${notes.length}`, pitch: r + 12, start: t, duration: EIGHTH });
      } else
        notes.push({
          id: `b${notes.length}`,
          pitch: pitches[(i * 7) % pitches.length],
          start: t,
          duration: EIGHTH,
        });
      t += EIGHTH / 2;
    }
    assignFingering(notes, { strings: STD }); // warm up the JIT
    const runs = 5;
    const t0 = performance.now();
    for (let k = 0; k < runs; k++) assignFingering(notes, { strings: STD });
    const ms = (performance.now() - t0) / runs;
    expect(ms).toBeLessThan(20);
  });
});
