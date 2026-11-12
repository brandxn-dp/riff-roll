import { describe, expect, it } from 'vitest';
import { playbackBars, playbackSegments } from './repeats';
import { PPQ } from './model';

describe('repeats', () => {
  it('plays a repeated section twice', () => {
    expect(playbackBars({ bars: 4, repeats: [{ id: 'r', startBar: 1, endBar: 2, times: 2 }] })).toEqual([0, 1, 2, 1, 2, 3]);
  });
  it('alternate endings', () => {
    // bars: 0 1 [2: 1st ending] [3: 2nd ending] 4 — repeat 0..2 with ending on bar 2 for pass 1 only, bar 3 for pass 2
    const order = playbackBars({
      bars: 5,
      repeats: [{ id: 'r', startBar: 0, endBar: 2, times: 2, endings: [{ bar: 2, passes: [1] }, { bar: 3, passes: [2] }] }],
    });
    expect(order).toEqual([0, 1, 2, 0, 1, 3, 4]);
  });
  it('merges consecutive bars into segments', () => {
    const segs = playbackSegments({ bars: 3, repeats: [{ id: 'r', startBar: 1, endBar: 1, times: 3 }], timeSigs: [{ bar: 0, num: 4, den: 4 }], ppq: PPQ });
    const bar = PPQ * 4;
    expect(segs).toEqual([
      { start: 0, end: 2 * bar },
      { start: bar, end: 2 * bar },
      { start: bar, end: 3 * bar },
    ]);
  });
});
