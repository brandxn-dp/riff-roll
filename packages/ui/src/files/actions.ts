/** File actions shared by the File menu, keyboard shortcuts and the desktop app's native menu. */
import { zipSync } from 'fflate';
import {
  asciiTab,
  midiToSong,
  newId,
  newSong,
  packRiff,
  songToAlphaTex,
  songToMidi,
  songToMusicXml,
  unpackRiff,
  type Song,
  isFretted,
} from '@riffroll/core';
import { audioBufferToWav, gateWorkletUrl, renderSong } from '@riffroll/audio';
import { barMap, currentTrack, initialSong, songEnd, useStore } from '../store';
import { SaveError, detectStorage, type StorageAdapter } from '../storage';
import { clearOpenedLocal, noteLocal } from '../storage/local-meta';
import { stop } from '../transport';
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
/** The most recently opened songs (newest first), as the launch screen shows them. */
export async function recentSongs(limit = 10): Promise<{ id: string; title: string }[]> {
  const s = await getStorage();
  const list = await s.list();
  return list
    .filter((p) => p.openedAt)
    .sort((a, b) => b.openedAt!.localeCompare(a.openedAt!))
    .slice(0, limit)
    .map((p) => ({ id: p.id, title: p.name || 'Untitled' }));
}

/** Desktop: keep File → Open Recent in the native menu up to date. */
export async function syncRecentMenu() {
  const d = desktop();
  if (!d?.projects.setRecent) return;
  try {
    d.projects.setRecent(await recentSongs(10));
  } catch {
    /* the menu just keeps its old list */
  }
}

/** Forget what was opened recently (the songs themselves stay). */
export async function clearRecent() {
  const s = await getStorage();
  if (s.kind === 'rest') return status('Recently opened is kept per account on the server.');
  clearOpenedLocal();
  await syncRecentMenu();
  status('Cleared the recently opened list');
}

/** Desktop: open the folder the songs are saved in. */
export async function openProjectFolder() {
  const d = desktop();
  if (!d?.projects.openFolder) return status('The project folder can be opened from the desktop app.');
  const p = await d.projects.openFolder();
  status(`Opened ${p}`);
}

/** The id a song is stored under. */
export const storeId = (songId: string) => songId.replace(/[^A-Za-z0-9_-]/g, '_');

