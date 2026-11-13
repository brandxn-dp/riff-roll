/**
 * User preferences: appearance, audio output, editor defaults and key bindings. Kept per device in
 * localStorage (they describe this screen, speakers and keyboard, not the song or the account).
 */
import { create } from 'zustand';
import { PPQ } from '@riffroll/core';

export type ThemeId = 'system' | 'studio' | 'midnight' | 'ember' | 'contrast' | 'light' | 'paper';
export type AccentId = 'blue' | 'teal' | 'green' | 'amber' | 'rose' | 'violet';
export type Latency = 'interactive' | 'balanced' | 'playback';

export interface Settings {
  theme: ThemeId;
  accent: AccentId;
  /** notation: follow the theme, or always black on white paper */
  notationPaper: 'theme' | 'light';
  /** desktop app interface size in percent */
  uiScale: number;
  followPlayhead: boolean;
  /** play notes as you place, select or move them */
  previewNotes: boolean;
  /** grid and note length a session starts with (ticks at 960 PPQ) */
  defaultSnap: number;
  defaultNoteLen: number;
  snapScale: boolean;
  /** remember whether the global view and the edit palette are open */
  globalView: boolean;
  palette: boolean;
  audio: {
    latency: Latency;
    /** 0 = what the device uses */
    sampleRate: number;
    /** '' = the system default output */
    sinkId: string;
  };
  /** key binding overrides: action id → key combos (see keymap.ts) */
  keys: Record<string, string[]>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'studio',
  accent: 'blue',
  notationPaper: 'theme',
  uiScale: 100,
  followPlayhead: true,
  previewNotes: true,
  defaultSnap: PPQ / 4,
  defaultNoteLen: PPQ / 2,
  snapScale: false,
  globalView: true,
  palette: true,
  audio: { latency: 'interactive', sampleRate: 0, sinkId: '' },
  keys: {},
};

const KEY = 'riffroll.settings';

function read(): Settings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...v,
      audio: { ...DEFAULT_SETTINGS.audio, ...(v.audio ?? {}) },
      keys: { ...(v.keys ?? {}) },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

interface SettingsState extends Settings {
  update(p: Partial<Settings>): void;
  updateAudio(p: Partial<Settings['audio']>): void;
  reset(part?: 'all' | 'keys' | 'appearance' | 'audio' | 'editor'): void;
}

const pick = (s: SettingsState): Settings => {
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_SETTINGS)) out[k] = s[k as keyof Settings];
  return out as unknown as Settings;
};

export const useSettings = create<SettingsState>((set, get) => {
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(pick(get())));
    } catch {
      /* storage blocked: lasts for this session */
    }
  };
  return {
    ...read(),
    update: (p) => {
      set(p);
      save();
    },
    updateAudio: (p) => {
      set({ audio: { ...get().audio, ...p } });
      save();
    },
    reset: (part = 'all') => {
      const d = DEFAULT_SETTINGS;
      if (part === 'all') set({ ...d, audio: { ...d.audio }, keys: {} });
      else if (part === 'keys') set({ keys: {} });
      else if (part === 'audio') set({ audio: { ...d.audio } });
      else if (part === 'appearance')
        set({ theme: d.theme, accent: d.accent, notationPaper: d.notationPaper, uiScale: d.uiScale });
      else
        set({
          followPlayhead: d.followPlayhead,
          previewNotes: d.previewNotes,
          defaultSnap: d.defaultSnap,
          defaultNoteLen: d.defaultNoteLen,
          snapScale: d.snapScale,
        });
      save();
    },
  };
});

export const settings = () => useSettings.getState();
