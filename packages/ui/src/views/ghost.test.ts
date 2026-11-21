import { describe, expect, it } from 'vitest';
import { foldIntoRange } from './ghost';

// standard guitar: E2 (40) … E4 + 24 frets (88)
const lo = 40,
  hi = 88;

describe('ghost notes folded into the edited track’s range', () => {
  it('brings bass notes up to the lowest matching guitar note', () => {
    expect(foldIntoRange(28, lo, hi)).toBe(40); // E1 → E2 (open low E)
    expect(foldIntoRange(33, lo, hi)).toBe(45); // A1 → A2
    expect(foldIntoRange(26, lo, hi)).toBe(50); // D1 → D3 (D2 is below the low E)
    expect(foldIntoRange(39, lo, hi)).toBe(51); // D#2 → D#3
  });

  it('leaves notes in range alone and brings high notes down', () => {
    expect(foldIntoRange(52, lo, hi)).toBe(52);
    expect(foldIntoRange(91, lo, hi)).toBe(79);
    // bass range E1 (28) … G2 + 21 frets (64): a high lead note comes down an octave
    expect(foldIntoRange(76, 28, 64)).toBe(64);
  });
});
