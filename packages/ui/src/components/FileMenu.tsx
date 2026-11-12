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
  newProject,
  openFromDisk,
  saveCopy,
  saveProject,
} from '../files/actions';
import { printScore } from '../files/print';
import { setLayoutPref } from '../device';
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
          {item('New song', newProject, 'Ctrl+N')}
          {item('All songs', goHome, 'Ctrl+O')}
          {item('Import from disk…', openFromDisk)}
          {access !== 'view' && item('Save', () => saveProject(), 'Ctrl+S')}
          {item('Save a copy', saveCopy)}
          {accounts && access === 'owner' && item('Share…', shareCurrentSong)}
          <hr />
          {item('Download .riff', exportRiff)}
          {item('Export MIDI', exportMidi)}
          {item('Export MusicXML', exportMusicXml)}
          {item('Export Guitar Pro 7', exportGuitarPro)}
          {item('Export WAV (mix)', () => exportWav(false))}
          {item('Export WAV stems (.zip)', () => exportWav(true))}
          {item('Print / PDF…', printScore, 'Ctrl+P')}
          {item('Copy as ASCII tab', copyAsciiTab, 'Ctrl+Shift+C')}
          <hr />
          {item('Instruments…', () => st.set({ modal: 'instruments' }))}
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
