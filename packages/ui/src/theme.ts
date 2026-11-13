/**
 * Colour themes. One palette drives both the CSS variables (the chrome) and COL (the canvas editors), so the
 * piano roll, tab and drum grid follow the theme too. Track and string colours stay as they are: they are
 * the song's colours, not the app's.
 */
import { COL } from './canvas';
import { useStore } from './store';
import { useSettings, type AccentId, type ThemeId } from './settings';

interface Palette {
  label: string;
  dark: boolean;
  bg: string;
  panel: string;
  raise: string;
  line: string;
  lineHi: string;
  ink: string;
  mute: string;
  clean: string;
  dist: string;
  warn: string;
}

export const THEMES: Record<Exclude<ThemeId, 'system'>, Palette> = {
  studio: {
    label: 'Studio (dark)',
    dark: true,
    bg: '#121419',
    panel: '#1b1e25',
    raise: '#262a33',
    line: '#343a46',
    lineHi: '#4a5262',
    ink: '#e6e8ee',
    mute: '#8a91a0',
    clean: '#8aa4c8',
    dist: '#e8365d',
    warn: '#ffb15c',
  },
  midnight: {
    label: 'Midnight',
    dark: true,
    bg: '#0b1018',
    panel: '#121a26',
    raise: '#1b2535',
    line: '#273449',
    lineHi: '#3a4b66',
    ink: '#e4ecf7',
    mute: '#8796ad',
    clean: '#7fa7dc',
    dist: '#f04870',
    warn: '#ffb15c',
  },
  ember: {
    label: 'Ember (warm dark)',
    dark: true,
    bg: '#161210',
    panel: '#201a17',
    raise: '#2c2420',
    line: '#3d332d',
    lineHi: '#56483f',
    ink: '#f1e8df',
    mute: '#a8998c',
    clean: '#c8ad8a',
    dist: '#ec5a3c',
    warn: '#ffc061',
  },
  contrast: {
    label: 'High contrast',
    dark: true,
    bg: '#000000',
    panel: '#0b0b0b',
    raise: '#1c1c1c',
    line: '#6a6a6a',
    lineHi: '#9a9a9a',
    ink: '#ffffff',
    mute: '#d0d0d0',
    clean: '#9cc4ff',
    dist: '#ff4d6d',
    warn: '#ffd166',
  },
  light: {
    label: 'Light',
    dark: false,
    bg: '#eef0f3',
    panel: '#ffffff',
    raise: '#e4e7ec',
    line: '#c9ced6',
    lineHi: '#a9b0bb',
    ink: '#161a21',
    mute: '#5a6270',
    clean: '#3f6aa6',
    dist: '#d0234b',
    warn: '#b8650a',
  },
  paper: {
    label: 'Paper (warm light)',
    dark: false,
    bg: '#f1ece2',
    panel: '#fbf8f2',
    raise: '#e7e0d3',
    line: '#d3c9b7',
    lineHi: '#b4a891',
    ink: '#2a241c',
    mute: '#6e6455',
    clean: '#55709a',
    dist: '#c2362f',
    warn: '#a8600c',
  },
};

export const ACCENTS: Record<AccentId, { label: string; color: string }> = {
  blue: { label: 'Blue', color: '#5b8fe8' },
  teal: { label: 'Teal', color: '#22a99b' },
  green: { label: 'Green', color: '#43b562' },
  amber: { label: 'Amber', color: '#e09a2b' },
  rose: { label: 'Rose', color: '#e2557e' },
  violet: { label: 'Violet', color: '#9479e6' },
};

