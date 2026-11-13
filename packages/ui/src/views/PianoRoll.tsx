import { useEffect, useRef } from 'react';
import {
  addNotes,
  newId,
  pitchClassName,
  pitchName,
  removeNotes,
  setLoop,
  isFretted,
  laneById,
  inScale,
  snapToScale,
  songScale,
  stringColor,
  trackFingering,
  updateNotes,
  type Note,
  type Track,
} from '@riffroll/core';
import { ZOOMS_Y, barMap, currentTrack, songEnd, useStore } from '../store';
import {
  BODY,
  COL,
  DISP,
  KEYS_W,
  MONO,
  RULER_H,
  fit,
  floorTick,
  frameScheduler,
  lowerBound,
  pxPerTick,
  rr,
  snapTick,
  alpha,
} from '../canvas';
import {
  drawGrid,
  drawPlayhead,
  drawToneWash,
  isCleanTone,
  tickToX,
  toneOf,
  xToTick,
  type TimeAxis,
} from './timeline';
import { pedalSegments } from '@riffroll/core';
import { preview } from '../audio-bridge';
import { seek } from '../transport';
import { techCode } from './tabDraw';

let RH = 18; // row height (24 in the mobile layout: finger-sized)
const BLACK = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const EDGE = 7; // px: grab zone for resizing at a note's right edge

/** Pitch range shown for a track: the whole playable range plus any out-of-range notes. */
export function pitchRange(t: Track): { lo: number; hi: number } {
  const s = t.tuning.strings;
  // guitar/bass: the instrument's range; other (piano, synth…): C2–C7 plus whatever the notes need
  let lo = s.length ? s[0] + t.capo : 36;
  let hi = s.length ? s[s.length - 1] + t.maxFret : 96;
  for (const n of t.notes) {
    if (n.pitch < lo) lo = n.pitch;
    if (n.pitch > hi) hi = n.pitch;
  }
  return { lo, hi };
}

type Drag =
  | {
      mode: 'move';
      ids: string[];
      startTick: number;
      startPitch: number;
      orig: Map<string, Note>;
      moved: boolean;
    }
  | { mode: 'resize'; ids: string[]; orig: Map<string, Note>; anchorTick: number; fresh: boolean }
  | { mode: 'box'; x0: number; y0: number; x1: number; y1: number; additive: boolean; base: Set<string> }
  | { mode: 'erase' }
  | { mode: 'loop'; from: number }
  /** drag the green loop bar: an edge, or the whole loop */
  | {
      mode: 'loopEdit';
      kind: 'start' | 'end' | 'move';
      grab: number;
      orig: { start: number; end: number };
      moved: boolean;
      p0: number;
    };

