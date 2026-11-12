/** Tab extras drawn on the lower panel: bar metadata, technique marks, rhythm stems, the keyboard-entry cursor. */
import { rhythmize, trackFingering, type Note, type RBar, type Song, type Track } from '@riffroll/core';
import { barMap, songEnd } from '../store';
import { COL, DISP, MONO, BODY, rr } from '../canvas';
import { tickToX, xToTick, type TimeAxis } from './timeline';

export const META_ROW = 34; // px above the tab's top line for bar numbers / sections / tempo
export const RHYTHM_H = 30; // px below the tab for rhythm stems

const rhythmCache = new WeakMap<Note[], { key: Song['timeSigs']; bars: number; value: RBar<Note>[] }>();

function trackRhythm(song: Song, t: Track): RBar<Note>[] {
  const hit = rhythmCache.get(t.notes);
  if (hit && hit.key === song.timeSigs && hit.bars === song.bars) return hit.value;
  const f = trackFingering(t);
  const value = rhythmize(t.notes.filter((n) => f.get(n.id)), song);
  rhythmCache.set(t.notes, { key: song.timeSigs, bars: song.bars, value });
  return value;
}

/** Short technique code for piano-roll notes. */
export function techCode(n: Note): string {
  const t = n.tech;
  if (!t) return '';
  const out: string[] = [];
  if (t.hammer) out.push('h');
  if (t.slide) out.push(t.slide.startsWith('out') ? '\\' : '/');
  if (t.bend) out.push('↗');
  if (t.vibrato) out.push('~');
  if (t.palmMute) out.push('PM');
  if (t.letRing) out.push('LR');
  if (t.harmonic) out.push('◇');
  if (t.tap) out.push('T');
  if (t.tremolo) out.push('≡');
  if (t.whammy) out.push('w');
  if (t.trill) out.push('tr');
  if (t.tieFromPrevious) out.push('⌒');
  return out.join(' ');
}

export function drawTabMeta(c: CanvasRenderingContext2D, song: Song, a: TimeAxis, tabY: number, w: number) {
  const bm = barMap(song);
  const [t0, t1] = [xToTick(a, 0), xToTick(a, w)];
  const y = tabY - META_ROW + 8;
  c.textBaseline = 'middle';
  let prevSig = '';
  for (let b = 0; b < song.bars; b++) {
    const bar = bm.bar(b);
    const sig = `${bar.num}/${bar.den}`;
    const changed = sig !== prevSig;
    prevSig = sig;
    if (bar.start > t1) break;
    if (bar.start + bar.length < t0) continue;
    const x = tickToX(a, bar.start);
    c.font = '600 10px ' + MONO;
    c.fillStyle = COL.mute;
    c.fillText(String(b + 1), x + 3, y);
    if (changed) {
      c.font = '700 13px ' + DISP;
      c.fillStyle = COL.ink;
      c.fillText(sig, x + 22, y);
    }
  }
  for (const tp of song.tempos) {
    if (tp.tick < t0 - 2000 || tp.tick > t1) continue;
    const x = tickToX(a, tp.tick);
    c.font = '600 11px ' + BODY;
    c.fillStyle = COL.ink;
    c.fillText(`♩=${Math.round(tp.bpm)}${tp.ramp ? ' →' : ''}`, x + (tp.tick === 0 ? 52 : 4), y);
  }
  for (const sec of song.sections) {
    if (sec.tick < t0 - 2000 || sec.tick > t1) continue;
    const x = tickToX(a, sec.tick) + 110 * (sec.tick === 0 ? 1 : 0) + 4;
    c.font = '700 12px ' + DISP;
    const label = sec.name.toUpperCase();
    const lw = c.measureText(label).width;
    c.fillStyle = '#3b4250';
    rr(c, x, y - 8, lw + 10, 16, 3);
    c.fill();
    c.fillStyle = COL.ink;
    c.fillText(label, x + 5, y);
  }
}

