/**
 * Global view (Guitar Pro style): every track as a row of bars. Filled cells have notes; click a bar to go there,
 * drag across bars and tracks to select, then copy / cut / paste / clear / insert / delete / duplicate whole bars.
 * Click a section name in the ruler to select that section in every track.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  TRACK_COLORS,
  addSection,
  addTrack,
  clearBars,
  copyBars,
  deleteBars,
  duplicateBars,
  filledBars,
  insertBars,
  isFretted,
  makeTrack,
  newId,
  pasteBars,
  setLoop,
  updateTrack,
  type BarClip,
  type TrackType,
} from '@riffroll/core';
import { barMap, useStore } from '../store';
import { COL, DISP, MONO, alpha, fit, frameScheduler, pxPerTick, rr } from '../canvas';
import { seek } from '../transport';

const CW = 22; // bar cell width
const RH = 24; // track row height
const RULER = 22;

export interface BarSel {
  t0: number;
  t1: number;
  b0: number;
  b1: number;
}
const norm = (s: BarSel) => ({
  ta: Math.min(s.t0, s.t1),
  tb: Math.max(s.t0, s.t1),
  ba: Math.min(s.b0, s.b1),
  bb: Math.max(s.b0, s.b1),
});

let clip: BarClip | null = null;

const status = (msg: string) => useStore.getState().set({ status: msg });

/** Bars selected in the global view, as track ids and a bar range. */
function selection() {
  const st = useStore.getState();
  if (!st.barSel) return null;
  const { ta, tb, ba, bb } = norm(st.barSel);
  const ids = st.song.tracks.slice(ta, tb + 1).map((t) => t.id);
  return { ids, ta, tb, ba, bb: Math.min(bb, st.song.bars - 1), st };
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const barActions = {
  copy() {
    const s = selection();
    if (!s) return;
    clip = copyBars(s.st.song, s.ids, s.ba, s.bb);
    status(`Copied ${plural(clip.bars, 'bar')} × ${plural(s.ids.length, 'track')}`);
  },
  cut() {
    const s = selection();
    if (!s) return;
    clip = copyBars(s.st.song, s.ids, s.ba, s.bb);
    s.st.exec(clearBars(s.ids, s.ba, s.bb, 'Cut bars'));
    status(`Cut ${plural(clip.bars, 'bar')}`);
  },
  paste(insert = false) {
    const s = selection();
    if (!s || !clip) return status(clip ? 'Pick where to paste first' : 'Nothing copied yet');
    const ids = s.st.song.tracks.slice(s.ta, s.ta + clip.tracks.length).map((t) => t.id);
    s.st.exec(pasteBars(clip, ids, s.ba, insert));
    s.st.set({ barSel: { t0: s.ta, t1: s.ta + ids.length - 1, b0: s.ba, b1: s.ba + clip.bars - 1 } });
    status(`${insert ? 'Inserted' : 'Pasted'} ${plural(clip.bars, 'bar')}`);
  },
  clear() {
    const s = selection();
    if (s) s.st.exec(clearBars(s.ids, s.ba, s.bb));
  },
  duplicate() {
    const s = selection();
    if (!s) return;
    s.st.exec(duplicateBars(s.ba, s.bb));
    const n = s.bb - s.ba + 1;
    s.st.set({ barSel: { t0: s.ta, t1: s.tb, b0: s.bb + 1, b1: s.bb + n } });
    status(`Duplicated ${plural(n, 'bar')} (all tracks)`);
  },
  insert(after = false) {
    const s = selection();
    if (!s) return;
    const at = after ? s.bb + 1 : s.ba;
    s.st.exec(insertBars(at, 1));
    status(`Inserted a bar ${after ? 'after' : 'before'} bar ${after ? s.bb + 1 : s.ba + 1}`);
  },
  remove() {
    const s = selection();
    if (!s) return;
    if (s.bb - s.ba + 1 >= s.st.song.bars) return status('A song needs at least one bar');
    s.st.exec(deleteBars(s.ba, s.bb));
    s.st.set({ barSel: { ...s.st.barSel!, b0: s.ba, b1: s.ba } });
    status(`Deleted ${plural(s.bb - s.ba + 1, 'bar')} from every track`);
  },
  loop() {
    const s = selection();
    if (!s) return;
    const bm = barMap(s.st.song);
    s.st.exec(setLoop({ start: bm.barStart(s.ba), end: bm.barStart(s.bb + 1), on: true }));
  },
  section() {
    const s = selection();
    if (!s) return;
    const name = prompt('Section name', 'Verse');
    if (name) s.st.exec(addSection({ id: newId('sec'), tick: barMap(s.st.song).barStart(s.ba), name }));
  },
};

const MENU: [string, () => void, string?][] = [
  ['Copy', barActions.copy, 'Ctrl+C'],
  ['Cut', barActions.cut, 'Ctrl+X'],
  ['Paste', () => barActions.paste(false), 'Ctrl+V'],
  ['Paste and insert', () => barActions.paste(true), 'Ctrl+Shift+V'],
  ['Clear bars', barActions.clear, 'Delete'],
  ['Duplicate bars', barActions.duplicate, 'Ctrl+D'],
  ['Insert bar before', () => barActions.insert(false), 'Insert'],
  ['Insert bar after', () => barActions.insert(true)],
  ['Delete bars', barActions.remove, 'Ctrl+Delete'],
  ['Loop these bars', barActions.loop],
  ['Add section here…', barActions.section],
];

function TrackRow({ i }: { i: number }) {
  const t = useStore((s) => s.song.tracks[i]);
  const on = useStore((s) => s.trackId === t?.id);
  const anySolo = useStore((s) => s.song.tracks.some((x) => x.solo));
  const st = useStore.getState();
  if (!t) return null;
  const set = (ch: Parameters<typeof updateTrack>[1], label: string) => st.exec(updateTrack(t.id, ch, label));
  return (
    <div
      className={'gv-row' + (on ? ' on' : '') + (t.mute || (anySolo && !t.solo) ? ' muted' : '')}
      style={{ ['--tc' as string]: t.color }}
    >
      <button
        className="gv-name"
        title={`${t.name}: open in the editor`}
        onClick={() =>
          st.set({
            trackId: t.id,
            selection: new Set(),
            tabCursor: null,
            view: t.type === 'drums' ? 'drums' : st.view === 'drums' ? 'split' : st.view,
          })
        }
      >
        <span className="gv-num">{i + 1}.</span> {t.name}
      </button>
      <button
        className={'gv-ms' + (t.mute ? ' on' : '')}
        aria-pressed={t.mute}
        aria-label={`Mute ${t.name}`}
        onClick={() => set({ mute: !t.mute }, 'Mute')}
      >
        M
      </button>
      <button
        className={'gv-ms solo' + (t.solo ? ' on' : '')}
        aria-pressed={t.solo}
        aria-label={`Solo ${t.name}`}
        onClick={() => set({ solo: !t.solo }, 'Solo')}
      >
        S
      </button>
      <input
        className="gv-vol"
        type="range"
        min={0}
        max={1.25}
        step={0.01}
        value={t.volume}
        aria-label={`${t.name} volume`}
        title={`Volume ${Math.round(t.volume * 100)}%`}
        onChange={(e) => set({ volume: Number(e.target.value) }, 'Volume')}
      />
      <input
        className="gv-pan"
        type="range"
        min={-1}
        max={1}
        step={0.05}
        value={t.pan}
        aria-label={`${t.name} pan`}
        title={`Pan ${t.pan === 0 ? 'centre' : t.pan < 0 ? `${Math.round(-t.pan * 100)}% left` : `${Math.round(t.pan * 100)}% right`}`}
        onChange={(e) => set({ pan: Number(e.target.value) }, 'Pan')}
        onDoubleClick={() => set({ pan: 0 }, 'Pan')}
      />
      {isFretted(t.type) ? (
        <button
          className="gv-tone"
          title="Tones (amp, pedals, cab)"
          aria-label={`${t.name} tones`}
          onClick={() => st.set({ trackId: t.id, modal: 'tone' })}
        >
          ◉
        </button>
      ) : (
        <span className="gv-tone" />
      )}
    </div>
  );
}

function AddTrack() {
  const [open, setOpen] = useState(false);
  const add = (type: TrackType) => {
    const st = useStore.getState();
    const n = st.song.tracks.filter((t) => t.type === type).length + 1;
    const label = { guitar: 'Guitar', bass: 'Bass', drums: 'Drums', other: 'Other' }[type];
    const t = makeTrack(
      type,
      type === 'drums' ? 'Drums' : `${label} ${n}`,
      TRACK_COLORS[st.song.tracks.length % TRACK_COLORS.length],
    );
    st.exec(addTrack(t));
    st.set({ trackId: t.id, selection: new Set() });
    setOpen(false);
  };
  return (
    <span className="gv-add">
      <button aria-label="Add track" aria-expanded={open} onClick={() => setOpen(!open)}>
        ＋
      </button>
      {open && (
        <span className="gv-addmenu" role="menu">
          {(['guitar', 'bass', 'drums', 'other'] as TrackType[]).map((ty) => (
            <button key={ty} role="menuitem" onClick={() => add(ty)}>
              {{ guitar: 'Guitar', bass: 'Bass', drums: 'Drums', other: 'Other (piano, synth…)' }[ty]}
            </button>
          ))}
        </span>
      )}
    </span>
  );
}

export function GlobalView() {
  const open = useStore((s) => s.globalView);
  const nTracks = useStore((s) => s.song.tracks.length);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvRef = useRef<HTMLCanvasElement>(null);
  const scRef = useRef<HTMLDivElement>(null);
  const sizerRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const song = useStore((s) => s.song);
  const filled = useMemo(() => filledBars(song), [song]);
  const filledRef = useRef(filled);
  filledRef.current = filled;

  // close the right-click menu on any click outside it
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    if (!open) return;
    const cv = cvRef.current!,
      sc = scRef.current!,
      sizer = sizerRef.current!,
      rows = rowsRef.current!;
    let drag: { mode: 'cells' | 'ruler'; anchor: BarSel } | null = null;

    const layout = () => {
      const st = useStore.getState();
      sizer.style.width = st.song.bars * CW + 60 + 'px';
      sizer.style.height = RULER + st.song.tracks.length * RH + 'px';
    };

    function draw() {
      const st = useStore.getState();
      const w = sc.clientWidth,
        h = sc.clientHeight;
      if (!w || !h) return;
      const c = fit(cv, w, h);
      const sx = sc.scrollLeft,
        sy = sc.scrollTop;
      const song = st.song;
      const bm = barMap(song);
      c.fillStyle = COL.bg;
      c.fillRect(0, 0, w, h);
      const b0 = Math.max(0, Math.floor(sx / CW)),
        b1 = Math.min(song.bars - 1, Math.ceil((sx + w) / CW));
      const cursorBar = bm.barAtTick(st.cursor).index;
      const playBar = st.playhead != null ? bm.barAtTick(st.playhead).index : -1;
      // rows
      c.save();
      c.beginPath();
      c.rect(0, RULER, w, h - RULER);
      c.clip();
      song.tracks.forEach((t, i) => {
        const y = RULER + i * RH - sy;
        if (y > h || y + RH < RULER) return;
        if (t.id === st.trackId) {
          c.fillStyle = '#1d212a';
          c.fillRect(0, y, w, RH);
        }
        const f = filledRef.current.get(t.id);
        for (let b = b0; b <= b1; b++) {
          const x = b * CW - sx;
          const has = f?.has(b);
          c.fillStyle = has ? alpha(t.color, t.mute ? 0.35 : 0.9) : '#262a33';
          c.fillRect(x + 1, y + 2, CW - 2, RH - 4);
        }
      });
      // playhead / cursor columns
      const col = (b: number, fill: string) => {
        if (b < b0 || b > b1) return;
        c.fillStyle = fill;
        c.fillRect(b * CW - sx, RULER, CW, h - RULER);
      };
      col(cursorBar, 'rgba(230,232,238,0.10)');
      if (playBar >= 0) col(playBar, 'rgba(232,54,93,0.25)');
      // selection
      if (st.barSel) {
        const { ta, tb, ba, bb } = norm(st.barSel);
        const x = ba * CW - sx,
          y = RULER + ta * RH - sy;
        const ww = (bb - ba + 1) * CW,
          hh = (tb - ta + 1) * RH;
        c.fillStyle = 'rgba(255,255,255,0.22)';
        c.fillRect(x, y, ww, hh);
        c.strokeStyle = COL.ink;
        c.lineWidth = 1.5;
        c.strokeRect(x + 0.75, y + 0.75, ww - 1.5, hh - 1.5);
      }
      c.restore();
      // ruler: bar numbers (1 and every 4th) and sections
      c.fillStyle = COL.panel;
      c.fillRect(0, 0, w, RULER);
      c.textBaseline = 'middle';
      for (let b = b0; b <= b1; b++) {
        const x = b * CW - sx;
        if (b === 0 || (b + 1) % 4 === 0) {
          c.fillStyle = COL.mute;
          c.font = '500 10px ' + MONO;
          c.fillText(String(b + 1), x + 3, RULER / 2 + 4);
        }
      }
      for (const sec of song.sections) {
        const b = bm.barAtTick(sec.tick).index;
        const x = b * CW - sx;
        if (x > w || x < -200) continue;
        c.font = '700 10px ' + DISP;
        const tw = c.measureText(sec.name.toUpperCase()).width;
        c.fillStyle = '#3b4250';
        rr(c, x + 1, 2, tw + 8, 11, 2);
        c.fill();
        c.fillStyle = COL.ink;
        c.fillText(sec.name.toUpperCase(), x + 5, 8);
      }
      // cursor marker
      c.fillStyle = COL.ink;
      const mx = cursorBar * CW - sx + CW / 2;
      c.beginPath();
      c.moveTo(mx - 4, RULER - 6);
      c.lineTo(mx + 4, RULER - 6);
      c.lineTo(mx, RULER - 1);
      c.fill();
      c.fillStyle = COL.line;
      c.fillRect(0, RULER - 1, w, 1);
    }
    const requestDraw = frameScheduler(draw);

    const pt = (e: { clientX: number; clientY: number }) => {
      const r = sc.getBoundingClientRect();
      const x = e.clientX - r.left + sc.scrollLeft,
        y = e.clientY - r.top;
      const st = useStore.getState();
      return {
        bar: Math.max(0, Math.min(st.song.bars - 1, Math.floor(x / CW))),
        row: Math.max(0, Math.min(st.song.tracks.length - 1, Math.floor((y - RULER + sc.scrollTop) / RH))),
        inRuler: y < RULER,
        x,
        y,
      };
    };
    const goTo = (bar: number) => {
      const st = useStore.getState();
      const start = barMap(st.song).barStart(bar);
      seek(start);
      st.set({ cursor: start, scrollX: Math.max(0, start * pxPerTick(st.zoom) - 60) });
    };
    /** a click on a section tag in the ruler selects that section (all tracks) */
    const sectionAt = (x: number, y: number) => {
      if (y > 14) return null;
      const st = useStore.getState();
      const bm = barMap(st.song);
      const secs = [...st.song.sections].sort((a, b) => a.tick - b.tick);
      for (let i = 0; i < secs.length; i++) {
        const b = bm.barAtTick(secs[i].tick).index;
        const c = cv.getContext('2d')!;
        c.font = '700 10px ' + DISP;
        const tw = c.measureText(secs[i].name.toUpperCase()).width + 8;
        if (x >= b * CW && x <= b * CW + tw) {
          const next = secs[i + 1] ? bm.barAtTick(secs[i + 1].tick).index - 1 : st.song.bars - 1;
          return { name: secs[i].name, b0: b, b1: Math.max(b, next) };
        }
      }
      return null;
    };

    const onDown = (e: PointerEvent) => {
      if (e.button === 2) return;
      sc.focus();
      setMenu(null);
      const st = useStore.getState();
      const p = pt(e);
      const last = st.song.tracks.length - 1;
      if (p.inRuler) {
        const sec = sectionAt(p.x, p.y);
        if (sec) {
          st.set({ barSel: { t0: 0, t1: last, b0: sec.b0, b1: sec.b1 } });
          goTo(sec.b0);
          status(`“${sec.name}”: bars ${sec.b0 + 1}–${sec.b1 + 1} selected in every track`);
          return;
        }
        const anchor = e.shiftKey && st.barSel ? st.barSel : { t0: 0, t1: last, b0: p.bar, b1: p.bar };
        st.set({ barSel: { t0: 0, t1: last, b0: anchor.b0, b1: p.bar } });
        drag = { mode: 'ruler', anchor };
        if (!e.shiftKey) goTo(p.bar);
      } else {
        const anchor = e.shiftKey && st.barSel ? st.barSel : { t0: p.row, t1: p.row, b0: p.bar, b1: p.bar };
        st.set({
          barSel: { t0: anchor.t0, t1: p.row, b0: anchor.b0, b1: p.bar },
          trackId: st.song.tracks[p.row].id,
          selection: new Set(),
        });
        drag = { mode: 'cells', anchor };
        if (!e.shiftKey) goTo(p.bar);
      }
      sc.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      const st = useStore.getState();
      const p = pt(e);
      const a = drag.anchor;
      st.set({
        barSel:
          drag.mode === 'ruler'
            ? { t0: 0, t1: st.song.tracks.length - 1, b0: a.b0, b1: p.bar }
            : { t0: a.t0, t1: p.row, b0: a.b0, b1: p.bar },
      });
    };
    const onUp = () => {
      if (!drag) return;
      drag = null;
      const s = selection();
      if (s && (s.bb > s.ba || s.tb > s.ta))
        status(
          `${plural(s.bb - s.ba + 1, 'bar')} × ${plural(s.tb - s.ta + 1, 'track')} selected. Ctrl+C copies, right-click for more.`,
        );
    };
    const onDbl = (e: MouseEvent) => {
      // double-click a bar: open that track in the editor at that bar
      const st = useStore.getState();
      const p = pt(e);
      if (p.inRuler) return;
      const t = st.song.tracks[p.row];
      st.set({ trackId: t.id, view: t.type === 'drums' ? 'drums' : st.view === 'drums' ? 'split' : st.view });
      goTo(p.bar);
    };
    const onCtx = (e: MouseEvent) => {
      e.preventDefault();
      const st = useStore.getState();
      const p = pt(e);
      if (!p.inRuler) {
        const s = st.barSel && norm(st.barSel);
        const inside = s && p.row >= s.ta && p.row <= s.tb && p.bar >= s.ba && p.bar <= s.bb;
        if (!inside) st.set({ barSel: { t0: p.row, t1: p.row, b0: p.bar, b1: p.bar } });
      }
      // the panel is short: the menu floats over the page, kept inside the window
      setMenu({
        x: Math.min(e.clientX, window.innerWidth - 240),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - 380)),
      });
    };
    const onScroll = () => {
      rows.scrollTop = sc.scrollTop;
      requestDraw();
    };
    const onWheelRows = (e: WheelEvent) => {
      sc.scrollTop += e.deltaY;
      e.preventDefault();
    };

    sc.addEventListener('pointerdown', onDown);
    sc.addEventListener('pointermove', onMove);
    sc.addEventListener('pointerup', onUp);
    sc.addEventListener('pointercancel', onUp);
    sc.addEventListener('dblclick', onDbl);
    sc.addEventListener('contextmenu', onCtx);
    sc.addEventListener('scroll', onScroll, { passive: true });
    rows.addEventListener('wheel', onWheelRows, { passive: false });
    const unsub = useStore.subscribe((s, prev) => {
      if (s.song !== prev.song) layout();
      if (
        s.song !== prev.song ||
        s.barSel !== prev.barSel ||
        s.cursor !== prev.cursor ||
        s.trackId !== prev.trackId ||
        (s.playhead !== prev.playhead &&
          (s.playhead == null ||
            prev.playhead == null ||
            barMap(s.song).barAtTick(s.playhead).index !== barMap(s.song).barAtTick(prev.playhead).index))
      )
        requestDraw();
    });
    const ro = new ResizeObserver(() => {
      layout();
      requestDraw();
    });
    ro.observe(wrapRef.current!);
    layout();
    requestDraw();
    document.fonts?.ready.then(requestDraw);
    return () => {
      unsub();
      ro.disconnect();
      rows.removeEventListener('wheel', onWheelRows);
    };
  }, [open]);

  const onKey = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    const st = useStore.getState();
    let handled = true;
    if (mod && k === 'c') barActions.copy();
    else if (mod && k === 'x') barActions.cut();
    else if (mod && k === 'v') barActions.paste(e.shiftKey);
    else if (mod && k === 'd') barActions.duplicate();
    else if (mod && (e.key === 'Delete' || e.key === 'Backspace')) barActions.remove();
    else if (e.key === 'Delete' || e.key === 'Backspace') barActions.clear();
    else if (e.key === 'Insert') barActions.insert(false);
    else if (e.key === 'Escape') st.set({ barSel: null });
    else if (e.key.startsWith('Arrow') && st.barSel) {
      const s = norm(st.barSel);
      const dB = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
      const dT = e.key === 'ArrowUp' ? -1 : e.key === 'ArrowDown' ? 1 : 0;
      const nb = Math.max(0, Math.min(st.song.bars - 1, (e.shiftKey ? st.barSel.b1 : s.ba) + dB));
      const nt = Math.max(0, Math.min(st.song.tracks.length - 1, (e.shiftKey ? st.barSel.t1 : s.ta) + dT));
      st.set({
        barSel: e.shiftKey ? { ...st.barSel, b1: nb, t1: nt } : { t0: nt, t1: nt, b0: nb, b1: nb },
        trackId: st.song.tracks[nt].id,
      });
    } else handled = false;
    if (handled) {
      // keep these keys away from the editor's own shortcuts
      e.preventDefault();
      e.stopPropagation();
    }
  };

  const rowsH = RULER + nTracks * RH;
  return (
    <section className={'gv' + (open ? '' : ' closed')} aria-label="Global view">
      <div className="gv-left">
        <div className="gv-head">
          <AddTrack />
          <span className="gv-title">Tracks</span>
          <span className="gv-cols mute" aria-hidden="true">
            M S · Vol · Pan
          </span>
          <button
            className="gv-toggle"
            aria-expanded={open}
            title={open ? 'Hide the global view' : 'Show the global view'}
            onClick={() => useStore.getState().set({ globalView: !open })}
          >
            {open ? '▾' : '▴'}
          </button>
        </div>
        {open && (
          <div className="gv-rows" ref={rowsRef}>
            {Array.from({ length: nTracks }, (_, i) => (
              <TrackRow key={i} i={i} />
            ))}
          </div>
        )}
      </div>
      {open && (
        <div ref={wrapRef} className="cvwrap gv-grid" style={{ height: Math.min(rowsH + 14, 240) }}>
          <canvas ref={cvRef} />
          <div
            ref={scRef}
            className="scroller"
            tabIndex={0}
            onKeyDown={onKey}
            aria-label="Bars of every track. Drag to select bars, Ctrl+C / Ctrl+X / Ctrl+V copy, cut and paste, Delete clears, Ctrl+Delete deletes bars, Insert adds a bar, right-click for more."
          >
            <div ref={sizerRef} className="sizer" />
          </div>
          {menu &&
            createPortal(
              <div
                className="ctxmenu gv-menu"
                role="menu"
                style={{ position: 'fixed', left: menu.x, top: menu.y, zIndex: 60 }}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {MENU.map(([label, fn, key]) => (
                  <button
                    key={label}
                    role="menuitem"
                    disabled={label.startsWith('Paste') && !clip}
                    onClick={() => {
                      setMenu(null);
                      fn();
                      scRef.current?.focus();
                    }}
                  >
                    <span>{label}</span>
                    {key && <kbd>{key}</kbd>}
                  </button>
                ))}
              </div>,
              document.body,
            )}
        </div>
      )}
    </section>
  );
}
