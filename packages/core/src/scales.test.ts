import { describe, expect, it } from 'vitest';
import { inScale, keyTonic, snapToScale, songScale, stepInScale } from './scales';

describe('scales', () => {
  it('finds the tonic from the key signature', () => {
    expect(keyTonic({ fifths: 0, minor: false })).toBe(0); // C
    expect(keyTonic({ fifths: 0, minor: true })).toBe(9); // A
    expect(keyTonic({ fifths: 2, minor: false })).toBe(2); // D
    expect(keyTonic({ fifths: -1, minor: true })).toBe(2); // D minor
    expect(keyTonic({ fifths: 1, minor: true })).toBe(4); // E minor
  });

  it('A minor by default, or the song’s own scale type', () => {
    const am = songScale({ keySig: { fifths: 0, minor: true } });
    expect(am.name).toBe('minor');
    expect([...am.pcs].sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11]);
    const pent = songScale({ keySig: { fifths: 0, minor: true }, scale: 'minor pentatonic' });
    expect([...pent.pcs].sort((a, b) => a - b)).toEqual([0, 2, 4, 7, 9]); // A C D E G
    expect(inScale(69, pent)).toBe(true);
    expect(inScale(71, pent)).toBe(false); // B
  });

  it('steps and snaps to scale notes', () => {
    const pent = songScale({ keySig: { fifths: 0, minor: true }, scale: 'minor pentatonic' });
    expect(stepInScale(69, 1, pent)).toBe(72); // A → C
    expect(stepInScale(69, -1, pent)).toBe(67); // A → G
    expect(snapToScale(71, pent)).toBe(72); // B → C (nearest)
    expect(snapToScale(70, pent)).toBe(69); // Bb → A (tie goes down)
  });
});
