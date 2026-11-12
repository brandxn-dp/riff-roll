/** Timeline helpers shared by every horizontally scrolling view (roll, lower panel, drum grid, ruler). */
import { pedalSegments, type Song, type Tone, type Track } from '@riffroll/core';
import { barMap, songEnd } from '../store';
import { COL, KEYS_W, alpha } from '../canvas';

export interface TimeAxis {
  ppt: number; // pixels per tick
  scrollX: number;
  width: number; // visible width in px, including the left gutter
}

export const tickToX = (a: TimeAxis, tick: number) => KEYS_W + tick * a.ppt - a.scrollX;
export const xToTick = (a: TimeAxis, x: number) => (x - KEYS_W + a.scrollX) / a.ppt;
export const visibleTicks = (a: TimeAxis) => [xToTick(a, KEYS_W), xToTick(a, a.width)] as const;

/** Vertical grid lines: bars (strong), beats, and snap subdivisions when there is room. */
export function drawGrid(c: CanvasRenderingContext2D, song: Song, a: TimeAxis, snap: number, y0: number, h: number) {
  const bm = barMap(song);
  const [t0, t1] = visibleTicks(a);
  const end = songEnd(song);
  const first = bm.barAtTick(Math.max(0, t0)).index;
  for (let b = first; b <= song.bars; b++) {
    const bar = bm.bar(b);
    if (bar.start > t1) break;
    const bx = tickToX(a, bar.start);
    c.fillStyle = b === song.bars ? COL.ink : COL.bar;
    c.fillRect(bx, y0, b === song.bars ? 2 : 1.5, h);
    if (b === song.bars) break;
    const beat = (song.ppq * 4) / bar.den;
    const drawSnap = snap > 1 && snap * a.ppt >= 7 && snap < beat;
    for (let t = bar.start; t < bar.start + bar.length && t < end; t += drawSnap ? snap : beat) {
      if (t === bar.start) continue;
      const onBeat = Math.abs((t - bar.start) % beat) < 1e-6;
      c.fillStyle = onBeat ? COL.beat : COL.step;
      c.fillRect(tickToX(a, t), y0, 1, h);
    }
  }
}

export function isCleanTone(t?: Tone) {
  return !t || t.chain.amp.character === 'clean';
}

export function toneOf(track: Track, id: string): Tone | undefined {
  return track.tones.find((t) => t.id === id);
}

/** Tint the background of non-clean pedal segments (prototype: subtle red wash on distorted parts). */
export function drawToneWash(c: CanvasRenderingContext2D, song: Song, track: Track, a: TimeAxis, y0: number, h: number) {
  if (track.type === 'drums' || !track.tones.length) return;
  for (const sg of pedalSegments(track.pedal, songEnd(song))) {
    const tone = toneOf(track, sg.toneId);
    if (isCleanTone(tone)) continue;
    c.fillStyle = alpha(tone!.color, 0.075);
    c.fillRect(tickToX(a, sg.start), y0, (sg.end - sg.start) * a.ppt, h);
  }
}

export function drawPlayhead(c: CanvasRenderingContext2D, a: TimeAxis, tick: number | null, y0: number, h: number) {
  if (tick == null) return;
  c.fillStyle = COL.head;
  c.fillRect(tickToX(a, tick), y0, 1.5, h);
}