export function PianoRoll() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rowH = () => {
      const st = useStore.getState();
      return Math.max(8, Math.round((st.layout === 'mobile' ? 24 : 18) * ZOOMS_Y[st.zoomY]));
    };
    RH = rowH();
    const wrap = wrapRef.current!,
      cv = cvRef.current!,
      sc = scRef.current!,
      sizer = sizerRef.current!;
    let range = { lo: 40, hi: 88 };
    let drag: Drag | null = null;
    let lastTrackId = '';
    let tapStart: { x: number; y: number; t: number; sl: number; st: number; id: number } | null = null;

    const axis = (): TimeAxis => {
      const st = useStore.getState();
      return { ppt: pxPerTick(st.zoom), scrollX: sc.scrollLeft, width: sc.clientWidth };
    };

    function layout() {
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t) return;
      const nr = pitchRange(t);
      // vertical zoom: keep the pitch in the middle of the view where it was
      const newRH = rowH();
      const viewH = sc.clientHeight - RULER_H;
      const midPitch = range.hi - (sc.scrollTop + viewH / 2) / RH;
      const zoomedY = newRH !== RH;
      RH = newRH;
      const w = KEYS_W + songEnd(st.song) * pxPerTick(st.zoom) + 40;
      sizer.style.width = w + 'px';
      sizer.style.height = RULER_H + (nr.hi - nr.lo + 1) * RH + 'px';
      if (t.id !== lastTrackId) {
        lastTrackId = t.id;
        range = nr;
        // scroll so the low strings are visible at the bottom, like the prototype
        sc.scrollTop = Math.max(
          0,
          (nr.hi - (t.tuning.strings[0] ?? 48) + 1) * RH + RULER_H - sc.clientHeight + 4,
        );
      } else if (zoomedY) {
        range = nr;
        sc.scrollTop = Math.max(0, (range.hi - midPitch) * RH - viewH / 2);
      } else if (nr.lo !== range.lo || nr.hi !== range.hi) {
        const dy = (nr.hi - range.hi) * RH;
        range = nr;
        sc.scrollTop += dy;
      }
      if (Math.abs(sc.scrollLeft - st.scrollX) > 1) sc.scrollLeft = st.scrollX;
    }

    function draw() {
      const st = useStore.getState();
      const t = currentTrack(st);
      const w = sc.clientWidth,
        h = sc.clientHeight;
      if (!w || !h || !t) return;
      const c = fit(cv, w, h);
      const a = axis();
      const sy = sc.scrollTop;
      const rows = range.hi - range.lo + 1;
      const gy0 = RULER_H - sy;
      const end = songEnd(st.song);
      const gridW = end * a.ppt;
      const gx0 = tickToX(a, 0);
      const fretted = isFretted(t.type);
      const fing = fretted ? trackFingering(t) : new Map<string, null>();
      const nStr = t.tuning.strings.length;

      c.fillStyle = COL.bg;
      c.fillRect(0, 0, w, h);
      c.save();
      c.beginPath();
      c.rect(KEYS_W, RULER_H, w - KEYS_W, h - RULER_H);
      c.clip();
      const r0 = Math.max(0, Math.floor(sy / RH)),
        r1 = Math.min(rows - 1, Math.ceil((sy + h) / RH));
      // rows follow the song's scale (out-of-scale rows dark, the tonic tinted); chromatic = piano keys
      const scale = songScale(st.song);
      const chromatic = scale.name === 'chromatic';
      for (let r = r0; r <= r1; r++) {
        const p = range.hi - r,
          y = gy0 + r * RH;
        const dark = chromatic ? BLACK[p % 12] : !inScale(p, scale);
        c.fillStyle = dark ? COL.rowB : COL.rowW;
        c.fillRect(gx0, y, gridW, RH);
        if (!chromatic && p % 12 === scale.tonic) {
          c.fillStyle = 'rgba(232, 54, 93, 0.07)';
          c.fillRect(gx0, y, gridW, RH);
        }
        c.fillStyle = p % 12 === 0 ? COL.cLine : COL.rowLine;
        c.fillRect(gx0, y + RH - 1, gridW, 1);
      }
      drawToneWash(c, st.song, t, a, gy0, rows * RH);
      drawGrid(c, st.song, a, st.snap, gy0, rows * RH);

      const tA = xToTick(a, KEYS_W),
        tB = xToTick(a, w);
      // ghost notes: another track's notes, faint and not editable (FL Studio style)
      const ghost =
        st.ghostTrackId && st.ghostTrackId !== t.id
          ? st.song.tracks.find((x) => x.id === st.ghostTrackId)
          : null;
      if (ghost) {
        const gNotes =
          ghost.type === 'drums'
            ? ghost.hits.map((hh) => ({
                pitch: laneById.get(`${hh.piece}:${hh.articulation}`)?.gm ?? 38,
                start: hh.start,
                duration: st.song.ppq / 4,
              }))
            : ghost.notes;
        c.save();
        for (const n of gNotes) {
          if (n.start > tB || n.start + n.duration < tA) continue;
          if (n.pitch > range.hi || n.pitch < range.lo) continue;
          const x = tickToX(a, n.start) + 1,
            y = gy0 + (range.hi - n.pitch) * RH + 2;
          const nw = Math.max(3, n.duration * a.ppt - 2);
          c.fillStyle = alpha(ghost.color, 0.16);
          rr(c, x, y, nw, RH - 4, 3);
          c.fill();
          c.strokeStyle = alpha(ghost.color, 0.55);
          c.lineWidth = 1;
          c.setLineDash([3, 2]);
          rr(c, x + 0.5, y + 0.5, nw - 1, RH - 5, 3);
          c.stroke();
        }
        c.restore();
      }

      // notes (sorted by start; scan from a little before the visible window to catch long notes)
      c.textBaseline = 'middle';
      let maxDur = 0;
      for (const n of t.notes) if (n.duration > maxDur) maxDur = n.duration;
      for (let i = lowerBound(t.notes, tA - maxDur); i < t.notes.length; i++) {
        const n = t.notes[i];
        if (n.start > tB) break;
        if (n.start + n.duration < tA) continue;
        const x = tickToX(a, n.start) + 1,
          y = gy0 + (range.hi - n.pitch) * RH + 1,
          nw = Math.max(3, n.duration * a.ppt - 2),
          nh = RH - 2;
        if (y > h || y + nh < RULER_H) continue;
        const pos = fing.get(n.id);
        // guitar/bass notes take their string's colour; other instruments the track colour
        const col = !fretted ? t.color : pos ? stringColor(t.type, nStr, pos.string) : COL.unplayable;
        c.globalAlpha = 0.55 + (0.45 * n.velocity) / 127;
        c.fillStyle = col;
        rr(c, x, y, nw, nh, 3);
        c.fill();
        c.globalAlpha = 1;
        c.strokeStyle = 'rgba(0,0,0,0.35)';
        c.lineWidth = 1;
        rr(c, x + 0.5, y + 0.5, nw - 1, nh - 1, 3);
        c.stroke();
        if (n.pinnedString != null && pos) {
          // small pin mark: the user chose this string
          c.fillStyle = 'rgba(21,23,28,0.75)';
          c.beginPath();
          c.moveTo(x + nw - 7, y);
          c.lineTo(x + nw, y);
          c.lineTo(x + nw, y + 7);
          c.fill();
        }
        const code = techCode(n);
        if (code) {
          c.font = '600 9px ' + BODY;
          const cw = c.measureText(code).width;
          if (cw < nw - 22) {
            c.fillStyle = 'rgba(21,23,28,0.85)';
            c.textAlign = 'right';
            c.fillText(code, x + nw - 4, y + nh / 2 + 0.5);
            c.textAlign = 'left';
          }
        }
        if (st.selection.has(n.id)) {
          c.strokeStyle = COL.head;
          c.lineWidth = 2;
          rr(c, x - 1, y - 1, nw + 2, nh + 2, 4);
          c.stroke();
        }
        // fret number + note name, shrinking gracefully for short notes
        // guitar/bass: fret number (✕ = no string reaches it); other instruments: the note name
        const txt = !fretted ? pitchName(n.pitch) : pos ? String(pos.fret) : '✕';
        c.font = '600 11px ' + MONO;
        let tw = c.measureText(txt).width;
        if (tw > nw - 4) {
          c.font = '600 9px ' + MONO;
          tw = c.measureText(txt).width;
        }
        if (tw <= nw - 3) {
          c.fillStyle = pos || !fretted ? '#15171c' : '#c9ccd4';
          c.fillText(txt, x + (nw < 16 ? (nw - tw) / 2 : 4), y + nh / 2 + 0.5);
          if (pos) {
            const nm = pitchClassName(n.pitch);
            c.font = '500 10px ' + BODY;
            const nmw = c.measureText(nm).width;
            if (4 + tw + 3 + nmw <= nw - 3) {
              c.fillStyle = 'rgba(21,23,28,0.68)';
              c.fillText(nm, x + 4 + tw + 3, y + nh / 2 + 0.5);
            }
          }
        }
      }
      if (drag?.mode === 'box') {
        const bx = Math.min(drag.x0, drag.x1) - sc.scrollLeft,
          by = Math.min(drag.y0, drag.y1) - sy;
        c.fillStyle = COL.select;
        c.fillRect(bx, by, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
        c.strokeStyle = COL.selectLine;
        c.lineWidth = 1;
        c.strokeRect(bx + 0.5, by + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      }
      drawPlayhead(c, a, st.playhead, gy0, rows * RH);
      c.restore();

      // ruler: bar numbers, section names, pedal strip, cursor
      c.fillStyle = COL.panel;
      c.fillRect(0, 0, w, RULER_H);
      c.save();
      c.beginPath();
      c.rect(KEYS_W, 0, w - KEYS_W, RULER_H);
      c.clip();
      const bm = barMap(st.song);
      c.textBaseline = 'middle';
      for (let b = bm.barAtTick(Math.max(0, tA)).index; b <= st.song.bars; b++) {
        const s = bm.barStart(b);
        if (s > tB) break;
        const x = tickToX(a, s);
        c.fillStyle = COL.bar;
        c.fillRect(x, 0, 1, RULER_H);
        if (b < st.song.bars) {
          c.fillStyle = COL.ink;
          c.font = '600 13px ' + DISP;
          c.fillText(String(b + 1), x + 6, RULER_H / 2 - 1);
        }
      }
      for (const sec of st.song.sections) {
        const x = tickToX(a, sec.tick);
        if (x > w || x < KEYS_W - 200) continue;
        c.font = '700 12px ' + DISP;
        const lw = c.measureText(sec.name.toUpperCase()).width;
        c.fillStyle = COL.chip;
        rr(c, x + 22, 3, lw + 10, RULER_H - 9, 3);
        c.fill();
        c.fillStyle = COL.ink;
        c.fillText(sec.name.toUpperCase(), x + 27, RULER_H / 2 - 1);
      }
      if (isFretted(t.type)) {
        for (const sg of pedalSegments(t.pedal, end)) {
          const tone = toneOf(t, sg.toneId);
          c.fillStyle = tone?.color ?? COL.clean;
          c.globalAlpha = isCleanTone(tone) ? 0.55 : 1;
          c.fillRect(tickToX(a, sg.start), RULER_H - 3, (sg.end - sg.start) * a.ppt, 3);
        }
        c.globalAlpha = 1;
      }
      if (st.song.loop?.on) {
        const lx0 = tickToX(a, st.song.loop.start),
          lx1 = tickToX(a, st.song.loop.end);
        c.fillStyle = 'rgba(95,209,124,0.22)';
        c.fillRect(lx0, 0, lx1 - lx0, RULER_H - 3);
        c.fillStyle = COL.ok;
        c.fillRect(lx0, 0, 3, RULER_H - 3);
        c.fillRect(lx1 - 3, 0, 3, RULER_H - 3);
        // grab handles at the edges
        c.fillRect(lx0, 0, 7, 5);
        c.fillRect(lx1 - 7, 0, 7, 5);
      }
      const mx = tickToX(a, st.cursor);
      c.fillStyle = COL.ink;
      c.beginPath();
      c.moveTo(mx, RULER_H - 4);
      c.lineTo(mx - 5, RULER_H - 12);
      c.lineTo(mx + 5, RULER_H - 12);
      c.closePath();
      c.fill();
      drawPlayhead(c, a, st.playhead, 0, RULER_H);
      c.restore();

      // keys column, open strings marked in their string colour
      c.save();
      c.beginPath();
      c.rect(0, RULER_H, KEYS_W, h - RULER_H);
      c.clip();
      const open = t.tuning.strings.map((p) => p + t.capo);
      const keyScale = songScale(st.song);
      const keyChromatic = keyScale.name === 'chromatic';
      for (let r = r0; r <= r1; r++) {
        const p = range.hi - r,
          y = gy0 + r * RH,
          bk = BLACK[p % 12];
        c.fillStyle = bk ? COL.keyBlack : COL.keyWhite;
        c.fillRect(0, y, KEYS_W - 1, RH - 1);
        if (!keyChromatic && inScale(p, keyScale)) {
          c.fillStyle = p % 12 === keyScale.tonic ? COL.dist : 'rgba(138,164,200,0.7)';
          c.fillRect(0, y + 1, 2, RH - 3);
        }
        c.font = (p % 12 === 0 ? '600 ' : '500 ') + '10px ' + MONO;
        c.fillStyle = bk ? COL.keyBlackInk : p % 12 === 0 ? COL.ink : COL.keyInk;
        c.fillText(pitchName(p), 5, y + RH / 2);
        for (let s = 0; s < open.length; s++)
          if (open[s] === p) {
            c.fillStyle = stringColor(t.type, nStr, s);
            c.fillRect(KEYS_W - 7, y + 3, 4, RH - 7);
          }
      }
      c.restore();
      c.fillStyle = COL.panel;
      c.fillRect(0, 0, KEYS_W, RULER_H);
      c.fillStyle = COL.mute;
      c.font = '600 11px ' + DISP;
      c.textBaseline = 'middle';
      c.fillText('BAR', 8, RULER_H / 2);
      c.fillStyle = COL.line;
      c.fillRect(KEYS_W - 1, 0, 1, h);
      c.fillRect(0, RULER_H - 1, w, 1);
    }

    const requestDraw = frameScheduler(draw);

    // ---------------- hit testing ----------------
    const pt = (e: { clientX: number; clientY: number }) => {
      const r = sc.getBoundingClientRect();
      const lx = e.clientX - r.left,
        ly = e.clientY - r.top;
      return { lx, ly, gx: lx - KEYS_W + sc.scrollLeft, gy: ly - RULER_H + sc.scrollTop };
    };
    const inGrid = (p: ReturnType<typeof pt>) =>
      p.lx >= KEYS_W && p.ly >= RULER_H && p.lx < sc.clientWidth && p.ly < sc.clientHeight;
    const pitchAt = (gy: number) => range.hi - Math.floor(gy / RH);
    const tickAt = (gx: number) => gx / pxPerTick(useStore.getState().zoom);
    function noteAt(t: Track, gx: number, gy: number): Note | null {
      const p = pitchAt(gy),
        tick = tickAt(gx);
      for (let i = t.notes.length - 1; i >= 0; i--) {
        const n = t.notes[i];
        if (n.pitch === p && tick >= n.start && tick < n.start + n.duration) return n;
      }
      return null;
    }
    const nearEdge = (n: Note, gx: number) => {
      const ppt = pxPerTick(useStore.getState().zoom);
      return (n.start + n.duration) * ppt - gx < EDGE && n.duration * ppt > EDGE * 2;
    };

    function addAt(t: Track, gx: number, gy: number): Note | null {
      const st = useStore.getState();
      const end = songEnd(st.song);
      const start = Math.max(0, floorTick(tickAt(gx), st.snap));
      if (start >= end) return null;
      let pitch = pitchAt(gy);
      if (st.snapScale) pitch = snapToScale(pitch, songScale(st.song));
      if (pitch < range.lo || pitch > range.hi) return null;
      const n: Note = {
        id: newId('n'),
        pitch,
        start,
        duration: Math.min(st.noteLen, end - start),
        velocity: 100,
      };
      st.exec(addNotes(t.id, [n]));
      st.select([n.id]);
      preview(t, n.pitch, n.start, n.duration);
      return n;
    }

    /** Which part of the loop bar is under x (ruler only): an edge (±6 px), inside, or none. */
    function loopPart(lx: number): 'start' | 'end' | 'move' | null {
      const loop = useStore.getState().song.loop;
      if (!loop?.on) return null;
      const a = axis();
      const x0 = tickToX(a, loop.start),
        x1 = tickToX(a, loop.end);
      if (Math.abs(lx - x0) <= 6) return 'start';
      if (Math.abs(lx - x1) <= 6) return 'end';
      if (lx > x0 && lx < x1) return 'move';
      return null;
    }

    function rulerClick(p: ReturnType<typeof pt>) {
      const st = useStore.getState();
      const tick = Math.max(0, Math.min(songEnd(st.song) - 1, floorTick(tickAt(p.gx), st.snap)));
      seek(tick);
    }

    // ---------------- pointer: mouse/pen get the FL-style editor, touch gets the prototype's tap model ----------
    const onDown = (e: PointerEvent) => {
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t) return;
      const p = pt(e);
      // working in the roll: arrow keys belong to the selected notes, not the tab cursor
      if (st.tabCursor && p.ly >= RULER_H) st.set({ tabCursor: null });
      if (e.pointerType === 'touch') {
        tapStart = {
          x: e.clientX,
          y: e.clientY,
          t: Date.now(),
          sl: sc.scrollLeft,
          st: sc.scrollTop,
          id: e.pointerId,
        };
        return;
      }
      if (p.ly < RULER_H && p.lx >= KEYS_W) {
        if (e.button !== 0) return;
        if (e.shiftKey) {
          // Shift+drag in the ruler sets the loop region (snapped to bars' grid)
          const from = Math.max(0, snapTick(tickAt(p.gx), st.snap));
          st.begin('Set loop');
          drag = { mode: 'loop', from };
          sc.setPointerCapture(e.pointerId);
        } else {
          const part = loopPart(p.lx);
          if (part && st.song.loop) {
            st.begin(part === 'move' ? 'Move loop' : 'Change loop');
            drag = {
              mode: 'loopEdit',
              kind: part,
              grab: tickAt(p.gx),
              orig: { start: st.song.loop.start, end: st.song.loop.end },
              moved: false,
              p0: p.lx,
            };
            sc.setPointerCapture(e.pointerId);
          } else rulerClick(p);
        }
        return;
      }
      if (p.lx < KEYS_W && p.ly >= RULER_H) {
        const pitch = pitchAt(p.gy);
        if (e.shiftKey || e.ctrlKey || e.metaKey) {
          // Shift+click a key: select every note of that pitch (Ctrl/Cmd as well: add to the selection)
          const ids = t.notes.filter((n) => n.pitch === pitch).map((n) => n.id);
          const keep = e.ctrlKey || e.metaKey ? [...st.selection] : [];
          st.select([...keep, ...ids], null);
          st.set({ status: `${ids.length} × ${pitchName(pitch)} selected` });
          requestDraw();
          return;
        }
        preview(t, pitch, st.cursor, st.noteLen);
        return;
      }
      if (!inGrid(p)) return;
      const hit = noteAt(t, p.gx, p.gy);
      if (e.button === 2) {
        st.begin('Delete notes');
        if (hit) st.exec(removeNotes(t.id, [hit.id]));
        drag = { mode: 'erase' };
        sc.setPointerCapture(e.pointerId);
        return;
      }
      if (e.button !== 0) return;
      sc.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (hit) {
        let sel = new Set(st.selection);
        if (e.ctrlKey || e.metaKey) {
          if (sel.has(hit.id)) sel.delete(hit.id);
          else sel.add(hit.id);
          st.select(sel, hit.id);
          return;
        }
        if (!sel.has(hit.id)) sel = new Set([hit.id]);
        st.select(sel, hit.id);
        const orig = new Map(t.notes.filter((n) => sel.has(n.id)).map((n) => [n.id, n]));
        if (nearEdge(hit, p.gx)) {
          st.begin('Resize notes');
          drag = { mode: 'resize', ids: [...sel], orig, anchorTick: hit.start + hit.duration, fresh: false };
        } else {
          st.begin('Move notes');
          if (e.altKey) {
            // Alt-drag duplicates, then moves the copies
            const copies = [...orig.values()].map((n) => ({ ...n, id: newId('n') }));
            st.exec(addNotes(t.id, copies, 'Duplicate notes'));
            const corig = new Map(copies.map((n) => [n.id, n]));
            st.select(corig.keys(), null);
            drag = {
              mode: 'move',
              ids: [...corig.keys()],
              startTick: tickAt(p.gx),
              startPitch: hit.pitch,
              orig: corig,
              moved: false,
            };
          } else {
            drag = {
              mode: 'move',
              ids: [...sel],
              startTick: tickAt(p.gx),
              startPitch: hit.pitch,
              orig,
              moved: false,
            };
          }
          preview(t, hit.pitch, hit.start, hit.duration);
        }
      } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
        const x = p.lx + sc.scrollLeft,
          y = p.ly + sc.scrollTop;
        drag = {
          mode: 'box',
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          additive: e.shiftKey,
          base: new Set(e.shiftKey ? st.selection : []),
        };
      } else {
        st.begin('Add note');
        const n = addAt(t, p.gx, p.gy);
        if (n)
          drag = {
            mode: 'resize',
            ids: [n.id],
            orig: new Map([[n.id, n]]),
            anchorTick: n.start + n.duration,
            fresh: true,
          };
        else st.commit();
      }
      requestDraw();
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t) return;
      const p = pt(e);
      if (!drag && p.ly < RULER_H && p.lx >= KEYS_W) {
        const part = loopPart(p.lx);
        sc.style.cursor =
          part === 'start' || part === 'end' ? 'ew-resize' : part === 'move' ? 'grab' : 'pointer';
        return;
      }
      if (!drag) {
        const hit = inGrid(p) ? noteAt(t, p.gx, p.gy) : null;
        sc.style.cursor = hit
          ? nearEdge(hit, p.gx)
            ? 'ew-resize'
            : 'grab'
          : inGrid(p)
            ? 'crosshair'
            : 'default';
        return;
      }
      const end = songEnd(st.song);
      if (drag.mode === 'loopEdit') {
        if (Math.abs(p.lx - drag.p0) > 3) drag.moved = true;
        if (!drag.moved) return;
        const { start: s0, end: e0 } = drag.orig;
        const tick = snapTick(tickAt(p.gx), st.snap);
        let ls = s0,
          le = e0;
        if (drag.kind === 'start') ls = Math.max(0, Math.min(e0 - st.snap, tick));
        else if (drag.kind === 'end') le = Math.min(end, Math.max(s0 + st.snap, tick));
        else {
          const d = Math.max(-s0, Math.min(end - e0, snapTick(tickAt(p.gx) - drag.grab, st.snap)));
          ls = s0 + d;
          le = e0 + d;
        }
        st.exec(setLoop({ start: ls, end: le, on: true }));
        sc.style.cursor = drag.kind === 'move' ? 'grabbing' : 'ew-resize';
        return;
      }
      if (drag.mode === 'loop') {
        const to = Math.max(0, Math.min(end, snapTick(tickAt(p.gx), st.snap)));
        const [a, b] = drag.from < to ? [drag.from, to] : [to, drag.from];
        if (b > a) st.exec(setLoop({ start: a, end: b, on: true }));
        return;
      }
      if (drag.mode === 'erase') {
        const hit = noteAt(t, p.gx, p.gy);
        if (hit) st.exec(removeNotes(t.id, [hit.id]));
      } else if (drag.mode === 'resize') {
        const tick = tickAt(p.gx);
        const changes: Record<string, Partial<Note>> = {};
        const dt = snapTick(tick - drag.anchorTick, st.snap);
        for (const [id, n] of drag.orig) {
          const dur = Math.max(Math.min(st.snap, n.duration), n.duration + dt);
          changes[id] = { duration: Math.min(dur, end - n.start) };
        }
        st.exec(updateNotes(t.id, changes, 'Resize notes'));
      } else if (drag.mode === 'move') {
        const dTick = snapTick(tickAt(p.gx) - drag.startTick, st.snap);
        const dPitch = pitchAt(p.gy) - drag.startPitch;
        let minStart = Infinity,
          maxEnd = 0,
          minP = 127,
          maxP = 0;
        for (const n of drag.orig.values()) {
          minStart = Math.min(minStart, n.start);
          maxEnd = Math.max(maxEnd, n.start + n.duration);
          minP = Math.min(minP, n.pitch);
          maxP = Math.max(maxP, n.pitch);
        }
        const dt = Math.max(-minStart, Math.min(end - maxEnd, dTick));
        const dp = Math.max(range.lo - minP, Math.min(range.hi - maxP, dPitch));
        const changes: Record<string, Partial<Note>> = {};
        const sc8 = st.snapScale && dp ? songScale(st.song) : null;
        for (const [id, n] of drag.orig)
          changes[id] = {
            start: n.start + dt,
            pitch: sc8 ? snapToScale(n.pitch + dp, sc8) : n.pitch + dp,
            ...(dp ? { pinnedString: null } : {}),
          };
        const first = drag.orig.values().next().value!;
        const cur = t.notes.find((n) => n.id === first.id);
        if (dp && cur && cur.pitch !== first.pitch + dp)
          preview(t, first.pitch + dp, first.start + dt, first.duration);
        drag.moved = drag.moved || dt !== 0 || dp !== 0;
        st.exec(updateNotes(t.id, changes, 'Move notes'));
      } else if (drag.mode === 'box') {
        drag.x1 = p.lx + sc.scrollLeft;
        drag.y1 = p.ly + sc.scrollTop;
        const ppt = pxPerTick(st.zoom);
        const t0 = (Math.min(drag.x0, drag.x1) - KEYS_W) / ppt,
          t1 = (Math.max(drag.x0, drag.x1) - KEYS_W) / ppt;
        const pHi = pitchAt(Math.min(drag.y0, drag.y1) - RULER_H),
          pLo = pitchAt(Math.max(drag.y0, drag.y1) - RULER_H);
        const sel = new Set(drag.base);
        for (const n of t.notes)
          if (n.pitch >= pLo && n.pitch <= pHi && n.start < t1 && n.start + n.duration > t0) sel.add(n.id);
        st.select(sel, null);
        requestDraw();
      }
    };

    const onUp = (e: PointerEvent) => {
      const st = useStore.getState();
      if (e.pointerType === 'touch') {
        const t = currentTrack(st);
        if (tapStart && tapStart.id === e.pointerId && t) {
          const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
          const scrolled = Math.abs(sc.scrollLeft - tapStart.sl) + Math.abs(sc.scrollTop - tapStart.st);
          if (moved < 10 && scrolled < 4 && Date.now() - tapStart.t < 600) {
            const p = pt(e);
            if (p.ly < RULER_H) rulerClick(p);
            else if (inGrid(p)) {
              const hit = noteAt(t, p.gx, p.gy);
              if (hit) {
                st.select([hit.id]);
                preview(t, hit.pitch, hit.start, hit.duration);
              } else addAt(t, p.gx, p.gy);
            }
          }
        }
        tapStart = null;
        return;
      }
      if (drag?.mode === 'loopEdit' && !drag.moved) {
        // a click inside the loop (no drag) still moves the playback start
        st.cancel();
        const d = drag;
        drag = null;
        if (d.kind === 'move') rulerClick(pt(e));
        requestDraw();
        return;
      }
      if (drag && drag.mode !== 'box') {
        if (drag.mode === 'resize' && drag.fresh) {
          const t = currentTrack(st);
          const id = drag.ids[0];
          const n = t?.notes.find((x) => x.id === id);
          if (n && n.duration !== st.noteLen) st.set({ noteLen: n.duration });
        }
        st.commit();
      }
      drag = null;
      requestDraw();
    };

    const onWheel = (e: WheelEvent) => {
      if (e.altKey) {
        // Alt+wheel: vertical zoom (taller / shorter rows)
        e.preventDefault();
        const st = useStore.getState();
        const d = (e.deltaY || e.deltaX) < 0 ? 1 : -1;
        const z = Math.max(0, Math.min(ZOOMS_Y.length - 1, st.zoomY + d));
        if (z !== st.zoomY) st.set({ zoomY: z });
        return;
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const st = useStore.getState();
      const z = Math.max(0, Math.min(7, st.zoom + (e.deltaY < 0 ? 1 : -1)));
      if (z === st.zoom) return;
      const p = pt(e);
      const tick = tickAt(p.gx);
      st.set({ zoom: z });
      layout();
      sc.scrollLeft = Math.max(0, tick * pxPerTick(z) - (p.lx - KEYS_W));
    };

    const onScroll = () => {
      useStore.getState().set({ scrollX: sc.scrollLeft });
      requestDraw();
    };

    sc.addEventListener('pointerdown', onDown);
    sc.addEventListener('pointermove', onMove);
    sc.addEventListener('pointerup', onUp);
    sc.addEventListener('pointercancel', onUp);
    sc.addEventListener('contextmenu', (e) => e.preventDefault());
    sc.addEventListener('wheel', onWheel, { passive: false });
    sc.addEventListener('scroll', onScroll, { passive: true });

    const unsub = useStore.subscribe((s, prev) => {
      if (
        s.song !== prev.song ||
        s.zoom !== prev.zoom ||
        s.zoomY !== prev.zoomY ||
        s.trackId !== prev.trackId ||
        s.scrollX !== prev.scrollX
      )
        layout();
      requestDraw();
    });
    const ro = new ResizeObserver(() => {
      layout();
      requestDraw();
    });
    ro.observe(wrap);
    layout();
    requestDraw();
    document.fonts?.ready.then(requestDraw);
    return () => {
      unsub();
      ro.disconnect();
      sc.removeEventListener('pointerdown', onDown);
      sc.removeEventListener('pointermove', onMove);
      sc.removeEventListener('pointerup', onUp);
      sc.removeEventListener('pointercancel', onUp);
      sc.removeEventListener('wheel', onWheel);
      sc.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <div ref={wrapRef} className="cvwrap roll" aria-label="Piano roll">
      <canvas ref={cvRef} />
      <div
        ref={scRef}
        className="scroller"
        tabIndex={0}
        aria-label="Piano roll. Arrow keys move the selected notes, Delete removes them, Space plays. Press ? for all shortcuts."
      >
        <div ref={sizerRef} className="sizer" />
      </div>
    </div>
  );
}
