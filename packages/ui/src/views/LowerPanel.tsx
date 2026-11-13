import { useEffect, useRef, useState } from 'react';
import {
  addStomp,
  newId,
  pedalSegments,
  removeStomp,
  setPedal,
  stringColor,
  stringLabel,
  trackFingering,
  updateNotes,
  updateStomp,
  type Note,
  type Stomp,
  type Track,
  isFretted,
} from '@riffroll/core';
import { currentTrack, songEnd, useStore } from '../store';
import {
  COL,
  DISP,
  KEYS_W,
  MONO,
  alpha,
  fit,
  frameScheduler,
  lowerBound,
  pxPerTick,
  rr,
  snapTick,
} from '../canvas';
import { drawGrid, drawPlayhead, isCleanTone, tickToX, toneOf, xToTick, type TimeAxis } from './timeline';
import { preview } from '../audio-bridge';
import {
  META_ROW,
  RHYTHM_H,
  drawRepeats,
  drawRhythm,
  drawTabCursor,
  drawTabMeta,
  drawTechniques,
} from './tabDraw';
import { floorTick } from '../canvas';
import { tabCursorTo } from '../tabEntry';

// vertical layout of the lower panel
export const VEL_Y = 6;
export let VEL_H = 38;
export const PED_Y = VEL_Y + VEL_H + 10;
export const PED_H = 26;
export const TAB_Y = PED_Y + PED_H + 22 + META_ROW;
// tab line spacing (wider in the mobile layout so strings can be tapped)
export let LS = 15;
const STOMP_R = 8;

export function lowerPanelHeight(strings: number, showVelocity = true) {
  return (showVelocity ? TAB_Y : TAB_Y - VEL_H - 10) + (strings - 1) * LS + 14 + RHYTHM_H;
}

type Drag =
  | { mode: 'vel'; ids: string[]; y0: number }
  /** Alt+drag in the velocity lane: draw a line; notes under it take its height */
  | { mode: 'vline'; x0: number; y0: number; x1: number; y1: number }
  | { mode: 'velH'; y0: number; h0: number }
  | { mode: 'stomp'; id: string; x0: number; moved: boolean; origTick: number };

interface Menu {
  x: number;
  y: number;
  stompId: string;
}

/** Draws the footswitch marker used in the pedal lane and above the tab (tells the player when to stomp). */
function drawFootswitch(c: CanvasRenderingContext2D, x: number, y: number, r = STOMP_R) {
  c.fillStyle = COL.foot;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = COL.ink;
  c.lineWidth = 2;
  c.stroke();
  c.fillStyle = COL.ink;
  c.beginPath();
  c.arc(x, y, r * 0.4, 0, Math.PI * 2);
  c.fill();
}

