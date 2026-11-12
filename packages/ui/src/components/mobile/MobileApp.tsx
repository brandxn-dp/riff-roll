import { useEffect, useRef, useState, type ReactNode } from 'react';
import { TRACK_COLORS, addTrack, makeTrack, type TrackType } from '@riffroll/core';
import { currentTrack, useStore, type MainView } from '../../store';
import { togglePlay } from '../../transport';
import { PianoRoll } from '../../views/PianoRoll';
import { LowerPanel } from '../../views/LowerPanel';
import { DrumGrid } from '../../views/DrumGrid';
import { NotationView } from '../../views/NotationView';
import { Inspector } from '../Inspector';
import { Toolbar } from '../Toolbar';
import { SongBar } from '../SongBar';
import { InputControls } from '../InputControls';
import { FretPad } from './FretPad';
import { setLayoutPref } from '../../device';
import {
  copyAsciiTab,
  exportGuitarPro,
  exportMidi,
  exportMusicXml,
  exportRiff,
  exportWav,
  goHome,
  newProject,
  openFromDisk,
  saveCopy,
  saveProject,
} from '../../files/actions';
import { printScore } from '../../files/print';
import { DocBanner, shareCurrentSong } from '../DocBanner';

const run = (fn: () => unknown) => () => {
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().set({ status: `Error: ${(e as Error).message}` }));
};

function TopBar() {
  const playing = useStore((s) => s.playing);
  const title = useStore((s) => s.song.title);
  useStore((s) => s.historyVersion);
  const st = useStore.getState();
  return (
    <header className="m-top">
      <button className="m-icon" aria-label="All songs" onClick={run(goHome)}>
        ⌂
      </button>
      <button className="m-icon" aria-label="More controls" onClick={() => st.set({ sheet: true })}>
        ☰
      </button>
      <div className="m-title" title={title}>
        {title || 'Untitled'}
      </div>
      <button className="m-icon" aria-label="Undo" disabled={!st.history.canUndo} onClick={st.undo}>
        ↶
      </button>
      <button className="m-icon" aria-label="Redo" disabled={!st.history.canRedo} onClick={st.redo}>
        ↷
      </button>
      <button
        className={'m-play' + (playing ? ' on' : '')}
        onClick={togglePlay}
        aria-label={playing ? 'Stop' : 'Play'}
      >
        {playing ? '■' : '▶'}
      </button>
    </header>
  );
}

function TrackChips() {
  const tracks = useStore((s) => s.song.tracks);
  const trackId = useStore((s) => s.trackId);
  const st = useStore.getState();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [trackId]);
  const add = (type: TrackType) => {
    const count = tracks.filter((t) => t.type === type).length + 1;
    const name = type === 'drums' ? 'Drums' : `${type === 'guitar' ? 'Guitar' : 'Bass'} ${count}`;
    const t = makeTrack(type, name, TRACK_COLORS[tracks.length % TRACK_COLORS.length]);
    st.exec(addTrack(t));
    st.set({ trackId: t.id, selection: new Set(), tabCursor: null });
  };
  return (
    <nav className="m-tracks" ref={ref} aria-label="Tracks">
      {tracks.map((t) => (
        <button
          key={t.id}
          className={'m-chip' + (t.mute ? ' muted' : '')}
          style={{ ['--tc' as string]: t.color }}
          aria-pressed={t.id === trackId}
          onClick={() =>
            st.set({
              trackId: t.id,
              selection: new Set(),
              focusId: null,
              tabCursor: null,
              view: t.type === 'drums' ? 'drums' : st.view === 'drums' ? 'split' : st.view,
            })
          }
        >
          {t.name}
        </button>
      ))}
      <select
        className="m-chip add"
        aria-label="Add track"
        value=""
        onChange={(e) => e.target.value && add(e.target.value as TrackType)}
      >
        <option value="">＋</option>
        <option value="guitar">Guitar</option>
        <option value="bass">Bass</option>
        <option value="drums">Drums</option>
      </select>
    </nav>
  );
}

