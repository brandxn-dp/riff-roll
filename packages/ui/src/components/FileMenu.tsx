import { useEffect, useRef, useState } from 'react';
import { unpackRiff, updateSong } from '@riffroll/core';
import { useStore } from '../store';
import { Modal } from './Modal';
import {
  copyAsciiTab,
  exportGuitarPro,
  exportMidi,
  exportMusicXml,
  exportRiff,
  exportWav,
  getStorage,
  newProject,
  openFromDisk,
  openProject,
  saveProject,
} from '../files/actions';
import { printScore } from '../files/print';
import { setLayoutPref } from '../device';
import type { ProjectInfo } from '../storage';

const run = (fn: () => unknown) => () => {
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().set({ status: `Error: ${(e as Error).message}` }));
};

export function FileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dirty = useStore((s) => s.dirty);
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
          {item('Open…', () => st.set({ modal: 'files' }), 'Ctrl+O')}
          {item('Import from disk…', openFromDisk)}
          {item('Save', () => saveProject(), 'Ctrl+S')}
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

export function ProjectsDialog() {
  const [list, setList] = useState<ProjectInfo[] | null>(null);
  const [kind, setKind] = useState('');
  const refresh = () =>
    getStorage().then(async (s) => {
      setKind(s.kind);
      const items = await s.list();
      setList(items);
      // read titles from the files themselves (small zips)
      const named = await Promise.all(
        items.map(async (p) => {
          try {
            return { ...p, name: unpackRiff(await s.load(p.id)).song.title };
          } catch {
            return p;
          }
        }),
      );
      setList(named);
    });
  useEffect(() => {
    void refresh();
  }, []);
  const current = useStore((s) => s.song.id);
  return (
    <Modal title="Open song">
      <p className="mute">
        Songs are saved automatically (
        {kind === 'rest'
          ? 'on the server'
          : kind === 'electron'
            ? 'in your app data folder'
            : 'in this browser'}
        ).
      </p>
      <ul className="projects">
        {list?.map((p) => (
          <li key={p.id}>
            <button
              className="pname"
              onClick={run(async () => {
                await openProject(p.id);
                useStore.getState().set({ modal: null });
              })}
            >
              {p.name ?? '…'} {p.id === current.replace(/[^A-Za-z0-9_-]/g, '_') && <em>(open)</em>}
              <small>{new Date(p.updatedAt).toLocaleString()}</small>
            </button>
            <button
              className="ib danger small"
              aria-label="Delete song"
              onClick={run(async () => {
                if (!confirm('Delete this song permanently?')) return;
                await (await getStorage()).remove(p.id);
                await refresh();
              })}
            >
              Delete
            </button>
          </li>
        ))}
        {list && !list.length && <li className="mute">No saved songs yet.</li>}
      </ul>
      <div className="row">
        <button className="ib" onClick={run(openFromDisk)}>
          Import from disk…
        </button>
        <span className="mute">.riff, Guitar Pro 3–8 / GPX, MusicXML, MIDI</span>
      </div>
    </Modal>
  );
}
