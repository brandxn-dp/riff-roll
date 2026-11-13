/**
 * Note colour palettes: string colours (piano roll notes, tab numbers, the string legend), drum colours and the
 * colours new tracks get. A palette is 8 string colours, low-to-high roles -2..5 (8th string, 7th string, then
 * low E A D G B high e); drums and track colours are taken from the same 8 so everything matches.
 */
import {
  ROLE_COLORS,
  TRACK_COLORS,
  isFretted,
  stringColor,
  type DrumPiece,
  type Note,
  type Track,
} from '@riffroll/core';
import { COL } from './canvas';
import { settings } from './settings';

export type NoteColorMode = 'string' | 'track' | 'velocity' | 'pitch';

export interface NotePalette {
  label: string;
  /** roles -2..5: 8th string, 7th string, E A D G B e */
  strings: string[];
  /** explicit track colours (otherwise taken from the strings) */
  tracks?: string[];
}

export const NOTE_PALETTES: Record<string, NotePalette> = {
  classic: {
    label: 'Classic',
    strings: ['#c8935a', '#ff6fb5', '#ff5a5a', '#ff9a3c', '#f3cf48', '#5fd17c', '#47bfee', '#b38bff'],
    tracks: ['#e8365d', '#47bfee', '#f3cf48', '#5fd17c', '#ff9a3c', '#b38bff', '#ff6fb5', '#8aa4c8'],
  },
  pastel: {
    label: 'Pastel',
    strings: ['#d9b48f', '#f4a6cd', '#f28b8b', '#f6b37f', '#f2dc8b', '#9bdcaa', '#8fd0ee', '#c7b2f5'],
  },
  neon: {
    label: 'Neon',
    strings: ['#ffb000', '#ff2bd6', '#ff3355', '#ff8c00', '#ffe600', '#39ff14', '#00e5ff', '#a64dff'],
  },
  colorblind: {
    label: 'Colour-blind safe',
    // Okabe & Ito
    strings: ['#999999', '#0072b2', '#d55e00', '#e69f00', '#f0e442', '#009e73', '#56b4e9', '#cc79a7'],
  },
  ocean: {
    label: 'Ocean',
    strings: ['#94a3b8', '#818cf8', '#4c7fd1', '#4aa3df', '#3cc6c0', '#6ee7b7', '#a5d8ff', '#c4b5fd'],
  },
  sunset: {
    label: 'Sunset',
    strings: ['#b08968', '#e0607e', '#ff4d6d', '#ff7a45', '#ffb347', '#ffd166', '#f7a8b8', '#c77dff'],
  },
  mono: {
    label: 'One colour',
    strings: ['#3b5bdb', '#4263eb', '#4c6ef5', '#5c7cfa', '#748ffc', '#91a7ff', '#a5b4fc', '#c5d0fc'],
  },
};

/** Role names, in palette order, for the custom palette editor. */
export const ROLE_LABELS = ['8th string', '7th string', 'Low E', 'A', 'D', 'G', 'B', 'High e'];

/** Drum colours, read by the drum grid every frame. */
export const DRUM_COL: Record<DrumPiece, string> = {
  kick: '#ff5a5a',
  snare: '#ff9a3c',
  hihat: '#47bfee',
  ride: '#f3cf48',
  crash1: '#f3cf48',
  crash2: '#f3cf48',
  china: '#f3cf48',
  splash: '#f3cf48',
  tom1: '#5fd17c',
  tom2: '#5fd17c',
  tom3: '#5fd17c',
  tom4: '#5fd17c',
};

/** The palette in use (a preset, or the custom colours). */
export function currentPalette(): NotePalette {
  const s = settings();
  if (s.notePalette === 'custom' && s.customStrings.length === 8)
    return { label: 'Custom', strings: s.customStrings };
  return NOTE_PALETTES[s.notePalette] ?? NOTE_PALETTES.classic;
}

/** Track colours for a palette: kept for Classic, otherwise drawn from the string colours. */
export function trackColors(p: NotePalette = currentPalette()): string[] {
  const s = p.strings;
  return p.tracks ?? [s[2], s[6], s[4], s[5], s[3], s[7], s[1], s[0]];
}

/** Put the palette into the shared colour tables (string roles, drums, colours for new tracks). */
export function applyPalette() {
  const p = currentPalette();
  p.strings.forEach((c, i) => (ROLE_COLORS[i - 2] = c));
  const [, , kick, snare, cym, tom, hat] = p.strings;
  Object.assign(DRUM_COL, {
    kick,
    snare,
    hihat: hat,
    ride: cym,
    crash1: cym,
    crash2: cym,
    china: cym,
    splash: cym,
    tom1: tom,
    tom2: tom,
    tom3: tom,
    tom4: tom,
  });
  TRACK_COLORS.splice(0, TRACK_COLORS.length, ...trackColors(p));
}

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = (rgb: number[]) => '#' + rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mixHex = (a: string, b: string, t: number) => {
  const x = hex(a),
    y = hex(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
};
function hsl(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return toHex([f(0), f(8), f(4)]);
}
/** C red round the colour wheel to B. */
const PITCH_COLORS = Array.from({ length: 12 }, (_, i) => hsl(i * 30, 0.78, 0.62));

/** Soft → loud, from the palette's cool string colours to its hot ones. */
function velocityColor(v: number): string {
  const s = currentPalette().strings;
  const t = Math.max(0, Math.min(1, (v - 1) / 126));
  return t < 0.5 ? mixHex(s[6], s[4], t * 2) : mixHex(s[4], s[2], (t - 0.5) * 2);
}

/**
 * The fill of a piano roll note under the chosen colouring (Settings → Appearance). `string` is the fingering
 * engine's string for fretted tracks (undefined = no string reaches it).
 */
export function noteFill(t: Track, n: Note, string: number | undefined): string {
  const mode = settings().noteColors;
  if (mode === 'track') return t.color;
  if (mode === 'velocity') return velocityColor(n.velocity);
  if (mode === 'pitch') return PITCH_COLORS[((n.pitch % 12) + 12) % 12];
  if (!isFretted(t.type)) return t.color;
  return string != null ? stringColor(t.type, t.tuning.strings.length, string) : COL.unplayable;
}

/** For the settings preview. */
export const pitchColors = () => PITCH_COLORS;
