import { useEffect, useRef, useState } from 'react';
import { updateSong } from '@riffroll/core';
import { useStore } from '../store';
import {
  copyAsciiTab,
  exportGuitarPro,
  exportMidi,
  exportMusicXml,
  exportRiff,
  exportWav,
  goHome,
  openProject,
  openProjectFolder,
  recentSongs,
  newProject,
  openFromDisk,
  saveCopy,
  saveProject,
} from '../files/actions';
import { printScore } from '../files/print';
import { setLayoutPref } from '../device';
import { keyHint } from '../keymap';
import { shareCurrentSong } from './DocBanner';

const run = (fn: () => unknown) => () => {
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().set({ status: `Error: ${(e as Error).message}` }));
};

export function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dirty = useStore((s) => s.dirty);
  const access = useStore((s) => s.doc.access);
  const accounts = useStore((s) => s.auth.accounts);
  const st = useStore.getState();
  const [recent, setRecent] = useState<{ id: string; title: string }[]>([]);
  useEffect(() => {
    if (open)
      void recentSongs(5)
        .then(setRecent)
        .catch(() => setRecent([]));
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const item = (label: string, fn: () => unknown, hint?: string) => (
    <button
      role="menuitem"
      onClick={() => {
        setOpen(false);
        run(fn)();
      }}
    >
      <span>{label}</span>
      {hint && <kbd>{hint}</kbd>}
    </button>
  );
  return (
    <div className="filemenu" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        File{dirty ? ' •' : ''} ▾
      </button>
      {open && (
        <div className="menu" role="menu">
          {item('New song', newProject, keyHint('new'))}
          {item('All songs', goHome, keyHint('home'))}
          {recent.length > 0 && (
            <>
              <div className="menu-label">Open recent</div>
              {recent.map((r) => (
                <button
                  key={r.id}
                  role="menuitem"
                  className="recent-item"
                  onClick={() => {
                    setOpen(false);
                    run(() => openProject(r.id))();
                  }}
                >
                  <span>{r.title}</span>
                </button>
              ))}
              <hr />
            </>
          )}
          {item('Import from disk…', openFromDisk)}
          {window.riffroll && item('Open project folder', openProjectFolder)}
          {access !== 'view' && item('Save', () => saveProject(), keyHint('save'))}
          {item('Save a copy', saveCopy)}
          {accounts && access === 'owner' && item('Share…', shareCurrentSong)}
          <hr />
          {item('Download .riff', exportRiff)}
          {item('Export MIDI', exportMidi)}
          {item('Export MusicXML', exportMusicXml)}
          {item('Export Guitar Pro 7', exportGuitarPro)}
          {item('Export WAV (mix)', () => exportWav(false))}
          {item('Export WAV stems (.zip)', () => exportWav(true))}
          {item('Print / PDF…', printScore, keyHint('print'))}
          {item('Copy as ASCII tab', copyAsciiTab, keyHint('ascii'))}
          <hr />
          {item('Instruments…', () => st.set({ modal: 'instruments' }))}
          {item('Settings…', () => st.set({ modal: 'settings' }), keyHint('settings'))}
          {item('Phone layout', () => setLayoutPref('mobile'))}
          {item('About & credits', () => st.set({ modal: 'about' }))}
        </div>
      )}
    </div>
  );
}

export function SongTitle() {
  const song = useStore((s) => s.song);
  return (
    <input
      className="songtitle"
      aria-label="Song title"
      value={song.title}
      onChange={(e) => useStore.getState().exec(updateSong({ title: e.target.value }, 'Rename song'))}
    />
  );
}