const hex = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
/** a → b by t (0..1), as #rrggbb */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a),
    y = hex(b);
  return (
    '#' +
    x
      .map((v, i) =>
        Math.round(v + (y[i] - v) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const rgba = (c: string, a: number) => `rgba(${hex(c).join(',')},${a})`;

export function resolveTheme(id: ThemeId = useSettings.getState().theme): Palette {
  if (id !== 'system') return THEMES[id];
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;
  return dark ? THEMES.studio : THEMES.light;
}

/** The current theme is a dark one (notation colours, colour-scheme). */
export const isDark = () => resolveTheme().dark;

export function applyTheme() {
  const s = useSettings.getState();
  const p = resolveTheme(s.theme);
  const accent = ACCENTS[s.accent].color;
  const d = p.dark;

  // ---- canvas colours (mutated in place: the editors read COL on every frame)
  const rowW = d ? mix(p.bg, p.panel, 0.7) : p.panel;
  Object.assign(COL, {
    bg: p.bg,
    panel: p.panel,
    raise: p.raise,
    line: p.line,
    rowW,
    rowB: d ? mix(p.bg, p.panel, 0.4) : mix(p.bg, p.ink, 0.035),
    rowLine: mix(rowW, p.line, d ? 0.25 : 0.45),
    cLine: d ? p.line : p.lineHi,
    step: mix(rowW, p.line, d ? 0.25 : 0.45),
    beat: mix(rowW, p.line, d ? 0.6 : 0.85),
    bar: d ? p.lineHi : mix(p.lineHi, p.ink, 0.35),
    ink: p.ink,
    mute: p.mute,
    clean: p.clean,
    dist: p.dist,
    tabLine: d ? mix(p.line, p.lineHi, 0.3) : p.lineHi,
    head: d ? '#ffffff' : p.ink,
    unplayable: mix(p.panel, p.mute, 0.4),
    select: rgba(accent, d ? 0.18 : 0.16),
    selectLine: rgba(accent, 0.85),
    laneHi: mix(rowW, accent, d ? 0.1 : 0.12),
    sunk: d ? mix(p.bg, p.panel, 0.4) : mix(p.bg, p.ink, 0.03),
    keyWhite: d ? p.raise : '#ffffff',
    keyBlack: d ? mix(p.bg, '#000000', 0.15) : mix(p.ink, p.bg, 0.2),
    keyBlackInk: d ? p.mute : '#e8eaee',
    keyInk: d ? mix(p.mute, p.ink, 0.5) : mix(p.mute, p.ink, 0.4),
    laneLabel: d ? mix(p.panel, p.raise, 0.4) : p.raise,
    laneLabelHi: mix(p.raise, accent, 0.18),
    chip: mix(p.raise, p.lineHi, 0.5),
    cell: mix(p.panel, p.raise, 0.3),
    foot: d ? mix(p.bg, '#000000', 0.25) : p.raise,
    ok: '#43b562',
    cursor: accent,
  });

  // ---- CSS variables for the chrome
  const r = document.documentElement;
  const vars: Record<string, string> = {
    '--bg': p.bg,
    '--panel': p.panel,
    '--raise': p.raise,
    '--line': p.line,
    '--line-hi': p.lineHi,
    '--ink': p.ink,
    '--mute': p.mute,
    '--clean': p.clean,
    '--dist': p.dist,
    '--warn': p.warn,
    '--accent': accent,
    '--accent-strong': mix(accent, '#000000', 0.18),
    '--accent-soft': rgba(accent, d ? 0.45 : 0.3),
    '--sunk': COL.sunk,
    '--cell': COL.cell,
    '--deep': d ? mix(p.bg, p.panel, 0.55) : mix(p.bg, p.ink, 0.02),
    '--hover': mix(p.raise, p.lineHi, 0.25),
    '--glow': d ? mix(p.bg, accent, 0.08) : mix(p.bg, '#ffffff', 0.6),
    '--err-ink': d ? '#ffb3c2' : '#a3122f',
    '--shadow': d ? 'rgba(0,0,0,0.55)' : 'rgba(20,24,32,0.18)',
  };
  for (const [k, v] of Object.entries(vars)) r.style.setProperty(k, v);
  r.style.colorScheme = d ? 'dark' : 'light';
  r.dataset.theme = d ? 'dark' : 'light';
  // redraw the canvases (they repaint on any store change)
  useStore.getState().set({ themeRev: useStore.getState().themeRev + 1 });
}

/** Apply now, again whenever the setting (or the OS theme, for "system") changes. */
export function installTheme(): () => void {
  applyTheme();
  const off = useSettings.subscribe((s, prev) => {
    if (s.theme !== prev.theme || s.accent !== prev.accent || s.notationPaper !== prev.notationPaper)
      applyTheme();
  });
  const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
  const onOs = () => useSettings.getState().theme === 'system' && applyTheme();
  mq?.addEventListener?.('change', onOs);
  return () => {
    off();
    mq?.removeEventListener?.('change', onOs);
  };
}
