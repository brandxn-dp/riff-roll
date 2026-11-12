import { describe, expect, it } from 'vitest';
import { editVelocities } from './velocity';

const items = [
  { id: 'a', start: 0, velocity: 100 },
  { id: 'b', start: 0, velocity: 80 }, // chord with a
  { id: 'c', start: 480, velocity: 60 },
  { id: 'd', start: 960, velocity: 120 },
];

describe('bulk velocity', () => {
  it('set, scale and add, clamped to 1..127', () => {
    expect(editVelocities(items, { mode: 'set', value: 90 })).toEqual({ a: 90, b: 90, c: 90, d: 90 });
    expect(editVelocities(items, { mode: 'scale', percent: 50 })).toEqual({ a: 50, b: 40, c: 30, d: 60 });
    expect(editVelocities(items, { mode: 'add', amount: 20 })).toEqual({ a: 120, b: 100, c: 80, d: 127 });
    expect(editVelocities(items, { mode: 'add', amount: -200 })).toEqual({ a: 1, b: 1, c: 1, d: 1 });
  });

  it('ramps across time; chord notes share a value', () => {
    expect(editVelocities(items, { mode: 'ramp', from: 40, to: 120 })).toEqual({
      a: 40,
      b: 40,
      c: 80,
      d: 120,
    });
    expect(editVelocities([items[2]], { mode: 'ramp', from: 40, to: 120 })).toEqual({ c: 40 });
  });

  it('randomizes within ± amount, the same way every time for a seed', () => {
    const r1 = editVelocities(items, { mode: 'randomize', amount: 10, seed: 7 });
    const r2 = editVelocities(items, { mode: 'randomize', amount: 10, seed: 7 });
    expect(r1).toEqual(r2);
    for (const i of items) expect(Math.abs(r1[i.id] - Math.min(127, i.velocity))).toBeLessThanOrEqual(10);
  });
});