export function LowerPanel({
  showVelocity = true,
  showTab = true,
}: {
  showVelocity?: boolean;
  showTab?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const mobile = useStore((s) => s.layout === 'mobile');
  LS = mobile ? 21 : 15;
  const strings = useStore((s) => currentTrack(s)?.tuning.strings.length ?? 6);
  const trackType = useStore((s) => currentTrack(s)?.type);
  const pedalOn = trackType === 'guitar' || trackType === 'bass';
  const lanes = useStore((s) => s.lanes);
  const [lanesMenu, setLanesMenu] = useState(false);
  if (!mobile) LS = lanes.ls;
  VEL_H = lanes.velH;
  // each lane can be hidden; what's below moves up
  const showVel = showVelocity && lanes.vel && trackType !== 'drums';
  const showPed = pedalOn && lanes.pedal;
  const pedY0 = VEL_Y + (showVel ? VEL_H + 10 : 0);
  const tabY0 = pedY0 + (showPed ? PED_H + 22 : 16) + META_ROW;
  const height =
    showTab && pedalOn
      ? tabY0 + (strings - 1) * LS + 14 + RHYTHM_H
      : showPed
        ? pedY0 + PED_H + 10
        : showVel
          ? VEL_Y + VEL_H + 10
          : 26;

  useEffect(() => {
    const cv = cvRef.current!,
      sc = scRef.current!,
      sizer = sizerRef.current!,
      wrap = wrapRef.current!;
    let drag: Drag | null = null;
    const pedY = pedY0,
      tabY = tabY0;

    const axis = (): TimeAxis => {
      const st = useStore.getState();
      return { ppt: pxPerTick(st.zoom), scrollX: sc.scrollLeft, width: sc.clientWidth };
    };

    function layout() {
      const st = useStore.getState();
      // match the roll's scrollable width so both scroll in lockstep
      sizer.style.width = KEYS_W + songEnd(st.song) * pxPerTick(st.zoom) + 40 + 'px';
      sizer.style.height = '1px';
      if (Math.abs(sc.scrollLeft - st.scrollX) > 1) sc.scrollLeft = st.scrollX;
    }

    function draw() {
      const st = useStore.getState();
      const t = currentTrack(st);
      const w = sc.clientWidth,
        h = wrap.clientHeight;
      if (!w || !h || !t) return;
      const c = fit(cv, w, h);
      const a = axis();
      const end = songEnd(st.song);
      const gx0 = tickToX(a, 0);
      const n = t.tuning.strings.length;
      const fing = isFretted(t.type) ? trackFingering(t) : new Map<string, null>();
      c.fillStyle = COL.bg;
      c.fillRect(0, 0, w, h);
      c.save();
      c.beginPath();
      c.rect(KEYS_W, 0, w - KEYS_W, h);
      c.clip();
      c.textBaseline = 'middle';
      const tA = xToTick(a, KEYS_W - 40),
        tB = xToTick(a, w + 40);

      // ---- velocity lane
      if (showVel) {
        c.fillStyle = COL.sunk;
        c.fillRect(gx0, VEL_Y, end * a.ppt, VEL_H);
        for (let i = lowerBound(t.notes, tA); i < t.notes.length; i++) {
          const nt = t.notes[i];
          if (nt.start > tB) break;
          const x = tickToX(a, nt.start) + 1;
          const vh = (nt.velocity / 127) * (VEL_H - 4);
          const pos = fing.get(nt.id);
          const col = !isFretted(t.type)
            ? t.color
            : pos
              ? stringColor(t.type, n, pos.string)
              : COL.unplayable;
          const sel = st.selection.has(nt.id);
          c.fillStyle = sel ? COL.head : col;
          c.globalAlpha = sel ? 1 : 0.8;
          c.fillRect(x, VEL_Y + VEL_H - vh, 2, vh);
          c.fillRect(x - 2, VEL_Y + VEL_H - vh, 6, 2);
          c.globalAlpha = 1;
        }
        if (drag?.mode === 'vline') {
          c.strokeStyle = COL.head;
          c.lineWidth = 1.5;
          c.beginPath();
          c.moveTo(drag.x0, drag.y0);
          c.lineTo(drag.x1, drag.y1);
          c.stroke();
        }
      }

      // ---- pedal lane
      if (showPed) {
        for (const sg of pedalSegments(t.pedal, end)) {
          const x0 = tickToX(a, sg.start),
            x1 = tickToX(a, sg.end);
          if (x1 < KEYS_W || x0 > w) continue;
          const tone = toneOf(t, sg.toneId);
          const col = tone?.color ?? COL.clean;
          const clean = isCleanTone(tone);
          if (!clean) {
            c.fillStyle = col;
            rr(c, x0 + 1, pedY, x1 - x0 - 2, PED_H, 4);
            c.fill();
          } else {
            c.fillStyle = alpha(col, 0.13);
            rr(c, x0 + 1, pedY, x1 - x0 - 2, PED_H, 4);
            c.fill();
            c.strokeStyle = alpha(col, 0.5);
            c.lineWidth = 1;
            rr(c, x0 + 1.5, pedY + 0.5, x1 - x0 - 3, PED_H - 1, 4);
            c.stroke();
          }
          const label = (tone?.name ?? '?').toUpperCase();
          c.font = '700 13px ' + DISP;
          const lw = c.measureText(label).width;
          let tx = Math.max(x0 + (sg.start > 0 ? 14 : 8), KEYS_W + 8);
          tx = Math.min(tx, x1 - lw - 8);
          if (tx >= x0 + 4) {
            c.fillStyle = clean ? col : '#fff';
            c.fillText(label, tx, pedY + PED_H / 2 + 1);
          }
        }
        for (const s of t.pedal.stomps) {
          if (s.tick <= 0 || s.tick >= end) continue;
          drawFootswitch(c, tickToX(a, s.tick), pedY + PED_H / 2);
        }
      }

      // ---- tab staff
      if (showTab && t.type !== 'drums' && n > 0) {
        drawGrid(c, st.song, { ...a }, 1e9, tabY, (n - 1) * LS + 1); // bar lines only
        for (let i = 0; i < n; i++) {
          c.fillStyle = COL.tabLine;
          c.fillRect(gx0, tabY + i * LS, end * a.ppt, 1);
        }
        // stomp markers above the tab, with the tone name, so a printed tab says when to stomp
        for (const sg of pedalSegments(t.pedal, end)) {
          if (!sg.stompId) continue;
          const x = tickToX(a, sg.start);
          if (x > KEYS_W - 60 && x < w + 10) {
            drawFootswitch(c, x, tabY - 16, 5);
            const tone = toneOf(t, sg.toneId);
            c.font = '700 11px ' + DISP;
            c.fillStyle = tone?.color ?? COL.ink;
            c.fillText((tone?.name ?? '').toUpperCase(), x + 8, tabY - 15);
          }
        }
        const items: { nt: Note; x: number; y: number; txt: string; tw: number; s: number }[] = [];
        c.font = '600 12px ' + MONO;
        let maxDur = 0;
        for (const nt of t.notes) maxDur = Math.max(maxDur, nt.duration);
        for (let i = lowerBound(t.notes, tA - maxDur); i < t.notes.length; i++) {
          const nt = t.notes[i];
          if (nt.start > tB) break;
          const pos = fing.get(nt.id);
          if (!pos) continue;
          const txt = nt.tech?.dead ? 'x' : String(pos.fret);
          const y = tabY + (n - 1 - pos.string) * LS;
          items.push({
            nt,
            x: tickToX(a, nt.start) + Math.min(8, (nt.duration * a.ppt) / 2),
            y,
            txt,
            tw: c.measureText(txt).width,
            s: pos.string,
          });
        }
        drawTabMeta(c, st.song, a, tabY, w);
        drawRepeats(c, st.song, a, tabY, (n - 1) * LS);
        drawRhythm(c, st.song, t, a, tabY + (n - 1) * LS + 6, w);
        // sustain lines
        for (const it of items) {
          const xe = tickToX(a, it.nt.start + it.nt.duration) - 3,
            xs = it.x + it.tw / 2 + 3;
          if (xe > xs) {
            c.globalAlpha = 0.45;
            c.fillStyle = stringColor(t.type, n, it.s);
            c.fillRect(xs, it.y - 1, xe - xs, 2);
            c.globalAlpha = 1;
          }
        }
        c.textAlign = 'center';
        for (const it of items) {
          c.fillStyle = COL.bg;
          c.fillRect(it.x - it.tw / 2 - 2, it.y - 7, it.tw + 4, 14);
          if (st.selection.has(it.nt.id)) {
            c.strokeStyle = COL.head;
            c.lineWidth = 1.5;
            rr(c, it.x - it.tw / 2 - 4, it.y - 8.5, it.tw + 8, 17, 3);
            c.stroke();
          }
          c.fillStyle = stringColor(t.type, n, it.s);
          c.fillText(it.txt, it.x, it.y + 0.5);
        }
        c.textAlign = 'left';
        drawTechniques(c, t, items);
        if (st.tabCursor) drawTabCursor(c, st.song, t, a, tabY, LS, st.tabCursor, st.noteLen);
      }
      drawPlayhead(c, a, st.playhead, 0, h);
      c.restore();

      // ---- labels column
      c.fillStyle = COL.panel;
      c.fillRect(0, 0, KEYS_W, h);
      c.textBaseline = 'middle';
      c.fillStyle = COL.mute;
      c.font = '700 11px ' + DISP;
      if (showVel) c.fillText('VEL', 8, VEL_Y + VEL_H / 2);
      if (t.type !== 'drums') {
        if (showPed) c.fillText('PEDAL', 7, pedY + PED_H / 2 + 1);
        if (showTab) {
          c.font = '600 12px ' + MONO;
          for (let i = 0; i < n; i++) {
            const s = n - 1 - i;
            c.fillStyle = stringColor(t.type, n, s);
            c.fillText(stringLabel(t.tuning, s, t.type), 16, tabY + i * LS + 0.5);
          }
        }
      }
      c.fillStyle = COL.line;
      c.fillRect(KEYS_W - 1, 0, 1, h);
    }
    const requestDraw = frameScheduler(draw);

    const local = (e: { clientX: number; clientY: number }) => {
      const r = sc.getBoundingClientRect();
      return { lx: e.clientX - r.left, ly: e.clientY - r.top };
    };
    const stompAt = (t: Track, lx: number): Stomp | undefined => {
      const a = axis();
      return t.pedal.stomps.find((s) => Math.abs(tickToX(a, s.tick) - lx) <= STOMP_R + 2);
    };
    const inPedal = (ly: number) => showPed && ly >= pedY - 6 && ly <= pedY + PED_H + 6;
    /** the bottom edge of the velocity lane: drag to resize it */
    const onVelEdge = (ly: number) => showVel && Math.abs(ly - (VEL_Y + VEL_H + 5)) <= 4;

    function cycleStartTone(t: Track) {
      const st = useStore.getState();
      const p = t.pedal;
      let next: string;
      if (p.mode === 'simple') next = p.startTone === p.toggle[0] ? p.toggle[1] : p.toggle[0];
      else {
        const i = t.tones.findIndex((x) => x.id === p.startTone);
        next = t.tones[(i + 1) % t.tones.length].id;
      }
      st.exec(setPedal(t.id, { startTone: next }, 'Change starting tone'));
    }

    let tap: { x: number; y: number; sl: number; id: number } | null = null;

    const onDown = (e: PointerEvent) => {
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t || t.type === 'drums') return;
      setMenu(null);
      const { lx, ly } = local(e);
      if (e.pointerType === 'touch') {
        tap = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, id: e.pointerId };
        return;
      }
      if (onVelEdge(ly)) {
        drag = { mode: 'velH', y0: ly, h0: VEL_H };
        sc.setPointerCapture(e.pointerId);
        return;
      }
      if (inPedal(ly)) {
        if (lx < KEYS_W) {
          if (e.button === 0) cycleStartTone(t);
          return;
        }
        const s = stompAt(t, lx);
        if (e.button === 2) {
          if (s && t.pedal.mode === 'advanced') setMenu({ x: lx, y: ly, stompId: s.id });
          return;
        }
        if (s) {
          st.begin('Move stomp');
          drag = { mode: 'stomp', id: s.id, x0: lx, moved: false, origTick: s.tick };
          sc.setPointerCapture(e.pointerId);
        } else {
          pedalClick(t, lx);
        }
        return;
      }
      if (showVel && ly >= VEL_Y && ly <= VEL_Y + VEL_H && lx >= KEYS_W) {
        if (e.altKey && e.button === 0) {
          // Alt+drag: draw a velocity line (a ramp) across the notes under it
          st.begin('Draw velocity');
          drag = { mode: 'vline', x0: lx, y0: ly, x1: lx, y1: ly };
          sc.setPointerCapture(e.pointerId);
          return;
        }
        // velocity: drag the stem nearest the pointer (or every selected note if it is selected)
        const a = axis();
        let best: Note | null = null,
          bd = 8;
        for (const nt of t.notes) {
          const d = Math.abs(tickToX(a, nt.start) + 2 - lx);
          if (d < bd) {
            bd = d;
            best = nt;
          }
        }
        if (best) {
          const ids = st.selection.has(best.id) ? [...st.selection] : [best.id];
          st.begin('Change velocity');
          drag = { mode: 'vel', ids, y0: ly };
          sc.setPointerCapture(e.pointerId);
          setVel(t, ids, ly);
        }
        return;
      }
      if (showTab && ly >= tabY - 10 && lx >= KEYS_W) tabClick(t, lx, ly);
    };

    /** Notes between the line's ends (only selected ones if there is a selection) take the line's height. */
    function drawVelLine(t: Track, d: Extract<Drag, { mode: 'vline' }>) {
      const st = useStore.getState();
      const a = axis();
      const [xa, ya, xb, yb] = d.x0 <= d.x1 ? [d.x0, d.y0, d.x1, d.y1] : [d.x1, d.y1, d.x0, d.y0];
      const ch: Record<string, Partial<Note>> = {};
      for (const nt of t.notes) {
        if (st.selection.size && !st.selection.has(nt.id)) continue;
        const x = tickToX(a, nt.start) + 2;
        if (x < xa - 1 || x > xb + 1) continue;
        const y = xb === xa ? yb : ya + ((x - xa) / (xb - xa)) * (yb - ya);
        const v = Math.round(Math.max(1, Math.min(127, ((VEL_Y + VEL_H - y) / (VEL_H - 4)) * 127)));
        if (v !== nt.velocity) ch[nt.id] = { velocity: v };
      }
      if (Object.keys(ch).length) st.exec(updateNotes(t.id, ch, 'Draw velocity'));
      requestDraw();
    }

    function setVel(t: Track, ids: string[], ly: number) {
      const v = Math.round(Math.max(1, Math.min(127, ((VEL_Y + VEL_H - ly) / (VEL_H - 4)) * 127)));
      const ch: Record<string, Partial<Note>> = {};
      for (const id of ids) ch[id] = { velocity: v };
      useStore.getState().exec(updateNotes(t.id, ch, 'Change velocity'));
      useStore.getState().set({ status: `Velocity ${v}` });
    }

    function pedalClick(t: Track, lx: number) {
      const st = useStore.getState();
      const a = axis();
      const tick = snapTick(xToTick(a, lx), st.snap);
      if (tick <= 0) return cycleStartTone(t);
      if (tick >= songEnd(st.song)) return;
      const s = stompAt(t, lx);
      if (s) st.exec(removeStomp(t.id, s.id));
      else {
        const stomp: Stomp = { id: newId('stomp'), tick };
        if (t.pedal.mode === 'advanced') {
          // default to the "other" tone than the one currently active
          const cur = pedalSegments(t.pedal, songEnd(st.song)).find(
            (sg) => sg.start <= tick && sg.end > tick,
          )?.toneId;
          stomp.toneId = t.tones.find((x) => x.id !== cur)?.id ?? t.tones[0].id;
        }
        st.exec(addStomp(t.id, stomp));
      }
    }

    function tabClick(t: Track, lx: number, ly: number) {
      const st = useStore.getState();
      const a = axis();
      const n = t.tuning.strings.length;
      const line = Math.max(0, Math.min(n - 1, Math.round((ly - tabY) / LS)));
      const s = n - 1 - line;
      const tick = xToTick(a, lx);
      const fing = isFretted(t.type) ? trackFingering(t) : new Map<string, null>();
      const hit = t.notes.find((nt) => {
        const p = fing.get(nt.id);
        return p && p.string === s && tick >= nt.start - 60 && tick < nt.start + nt.duration;
      });
      // clicking the tab puts the keyboard-entry cursor there (Guitar Pro style)
      tabCursorTo(hit ? hit.start : Math.max(0, floorTick(tick, st.snap)), s);
      if (hit) preview(t, hit.pitch, hit.start, hit.duration);
    }

    const onMove = (e: PointerEvent) => {
      if (!drag) {
        sc.style.cursor = onVelEdge(local(e).ly) ? 'row-resize' : '';
        return;
      }
      if (drag.mode === 'velH') {
        const h = Math.round(Math.max(20, Math.min(140, drag.h0 + local(e).ly - drag.y0)));
        if (h !== VEL_H) useStore.getState().setLanes({ velH: h });
        return;
      }
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t) return;
      const { lx, ly } = local(e);
      if (drag.mode === 'vel') setVel(t, drag.ids, ly);
      else if (drag.mode === 'vline') {
        drag.x1 = lx;
        drag.y1 = Math.max(VEL_Y, Math.min(VEL_Y + VEL_H, ly));
        drawVelLine(t, drag);
      } else {
        if (Math.abs(lx - drag.x0) > 3) drag.moved = true;
        if (!drag.moved) return;
        const a = axis();
        const tick = Math.max(
          st.snap,
          Math.min(songEnd(st.song) - st.snap, snapTick(xToTick(a, lx), st.snap)),
        );
        if (!t.pedal.stomps.some((s) => s.tick === tick && s.id !== (drag as { id: string }).id))
          st.exec(updateStomp(t.id, drag.id, { tick }));
      }
    };
    const onUp = (e: PointerEvent) => {
      const st = useStore.getState();
      const t = currentTrack(st);
      if (e.pointerType === 'touch') {
        if (tap && tap.id === e.pointerId && t && isFretted(t.type)) {
          const moved = Math.hypot(e.clientX - tap.x, e.clientY - tap.y);
          if (moved < 10 && Math.abs(sc.scrollLeft - tap.sl) < 4) {
            const { lx, ly } = local(e);
            if (inPedal(ly)) {
              if (lx < KEYS_W) cycleStartTone(t);
              else pedalClick(t, lx);
            } else if (showTab && ly >= tabY - 10 && lx >= KEYS_W) tabClick(t, lx, ly);
          }
        }
        tap = null;
        return;
      }
      if (drag?.mode === 'stomp' && !drag.moved && t) {
        // a click (no drag) on a stomp removes it
        st.cancel();
        st.exec(removeStomp(t.id, drag.id));
      } else if (drag && drag.mode !== 'velH') st.commit();
      drag = null;
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
    sc.addEventListener('scroll', onScroll, { passive: true });
    const unsub = useStore.subscribe((s, prev) => {
      if (s.song !== prev.song || s.zoom !== prev.zoom || s.scrollX !== prev.scrollX) layout();
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
      sc.removeEventListener('scroll', onScroll);
    };
  }, [showVelocity, showTab, mobile, showVel, showPed, lanes.velH, lanes.ls, pedY0, tabY0]);

  const track = useStore((s) => currentTrack(s));
  return (
    <div ref={wrapRef} className="cvwrap lower" style={{ height }} aria-label="Pedal lane and tab">
      <canvas ref={cvRef} />
      <button
        className="lanes-btn"
        aria-expanded={lanesMenu}
        title="Show or hide the velocity and pedal lanes, change their size"
        onClick={() => setLanesMenu(!lanesMenu)}
      >
        Lanes ▾
      </button>
      {lanesMenu && (
        <div className="lanes-menu" role="menu" onPointerLeave={() => setLanesMenu(false)}>
          <label className="check">
            <input
              type="checkbox"
              checked={lanes.vel}
              onChange={(e) => useStore.getState().setLanes({ vel: e.target.checked })}
            />
            Velocity lane
          </label>
          {pedalOn && (
            <label className="check">
              <input
                type="checkbox"
                checked={lanes.pedal}
                onChange={(e) => useStore.getState().setLanes({ pedal: e.target.checked })}
              />
              Pedal lane
            </label>
          )}
          <div className="lanes-row">
            <span>Velocity</span>
            {[
              ['S', 26],
              ['M', 38],
              ['L', 64],
              ['XL', 100],
            ].map(([l, v]) => (
              <button
                key={l}
                aria-pressed={lanes.velH === v}
                onClick={() => useStore.getState().setLanes({ velH: v as number, vel: true })}
              >
                {l}
              </button>
            ))}
          </div>
          {pedalOn && (
            <div className="lanes-row">
              <span>Tab</span>
              {[
                ['S', 12],
                ['M', 15],
                ['L', 20],
                ['XL', 26],
              ].map(([l, v]) => (
                <button
                  key={l}
                  aria-pressed={lanes.ls === v}
                  onClick={() => useStore.getState().setLanes({ ls: v as number })}
                >
                  {l}
                </button>
              ))}
            </div>
          )}
          <p className="mute small">
            Drag the bottom of the velocity lane, or the line above the lanes, to resize.
          </p>
        </div>
      )}
      <div
        ref={scRef}
        className="scroller xonly"
        tabIndex={0}
        aria-label="Pedal lane and tab. Click a tab line for keyboard tab entry: arrows move, digits type frets, Escape leaves."
      >
        <div ref={sizerRef} className="sizer" />
      </div>
      {menu && track && (
        <div className="ctxmenu" style={{ left: menu.x, top: menu.y }} role="menu">
          {track.tones.map((tone) => (
            <button
              key={tone.id}
              role="menuitem"
              onClick={() => {
                useStore
                  .getState()
                  .exec(updateStomp(track.id, menu.stompId, { toneId: tone.id }, 'Stomp tone'));
                setMenu(null);
              }}
            >
              <i style={{ background: tone.color }} /> {tone.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
