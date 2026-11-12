import { BarMap } from './timesig';
import type { Song } from './model';

/**
 * Bar order for playback with repeats and alternate endings, e.g. bars 0..3 with a repeat of 1..2 ×2 → 0 1 2 1 2 3.
 * Alternate endings: a bar listed in `endings` only plays on the passes it names.
 */
export function playbackBars(song: Pick<Song, 'bars' | 'repeats'>): number[] {
  const reps = [...song.repeats].filter((r) => r.endBar >= r.startBar && r.times >= 2).sort((a, b) => a.startBar - b.startBar);
  const out: number[] = [];
  let bar = 0;
  let guard = 0;
  while (bar < song.bars && guard++ < 100000) {
    const r = reps.find((x) => x.startBar === bar);
    if (!r) {
      out.push(bar++);
      continue;
    }
    for (let pass = 1; pass <= r.times; pass++) {
      for (let b = r.startBar; b <= Math.min(r.endBar, song.bars - 1); b++) {
        const ending = r.endings?.find((e) => e.bar === b);
        if (ending && !ending.passes.includes(pass)) continue;
        out.push(b);
      }
    }
    bar = r.endBar + 1;
    // endings placed after the repeat close play on the final pass only if listed; skip bars meant for earlier passes
    while (bar < song.bars) {
      const ending = r.endings?.find((e) => e.bar === bar);
      if (!ending) break;
      if (ending.passes.includes(r.times)) break;
      bar++;
    }
  }
  return out;
}

/** Playback order as tick segments (consecutive bars merged). */
export function playbackSegments(song: Pick<Song, 'bars' | 'repeats' | 'timeSigs' | 'ppq'>): { start: number; end: number }[] {
  const bm = new BarMap(song.timeSigs, song.ppq);
  const segs: { start: number; end: number }[] = [];
  let prev = -2;
  for (const b of playbackBars(song)) {
    const start = bm.barStart(b),
      end = bm.barStart(b + 1);
    if (b === prev + 1 && segs.length) segs[segs.length - 1].end = end;
    else segs.push({ start, end });
    prev = b;
  }
  return segs;
}
