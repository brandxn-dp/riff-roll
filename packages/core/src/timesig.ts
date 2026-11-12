import { PPQ, type TimeSig } from './model';

export interface BarInfo {
  index: number;
  start: number;
  length: number;
  num: number;
  den: number;
}

/** Bars <-> ticks for a list of time-signature changes. */
export class BarMap {
  private sigs: TimeSig[];
  private starts: number[]; // start tick of each sig change
  constructor(
    sigs: readonly TimeSig[],
    private ppq = PPQ,
  ) {
    const s = [...sigs].sort((a, b) => a.bar - b.bar);
    if (!s.length || s[0].bar > 0) s.unshift({ bar: 0, num: 4, den: 4 });
    this.sigs = s;
    this.starts = [];
    let tick = 0;
    for (let i = 0; i < s.length; i++) {
      this.starts.push(tick);
      if (i + 1 < s.length) tick += (s[i + 1].bar - s[i].bar) * this.barLen(s[i]);
    }
  }

  private barLen(s: TimeSig) {
    return (s.num * this.ppq * 4) / s.den;
  }

  private sigIndexForBar(bar: number) {
    let i = 0;
    while (i + 1 < this.sigs.length && this.sigs[i + 1].bar <= bar) i++;
    return i;
  }

  bar(index: number): BarInfo {
    const i = this.sigIndexForBar(index);
    const s = this.sigs[i];
    const len = this.barLen(s);
    return { index, start: this.starts[i] + (index - s.bar) * len, length: len, num: s.num, den: s.den };
  }

  barStart(index: number): number {
    return this.bar(index).start;
  }

  barAtTick(tick: number): BarInfo {
    let i = 0;
    while (i + 1 < this.sigs.length && this.starts[i + 1] <= tick) i++;
    const s = this.sigs[i];
    const len = this.barLen(s);
    const index = s.bar + Math.floor((tick - this.starts[i]) / len);
    return this.bar(Math.max(0, index));
  }

  /** Ticks per beat (the denominator's note value) at a bar. */
  beatTicks(index: number): number {
    return (this.ppq * 4) / this.bar(index).den;
  }

  totalTicks(bars: number): number {
    return this.barStart(bars);
  }

  /** "bar.beat" display, 1-based. */
  format(tick: number): string {
    const b = this.barAtTick(tick);
    const beat = Math.floor((tick - b.start) / ((this.ppq * 4) / b.den)) + 1;
    return `${b.index + 1}.${beat}`;
  }
}
