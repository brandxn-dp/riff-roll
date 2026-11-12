/** File actions shared by the File menu, keyboard shortcuts and the desktop app's native menu. */
import { zipSync } from 'fflate';
import {
  asciiTab,
  midiToSong,
  newSong,
  packRiff,
  songToAlphaTex,
  songToMidi,
  songToMusicXml,
  unpackRiff,
  type Song,
} from '@riffroll/core';
import { audioBufferToWav, gateWorkletUrl, renderSong } from '@riffroll/audio';
import { barMap, currentTrack, songEnd, useStore } from '../store';
import { detectStorage, type StorageAdapter } from '../storage';
import { ensureEngine } from '../audio-setup';
import { exportGp7, importScoreBytes } from './importScore';
import type { RiffRollBridge } from '../storage/electron';

type DesktopBridge = RiffRollBridge & {
  dialogs: {
    open(): Promise<{ path: string; name: string; data: Uint8Array } | null>;
    save(name: string, data: Uint8Array, ext: string): Promise<string | null>;
  };
  readPath(p: string): Promise<{ path: string; name: string; data: Uint8Array }>;
  onMenuCommand(fn: (cmd: string) => void): () => void;
  onOpenPath(fn: (p: string) => void): () => void;
};
const desktop = (): DesktopBridge | undefined => window.riffroll as DesktopBridge | undefined;

let storage: StorageAdapter | null = null;
export async function getStorage() {
  return (storage ??= await detectStorage());
}

const status = (msg: string) => useStore.getState().set({ status: msg });
const safeName = (s: string) =>
  (s || 'untitled')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase() || 'untitled';

/** Save a file: native dialog on desktop, browser download on the web. */
export async function saveFile(name: string, data: Uint8Array | string, mime: string) {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  const d = desktop();
  if (d) {
    const ext = name.split('.').pop() ?? '';
    const p = await d.dialogs.save(name, bytes, ext);
    if (p) status(`Saved ${p}`);
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  status(`Downloaded ${name}`);
}

// ---------------- projects ----------------
export async function saveProject(song = useStore.getState().song) {
  const s = await getStorage();
  await s.save(song.id.replace(/[^A-Za-z0-9_-]/g, '_'), packRiff(song));
  useStore.getState().set({ dirty: false, status: `Saved “${song.title}”` });
}

export async function openProject(id: string) {
  const s = await getStorage();
  const { song } = unpackRiff(await s.load(id));
  useStore.getState().loadSong(song);
  status(`Opened “${song.title}”`);
}

export function newProject() {
  const song = newSong('Untitled');
  useStore.getState().loadSong({ ...song, bars: 8 });
  status('New song');
}

/** Autosave + crash recovery: every change is saved to the project store shortly after you stop editing. */
export function installAutosave() {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return useStore.subscribe((s, prev) => {
    if (s.song === prev.song) return;
    if (!s.dirty) useStore.getState().set({ dirty: true });
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      saveProject(useStore.getState().song).catch((e) => status(`Autosave failed: ${(e as Error).message}`));
    }, 1500);
  });
}

/** On startup reopen the most recently edited project (this is also the crash recovery). */
export async function restoreLastSession(): Promise<boolean> {
  try {
    const s = await getStorage();
    const list = await s.list();
    if (!list.length) return false;
    await openProject(list[0].id);
    status(
      `Restored “${useStore.getState().song.title}” (autosaved ${new Date(list[0].updatedAt).toLocaleString()})`,
    );
    return true;
  } catch {
    return false;
  }
}

// ---------------- import ----------------
export async function importBytes(name: string, bytes: Uint8Array) {
  const lower = name.toLowerCase();
  let song: Song;
  let warnings: string[] = [];
  if (lower.endsWith('.riff')) {
    song = unpackRiff(bytes).song;
  } else if (/\.midi?$/.test(lower)) {
    song = midiToSong(bytes, name.replace(/\.midi?$/i, ''));
  } else {
    // Guitar Pro 3-8, GPX, MusicXML (.xml/.musicxml/.mxl)
    ({ song, warnings } = importScoreBytes(bytes));
    if (!song.title || song.title === 'Imported') song.title = name.replace(/\.[^.]+$/, '');
  }
  useStore.getState().loadSong(song);
  await saveProject(song);
  status(`Imported ${name}${warnings.length ? ` — ${warnings.join('; ')}` : ''}`);
}

export async function openFromDisk() {
  const d = desktop();
  if (d) {
    const r = await d.dialogs.open();
    if (r) await importBytes(r.name, r.data);
    return;
  }
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.riff,.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.gp8,.xml,.musicxml,.mxl,.mid,.midi';
  input.onchange = async () => {
    const f = input.files?.[0];
    if (!f) return;
    try {
      await importBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    } catch (e) {
      status(`Could not open ${f.name}: ${(e as Error).message}`);
    }
  };
  input.click();
}

// ---------------- export ----------------
const base = () => safeName(useStore.getState().song.title);

export const exportRiff = () =>
  saveFile(`${base()}.riff`, packRiff(useStore.getState().song), 'application/x-riffroll');
export const exportMidi = () => saveFile(`${base()}.mid`, songToMidi(useStore.getState().song), 'audio/midi');
export const exportMusicXml = () =>
  saveFile(
    `${base()}.musicxml`,
    songToMusicXml(useStore.getState().song),
    'application/vnd.recordare.musicxml+xml',
  );
export const exportGuitarPro = () =>
  saveFile(
    `${base()}.gp`,
    exportGp7(songToAlphaTex(useStore.getState().song).tex),
    'application/octet-stream',
  );

export async function exportWav(stems = false) {
  const song = useStore.getState().song;
  const e = await ensureEngine();
  const opts = { gateWorkletUrl, onProgress: (f: number) => status(`Rendering… ${Math.round(f * 100)}%`) };
  if (!stems) {
    const buf = await renderSong(song, e.lib, opts);
    await saveFile(`${base()}.wav`, audioBufferToWav(buf, 24), 'audio/wav');
    return;
  }
  const files: Record<string, Uint8Array> = {};
  for (const t of song.tracks) {
    if (!t.notes.length && !t.hits.length) continue;
    status(`Rendering stem: ${t.name}…`);
    const buf = await renderSong(song, e.lib, { ...opts, onlyTrack: t.id });
    files[`${base()} - ${safeName(t.name)}.wav`] = audioBufferToWav(buf, 24);
  }
  await saveFile(`${base()}-stems.zip`, zipSync(files, { level: 0 }), 'application/zip');
}

/** Copy the selection (or the bar at the cursor) as ASCII tab. */
export async function copyAsciiTab() {
  const st = useStore.getState();
  const t = currentTrack(st);
  if (!t || t.type === 'drums') return status('ASCII tab works on guitar and bass tracks.');
  const sel = t.notes.filter((n) => st.selection.has(n.id));
  const bm = barMap(st.song);
  let from: number, to: number;
  if (sel.length) {
    from = bm.barAtTick(Math.min(...sel.map((n) => n.start))).start;
    const last = bm.barAtTick(Math.max(...sel.map((n) => n.start)));
    to = last.start + last.length;
  } else {
    const b = bm.barAtTick(st.cursor);
    from = b.start;
    to = Math.min(songEnd(st.song), b.start + b.length * 4);
  }
  const txt = asciiTab(st.song, t, { from, to });
  await navigator.clipboard.writeText(txt);
  status('ASCII tab copied to the clipboard');
}
