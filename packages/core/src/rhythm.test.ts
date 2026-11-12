import { describe, expect, it } from 'vitest';
import { rhythmize, splitDuration } from './rhythm';
import { PPQ } from './model';

const song = { timeSigs: [{ bar: 0, num: 4, den: 4 }], ppq: PPQ, bars: 2 };
const ev = (id: string, start: number, duration: number) => ({ id, start, duration });

describe('rhythm quantisation', () => {
  it('splits spans into plain, dotted and triplet values', () => {
    expect(splitDuration(PPQ, PPQ).map((d) => [d.value, d.dots])).toEqual([[4, 0]]);
    expect(splitDuration(PPQ * 1.5, PPQ).map((d) => [d.value, d.dots])).toEqual([[4, 1]]);
    expect(splitDuration(PPQ * 1.25, PPQ).map((d) => [d.value, d.dots])).toEqual([
      [4, 0],
      [16, 0],
    ]);
    const trip = splitDuration(PPQ / 3, PPQ);
    expect(trip).toEqual([{ ticks: PPQ / 3, value: 8, dots: 0, tuplet: 3 }]);
  });

  it('fills gaps with rests and keeps chords together', () => {
    const bars = rhythmize([ev('a', 0, PPQ), ev('b', 0, PPQ), ev('c', PPQ * 2, PPQ)], song);
    const b0 = bars[0].beats;
    expect(b0.map((b) => [b.value, b.rest, b.notes.length])).toEqual([
      [4, false, 2],
      [4, true, 0],
      [4, false, 1],
      [4, true, 0],
    ]);
    expect(bars[1].beats).toEqual([expect.objectContaining({ value: 1, rest: true })]);
  });

  it('ties notes across the bar line', () => {
    const bars = rhythmize([ev('long', PPQ * 3, PPQ * 2)], song);
    expect(bars[0].beats.at(-1)!.notes[0]).toEqual({ event: expect.objectContaining({ id: 'long' }), tied: false });
    expect(bars[1].beats[0].notes[0].tied).toBe(true);
    expect(bars[1].beats[0].value).toBe(4);
  });

  it('a long note under shorter ones is tied at their boundaries', () => {
    const bars = rhythmize([ev('drone', 0, PPQ * 2), ev('x', PPQ, PPQ)], song);
    const [first, second] = bars[0].beats;
    expect(first.notes.map((n) => [n.event.id, n.tied])).toEqual([['drone', false]]);
    expect(second.notes.map((n) => [n.event.id, n.tied])).toEqual([
      ['drone', true],
      ['x', false],
    ]);
  });

  it('every bar adds up to its length', () => {
    const bars = rhythmize([ev('a', 100, 333), ev('b', 2000, 1300)], { ...song, timeSigs: [{ bar: 0, num: 7, den: 8 }] });
    for (const b of bars) expect(b.beats.reduce((s, x) => s + x.duration, 0)).toBe(b.length);
  });
});
