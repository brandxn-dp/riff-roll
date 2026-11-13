import { useEffect, useRef, useState } from 'react';
import {
  DRUM_LANES,
  addHits,
  newId,
  removeHits,
  setLoop,
  updateHits,
  type DrumHit,
  type DrumLane,
  type DrumPiece,
  type Track,
} from '@riffroll/core';
import { ZOOMS_Y, barMap, currentTrack, songEnd, useStore } from '../store';
import {
  COL,
  DISP,
  BODY,
  RULER_H,
  alpha,
  fit,
  floorTick,
  frameScheduler,
  lowerBound,
  pxPerTick,
  rr,
  snapTick,
} from '../canvas';
import { previewDrum } from '../audio-bridge';
import { seek } from '../transport';

let LW = 132; // label gutter (96 on phones)
let RH = 20; // lane height (28 on phones)
const VEL_H = 54;

const PIECE_COL: Record<DrumPiece, string> = {
  kick: '#ff5a5a',
  snare: '#ff9a3c',
  hihat: '#47bfee',
  ride: '#f3cf48',
  crash1: '#f3cf48',
  crash2: '#f3cf48',
  china: '#f3cf48',
  splash: '#f3cf48',
  tom1: '#5fd17c',
  tom2: '#5fd17c',
  tom3: '#5fd17c',
  tom4: '#5fd17c',
};

const laneIndex = new Map(DRUM_LANES.map((l, i) => [l.id, i]));
const hitLane = (h: DrumHit) => `${h.piece}:${h.articulation}`;

type Drag =
  | { mode: 'paint'; add: boolean; lane: number | null; done: Set<string> }
  | { mode: 'vel'; ids: string[] }
  /** drag selected hits: in time (snapped) and across lanes */
  | {
      mode: 'move';
      orig: Map<string, { start: number; lane: number }>;
      t0: number;
      l0: number;
      moved: boolean;
    }
  /** box select: ticks and grid-y of both corners; `base` = what was selected before (Shift adds to it) */
  | { mode: 'box'; t0: number; g0: number; t1: number; g1: number; base: string[] }
  | { mode: 'loop'; from: number }
  | {
      mode: 'loopEdit';
      kind: 'start' | 'end' | 'move';
      grab: number;
      orig: { start: number; end: number };
      moved: boolean;
      p0: number;
    };