/** True while a song is being loaded, so loading it doesn't count as an edit to autosave. */
let loading = false;
function load(song: Song, assets: Record<string, Uint8Array> = {}) {
  loading = true;
  try {
    useStore.getState().loadSong(song, assets);
  } finally {
    loading = false;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function cancelPendingSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
}

// saves run one at a time, so each one is based on the version the previous one produced
let saveChain: Promise<unknown> = Promise.resolve();
export function saveProject(song?: Song, opts: { auto?: boolean } = {}): Promise<void> {
  const run = saveChain.then(() => doSave(song ?? useStore.getState().song, opts.auto ?? false));
  saveChain = run.catch(() => {});
  return run;
}

async function doSave(song: Song, auto: boolean) {
  const st = useStore.getState();
  if (st.doc.access === 'view' || st.doc.blocked) {
    if (st.doc.access === 'view' && !st.doc.blocked) st.set({ doc: { ...st.doc, blocked: 'readonly' } });
    if (!auto) status('Not saved: use “Save a copy” to keep your changes.');
    return;
  }
  const s = await getStorage();
  try {
    const r = await s.save(storeId(song.id), packRiff(song, st.assets), {
      title: song.title || 'Untitled',
      baseVersion: st.doc.version,
    });
    const now = useStore.getState();
    if (now.song.id === song.id)
      now.set({ dirty: now.song !== song, doc: { ...now.doc, version: r.version ?? now.doc.version } });
    // the song you're working on counts as recently opened (new songs, imports and the example too)
    if (s.kind !== 'rest' && now.song.id === song.id)
      noteLocal(storeId(song.id), { openedAt: new Date().toISOString(), title: song.title || 'Untitled' });
    if (!auto) status(`Saved “${song.title}”`);
    void syncRecentMenu();
  } catch (e) {
    if (!(e instanceof SaveError)) throw e;
    const now = useStore.getState();
    if (e.code === 'taken') {
      // the id belongs to another user's song (e.g. you imported a copy of their file): keep yours separately
      const own = { ...now.song, id: newId('song') };
      now.set({ doc: { access: 'owner', blocked: null } });
      load(own, now.assets);
      return doSave(own, auto);
    }
    if (e.code === 'conflict') now.set({ doc: { ...now.doc, blocked: 'conflict', conflictBy: e.updatedBy } });
    else if (e.code === 'readonly') now.set({ doc: { ...now.doc, access: 'view', blocked: 'readonly' } });
    status(e.message);
  }
}

export async function openProject(id: string) {
  cancelPendingSave();
  const s = await getStorage();
  const p = await s.load(id);
  const { song, assets } = unpackRiff(p.data);
  // the stored id is the one the store knows; keep the song's own id in step with it
  const fixed = storeId(song.id) === id ? song : { ...song, id };
  useStore.getState().set({
    doc: { access: p.access, version: p.version, owner: p.owner, blocked: null },
    screen: 'editor',
    sheet: false,
  });
  load(fixed, assets);
  useStore.getState().set({ dirty: false });
  if (s.kind !== 'rest') noteLocal(id, { openedAt: new Date().toISOString(), title: fixed.title });
  void syncRecentMenu();
  status(p.access === 'view' ? `Opened “${fixed.title}” (view only)` : `Opened “${fixed.title}”`);
}

export function newProject() {
  cancelPendingSave();
  const song = newSong('Untitled');
  const st = useStore.getState();
  st.set({ doc: { access: 'owner', blocked: null }, screen: 'editor', sheet: false });
  // loading a new song is a change: it gets saved right away and shows up in your songs
  st.loadSong({ ...song, bars: 8 });
  status('New song');
}

/** The example riff as a new song of yours. */
export function openExample() {
  cancelPendingSave();
  const st = useStore.getState();
  st.set({ doc: { access: 'owner', blocked: null }, screen: 'editor', sheet: false });
  st.loadSong({ ...initialSong(), id: newId('song'), title: 'Example riff' });
  status('Example riff: it’s your own song now, edit away');
}

/** Keep your changes to a song you can't save (view-only, or someone else saved first) as your own song. */
export async function saveCopy() {
  cancelPendingSave();
  const st = useStore.getState();
  const song = { ...st.song, id: newId('song'), title: `${st.song.title || 'Untitled'} (copy)` };
  st.set({ doc: { access: 'owner', blocked: null } });
  load(song, st.assets);
  await saveProject(song);
  status(`Saved a copy: “${song.title}”`);
}

/** Throw away local changes and open the stored version again (after a save conflict). */
export async function reopenProject() {
  await openProject(storeId(useStore.getState().song.id));
}

/** Save anything still waiting for autosave, and wait for saves in flight (before signing out). */
export async function flushSaves() {
  if (saveTimer) {
    cancelPendingSave();
    await saveProject(undefined, { auto: true }).catch(() => {});
  }
  await saveChain;
}

/** Signed out: forget the previous user's song (nothing of theirs stays in memory for the next person). */
export function clearEditor() {
  cancelPendingSave();
  useStore.getState().set({ doc: { access: 'owner', blocked: null }, dirty: false });
  load(initialSong());
}

/** Back to the launch screen; anything unsaved is saved first. */
export async function goHome() {
  const st = useStore.getState();
  if (st.playing) stop();
  if (saveTimer) {
    cancelPendingSave();
    await saveProject(undefined, { auto: true }).catch(() => {});
  }
  useStore.getState().set({ screen: 'home', modal: null, sheet: false });
}

/** Autosave + crash recovery: every change is saved to the project store shortly after you stop editing. */
export function installAutosave() {
  return useStore.subscribe((s, prev) => {
    if (s.song === prev.song || loading || s.screen !== 'editor') return;
    if (!s.dirty) useStore.getState().set({ dirty: true });
    cancelPendingSave();
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveProject(undefined, { auto: true }).catch((e) => status(`Autosave failed: ${(e as Error).message}`));
    }, 1500);
  });
}

// ---------------- import ----------------
export async function importBytes(name: string, bytes: Uint8Array) {
  const lower = name.toLowerCase();
  let song: Song;
  let warnings: string[] = [];
  let assets: Record<string, Uint8Array> = {};
  if (lower.endsWith('.riff')) {
    const f = unpackRiff(bytes);
    song = f.song;
    assets = f.assets;
  } else if (/\.midi?$/.test(lower)) {
    song = midiToSong(bytes, name.replace(/\.midi?$/i, ''));
  } else {
    // Guitar Pro 3-8, GPX, MusicXML (.xml/.musicxml/.mxl)
    ({ song, warnings } = importScoreBytes(bytes));
    if (!song.title || song.title === 'Imported') song.title = name.replace(/\.[^.]+$/, '');
  }
  // an import is always a new song of yours (importing the same .riff twice gives two songs)
  song = { ...song, id: newId('song') };
  cancelPendingSave();
  useStore.getState().set({ doc: { access: 'owner', blocked: null }, screen: 'editor', sheet: false });
  load(song, assets);
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
  saveFile(
    `${base()}.riff`,
    packRiff(useStore.getState().song, useStore.getState().assets),
    'application/x-riffroll',
  );
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
  const opts = {
    gateWorkletUrl,
    userIRs: e.userIRs,
    onProgress: (f: number) => status(`Rendering… ${Math.round(f * 100)}%`),
  };
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
  if (!t || !isFretted(t.type)) return status('ASCII tab works on guitar and bass tracks.');
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