/** Repeat bar lines and alternate-ending brackets on the tab staff. */
export function drawRepeats(c: CanvasRenderingContext2D, song: Song, a: TimeAxis, tabY: number, staffH: number) {
  const bm = barMap(song);
  for (const r of song.repeats) {
    const xs = tickToX(a, bm.barStart(r.startBar)),
      xe = tickToX(a, bm.barStart(r.endBar + 1));
    c.fillStyle = COL.ink;
    c.fillRect(xs, tabY, 3, staffH);
    c.fillRect(xe - 3, tabY, 3, staffH);
    for (const [x, dx] of [
      [xs, 8],
      [xe, -8],
    ] as const) {
      c.beginPath();
      c.arc(x + dx, tabY + staffH * 0.38, 2, 0, Math.PI * 2);
      c.arc(x + dx, tabY + staffH * 0.62, 2, 0, Math.PI * 2);
      c.fill();
    }
    c.font = '700 11px ' + DISP;
    c.fillText(`×${r.times}`, xe - 22, tabY - 6);
    for (const e of r.endings ?? []) {
      const ex = tickToX(a, bm.barStart(e.bar)),
        ee = tickToX(a, bm.barStart(e.bar + 1));
      c.strokeStyle = COL.ink;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(ex + 1, tabY - 8);
      c.lineTo(ex + 1, tabY - 20);
      c.lineTo(ee - 6, tabY - 20);
      c.stroke();
      c.fillText(e.passes.join(', ') + '.', ex + 5, tabY - 13);
    }
  }
}

/** Technique marks next to fret numbers. */
export function drawTechniques(
  c: CanvasRenderingContext2D,
  t: Track,
  items: { nt: Note; x: number; y: number; tw: number; s: number }[],
) {
  const lastOnString = new Map<number, { x: number; y: number; tw: number; nt: Note }>();
  c.font = '600 9px ' + BODY;
  c.textAlign = 'center';
  for (const it of items) {
    const tech = it.nt.tech;
    const prev = lastOnString.get(it.s);
    lastOnString.set(it.s, it);
    if (!tech) continue;
    c.fillStyle = COL.ink;
    const above = it.y - 10;
    if (tech.hammer && prev) {
      const mid = (prev.x + it.x) / 2;
      c.strokeStyle = COL.mute;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(prev.x + 3, it.y - 6);
      c.quadraticCurveTo(mid, it.y - 13, it.x - 3, it.y - 6);
      c.stroke();
      c.fillText(prev.nt.pitch < it.nt.pitch ? 'h' : 'p', mid, it.y - 12);
    }
    if ((tech.slide === 'legato' || tech.slide === 'shift') && prev) {
      c.strokeStyle = COL.ink;
      c.lineWidth = 1;
      c.beginPath();
      const up = prev.nt.pitch < it.nt.pitch;
      c.moveTo(prev.x + prev.tw / 2 + 3, it.y + (up ? 3 : -3));
      c.lineTo(it.x - it.tw / 2 - 3, it.y + (up ? -3 : 3));
      c.stroke();
      if (tech.slide === 'legato') c.fillText('sl', (prev.x + it.x) / 2, it.y - 9);
    }
    if (tech.slide === 'in-below' || tech.slide === 'in-above') c.fillText(tech.slide === 'in-below' ? '/' : '\\', it.x - it.tw / 2 - 6, it.y);
    if (tech.slide === 'out-down' || tech.slide === 'out-up') c.fillText(tech.slide === 'out-down' ? '\\' : '/', it.x + it.tw / 2 + 6, it.y);
    if (tech.bend?.length) {
      const peak = Math.max(...tech.bend.map((p) => p.value));
      const label = peak >= 2 ? 'full' : peak >= 1 ? '½' : '¼';
      c.strokeStyle = COL.ink;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(it.x + it.tw / 2 + 2, it.y);
      c.quadraticCurveTo(it.x + it.tw / 2 + 10, it.y, it.x + it.tw / 2 + 10, it.y - 12);
      c.stroke();
      c.fillText(label, it.x + it.tw / 2 + 12, it.y - 17);
    }
    if (tech.vibrato) c.fillText(tech.vibrato === 'wide' ? '≈≈' : '~~', it.x + it.tw / 2 + 9, it.y - 1);
    const tags: string[] = [];
    if (tech.palmMute) tags.push('PM');
    if (tech.letRing) tags.push('LR');
    if (tech.tap) tags.push('T');
    if (tech.accent) tags.push(tech.accent === 'heavy' ? '^' : '>');
    if (tech.pick) tags.push(tech.pick === 'down' ? '⊓' : 'V');
    if (tech.tremolo) tags.push('≡');
    if (tech.whammy) tags.push('w/b');
    if (tech.fadeIn) tags.push('<');
    if (tech.trill) tags.push('tr');
    if (tags.length) c.fillText(tags.join(' '), it.x, above);
    if (tech.harmonic) {
      c.font = '600 11px ' + MONO;
      c.fillText('<', it.x - it.tw / 2 - 5, it.y + 0.5);
      c.fillText('>', it.x + it.tw / 2 + 5, it.y + 0.5);
      c.font = '600 9px ' + BODY;
    }
    if (tech.ghost || tech.tieFromPrevious) {
      c.font = '600 12px ' + MONO;
      c.fillText('(', it.x - it.tw / 2 - 4, it.y + 0.5);
      c.fillText(')', it.x + it.tw / 2 + 4, it.y + 0.5);
      c.font = '600 9px ' + BODY;
    }
    if (tech.staccato) c.fillText('·', it.x, it.y + 9);
  }
  c.textAlign = 'left';
}