export function DrumGrid() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const [lane, setLane] = useState<number>(DRUM_LANES.findIndex((l) => l.id === 'hihat:closed'));
  const [vel, setVel] = useState(100);
  const laneRef = useRef(lane);
  laneRef.current = lane;
  const velRef = useRef(vel);
  velRef.current = vel;

  const mobile = useStore((s) => s.layout === 'mobile');
  const zoomY = useStore((s) => s.zoomY);
  LW = mobile ? 96 : 132;
  RH = Math.max(10, Math.round((mobile ? 28 : 20) * ZOOMS_Y[zoomY]));
  useEffect(() => {
    const cv = cvRef.current!,
      sc = scRef.current!,
      sizer = sizerRef.current!,
      wrap = wrapRef.current!;
    let drag: Drag | null = null;
    const ppt = () => pxPerTick(useStore.getState().zoom);
    const baseRH = RH;
    let gridH = DRUM_LANES.length * RH;

    function layout() {
      const st = useStore.getState();
      // lanes stretch to fill the editor's height (never smaller than the zoom level's lane height)
      const fit = Math.floor((sc.clientHeight - RULER_H - VEL_H - 14) / DRUM_LANES.length);
      RH = Math.max(baseRH, Math.min(baseRH * 2.5, fit));
      gridH = DRUM_LANES.length * RH;
      sizer.style.width = LW + songEnd(st.song) * ppt() + 40 + 'px';
      sizer.style.height = RULER_H + gridH + VEL_H + 8 + 'px';
      if (Math.abs(sc.scrollLeft - st.scrollX) > 1) sc.scrollLeft = st.scrollX;
    }

    const xOf = (tick: number) => LW + tick * ppt() - sc.scrollLeft;
    const tickOf = (x: number) => (x - LW + sc.scrollLeft) / ppt();

    function draw() {
      const st = useStore.getState();
      const t = currentTrack(st);
      const w = sc.clientWidth,
        h = sc.clientHeight;
      if (!w || !h || !t) return;
      const c = fit(cv, w, h);
      const sy = sc.scrollTop;
      const gy0 = RULER_H - sy;
      const end = songEnd(st.song);
      const p = ppt();
      c.fillStyle = COL.bg;
      c.fillRect(0, 0, w, h);
      c.save();
      c.beginPath();
      c.rect(LW, RULER_H, w - LW, h - RULER_H);
      c.clip();
      // lane rows
      DRUM_LANES.forEach((l, i) => {
        const y = gy0 + i * RH;
        c.fillStyle = i === laneRef.current ? COL.laneHi : i % 2 ? COL.rowB : COL.rowW;
        c.fillRect(xOf(0), y, end * p, RH);
        const prev = DRUM_LANES[i - 1];
        c.fillStyle = prev && prev.piece !== l.piece ? COL.cLine : COL.rowLine;
        c.fillRect(xOf(0), y, end * p, 1);
      });
      // grid: cells at the snap, beats, bars
      const bm = barMap(st.song);
      const t0 = Math.max(0, tickOf(LW)),
        t1 = tickOf(w);
      for (let b = bm.barAtTick(t0).index; b <= st.song.bars; b++) {
        const bar = bm.bar(b);
        if (bar.start > t1) break;
        c.fillStyle = COL.bar;
        c.fillRect(xOf(bar.start), gy0, 1.5, gridH);
        if (b === st.song.bars) break;
        const beat = (st.song.ppq * 4) / bar.den;
        for (let k = bar.start + st.snap; k < bar.start + bar.length - 1; k += st.snap) {
          const onBeat = Math.abs((k - bar.start) % beat) < 1e-6;
          if (!onBeat && st.snap * p < 6) continue;
          c.fillStyle = onBeat ? COL.beat : COL.step;
          c.fillRect(xOf(k), gy0, 1, gridH);
        }
      }
      // hits
      const cw = Math.max(6, Math.min(st.snap * p - 3, 22));
      for (let i = lowerBound(t.hits, t0 - st.snap); i < t.hits.length; i++) {
        const hh = t.hits[i];
        if (hh.start > t1) break;
        const li = laneIndex.get(hitLane(hh));
        if (li == null) continue;
        const x = xOf(hh.start) + 1.5,
          y = gy0 + li * RH + 2;
        const col = PIECE_COL[hh.piece];
        c.fillStyle = alpha(col, 0.3 + (0.7 * hh.velocity) / 127);
        rr(c, x, y, cw, RH - 4, 3);
        c.fill();
        if (st.selection.has(hh.id)) {
          c.strokeStyle = COL.head;
          c.lineWidth = 1.5;
          rr(c, x - 0.5, y - 0.5, cw + 1, RH - 3, 3);
          c.stroke();
        }
      }
      if (st.playhead != null) {
        c.fillStyle = COL.head;
        c.fillRect(xOf(st.playhead), gy0, 1.5, gridH);
      }
      if (drag?.mode === 'box') {
        const x0 = xOf(Math.min(drag.t0, drag.t1)),
          x1 = xOf(Math.max(drag.t0, drag.t1));
        const y0 = gy0 + Math.min(drag.g0, drag.g1),
          y1 = gy0 + Math.max(drag.g0, drag.g1);
        c.fillStyle = 'rgba(230,232,238,0.08)';
        c.fillRect(x0, y0, x1 - x0, y1 - y0);
        c.strokeStyle = 'rgba(230,232,238,0.7)';
        c.lineWidth = 1;
        c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
      }
      // velocity strip for the selected lane
      const vy = gy0 + gridH + 8;
      c.fillStyle = COL.sunk;
      c.fillRect(xOf(0), vy, end * p, VEL_H);
      const sel = DRUM_LANES[laneRef.current];
      for (let i = lowerBound(t.hits, t0 - st.snap); i < t.hits.length; i++) {
        const hh = t.hits[i];
        if (hh.start > t1) break;
        if (hitLane(hh) !== sel?.id) continue;
        const x = xOf(hh.start) + 2;
        const vh = (hh.velocity / 127) * (VEL_H - 6);
        c.fillStyle = PIECE_COL[hh.piece];
        c.fillRect(x, vy + VEL_H - vh, 3, vh);
        c.fillRect(x - 2, vy + VEL_H - vh, 7, 2);
      }
      c.restore();

      // ruler
      c.fillStyle = COL.panel;
      c.fillRect(0, 0, w, RULER_H);
      c.save();
      c.beginPath();
      c.rect(LW, 0, w - LW, RULER_H);
      c.clip();
      c.textBaseline = 'middle';
      for (let b = bm.barAtTick(t0).index; b < st.song.bars; b++) {
        const s = bm.barStart(b);
        if (s > t1) break;
        c.fillStyle = COL.bar;
        c.fillRect(xOf(s), 0, 1, RULER_H);
        c.fillStyle = COL.ink;
        c.font = '600 13px ' + DISP;
        c.fillText(String(b + 1), xOf(s) + 6, RULER_H / 2 - 1);
      }
      if (st.song.loop?.on) {
        c.fillStyle = 'rgba(95,209,124,0.22)';
        c.fillRect(xOf(st.song.loop.start), 0, (st.song.loop.end - st.song.loop.start) * p, RULER_H - 3);
        c.fillStyle = COL.ok;
        c.fillRect(xOf(st.song.loop.start), 0, 3, RULER_H - 3);
        c.fillRect(xOf(st.song.loop.end) - 3, 0, 3, RULER_H - 3);
      }
      const mx = xOf(st.cursor);
      c.fillStyle = COL.ink;
      c.beginPath();
      c.moveTo(mx, RULER_H - 4);
      c.lineTo(mx - 5, RULER_H - 12);
      c.lineTo(mx + 5, RULER_H - 12);
      c.closePath();
      c.fill();
      if (st.playhead != null) {
        c.fillStyle = COL.head;
        c.fillRect(xOf(st.playhead), 0, 1.5, RULER_H);
      }
      c.restore();

      // lane labels
      c.save();
      c.beginPath();
      c.rect(0, RULER_H, LW, h - RULER_H);
      c.clip();
      DRUM_LANES.forEach((l, i) => {
        const y = gy0 + i * RH;
        c.fillStyle = i === laneRef.current ? COL.laneLabelHi : COL.laneLabel;
        c.fillRect(0, y, LW - 1, RH - 1);
        c.fillStyle = PIECE_COL[l.piece];
        c.fillRect(0, y, 3, RH - 1);
        c.fillStyle = i === laneRef.current ? COL.ink : COL.keyInk;
        c.font = '500 12px ' + BODY;
        c.textBaseline = 'middle';
        c.fillText(l.label, 9, y + RH / 2);
      });
      c.fillStyle = COL.mute;
      c.font = '700 11px ' + DISP;
      c.fillText('VEL · ' + (sel?.label ?? '').toUpperCase(), 9, gy0 + gridH + 8 + VEL_H / 2);
      c.restore();
      c.fillStyle = COL.panel;
      c.fillRect(0, 0, LW, RULER_H);
      c.fillStyle = COL.mute;
      c.font = '600 11px ' + DISP;
      c.fillText('DRUMS', 9, RULER_H / 2);
      c.fillStyle = COL.line;
      c.fillRect(LW - 1, 0, 1, h);
      c.fillRect(0, RULER_H - 1, w, 1);
    }
    const requestDraw = frameScheduler(draw);

    const pt = (e: { clientX: number; clientY: number }) => {
      const r = sc.getBoundingClientRect();
      const lx = e.clientX - r.left,
        ly = e.clientY - r.top;
      return { lx, ly, gy: ly - RULER_H + sc.scrollTop };
    };
    const laneAt = (gy: number) => {
      const i = Math.floor(gy / RH);
      return i >= 0 && i < DRUM_LANES.length ? i : null;
    };
    const inVel = (gy: number) => gy >= gridH + 8 && gy <= gridH + 8 + VEL_H;

    function paintAt(t: Track, li: number, tick: number, d: Extract<Drag, { mode: 'paint' }>) {
      const st = useStore.getState();
      const cell = floorTick(tick, st.snap);
      if (cell < 0 || cell >= songEnd(st.song)) return;
      const key = `${li}@${cell}`;
      if (d.done.has(key)) return;
      d.done.add(key);
      const l = DRUM_LANES[li];
      const existing = t.hits.filter(
        (h) => hitLane(h) === l.id && h.start >= cell && h.start < cell + st.snap,
      );
      if (d.add && !existing.length) {
        st.exec(
          addHits(
            t.id,
            [
              {
                id: newId('h'),
                start: cell,
                piece: l.piece,
                articulation: l.articulation,
                velocity: velRef.current,
              },
            ],
            'Paint drums',
          ),
        );
        previewDrum(t, l.id, velRef.current);
      } else if (!d.add && existing.length)
        st.exec(
          removeHits(
            t.id,
            existing.map((h) => h.id),
            'Erase drums',
          ),
        );
    }

    function setVelAt(t: Track, ly: number, ids: string[]) {
      const st = useStore.getState();
      const vy = RULER_H - sc.scrollTop + gridH + 8;
      const v = Math.round(Math.max(1, Math.min(127, ((vy + VEL_H - ly) / (VEL_H - 6)) * 127)));
      const ch: Record<string, Partial<DrumHit>> = {};
      for (const id of ids) ch[id] = { velocity: v };
      st.exec(updateHits(t.id, ch, 'Drum velocity'));
      st.set({ status: `Velocity ${v}` });
    }

    let tap: { x: number; y: number; sl: number; st: number; id: number } | null = null;
    const onDown = (e: PointerEvent) => {
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t) return;
      if (e.pointerType === 'touch') {
        // touch: a tap toggles a cell; a drag scrolls (painting would fight with scrolling)
        tap = { x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop, id: e.pointerId };
        return;
      }
      const p = pt(e);
      if (p.ly < RULER_H) {
        if (p.lx < LW || e.button !== 0) return;
        const tick = Math.max(0, snapTick(tickOf(p.lx), st.snap));
        const loop = st.song.loop;
        const part = (() => {
          if (!loop?.on || e.shiftKey) return null;
          const x0 = xOf(loop.start),
            x1 = xOf(loop.end);
          if (Math.abs(p.lx - x0) <= 6) return 'start' as const;
          if (Math.abs(p.lx - x1) <= 6) return 'end' as const;
          return p.lx > x0 && p.lx < x1 ? ('move' as const) : null;
        })();
        if (e.shiftKey) {
          st.begin('Set loop');
          drag = { mode: 'loop', from: tick };
          sc.setPointerCapture(e.pointerId);
        } else if (part && loop) {
          // drag the green loop bar: an edge, or the whole loop
          st.begin(part === 'move' ? 'Move loop' : 'Change loop');
          drag = {
            mode: 'loopEdit',
            kind: part,
            grab: tickOf(p.lx),
            orig: { start: loop.start, end: loop.end },
            moved: false,
            p0: p.lx,
          };
          sc.setPointerCapture(e.pointerId);
        } else seek(Math.min(tick, songEnd(st.song) - 1));
        return;
      }
      if (p.lx < LW) {
        const li = laneAt(p.gy);
        if (li != null && (e.shiftKey || e.ctrlKey || e.metaKey)) {
          // Shift+click a lane name: select every hit on it (Ctrl/Cmd as well: add to the selection)
          const ids = t.hits.filter((h) => hitLane(h) === DRUM_LANES[li].id).map((h) => h.id);
          const keep = e.ctrlKey || e.metaKey ? [...st.selection] : [];
          st.select([...keep, ...ids], null);
          st.set({
            status: `${ids.length} ${DRUM_LANES[li].label} hit${ids.length === 1 ? '' : 's'} selected`,
          });
          setLane(li);
          laneRef.current = li;
          requestDraw();
          return;
        }
        if (li != null) {
          setLane(li);
          laneRef.current = li;
          previewDrum(t, DRUM_LANES[li].id, velRef.current);
          requestDraw();
        }
        return;
      }
      if (inVel(p.gy)) {
        const l = DRUM_LANES[laneRef.current];
        const tick = tickOf(p.lx);
        const near = t.hits.filter((h) => hitLane(h) === l.id && Math.abs(h.start - tick) * ppt() < 8);
        if (near.length) {
          st.begin('Drum velocity');
          const ids = near.some((h) => st.selection.has(h.id))
            ? t.hits.filter((h) => st.selection.has(h.id)).map((h) => h.id)
            : near.map((h) => h.id);
          drag = { mode: 'vel', ids };
          sc.setPointerCapture(e.pointerId);
          setVelAt(t, p.ly, drag.ids);
        }
        return;
      }
      const li = laneAt(p.gy);
      if (li == null) return;
      const tick = tickOf(p.lx);
      if (e.button === 0 && (e.shiftKey || e.ctrlKey || e.metaKey)) {
        // box select, like the piano roll: Shift adds to the selection, Ctrl/Cmd starts a new one
        drag = {
          mode: 'box',
          t0: tick,
          g0: p.gy,
          t1: tick,
          g1: p.gy,
          base: e.shiftKey ? [...st.selection] : [],
        };
        if (!e.shiftKey) st.select([], null);
        sc.setPointerCapture(e.pointerId);
        requestDraw();
        return;
      }
      const cell = floorTick(tick, st.snap);
      const here = t.hits.find(
        (h) => hitLane(h) === DRUM_LANES[li].id && h.start >= cell && h.start < cell + st.snap,
      );
      const has = !!here;
      if (e.button === 0 && here) {
        // like the piano roll: click a hit to select it (Shift adds), drag to move the selection
        const sel = st.selection.has(here.id)
          ? new Set(st.selection)
          : new Set(e.shiftKey ? [...st.selection, here.id] : [here.id]);
        st.select([...sel], null);
        const orig = new Map<string, { start: number; lane: number }>();
        for (const h of t.hits)
          if (sel.has(h.id))
            orig.set(h.id, { start: h.start, lane: DRUM_LANES.findIndex((l) => l.id === hitLane(h)) });
        st.begin('Move hits');
        drag = { mode: 'move', orig, t0: floorTick(tick, st.snap), l0: li, moved: false };
        sc.setPointerCapture(e.pointerId);
        setLane(li);
        laneRef.current = li;
        requestDraw();
        return;
      }
      if (e.button === 0 && !e.shiftKey && st.selection.size) st.select([], null);
      const add = e.button === 0 && !has;
      if (e.button !== 0 && e.button !== 2) return;
      st.begin(add ? 'Paint drums' : 'Erase drums');
      setLane(li);
      laneRef.current = li;
      drag = { mode: 'paint', add, lane: e.altKey ? null : li, done: new Set() };
      sc.setPointerCapture(e.pointerId);
      paintAt(t, li, tick, drag);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t) return;
      const p = pt(e);
      if (drag.mode === 'vel') return setVelAt(t, p.ly, drag.ids);
      if (drag.mode === 'move') {
        const end = songEnd(st.song);
        const li = laneAt(p.gy) ?? drag.l0;
        let dt = floorTick(tickOf(p.lx), st.snap) - drag.t0;
        let dl = li - drag.l0;
        const os = [...drag.orig.values()];
        dt = Math.max(
          -Math.min(...os.map((o) => o.start)),
          Math.min(end - 1 - Math.max(...os.map((o) => o.start)), dt),
        );
        dl = Math.max(
          -Math.min(...os.map((o) => o.lane)),
          Math.min(DRUM_LANES.length - 1 - Math.max(...os.map((o) => o.lane)), dl),
        );
        const ch: Record<string, Partial<DrumHit>> = {};
        for (const [id, o] of drag.orig) {
          const lane = DRUM_LANES[o.lane + dl];
          ch[id] = { start: o.start + dt, piece: lane.piece, articulation: lane.articulation };
        }
        if (dt || dl || drag.moved) {
          drag.moved = true;
          st.exec(updateHits(t.id, ch, 'Move hits'));
        }
        return;
      }
      if (drag.mode === 'box') {
        drag.t1 = tickOf(p.lx);
        drag.g1 = p.gy;
        const [ta, tb] = [Math.min(drag.t0, drag.t1), Math.max(drag.t0, drag.t1)];
        const la = Math.max(0, Math.floor(Math.min(drag.g0, drag.g1) / RH));
        const lb = Math.min(DRUM_LANES.length - 1, Math.floor(Math.max(drag.g0, drag.g1) / RH));
        const lanes = new Set(DRUM_LANES.slice(la, lb + 1).map((l) => l.id));
        const hit = t.hits
          .filter((h) => lanes.has(hitLane(h)) && h.start + st.snap > ta && h.start <= tb)
          .map((h) => h.id);
        st.select([...drag.base, ...hit], null);
        requestDraw();
        return;
      }
      if (drag.mode === 'loopEdit') {
        if (Math.abs(p.lx - drag.p0) > 3) drag.moved = true;
        if (!drag.moved) return;
        const end = songEnd(st.song);
        const { start: s0, end: e0 } = drag.orig;
        const tick = snapTick(tickOf(p.lx), st.snap);
        let ls = s0,
          le = e0;
        if (drag.kind === 'start') ls = Math.max(0, Math.min(e0 - st.snap, tick));
        else if (drag.kind === 'end') le = Math.min(end, Math.max(s0 + st.snap, tick));
        else {
          const d = Math.max(-s0, Math.min(end - e0, snapTick(tickOf(p.lx) - drag.grab, st.snap)));
          ls = s0 + d;
          le = e0 + d;
        }
        st.exec(setLoop({ start: ls, end: le, on: true }));
        return;
      }
      if (drag.mode === 'loop') {
        const to = Math.max(0, Math.min(songEnd(st.song), snapTick(tickOf(p.lx), st.snap)));
        const [a, b] = drag.from < to ? [drag.from, to] : [to, drag.from];
        if (b > a) st.exec(setLoop({ start: a, end: b, on: true }));
        return;
      }
      const li = drag.lane ?? laneAt(p.gy);
      if (li == null) return;
      paintAt(t, li, tickOf(p.lx), drag);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && tap && tap.id === e.pointerId) {
        const moved =
          Math.hypot(e.clientX - tap.x, e.clientY - tap.y) +
          Math.abs(sc.scrollLeft - tap.sl) +
          Math.abs(sc.scrollTop - tap.st);
        tap = null;
        if (moved > 10) return;
        const st = useStore.getState();
        const t = currentTrack(st);
        const p = pt(e);
        if (!t) return;
        if (p.ly < RULER_H && p.lx >= LW)
          return seek(Math.max(0, Math.min(songEnd(st.song) - 1, floorTick(tickOf(p.lx), st.snap))));
        const li = laneAt(p.gy);
        if (li == null) return;
        setLane(li);
        laneRef.current = li;
        if (p.lx < LW) return previewDrum(t, DRUM_LANES[li].id, velRef.current);
        const cell = floorTick(tickOf(p.lx), st.snap);
        const has = t.hits.some(
          (h) => hitLane(h) === DRUM_LANES[li].id && h.start >= cell && h.start < cell + st.snap,
        );
        paintAt(t, li, tickOf(p.lx), { mode: 'paint', add: !has, lane: li, done: new Set() });
        return;
      }
      if (drag?.mode === 'loopEdit' && !drag.moved) {
        useStore.getState().cancel();
        const d = drag;
        drag = null;
        if (d.kind === 'move') {
          const st = useStore.getState();
          seek(Math.max(0, Math.min(songEnd(st.song) - 1, floorTick(tickOf(d.p0), st.snap))));
        }
        return;
      }
      if (drag?.mode === 'move' && !drag.moved) useStore.getState().cancel();
      else if (drag && drag.mode !== 'box') useStore.getState().commit();
      const wasBox = drag?.mode === 'box';
      drag = null;
      if (wasBox) {
        const n = useStore.getState().selection.size;
        useStore
          .getState()
          .set({ status: n ? `${n} hit${n === 1 ? '' : 's'} selected (Delete removes, Ctrl+C copies)` : '' });
        requestDraw();
      }
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
    // Ctrl+wheel: horizontal zoom; Alt+wheel: vertical zoom (lane height)
    const onWheel = (e: WheelEvent) => {
      if (!(e.altKey || e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const st = useStore.getState();
      const d = (e.deltaY || e.deltaX) < 0 ? 1 : -1;
      if (e.altKey) st.set({ zoomY: Math.max(0, Math.min(ZOOMS_Y.length - 1, st.zoomY + d)) });
      else st.set({ zoom: Math.max(0, Math.min(7, st.zoom + d)) });
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
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
  }, [mobile, zoomY]);

  useEffect(() => {
    // redraw when the selected lane changes
    useStore.getState().set({});
  }, [lane]);

  return (
    <>
      <PatternTools lane={DRUM_LANES[lane]} vel={vel} setVel={setVel} />
      <div ref={wrapRef} className="cvwrap roll" aria-label="Drum grid">
        <canvas ref={cvRef} />
        <div
          ref={scRef}
          className="scroller"
          tabIndex={0}
          aria-label="Drum grid. Click cells to add or remove hits; Space plays."
        >
          <div ref={sizerRef} className="sizer" />
        </div>
      </div>
    </>
  );
}

