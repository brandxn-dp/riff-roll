import { PPQ, type TempoPoint } from './model';

/**
 * Tempo map: ticks <-> seconds. Constant segments and linear bpm ramps (gradual tempo changes),
 * both solved in closed form, so conversions are exact and O(log n).
 */
interface Seg {
  tick: number;
  sec: number;
  bpm0: number;
  bpm1: number; // == bpm0 for constant segments
  len: number; // ticks to the next point (Infinity for the last)
}

export class TempoMap {
  private segs: Seg[];
  constructor(
    points: readonly TempoPoint[],
    private ppq = PPQ,
  ) {
    const pts = [...points].sort((a, b) => a.tick - b.tick);
    if (!pts.length || pts[0].tick > 0) pts.unshift({ tick: 0, bpm: pts[0]?.bpm ?? 120 });
    this.segs = [];
    let sec = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const next = pts[i + 1];
      const len = next ? next.tick - p.tick : Infinity;
      const bpm1 = p.ramp && next ? next.bpm : p.bpm;
      const seg: Seg = { tick: p.tick, sec, bpm0: p.bpm, bpm1, len };
      this.segs.push(seg);
      if (next) sec += this.segSeconds(seg, len);
    }
  }

  private segSeconds(s: Seg, dt: number): number {
    const k = 60 / this.ppq; // seconds per tick at 1 bpm
    if (s.bpm0 === s.bpm1 || !isFinite(s.len)) return (k * dt) / s.bpm0;
    // bpm(t) = b0 + r t,  r = (b1-b0)/len;  sec = k/r * ln(bpm(dt)/b0)
    const r = (s.bpm1 - s.bpm0) / s.len;
    return (k / r) * Math.log((s.bpm0 + r * dt) / s.bpm0);
  }

  private segTicks(s: Seg, dsec: number): number {
    const k = 60 / this.ppq;
    if (s.bpm0 === s.bpm1 || !isFinite(s.len)) return (dsec * s.bpm0) / k;
    const r = (s.bpm1 - s.bpm0) / s.len;
    return (s.bpm0 * (Math.exp((dsec * r) / k) - 1)) / r;
  }

  private segAtTick(tick: number): Seg {
    let lo = 0,
      hi = this.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segs[mid].tick <= tick) lo = mid;
      else hi = mid - 1;
    }
    return this.segs[lo];
  }

  private segAtSec(sec: number): Seg {
    let lo = 0,
      hi = this.segs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.segs[mid].sec <= sec) lo = mid;
      else hi = mid - 1;
    }
    return this.segs[lo];
  }

  tickToSeconds(tick: number): number {
    const s = this.segAtTick(tick);
    return s.sec + this.segSeconds(s, tick - s.tick);
  }

  secondsToTick(sec: number): number {
    const s = this.segAtSec(sec);
    return s.tick + this.segTicks(s, sec - s.sec);
  }

  bpmAt(tick: number): number {
    const s = this.segAtTick(tick);
    if (s.bpm0 === s.bpm1 || !isFinite(s.len)) return s.bpm0;
    return s.bpm0 + ((s.bpm1 - s.bpm0) * (tick - s.tick)) / s.len;
  }
}
