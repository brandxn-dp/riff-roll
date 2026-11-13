import { useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url';
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url';
import { isFretted, songToAlphaTex, type TexBeatRef } from '@riffroll/core';
import { currentTrack, useStore } from '../store';
import { useSettings } from '../settings';
import { isDark } from '../theme';

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
interface BeatB {
  visualBounds: Bounds;
  beat: { index: number; voice: { bar: { index: number } } };
}
interface BarB {
  visualBounds: Bounds;
  beats: BeatB[];
}
interface MasterBarB {
  index: number;
  visualBounds: Bounds;
  bars: BarB[];
}

/**
 * Notation + Tab, edited like Guitar Pro: click a line of the tab staff to put the cursor on that string at that
 * beat (rests too), then type frets and use the usual tab keys; click the notation staff to select a beat.
 */
export function NotationView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const curRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const beatsRef = useRef<TexBeatRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const song = useStore((s) => s.song);
  const trackId = useStore((s) => s.trackId);
  const selection = useStore((s) => s.selection);
  const tabCursor = useStore((s) => s.tabCursor);

  /** All master bars with their staff bars (index 0 notation, last one the tab staff). */
  const masterBars = (): MasterBarB[] => {
    const bl = apiRef.current?.renderer.boundsLookup as unknown as {
      staffSystems: { bars: MasterBarB[] }[];
    } | null;
    return bl ? bl.staffSystems.flatMap((s) => s.bars) : [];
  };

  useEffect(() => {
    const settings = alphaTabSettings(notationDark()) as { display: Record<string, unknown> };
    if (useStore.getState().layout === 'mobile') settings.display.scale = 0.62;
    const api = new alphaTab.AlphaTabApi(hostRef.current!, settings as never);
    apiRef.current = api;
    if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__at = api;
    api.error.on((e) => setError(String((e as Error)?.message ?? e)));
    api.renderStarted.on(() => setBusy(true));
    api.renderFinished.on(() => {
      setBusy(false);
      positionBox();
      positionCursor();
    });
    api.beatMouseDown.on((beat) => {
      if (onTabStaff) return; // the tab staff places the cursor instead (mousedown below)
      const ref = beatsRef.current.find((b) => b.bar === beat.voice.bar.index && b.beat === beat.index);
      const st = useStore.getState();
      if (ref) {
        st.select(ref.noteIds, ref.noteIds[0] ?? null);
        st.set({ cursor: ref.start, tabCursor: null });
      }
    });

    // Guitar Pro style: a click on a tab line sets the tab cursor (string from the line, beat from the x)
    let onTabStaff = false;
    const host = hostRef.current!;
    const onDown = (e: MouseEvent) => {
      onTabStaff = false;
      const st = useStore.getState();
      const t = currentTrack(st);
      if (!t || !isFretted(t.type)) return;
      const r = host.getBoundingClientRect();
      const x = e.clientX - r.left,
        y = e.clientY - r.top;
      const n = t.tuning.strings.length;
      for (const mb of masterBars()) {
        const tab = mb.bars[mb.bars.length - 1];
        const b = tab.visualBounds;
        const gap = b.h / Math.max(1, n - 1);
        if (x < mb.visualBounds.x || x > mb.visualBounds.x + mb.visualBounds.w) continue;
        if (y < b.y - gap / 2 || y > b.y + b.h + gap / 2) continue;
        const row = Math.max(0, Math.min(n - 1, Math.round((y - b.y) / gap)));
        // nearest beat by its centre
        let best: BeatB | null = null,
          bd = Infinity;
        for (const bb of tab.beats) {
          const cx = bb.visualBounds.x + bb.visualBounds.w / 2;
          if (Math.abs(cx - x) < bd) [bd, best] = [Math.abs(cx - x), bb];
        }
        if (!best) return;
        const ref = beatsRef.current.find(
          (q) => q.bar === best!.beat.voice.bar.index && q.beat === best!.beat.index,
        );
        if (!ref) return;
        onTabStaff = true;
        const string = n - 1 - row; // top line = highest string
        const noteHere = t.notes.find((q) => ref.noteIds.includes(q.id) && st.selection.has(q.id));
        st.set({ tabCursor: { tick: ref.start, string }, cursor: ref.start });
        st.select(
          ref.noteIds.filter((id) => {
            const q = t.notes.find((m) => m.id === id);
            return q && q.pinnedString === string;
          }),
          noteHere?.id ?? null,
        );
        e.preventDefault();
        return;
      }
    };
    host.addEventListener('mousedown', onDown, true);
    return () => {
      host.removeEventListener('mousedown', onDown, true);
      api.destroy();
    };
    // one alphaTab instance for the component's life; the handlers read current state from the store
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // re-render (debounced) when the song or track changes
  useEffect(() => {
    const id = setTimeout(() => {
      const api = apiRef.current;
      if (!api) return;
      try {
        const res = songToAlphaTex(song, [trackId]);
        beatsRef.current = res.beats;
        setError(null);
        api.tex(res.tex);
      } catch (e) {
        setError((e as Error).message);
      }
    }, 150);
    return () => clearTimeout(id);
  }, [song, trackId]);

  function positionBox() {
    const api = apiRef.current;
    const box = boxRef.current;
    if (!api || !box) return;
    const sel = useStore.getState().selection;
    const ref = beatsRef.current.find((b) => b.noteIds.some((id) => sel.has(id)));
    const beat = ref && api.score?.tracks[0]?.staves[0]?.bars[ref.bar]?.voices[0]?.beats[ref.beat];
    const bounds = beat ? api.renderer.boundsLookup?.findBeat(beat) : null;
    if (!bounds || useStore.getState().tabCursor) {
      box.style.display = 'none';
      return;
    }
    const b = bounds.visualBounds;
    box.style.display = 'block';
    box.style.left = b.x - 3 + 'px';
    box.style.top = bounds.barBounds.masterBarBounds.visualBounds.y + 'px';
    box.style.width = b.w + 6 + 'px';
    box.style.height = bounds.barBounds.masterBarBounds.visualBounds.h + 'px';
  }

  /** The tab cursor: a box on its string line at the beat at (or just before) its tick. */
  function positionCursor() {
    const el = curRef.current;
    const st = useStore.getState();
    const c = st.tabCursor;
    const t = currentTrack(st);
    if (!el) return;
    if (!c || !t || !isFretted(t.type)) {
      el.style.display = 'none';
      return;
    }
    const refs = beatsRef.current.filter((b) => b.start <= c.tick);
    const ref = refs[refs.length - 1];
    const mb = ref && masterBars().find((m) => m.index === ref.bar);
    const tab = mb?.bars[mb.bars.length - 1];
    const bb = tab?.beats.find((x) => x.beat.index === ref!.beat);
    if (!tab || !bb) {
      el.style.display = 'none';
      return;
    }
    const n = t.tuning.strings.length;
    const gap = tab.visualBounds.h / Math.max(1, n - 1);
    const row = n - 1 - c.string;
    el.style.display = 'block';
    el.style.left = bb.visualBounds.x - 2 + 'px';
    el.style.width = Math.max(14, bb.visualBounds.w) + 4 + 'px';
    el.style.top = tab.visualBounds.y + row * gap - gap / 2 + 'px';
    el.style.height = gap + 'px';
    el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }

  useEffect(positionBox, [selection, tabCursor]);
  useEffect(positionCursor, [tabCursor]);

  return (
    <div className={'notation' + (notationDark() ? '' : ' paper')}>
      {error && <div className="warn notation-msg">Notation: {error}</div>}
      {busy && !error && <div className="mute notation-msg">Rendering…</div>}
      <div className="notation-scroll">
        <div className="notation-inner">
          <div ref={hostRef} className="notation-host" />
          <div ref={boxRef} className="notation-sel" />
          <div ref={curRef} className="notation-cursor" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
