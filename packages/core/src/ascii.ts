/** ASCII tab for the clipboard, e.g.
 *  e|----------------|
 *  B|--------0-------|
 *  ...
 */
import { trackFingering } from './derived';
import { stringLabel } from './tunings';
import { BarMap } from './timesig';
import type { Song, Track } from './model';

export interface AsciiOptions {
  from: number; // tick
  to: number; // tick (exclusive)
  /** grid resolution in ticks (default 1/16) */
  step?: number;
  /** characters per grid step (default 2) */
  width?: number;
}

export function asciiTab(song: Song, track: Track, opts: AsciiOptions): string {
  const step = opts.step ?? song.ppq / 4;
  const cw = opts.width ?? 2;
  const n = track.tuning.strings.length;
  const fing = trackFingering(track);
  const bm = new BarMap(song.timeSigs, song.ppq);
  const cols = Math.max(1, Math.ceil((opts.to - opts.from) / step));
  const rows: string[][] = Array.from({ length: n }, () => Array.from({ length: cols * cw }, () => '-'));
  const markers: string[] = Array.from({ length: cols * cw }, () => ' ');
  for (const note of track.notes) {
    if (note.start < opts.from || note.start >= opts.to) continue;
    const p = fing.get(note.id);
    if (!p) continue;
    const col = Math.floor((note.start - opts.from) / step) * cw;
    const t = note.tech ?? {};
    let txt = t.dead ? 'x' : String(p.fret);
    if (t.harmonic === 'natural') txt = `<${txt}>`;
    if (t.ghost) txt = `(${txt})`;
    if (t.hammer) txt = 'h' + txt;
    if (t.slide === 'legato' || t.slide === 'shift') txt = '/' + txt;
    if (t.bend) txt += 'b';
    if (t.vibrato) txt += '~';
    const line = rows[n - 1 - p.string];
    for (let i = 0; i < txt.length && col + i < line.length; i++) line[col + i] = txt[i];
    if (t.palmMute)
      for (let i = 0; i < cw && col + i < markers.length; i++) markers[col + i] = i === 0 ? 'P' : 'M';
  }
  // bar lines
  const barCols = new Set<number>();
  for (let b = bm.barAtTick(opts.from).index; b <= song.bars; b++) {
    const s = bm.barStart(b);
    if (s >= opts.to) break;
    if (s > opts.from) barCols.add(Math.floor((s - opts.from) / step) * cw);
  }
  const render = (chars: string[], fill: string) =>
    chars.map((ch, i) => (barCols.has(i) ? fill + ch : ch)).join('');
  const label = (s: number) => stringLabel(track.tuning, s, track.type).padEnd(2, ' ');
  const out: string[] = [];
  if (markers.some((m) => m !== ' ')) out.push('   ' + render(markers, ' '));
  for (let i = 0; i < n; i++) out.push(`${label(n - 1 - i)}|${render(rows[i], '|')}|`);
  return out.join('\n');
}
