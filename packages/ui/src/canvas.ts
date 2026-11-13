/** Shared canvas helpers + colours for the timeline views (piano roll, pedal lane, tab, drum grid). */
import { PPQ } from '@riffroll/core';
import { ZOOMS } from './store';

export const KEYS_W = 52; // left gutter (piano keys / lane labels)
export const RULER_H = 24;

export const COL = {
  bg: '#121419',
  panel: '#1b1e25',
  raise: '#262a33',
  line: '#343a46',
  rowW: '#1a1d24',
  rowB: '#16181e',
  rowLine: '#20242c',
  cLine: '#363c49',
  step: '#20242c',
  beat: '#2e333e',
  bar: '#4a5160',
  ink: '#e6e8ee',
  mute: '#8a91a0',
  clean: '#8aa4c8',
  dist: '#e8365d',
  tabLine: '#3a404c',
  head: '#ffffff',
  unplayable: '#4a505d',
  select: 'rgba(120,170,255,0.18)',
  selectLine: 'rgba(140,180,255,0.8)',
  /** the lane / row under the cursor */
  laneHi: '#232833',
  /** recessed strips (ruler, lane headers) */
  sunk: '#16181e',
  keyWhite: '#262a33',
  keyBlack: '#14161b',
  keyBlackInk: '#8a91a0',
  keyInk: '#b9bfcb',
  laneLabel: '#1f232b',
  laneLabelHi: '#2f3542',
  chip: '#3b4250',
  cell: '#1d212a',
  foot: '#0e1014',
  ok: '#5fd17c',
  cursor: '#8cb4ff',
};
/** Canvas colours; theme.ts swaps them for the chosen theme. */
export type Colors = typeof COL;

export const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
export const BODY = '"IBM Plex Sans", system-ui, sans-serif';
export const DISP = '"Barlow Condensed", "Arial Narrow", sans-serif';

export function fit(cv: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const d = window.devicePixelRatio || 1;
  const W = Math.round(w * d),
    H = Math.round(h * d);
  if (cv.width !== W || cv.height !== H) {
    cv.width = W;
    cv.height = H;
    cv.style.width = w + 'px';
    cv.style.height = h + 'px';
  }
  const c = cv.getContext('2d')!;
  c.setTransform(d, 0, 0, d, 0, 0);
  return c;
}

export function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  c.beginPath();
  if (c.roundRect) c.roundRect(x, y, Math.max(0, w), Math.max(0, h), r);
  else c.rect(x, y, w, h);
}

/** Pixels per tick for a zoom level. */
export const pxPerTick = (zoom: number) => ZOOMS[zoom] / (PPQ / 4);

export const snapTick = (tick: number, snap: number) => Math.round(tick / snap) * snap;
export const floorTick = (tick: number, snap: number) => Math.floor(tick / snap) * snap;

/** Hex colour with alpha. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** First index in a start-sorted array whose start >= tick. */
export function lowerBound<T extends { start: number }>(arr: readonly T[], tick: number): number {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m].start < tick) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** A once-per-frame redraw scheduler. */
export function frameScheduler(draw: () => void) {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      draw();
    });
  };
}
