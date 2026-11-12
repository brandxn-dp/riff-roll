import { useEffect, useRef, useState } from 'react';
import * as alphaTab from '@coderline/alphatab';
import bravuraWoff2 from '@coderline/alphatab/font/Bravura.woff2?url';
import bravuraWoff from '@coderline/alphatab/font/Bravura.woff?url';
import { songToAlphaTex, type TexBeatRef } from '@riffroll/core';
import { useStore } from '../store';

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

export function NotationView() {
  const hostRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<alphaTab.AlphaTabApi | null>(null);
  const beatsRef = useRef<TexBeatRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const song = useStore((s) => s.song);
  const trackId = useStore((s) => s.trackId);
  const selection = useStore((s) => s.selection);

  useEffect(() => {
    const api = new alphaTab.AlphaTabApi(hostRef.current!, alphaTabSettings(true) as never);
    apiRef.current = api;
    api.error.on((e) => setError(String((e as Error)?.message ?? e)));
    api.renderStarted.on(() => setBusy(true));
    api.renderFinished.on(() => {
      setBusy(false);
      positionBox();
    });
    api.beatMouseDown.on((beat) => {
      const ref = beatsRef.current.find((b) => b.bar === beat.voice.bar.index && b.beat === beat.index);
      const st = useStore.getState();
      if (ref) {
        st.select(ref.noteIds, ref.noteIds[0] ?? null);
        st.set({ cursor: ref.start });
      }
    });
    return () => api.destroy();
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
    if (!bounds) {
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

  useEffect(positionBox, [selection]);

  return (
    <div className="notation">
      {error && <div className="warn notation-msg">Notation: {error}</div>}
      {busy && !error && <div className="mute notation-msg">Rendering…</div>}
      <div className="notation-scroll">
        <div className="notation-inner">
          <div ref={hostRef} className="notation-host" />
          <div ref={boxRef} className="notation-sel" />
        </div>
      </div>
    </div>
  );
}