function PatternTools({ lane, vel, setVel }: { lane: DrumLane; vel: number; setVel: (v: number) => void }) {
  const st = useStore.getState();
  const cursor = useStore((s) => s.cursor);
  const song = useStore((s) => s.song);
  const t = currentTrack();
  if (!t) return null;
  const bm = barMap(song);
  const bar = bm.barAtTick(cursor);
  const inBar = (h: DrumHit, b = bar) => h.start >= b.start && h.start < b.start + b.length;

  const fill = (step: number) => {
    const existing = new Set(t.hits.filter((h) => hitLane(h) === lane.id && inBar(h)).map((h) => h.start));
    const hits: DrumHit[] = [];
    for (let k = bar.start; k < bar.start + bar.length; k += step)
      if (!existing.has(k))
        hits.push({
          id: newId('h'),
          start: k,
          piece: lane.piece,
          articulation: lane.articulation,
          velocity: vel,
        });
    st.exec(addHits(t.id, hits, `Fill bar with ${step === song.ppq / 2 ? '8ths' : '16ths'}`));
  };
  const clearBar = () =>
    st.exec(
      removeHits(
        t.id,
        t.hits.filter((h) => inBar(h)).map((h) => h.id),
        'Clear bar',
      ),
    );
  const copyBar = () => {
    if (bar.index + 1 >= song.bars) return;
    const next = bm.bar(bar.index + 1);
    const remove = t.hits.filter((h) => inBar(h, next)).map((h) => h.id);
    const add = t.hits
      .filter((h) => inBar(h) && h.start - bar.start < next.length)
      .map((h) => ({ ...h, id: newId('h'), start: h.start - bar.start + next.start }));
    st.begin('Copy bar');
    st.exec(removeHits(t.id, remove));
    st.exec(addHits(t.id, add));
    st.commit();
    st.set({ cursor: next.start });
  };
  const accent = () => {
    const ch: Record<string, Partial<DrumHit>> = {};
    for (const h of t.hits) {
      if (!inBar(h)) continue;
      const beat = (song.ppq * 4) / bar.den;
      ch[h.id] = { velocity: (h.start - bar.start) % beat === 0 ? 122 : Math.min(h.velocity, 92) };
    }
    st.exec(updateHits(t.id, ch, 'Accent every beat'));
  };

  return (
    <div className="ptools" role="toolbar" aria-label="Pattern tools">
      <span className="lbl">Lane</span>
      <strong>{lane.label}</strong>
      <span className="sep" />
      <span className="lbl">Bar {bar.index + 1}</span>
      <button className="ib" onClick={() => fill(song.ppq / 2)}>
        Fill 8ths
      </button>
      <button className="ib" onClick={() => fill(song.ppq / 4)}>
        Fill 16ths
      </button>
      <button className="ib" onClick={accent}>
        Accent beats
      </button>
      <button className="ib" onClick={copyBar}>
        Copy bar → next
      </button>
      <button className="ib danger" onClick={clearBar}>
        Clear bar
      </button>
      <button className="ib" onClick={() => useStore.getState().set({ modal: 'velocity' })}>
        Velocity…
      </button>
      <span className="sep" />
      <label className="field">
        Velocity
        <input type="range" min={1} max={127} value={vel} onChange={(e) => setVel(Number(e.target.value))} />
        <output>{vel}</output>
      </label>
      <span className="mute">
        Click empty cells to paint (drag for more), click a hit to select it and drag to move it, right-click
        erases, Alt-drag paints across lanes. Arrows move selected hits. Shift-drag selects hits; Shift-click
        a drum name selects all of it. Click the ruler to pick the bar.
      </span>
    </div>
  );
}
