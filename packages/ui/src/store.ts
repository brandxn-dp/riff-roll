import { create } from 'zustand';
import type { PublicUser } from './account';
import type { Access } from './storage/types';
import {
  BarMap,
  History,
  PPQ,
  exampleBass,
  exampleBeat,
  exampleRiff,
  newSong,
  type Command,
  type Id,
  type Song,
  type Track,
} from '@riffroll/core';

export type MainView = 'split' | 'roll' | 'tab' | 'notation' | 'drums';

export const SNAPS: { label: string; ticks: number }[] = [
  { label: '1/4', ticks: PPQ },
  { label: '1/8', ticks: PPQ / 2 },
  { label: '1/16', ticks: PPQ / 4 },
  { label: '1/32', ticks: PPQ / 8 },
  { label: '1/64', ticks: PPQ / 16 },
  { label: '1/4T', ticks: (PPQ * 2) / 3 },
  { label: '1/8T', ticks: PPQ / 3 },
  { label: '1/16T', ticks: PPQ / 6 },
  { label: 'Off', ticks: 1 },
];

/** Horizontal zoom: pixels per 1/16 note. */
export const ZOOMS = [8, 12, 18, 24, 32, 44, 56, 72];
/** Vertical zoom: row height factor for the piano roll and the drum grid. */
export const ZOOMS_Y = [0.6, 0.75, 1, 1.25, 1.5, 2, 2.5];

export interface UiState {
  song: Song;
  history: History;
  /** bump to re-render things that depend on history (undo labels) */
  historyVersion: number;
  trackId: Id;
  selection: ReadonlySet<Id>;
  /** note under the tab cursor / last clicked */
  focusId: Id | null;
  view: MainView;
  zoom: number;
  /** index into ZOOMS_Y */
  zoomY: number;
  snap: number; // ticks
  noteLen: number; // ticks, last-used length for new notes
  scrollX: number;
  playing: boolean;
  playhead: number | null; // tick while playing
  cursor: number; // playback start / paste position (tick)
  speed: number; // playback speed 0.5..1.5 (pitch unaffected)
  /** keyboard tab-entry cursor (Guitar Pro style); null = not in tab entry */
  tabCursor: { tick: number; string: number } | null;
  status: string;
  /** unsaved changes since the last (auto)save */
  dirty: boolean;
  /** 'mobile' = phone layout (see device.ts) */
  layout: 'mobile' | 'desktop';
  layoutPref: 'auto' | 'mobile' | 'desktop';
  /** mobile: the bottom sheet with all controls is open */
  sheet: boolean;
  /** MIDI input state (Web MIDI) */
  midi: {
    inputs: { id: string; name: string }[];
    inputId: string | null;
    armed: boolean;
    quantize: boolean;
    guitarChannels: boolean;
  };
  /** user files stored inside the .riff (impulse responses) */
  assets: Record<string, Uint8Array>;
  modal:
    | null
    | 'shortcuts'
    | 'about'
    | 'tone'
    | 'mixer'
    | 'instruments'
    | 'share'
    | 'users'
    | 'account'
    | 'velocity';
  /** sign-in screen, launch screen (recent + all songs), or the editor */
  screen: 'loading' | 'signin' | 'home' | 'editor';
  /** server accounts: whether the server has them, first-run setup, open sign-up */
  auth: { accounts: boolean; setupNeeded: boolean; signup: boolean };
  user: PublicUser | null;
  /** the open song as stored: your access, the version it is based on, and why saving stopped (if it did) */
  doc: {
    access: Access;
    version?: number;
    owner?: string;
    blocked: null | 'readonly' | 'conflict';
    conflictBy?: string;
  };
  /** song the share dialog is for */
  shareTarget: { id: string; title: string } | null;

  exec(cmd: Command): void;
  begin(label: string): void;
  commit(): void;
  cancel(): void;
  undo(): void;
  redo(): void;
  loadSong(song: Song, assets?: Record<string, Uint8Array>): void;
  set(p: Partial<UiState>): void;
  select(ids: Iterable<Id>, focus?: Id | null): void;
}

/** The example song (also what the editor holds before anything is opened). */
export function initialSong(): Song {
  const s = newSong('Untitled');
  // start with the prototype's example riff on Guitar 1 so the app is never empty on first launch
  return {
    ...s,
    bars: 4,
    tracks: s.tracks.map((t, i) =>
      i === 0 ? exampleBeat(t) : i === 1 ? exampleRiff(t) : i === 3 ? exampleBass(t) : t,
    ),
  };
}

export const useStore = create<UiState>((set, get) => {
  const song = initialSong();
  const history = new History(song);
  history.subscribe((s) => set((st) => ({ song: s, historyVersion: st.historyVersion + 1 })));
  return {
    song,
    history,
    historyVersion: 0,
    trackId: song.tracks[1].id,
    selection: new Set(),
    focusId: null,
    view: 'split',
    zoom: 4,
    zoomY: 2,
    snap: PPQ / 4,
    noteLen: PPQ / 2,
    scrollX: 0,
    playing: false,
    playhead: null,
    cursor: 0,
    speed: 1,
    tabCursor: null,
    status: '',
    dirty: false,
    assets: {},
    layout: 'desktop',
    layoutPref: 'auto',
    sheet: false,
    midi: { inputs: [], inputId: null, armed: false, quantize: true, guitarChannels: false },
    modal: null,
    screen: 'loading',
    auth: { accounts: false, setupNeeded: false, signup: false },
    user: null,
    doc: { access: 'owner', blocked: null },
    shareTarget: null,
    exec: (cmd) => get().history.execute(cmd),
    begin: (label) => get().history.begin(label),
    commit: () => {
      get().history.commit();
      set((st) => ({ historyVersion: st.historyVersion + 1 }));
    },
    cancel: () => get().history.cancel(),
    undo: () => {
      get().history.undo();
      pruneSelection();
    },
    redo: () => {
      get().history.redo();
      pruneSelection();
    },
    loadSong: (s, assets = {}) => {
      set({ assets });
      get().history.reset(s);
      const t = s.tracks.find((x) => x.type !== 'drums') ?? s.tracks[0];
      set({
        trackId: t?.id ?? '',
        selection: new Set(),
        focusId: null,
        cursor: 0,
        scrollX: 0,
        tabCursor: null,
      });
    },
    set: (p) => set(p),
    select: (ids, focus) => {
      const selection = new Set(ids);
      set({
        selection,
        focusId: focus !== undefined ? focus : selection.size === 1 ? [...selection][0] : null,
      });
    },
  };
});

// dev/test hook: lets automated checks read and drive the store
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__rr = useStore;

/** Drop selected ids that no longer exist (after undo/redo/delete). */
function pruneSelection() {
  const st = useStore.getState();
  const t = currentTrack(st);
  if (!t) return;
  const ids = new Set([...t.notes.map((n) => n.id), ...t.hits.map((h) => h.id)]);
  const sel = [...st.selection].filter((id) => ids.has(id));
  if (sel.length !== st.selection.size) st.select(sel);
}

export function currentTrack(st: Pick<UiState, 'song' | 'trackId'> = useStore.getState()): Track | undefined {
  return st.song.tracks.find((t) => t.id === st.trackId);
}

const barMaps = new WeakMap<Song['timeSigs'], BarMap>();
export function barMap(song: Song): BarMap {
  let m = barMaps.get(song.timeSigs);
  if (!m) barMaps.set(song.timeSigs, (m = new BarMap(song.timeSigs, song.ppq)));
  return m;
}

export function songEnd(song: Song): number {
  return barMap(song).barStart(song.bars);
}