const FLAGS: Record<number, number> = { 1: 0, 2: 0, 4: 0, 8: 1, 16: 2, 32: 3, 64: 4 };

/** Rhythm stems with beams under the tab (Guitar Pro style). */
export function drawRhythm(c: CanvasRenderingContext2D, song: Song, t: Track, a: TimeAxis, y0: number, w: number) {
  const bars = trackRhythm(song, t);
  const [t0, t1] = [xToTick(a, -50), xToTick(a, w + 50)];
  const stemTop = y0 + 4,
    stemBot = y0 + 22;
  c.strokeStyle = COL.mute;
  c.fillStyle = COL.mute;
  c.lineWidth = 1.2;
  for (const bar of bars) {
    if (bar.start > t1) break;
    if (bar.start + bar.length < t0) continue;
    const beatLen = (song.ppq * 4) / bar.den;
    const xOf = (b: (typeof bar.beats)[number]) => tickToX(a, b.start) + Math.min(8, (b.duration * a.ppt) / 2);
    // group beamable beats within one beat of the time signature
    let group: typeof bar.beats = [];
    const flush = () => {
      if (group.length >= 2) {
        const xs = group.map(xOf);
        c.fillRect(xs[0], stemBot - 2, xs[xs.length - 1] - xs[0] + 1.2, 2.5);
        for (let i = 0; i < group.length; i++) {
          const fl = FLAGS[group[i].value];
          for (let k = 1; k < fl; k++) {
            const yb = stemBot - 2 - k * 4;
            const nx = i + 1 < group.length && FLAGS[group[i + 1].value] > k ? xs[i + 1] : null;
            const px = i > 0 && FLAGS[group[i - 1].value] > k ? xs[i - 1] : null;
            if (nx != null) c.fillRect(xs[i], yb, nx - xs[i] + 1.2, 2.5);
            else if (px == null) c.fillRect(xs[i], yb, 6, 2.5);
          }
        }
      } else if (group.length === 1) {
        const x = xOf(group[0]);
        const fl = FLAGS[group[0].value];
        for (let k = 0; k < fl; k++) {
          c.beginPath();
          c.moveTo(x, stemBot - k * 4);
          c.lineTo(x + 6, stemBot - k * 4 - 6);
          c.stroke();
        }
      }
      if (group.some((b) => b.tuplet)) {
        const xs = group.map(xOf);
        c.font = '600 9px ' + BODY;
        c.textAlign = 'center';
        c.fillText('3', (xs[0] + xs[xs.length - 1]) / 2, stemBot + 7);
        c.textAlign = 'left';
      }
      group = [];
    };
    let groupBeat = -1;
    for (const b of bar.beats) {
      const beatIdx = Math.floor((b.start - bar.start) / beatLen);
      if (b.rest || b.value < 8 || beatIdx !== groupBeat) flush();
      if (b.rest) continue;
      const x = xOf(b);
      if (b.value >= 2) {
        c.beginPath();
        c.moveTo(x, b.value === 2 ? stemTop + 9 : stemTop);
        c.lineTo(x, stemBot);
        c.stroke();
      }
      if (b.dots) {
        c.beginPath();
        c.arc(x + 4, stemBot - 3, 1.4, 0, Math.PI * 2);
        c.fill();
      }
      if (b.value >= 8) {
        group.push(b);
        groupBeat = beatIdx;
      }
    }
    flush();
  }
}

/** Keyboard entry cursor: a box on the string at the cursor tick, as wide as the entry length. */
export function drawTabCursor(
  c: CanvasRenderingContext2D,
  song: Song,
  t: Track,
  a: TimeAxis,
  tabY: number,
  ls: number,
  cursor: { tick: number; string: number },
  len: number,
) {
  const n = t.tuning.strings.length;
  const y = tabY + (n - 1 - cursor.string) * ls;
  const x = tickToX(a, cursor.tick);
  const wpx = Math.max(10, Math.min(len, songEnd(song) - cursor.tick) * a.ppt);
  c.strokeStyle = '#8cb4ff';
  c.lineWidth = 1.5;
  rr(c, x - 1, y - 8, wpx, 16, 3);
  c.stroke();
  c.fillStyle = 'rgba(120,170,255,0.14)';
  c.fill();
}