function BottomNav() {
  const view = useStore((s) => s.view);
  const type = useStore((s) => currentTrack(s)?.type);
  const st = useStore.getState();
  const items: { label: string; view?: MainView; action?: () => void; icon: string }[] = [
    { label: type === 'drums' ? 'Drums' : 'Edit', view: type === 'drums' ? 'drums' : 'split', icon: '▤' },
    ...(type === 'drums' ? [] : [{ label: 'Tab', view: 'tab' as MainView, icon: '≡' }]),
    { label: 'Score', view: 'notation', icon: '♪' },
    ...(type === 'drums' ? [] : [{ label: 'Tones', action: () => st.set({ modal: 'tone' }), icon: '◉' }]),
    { label: 'Mixer', action: () => st.set({ modal: 'mixer' }), icon: '⫶' },
  ];
  return (
    <nav className="m-nav" aria-label="Views">
      {items.map((it) => (
        <button
          key={it.label}
          aria-current={
            it.view && (view === it.view || (it.view === 'split' && view === 'roll')) ? 'page' : undefined
          }
          onClick={() =>
            it.view
              ? st.set({ view: it.view, tabCursor: it.view === 'notation' ? null : st.tabCursor })
              : it.action?.()
          }
        >
          <span aria-hidden="true">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </nav>
  );
}

function Sheet() {
  const open = useStore((s) => s.sheet);
  const pref = useStore((s) => s.layoutPref);
  const access = useStore((s) => s.doc.access);
  const accounts = useStore((s) => s.auth.accounts);
  const st = useStore.getState();
  if (!open) return null;
  const close = () => st.set({ sheet: false });
  const item = (label: string, fn: () => unknown) => (
    <button
      className="m-item"
      onClick={() => {
        close();
        run(fn)();
      }}
    >
      {label}
    </button>
  );
  const section = (title: string, body: ReactNode) => (
    <section className="m-sec">
      <h3>{title}</h3>
      {body}
    </section>
  );
  return (
    <div className="m-sheet-bg" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label="More controls">
        <div className="m-grab" onClick={close} aria-hidden="true" />
        {section(
          'Song',
          <div className="m-items">
            {item('All songs', goHome)}
            {item('New song', newProject)}
            {item('Import file…', openFromDisk)}
            {access !== 'view' && item('Save now', () => saveProject())}
            {item('Save a copy', saveCopy)}
            {accounts && access === 'owner' && item('Share…', shareCurrentSong)}
          </div>,
        )}
        {section('Transport & editing', <Toolbar />)}
        {section('Song structure', <SongBar />)}
        {section('Inputs', <InputControls />)}
        {section(
          'Export',
          <div className="m-items">
            {item('Download .riff', exportRiff)}
            {item('MIDI', exportMidi)}
            {item('MusicXML', exportMusicXml)}
            {item('Guitar Pro 7', exportGuitarPro)}
            {item('WAV', () => exportWav(false))}
            {item('WAV stems', () => exportWav(true))}
            {item('Print / PDF', () => printScore())}
            {item('Copy ASCII tab', copyAsciiTab)}
          </div>,
        )}
        {section(
          'App',
          <div className="m-items">
            {item('Instruments', () => st.set({ modal: 'instruments' }))}
            {item('About & credits', () => st.set({ modal: 'about' }))}
            <label className="field">
              Layout
              <select
                value={pref}
                onChange={(e) => setLayoutPref(e.target.value as 'auto' | 'mobile' | 'desktop')}
              >
                <option value="auto">Automatic</option>
                <option value="mobile">Phone</option>
                <option value="desktop">Desktop</option>
              </select>
            </label>
          </div>,
        )}
        <button className="m-done" onClick={close}>
          Done
        </button>
      </div>
    </div>
  );
}

/** Brief status messages (the desktop status bar doesn't fit on a phone). */
function Toast() {
  const status = useStore((s) => s.status);
  const [shown, setShown] = useState('');
  useEffect(() => {
    if (!status) return;
    setShown(status);
    const id = setTimeout(
      () => setShown(''),
      status.startsWith('Loading') || status.startsWith('Rendering') ? 8000 : 3200,
    );
    return () => clearTimeout(id);
  }, [status]);
  return (
    <div className={'m-toast' + (shown ? ' on' : '')} role="status" aria-live="polite">
      {shown}
    </div>
  );
}

export function MobileApp({ modals }: { modals: ReactNode }) {
  const view = useStore((s) => s.view);
  const type = useStore((s) => currentTrack(s)?.type);
  const tabCursor = useStore((s) => s.tabCursor);
  const editingTab = !!tabCursor && type !== 'drums' && (view === 'split' || view === 'tab');
  return (
    <div className="app mobile">
      <TopBar />
      <TrackChips />
      <DocBanner />
      <main className="main">
        {view === 'notation' ? (
          <NotationView />
        ) : type === 'drums' ? (
          <DrumGrid />
        ) : (
          <>
            {view !== 'tab' && <PianoRoll />}
            <LowerPanel showVelocity={false} showTab />
            {view === 'tab' && <div className="fill" />}
            {editingTab ? <FretPad /> : <Inspector />}
          </>
        )}
      </main>
      <BottomNav />
      <Toast />
      <Sheet />
      {modals}
    </div>
  );
}
