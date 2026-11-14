import { useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url';
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url';
import { isFretted, songToAlphaTex, trackFingering, type TexBeatRef } from '@riffroll/core';
import { currentTrack, useStore } from '../store';
import { useSettings } from '../settings';
import { isDark } from '../theme';
import { registerKeyHandler } from '../shortcuts';

/** Notation in the theme's colours, or black on white paper (Settings → Appearance). */
export const notationDark = () => useSettings.getState().notationPaper !== 'light' && isDark();

/** Settings shared by the on-screen view and printing. */
export function alphaTabSettings(dark: boolean): Record<string, unknown> {
  const ink = dark ? '#e6e8ee' : '#15171c';
  const soft = dark ? '#8a91a0' : '#555c68';
  return {
    core: {
      useWorkers: false, // the app's CSP and Electron's app:// both prefer main-thread rendering
      engine: 'svg',
      logLevel: 'warning',
      smuflFontSources: new Map([
        [alphaTab.FontFileFormat.Woff2, bravuraWoff2],
        [alphaTab.FontFileFormat.Woff, bravuraWoff],
      ]),
    },
    display: {
      layoutMode: alphaTab.LayoutMode.Page,
      scale: 0.95,
      resources: {
        mainGlyphColor: ink,
        secondaryGlyphColor: soft,
        staffLineColor: dark ? '#4a5160' : '#7a808c',
        barSeparatorColor: dark ? '#6a7180' : '#3a404c',
        barNumberColor: soft,
        scoreInfoColor: ink,
      },
    },
    player: { enablePlayer: false, enableCursor: false },
    notation: { rhythmMode: alphaTab.TabRhythmMode.ShowWithBars },
  };
}

type Bounds = { x: number; y: number; w: number; h: number };
interface ModelBeat {
  index: number;
  voice: { bar: { index: number; staff: { track: { index: number } } } };
}
interface BeatB {
  visualBounds: Bounds;
  beat: ModelBeat;
}
interface BarB {
  visualBounds: Bounds;
  bar: { index: number; staff: { track: { index: number } } };
  beats: BeatB[];
}
interface MasterBarB {
  index: number;
  visualBounds: Bounds;
  bars: BarB[];
}
interface Lookup {
  staffSystems: { bars: MasterBarB[] }[];
}

/** View options, like Guitar Pro's: which staves, which tracks, page or one long line, zoom. */
type Staves = 'both' | 'score' | 'tab';
interface Prefs {
  staves: Staves;
  all: boolean;
  horizontal: boolean;
  zoom: number;
}
const PREFS_KEY = 'riffroll.notation';
function readPrefs(): Prefs {
  const d: Prefs = { staves: 'both', all: false, horizontal: false, zoom: 1 };
  try {
    return { ...d, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return d;
  }
}
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5, 1.75, 2];

/**
 * Notation + Tab, edited like Guitar Pro. Click a tab line to put the cursor on that string at that beat (then type
 * frets and use the usual tab keys), click the score to put it on the beat; drag or Shift+click to select beats;
 * ←/→ step beats, Shift+←/→ extend the selection, Ctrl+←/→ jump bars. The playback cursor follows the music.
 */
export function NotationView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const beatsRef = useRef<TexBeatRef[]>([]);
  /** track ids in score order (TexBeatRef.trackIndex points into this) */
  const tracksRef = useRef<string[]>([]);
  /** where a range selection started (Shift+click, drag, Shift+arrows) and where it ends now */
  const anchorRef = useRef<TexBeatRef | null>(null);
  const edgeRef = useRef<TexBeatRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [prefs, setPrefsState] = useState(readPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const song = useStore((s) => s.song);
  const trackId = useStore((s) => s.trackId);
  const selection = useStore((s) => s.selection);
  const tabCursor = useStore((s) => s.tabCursor);
  const mobile = useStore((s) => s.layout === 'mobile');
  const fretted = useStore((s) => {
    const t = currentTrack(s);
    return !!t && isFretted(t.type);
  });

  const setPrefs = (p: Partial<Prefs>) => {
    const next = { ...prefsRef.current, ...p };
    prefsRef.current = next; // a second change before the re-render builds on this one
    setPrefsState(next);
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch {
      /* this session only */
    }
  };

  const lookup = () => (apiRef.current?.renderer.boundsLookup as unknown as Lookup | null) ?? null;
  const masterBars = (): MasterBarB[] => lookup()?.staffSystems.flatMap((s) => s.bars) ?? [];
  /**
   * The beat under a point: the staff whose lines are nearest in y (within the master bar at x), then the beat
   * nearest in x on it. (alphaTab's own lookup doesn't respect which track's staff was clicked.)
   */
  const beatAt = (x: number, y: number): ModelBeat | null => {
    for (const sys of lookup()?.staffSystems ?? [])
      for (const mb of sys.bars) {
        const v = mb.visualBounds;
        if (x < v.x || x > v.x + v.w || y < v.y - 20 || y > v.y + v.h + 20) continue;
        let bar: BarB | null = null,
          bd = Infinity;
        for (const b of mb.bars) {
          const d =
            y < b.visualBounds.y
              ? b.visualBounds.y - y
              : Math.max(0, y - b.visualBounds.y - b.visualBounds.h);
          if (d < bd) [bd, bar] = [d, b];
        }
        let best: BeatB | null = null,
          xd = Infinity;
        for (const bb of bar?.beats ?? []) {
          const d = Math.abs(bb.visualBounds.x + bb.visualBounds.w / 2 - x);
          if (d < xd) [xd, best] = [d, bb];
        }
        return best?.beat ?? null;
      }
    return null;
  };
  /** our beat for a beat of the rendered score */
  const refOf = (b: ModelBeat | null | undefined) =>
    b
      ? beatsRef.current.find(
          (r) =>
            r.trackIndex === b.voice.bar.staff.track.index &&
            r.bar === b.voice.bar.index &&
            r.beat === b.index,
        )
      : undefined;
  /** the rendered score's beat for one of ours */
  const modelBeat = (r: TexBeatRef) =>
    (apiRef.current?.score?.tracks[r.trackIndex]?.staves[0]?.bars[r.bar]?.voices[0]?.beats[r.beat] ??
      null) as unknown as ModelBeat | null;
  const beatBounds = (r: TexBeatRef) => {
    const b = modelBeat(r);
    return b
      ? (apiRef.current!.renderer.boundsLookup!.findBeat(b as never) as unknown as {
          visualBounds: Bounds;
          barBounds: { masterBarBounds: MasterBarB };
        } | null)
      : null;
  };
  /** a track's staff bars inside a master bar: [notation, tab] or just one of them */
  const trackBars = (mb: MasterBarB, ti: number) => mb.bars.filter((b) => b.bar?.staff?.track?.index === ti);
  const curIndex = () => tracksRef.current.indexOf(useStore.getState().trackId);
  const refsOfCurrent = () => beatsRef.current.filter((r) => r.trackIndex === curIndex());
  const tabShown = () => prefsRef.current.staves !== 'score';

  /** select every note of the current track between two beats (inclusive) */
  function selectRange(a: TexBeatRef, b: TexBeatRef) {
    const [lo, hi] = a.start <= b.start ? [a.start, b.start] : [b.start, a.start];
    const ids = beatsRef.current
      .filter((r) => r.trackIndex === a.trackIndex && r.start >= lo && r.start <= hi)
      .flatMap((r) => r.noteIds);
    useStore.getState().select(ids, ids[0] ?? null);
  }

  /** Put the edit cursor on a beat (and string, on guitar/bass), select what's there. */
  function placeCursor(r: TexBeatRef, str: number | null) {
    const st = useStore.getState();
    const id = tracksRef.current[r.trackIndex];
    if (id && id !== st.trackId) st.set({ trackId: id });
    const t = st.song.tracks.find((x) => x.id === id);
    if (!t) return;
    anchorRef.current = edgeRef.current = r;
    if (isFretted(t.type)) {
      const fing = trackFingering(t);
      const beatNotes = t.notes.filter((n) => r.noteIds.includes(n.id));
      // the clicked string, else the string of the beat's top note, else where the cursor was
      const top = beatNotes.length ? fing.get(beatNotes[beatNotes.length - 1].id)?.string : undefined;
      const s: number =
        str != null ? str : top != null ? top : (st.tabCursor?.string ?? t.tuning.strings.length - 1);
      st.set({ tabCursor: { tick: r.start, string: s }, cursor: r.start });
      const on =
        str == null ? beatNotes : beatNotes.filter((n) => (fing.get(n.id)?.string ?? n.pinnedString) === s);
      st.select(
        on.map((n) => n.id),
        on[0]?.id ?? null,
      );
    } else {
      st.set({ tabCursor: null, cursor: r.start });
      st.select(r.noteIds, r.noteIds[0] ?? null);
    }
  }

  // ---- alphaTab: one instance for the component's life; handlers read current state from the store
  useEffect(() => {
    const settings = alphaTabSettings(notationDark()) as { display: Record<string, unknown> };
    const p = prefsRef.current;
    settings.display.scale = (useStore.getState().layout === 'mobile' ? 0.62 : 0.95) * p.zoom;
    settings.display.layoutMode = p.horizontal ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
    const api = new alphaTab.AlphaTabApi(hostRef.current!, settings as never);
    apiRef.current = api;
    if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__at = api;
    api.error.on((e) => setError(String((e as Error)?.message ?? e)));
    api.renderStarted.on(() => setBusy(true));
    api.renderFinished.on(() => {
      setBusy(false);
      positionAll();
    });

    const host = hostRef.current!;
    const local = (e: MouseEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    /** which string line of a tab staff is at y (null: not on the tab staff) */
    const tabRowAt = (x: number, y: number, ti: number) => {
      const st = useStore.getState();
      const t = st.song.tracks.find((q) => q.id === tracksRef.current[ti]);
      if (!t || !isFretted(t.type) || !tabShown()) return null;
      const n = t.tuning.strings.length;
      for (const mb of masterBars()) {
        if (x < mb.visualBounds.x || x > mb.visualBounds.x + mb.visualBounds.w) continue;
        const bars = trackBars(mb, ti);
        const tab = bars[bars.length - 1];
        if (!tab) continue;
        const b = tab.visualBounds;
        const gap = b.h / Math.max(1, n - 1);
        if (y < b.y - gap / 2 || y > b.y + b.h + gap / 2) continue;
        const row = Math.max(0, Math.min(n - 1, Math.round((y - b.y) / gap)));
        return n - 1 - row; // top line = highest string
      }
      return null;
    };
    let dragging = false;
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      const { x, y } = local(e);
      const beat = beatAt(x, y);
      const r = refOf(beat);
      if (!r) return;
      e.preventDefault();
      host.focus?.();
      if (e.shiftKey && anchorRef.current && anchorRef.current.trackIndex === r.trackIndex) {
        edgeRef.current = r;
        selectRange(anchorRef.current, r);
      } else placeCursor(r, tabRowAt(x, y, r.trackIndex));
      dragging = true;
    };
    const onMove = (e: MouseEvent) => {
      if (!dragging || !(e.buttons & 1) || !anchorRef.current) return;
      const { x, y } = local(e);
      const r = refOf(beatAt(x, y));
      if (!r || r.trackIndex !== anchorRef.current.trackIndex || r === edgeRef.current) return;
      edgeRef.current = r;
      selectRange(anchorRef.current, r);
    };
    const onUp = () => (dragging = false);
    host.addEventListener('mousedown', onDown, true);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);

    // ---- keyboard, Guitar Pro style (runs before the tab-entry keys and the global shortcuts)
    const offKeys = registerKeyHandler((e) => {
      const st = useStore.getState();
      if (st.view !== 'notation' || !e.key.startsWith('Arrow')) return false;
      const dir = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!dir || e.altKey) return false;
      const refs = refsOfCurrent();
      if (!refs.length) return false;
      const at = st.tabCursor?.tick ?? edgeRef.current?.start ?? st.cursor;
      const idx = Math.max(
        0,
        refs.findLastIndex((r) => r.start <= at),
      );
      if (e.shiftKey) {
        // extend the selection beat by beat
        const from = edgeRef.current && refs.includes(edgeRef.current) ? refs.indexOf(edgeRef.current) : idx;
        const to = refs[Math.max(0, Math.min(refs.length - 1, from + dir))];
        if (!anchorRef.current || !refs.includes(anchorRef.current)) anchorRef.current = refs[from];
        edgeRef.current = to;
        selectRange(anchorRef.current, to);
        return true;
      }
      if (e.ctrlKey || e.metaKey) {
        // previous / next bar
        const bar = refs[idx].bar + dir;
        const target =
          dir < 0 && refs[idx].start > (refs.find((r) => r.bar === refs[idx].bar)?.start ?? 0)
            ? refs.find((r) => r.bar === refs[idx].bar)
            : refs.find((r) => r.bar === bar);
        if (target) placeCursor(target, st.tabCursor?.string ?? null);
        return true;
      }
      // plain ←/→ step beats on tracks without tab (the tab cursor moves itself on guitar and bass)
      if (st.tabCursor) return false;
      const next = refs[Math.max(0, Math.min(refs.length - 1, idx + (edgeRef.current ? dir : 0)))];
      placeCursor(next, null);
      return true;
    });

    // ---- the playback cursor
    const offPlay = useStore.subscribe((s, prev) => {
      if (s.playhead !== prev.playhead) positionPlayhead();
    });

    return () => {
      host.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      offKeys();
      offPlay();
      api.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- layout and zoom changes re-render with new settings
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const d = api.settings.display as unknown as { scale: number; layoutMode: number };
    const scale = (mobile ? 0.62 : 0.95) * prefs.zoom;
    const mode = prefs.horizontal ? alphaTab.LayoutMode.Horizontal : alphaTab.LayoutMode.Page;
    if (d.scale === scale && d.layoutMode === mode) return;
    d.scale = scale;
    d.layoutMode = mode;
    api.updateSettings();
    api.render();
  }, [prefs.zoom, prefs.horizontal, mobile]);

  // ---- re-render (debounced) when the song, track or staves change
  useEffect(() => {
    const id = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      try {
        const ids = prefs.all ? song.tracks.map((t) => t.id) : [trackId];
        const res = songToAlphaTex(song, ids);
        tracksRef.current = song.tracks.filter((t) => ids.includes(t.id)).map((t) => t.id);
        beatsRef.current = res.beats;
        anchorRef.current = edgeRef.current = null;
        const staff =
          prefs.staves === 'score' ? '\\staff {score}' : prefs.staves === 'tab' ? '\\staff {tabs}' : null;
        setError(null);
        // render every track in the score (alphaTab draws only the first unless told)
        api.tex(
          staff ? res.tex.split('\\staff {score tabs}').join(staff) : res.tex,
          tracksRef.current.map((_, i) => i),
        );
      } catch (e) {
        setError((e as Error).message);
      }
    }, 150);
    return () => clearTimeout(id);
  }, [song, trackId, prefs.all, prefs.staves]);

  /** Highlight every selected beat of the current track. */
  function positionSelection() {
    const layer = selRef.current;
    if (!layer || !apiRef.current?.renderer.boundsLookup) return;
    const sel = useStore.getState().selection;
    const ti = curIndex();
    const boxes: string[] = [];
    for (const r of beatsRef.current) {
      if (r.trackIndex !== ti || !r.noteIds.some((id) => sel.has(id))) continue;
      const bb = beatBounds(r);
      if (!bb) continue;
      const bars = trackBars(bb.barBounds.masterBarBounds, ti);
      if (!bars.length) continue;
      const top = Math.min(...bars.map((b) => b.visualBounds.y));
      const bottom = Math.max(...bars.map((b) => b.visualBounds.y + b.visualBounds.h));
      const v = bb.visualBounds;
      boxes.push(
        `<div class="notation-sel" style="left:${v.x - 3}px;top:${top - 4}px;width:${v.w + 6}px;height:${bottom - top + 8}px"></div>`,
      );
    }
    layer.innerHTML = boxes.join('');
  }

  /** The edit cursor: on its string line of the tab staff, or over the beat when no tab is shown. */
  function positionCursor() {
    const el = curRef.current;
    const st = useStore.getState();
    const c = st.tabCursor;
    const t = currentTrack(st);
    if (!el) return;
    const ti = curIndex();
    const refs = refsOfCurrent();
    const at = c?.tick ?? (st.selection.size ? edgeRef.current?.start : undefined);
    const ref = at == null ? undefined : refs.filter((b) => b.start <= at).at(-1);
    const bb = ref && beatBounds(ref);
    if (!t || !ref || !bb) {
      el.style.display = 'none';
      return;
    }
    const bars = trackBars(bb.barBounds.masterBarBounds, ti);
    const v = bb.visualBounds;
    el.style.display = 'block';
    el.style.left = v.x - 2 + 'px';
    el.style.width = Math.max(14, v.w) + 4 + 'px';
    if (c && isFretted(t.type) && tabShown() && bars.length) {
      const tab = bars[bars.length - 1].visualBounds;
      const n = t.tuning.strings.length;
      const gap = tab.h / Math.max(1, n - 1);
      el.style.top = tab.y + (n - 1 - c.string) * gap - gap / 2 + 'px';
      el.style.height = gap + 'px';
    } else if (bars.length) {
      const top = Math.min(...bars.map((b) => b.visualBounds.y));
      const bottom = Math.max(...bars.map((b) => b.visualBounds.y + b.visualBounds.h));
      el.style.top = top - 4 + 'px';
      el.style.height = bottom - top + 8 + 'px';
    }
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  /** The playback cursor: a line at the beat being played, kept in view while it moves. */
  function positionPlayhead() {
    const el = playRef.current;
    const st = useStore.getState();
    if (!el) return;
    const tick = st.playhead;
    const ti = Math.max(0, curIndex());
    const refs = beatsRef.current.filter((r) => r.trackIndex === ti);
    const ref = tick == null ? undefined : refs.filter((r) => r.start <= tick).at(-1);
    const bb = ref && beatBounds(ref);
    if (!bb) {
      el.style.display = 'none';
      return;
    }
    const mb = bb.barBounds.masterBarBounds.visualBounds;
    el.style.display = 'block';
    el.style.left = bb.visualBounds.x - 2 + 'px';
    el.style.top = mb.y + 'px';
    el.style.height = mb.h + 'px';
    if (useSettings.getState().followPlayhead && document.body.dataset.dragging !== '1') {
      const sc = scrollRef.current;
      if (!sc) return;
      const x = bb.visualBounds.x,
        y = mb.y;
      if (y < sc.scrollTop || y + mb.h > sc.scrollTop + sc.clientHeight) sc.scrollTop = Math.max(0, y - 40);
      if (x < sc.scrollLeft || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = Math.max(0, x - 80);
    }
  }

  function positionAll() {
    positionSelection();
    positionCursor();
    positionPlayhead();
  }

  // the overlays read the render and the store directly; these are the changes that move them
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(positionSelection, [selection]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(positionCursor, [tabCursor, selection]);

  const seg = <K extends keyof Prefs>(key: K, options: [Prefs[K], string, string][]) => (
    <div className="group" role="group">
      {options.map(([v, label, title]) => (
        <button
          key={String(v)}
          aria-pressed={prefs[key] === v}
          title={title}
          onClick={() => setPrefs({ [key]: v })}
        >
          {label}
        </button>
      ))}
    </div>
  );
  const zi = Math.max(0, ZOOMS.indexOf(prefs.zoom));

  return (
    <div className={'notation' + (notationDark() ? '' : ' paper')}>
      <div className="notation-bar">
        {fretted &&
          seg('staves', [
            ['both', 'Notation + Tab', 'Standard notation and tablature'],
            ['score', 'Notation', 'Standard notation only'],
            ['tab', 'Tab', 'Tablature only (rhythm shown on the tab)'],
          ])}
        {seg('all', [
          [false, 'This track', 'Only the track you are editing'],
          [true, 'All tracks', 'The full score: every track (click a staff to edit that track)'],
        ])}
        {seg('horizontal', [
          [false, 'Page', 'Page layout'],
          [true, 'Horizontal', 'One long line that scrolls sideways'],
        ])}
        <div className="group" role="group" aria-label="Zoom">
          <button title="Zoom out" disabled={zi === 0} onClick={() => setPrefs({ zoom: ZOOMS[zi - 1] })}>
            −
          </button>
          <button title="Back to 100 %" onClick={() => setPrefs({ zoom: 1 })}>
            {Math.round(prefs.zoom * 100)}%
          </button>
          <button
            title="Zoom in"
            disabled={zi === ZOOMS.length - 1}
            onClick={() => setPrefs({ zoom: ZOOMS[zi + 1] })}
          >
            +
          </button>
        </div>
        {!mobile && (
          <span className="mute small notation-help">
            {fretted ? 'Click a tab line, type frets. ' : 'Click a beat. '}
            Drag or Shift+click to select · Shift+←/→ extend · Ctrl+←/→ bars
          </span>
        )}
      </div>
      {error && <div className="warn notation-msg">Notation: {error}</div>}
      {busy && !error && <div className="mute notation-msg">Rendering…</div>}
      <div className="notation-scroll" ref={scrollRef}>
        <div className="notation-inner">
          <div ref={hostRef} className="notation-host" tabIndex={-1} />
          <div ref={selRef} className="notation-sels" aria-hidden="true" />
          <div ref={curRef} className="notation-cursor" aria-hidden="true" />
          <div ref={playRef} className="notation-playhead" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
