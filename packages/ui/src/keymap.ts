/**
 * Rebindable keyboard commands. Each action has default key combos; Settings → Shortcuts stores overrides
 * in settings.keys. Combos are written "Ctrl+Shift+Z": modifiers in the order Ctrl, Alt, Shift, then the
 * key. Ctrl means Cmd on a Mac.
 */
import { settings } from './settings';

export interface Action {
  id: string;
  label: string;
  group: string;
  keys: string[];
}

export const ACTIONS: Action[] = [
  { id: 'play', group: 'Transport', label: 'Play / stop', keys: ['Space'] },
  { id: 'undo', group: 'Edit', label: 'Undo', keys: ['Ctrl+Z'] },
  { id: 'redo', group: 'Edit', label: 'Redo', keys: ['Ctrl+Shift+Z', 'Ctrl+Y'] },
  { id: 'copy', group: 'Edit', label: 'Copy', keys: ['Ctrl+C'] },
  { id: 'cut', group: 'Edit', label: 'Cut', keys: ['Ctrl+X'] },
  { id: 'paste', group: 'Edit', label: 'Paste at the start marker', keys: ['Ctrl+V'] },
  {
    id: 'duplicate',
    group: 'Edit',
    label: 'Duplicate selection after itself (on the grid)',
    keys: ['Ctrl+D'],
  },
  {
    id: 'duplicateAfter',
    group: 'Edit',
    label: 'Duplicate right after the last selected note (FL Studio)',
    keys: ['Ctrl+B'],
  },
  { id: 'selectAll', group: 'Edit', label: 'Select all', keys: ['Ctrl+A'] },
  { id: 'delete', group: 'Edit', label: 'Delete selection', keys: ['Delete', 'Backspace'] },
  { id: 'quantize', group: 'Edit', label: 'Quantize to the snap grid', keys: ['Q'] },
  { id: 'deselect', group: 'Edit', label: 'Clear selection', keys: ['Escape'] },
  { id: 'left', group: 'Move notes', label: 'Earlier by one grid step', keys: ['ArrowLeft'] },
  { id: 'right', group: 'Move notes', label: 'Later by one grid step', keys: ['ArrowRight'] },
  { id: 'barLeft', group: 'Move notes', label: 'Earlier by one bar', keys: ['Ctrl+ArrowLeft'] },
  { id: 'barRight', group: 'Move notes', label: 'Later by one bar', keys: ['Ctrl+ArrowRight'] },
  {
    id: 'up',
    group: 'Move notes',
    label: 'Up a semitone (drums: up a lane)',
    keys: ['ArrowUp', 'Shift+ArrowUp'],
  },
  {
    id: 'down',
    group: 'Move notes',
    label: 'Down a semitone (drums: down a lane)',
    keys: ['ArrowDown', 'Shift+ArrowDown'],
  },
  { id: 'octUp', group: 'Move notes', label: 'Up an octave', keys: ['Ctrl+ArrowUp'] },
  { id: 'octDown', group: 'Move notes', label: 'Down an octave', keys: ['Ctrl+ArrowDown'] },
  { id: 'save', group: 'File', label: 'Save', keys: ['Ctrl+S'] },
  { id: 'home', group: 'File', label: 'All songs', keys: ['Ctrl+O'] },
  { id: 'new', group: 'File', label: 'New song', keys: ['Ctrl+N'] },
  { id: 'print', group: 'File', label: 'Print / PDF', keys: ['Ctrl+P'] },
  { id: 'ascii', group: 'File', label: 'Copy as ASCII tab', keys: ['Ctrl+Shift+C'] },
  { id: 'globalView', group: 'View', label: 'Show / hide the global view', keys: ['Ctrl+G'] },
  { id: 'palette', group: 'View', label: 'Show / hide the edit palette', keys: ['Ctrl+Shift+B'] },
  { id: 'mixer', group: 'View', label: 'Mixer', keys: ['Ctrl+M'] },
  { id: 'settings', group: 'View', label: 'Settings', keys: ['Ctrl+,'] },
  { id: 'help', group: 'View', label: 'Keyboard shortcuts', keys: ['?'] },
];

const byId = new Map(ACTIONS.map((a) => [a.id, a]));

/** The combos bound to an action right now (an override, or the defaults). */
export function bindingsOf(id: string): string[] {
  return settings().keys[id] ?? byId.get(id)?.keys ?? [];
}

const MODS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'OS']);

/** "Ctrl+Shift+Z" for a key event; null for a lone modifier. */
export function comboOf(e: KeyboardEvent): string | null {
  if (MODS.has(e.key)) return null;
  let key = e.code === 'Space' ? 'Space' : e.key;
  if (key.length === 1) key = key.toUpperCase();
  // a shifted symbol ("?", "+") already says Shift
  const symbol = key.length === 1 && !/[A-Z0-9]/.test(key);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey && !symbol) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}

/** The action a key event triggers, if any. */
export function actionFor(e: KeyboardEvent): string | null {
  const c = comboOf(e);
  if (!c) return null;
  for (const a of ACTIONS) if (bindingsOf(a.id).includes(c)) return a.id;
  return null;
}

/** Other actions already using a combo. */
export const conflicts = (combo: string, except: string) =>
  ACTIONS.filter((a) => a.id !== except && bindingsOf(a.id).includes(combo));

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const NICE: Record<string, string> = {
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  Escape: 'Esc',
  Delete: 'Del',
};
/** "Ctrl+←" (or "⌘←" on a Mac) for display. */
export function niceCombo(c: string): string {
  const parts = c.split('+').filter(Boolean);
  // "Ctrl++" splits into an empty last part: the key was "+"
  if (c.endsWith('++')) parts.push('+');
  const shown = parts.map((p) => NICE[p] ?? (isMac && p === 'Ctrl' ? '⌘' : p));
  return isMac ? shown.join('') : shown.join('+');
}

/** The first binding of an action for menus and tooltips ("" if it has none). */
export const keyHint = (id: string) => {
  const b = bindingsOf(id)[0];
  return b ? niceCombo(b) : '';
};
