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
import { barMap, currentTrack, songEnd, useStore } from '../store';
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
  | { mode: 'loop'; from: number };

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
  LW = mobile ? 96 : 132;
  RH = mobile ? 28 : 20;
  useEffect(() => {
    const cv = cvRef.current!,
      sc = scRef.current!,
      sizer = sizerRef.current!,
      wrap = wrapRef.current!;
    let drag: Drag | null = null;
    const ppt = () => pxPerTick(useStore.getState().zoom);
    const gridH = DRUM_LANES.length * RH;

    function layout() {
      const st = useStore.getState();
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
        c.fillStyle = i === laneRef.current ? '#232833' : i % 2 ? COL.rowB : COL.rowW;
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
      // velocity strip for the selected lane
      const vy = gy0 + gridH + 8;
      c.fillStyle = '#16181e';
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
        c.fillStyle = i === laneRef.current ? '#2f3542' : '#1f232b';
        c.fillRect(0, y, LW - 1, RH - 1);
        c.fillStyle = PIECE_COL[l.piece];
        c.fillRect(0, y, 3, RH - 1);
        c.fillStyle = i === laneRef.current ? COL.ink : '#b9bfcb';
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
        if (e.shiftKey) {
          st.begin('Set loop');
          drag = { mode: 'loop', from: tick };
          sc.setPointerCapture(e.pointerId);
        } else seek(Math.min(tick, songEnd(st.song) - 1));
        return;
      }
      if (p.lx < LW) {
        const li = laneAt(p.gy);
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
          drag = { mode: 'vel', ids: near.map((h) => h.id) };
          sc.setPointerCapture(e.pointerId);
          setVelAt(t, p.ly, drag.ids);
        }
        return;
      }
      const li = laneAt(p.gy);
      if (li == null) return;
      const tick = tickOf(p.lx);
      const cell = floorTick(tick, st.snap);
      const has = t.hits.some(
        (h) => hitLane(h) === DRUM_LANES[li].id && h.start >= cell && h.start < cell + st.snap,
      );
      const add = e.button === 0 && !has;
      if (e.button !== 0 && e.button !== 2) return;
      st.begin(add ? 'Paint drums' : 'Erase drums');
      setLane(li);
      laneRef.current = li;
      drag = { mode: 'paint', add, lane: e.shiftKey ? null : li, done: new Set() };
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
      if (drag) useStore.getState().commit();
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
  }, [mobile]);

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
      <span className="sep" />
      <label className="field">
        Velocity
        <input type="range" min={1} max={127} value={vel} onChange={(e) => setVel(Number(e.target.value))} />
        <output>{vel}</output>
      </label>
      <span className="mute">
        Click/drag to paint, right-drag to erase, Shift-drag paints across lanes. Click the ruler to pick the
        bar.
      </span>
    </div>
  );
}
