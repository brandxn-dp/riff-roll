import {
  copy,
  cut,
  deleteSelection,
  duplicate,
  duplicateAfter,
  nudge,
  nudgeHits,
  paste,
  quantize,
  selectAll,
} from './editing';
import { currentTrack, useStore } from './store';
import { togglePlay } from './transport';
import { handleTabKey } from './tabEntry';
import { actionFor } from './keymap';

export interface Shortcut {
  keys: string;
  what: string;
  group: string;
}

/**
 * Mouse and fixed keys for the cheat sheet (press ?). The rebindable keys come from keymap.ts.
 * FL Studio conventions in the piano roll, Guitar Pro in the tab.
 */
export const SHORTCUTS: Shortcut[] = [
  { group: 'Transport', keys: 'Click ruler', what: 'Set playback start' },
  { group: 'Piano roll', keys: 'Click', what: 'Add a note at the last-used length (drag to set length)' },
  { group: 'Piano roll', keys: 'Drag note / right edge', what: 'Move / resize' },
  { group: 'Piano roll', keys: 'Alt+drag', what: 'Duplicate and move' },
  { group: 'Piano roll', keys: 'Right-click (drag)', what: 'Delete notes' },
  { group: 'Piano roll', keys: 'Ctrl+drag / Shift+drag', what: 'Box select / add to selection' },
  { group: 'Piano roll', keys: 'Ctrl+click', what: 'Toggle a note in the selection' },
  { group: 'Piano roll', keys: 'Ctrl+wheel / Alt+wheel', what: 'Zoom horizontally / vertically' },
  {
    group: 'Piano roll',
    keys: 'Shift+click a key',
    what: 'Select every note of that pitch (Ctrl+click adds)',
  },
  {
    group: 'Piano roll',
    keys: 'Alt+drag in VEL',
    what: 'Draw a velocity line across notes (selected ones if any)',
  },
  {
    group: 'Drum grid',
    keys: 'Shift+drag / Ctrl+drag',
    what: 'Box select hits (Shift adds to the selection)',
  },
  { group: 'Drum grid', keys: 'Shift+click a drum name', what: 'Select every hit of that drum' },
  { group: 'Drum grid', keys: 'Alt+drag', what: 'Paint across lanes' },
  { group: 'Pedal lane', keys: 'Click', what: 'Add stomp at nearest grid line, click a stomp to remove it' },
  { group: 'Pedal lane', keys: 'Drag stomp', what: 'Move stomp' },
  { group: 'Pedal lane', keys: 'Click "PEDAL"', what: 'Change the starting tone' },
  { group: 'Pedal lane', keys: 'Right-click stomp', what: 'Pick its tone (advanced mode)' },
  { group: 'Tab entry', keys: 'Click a tab line', what: 'Put the cursor there (Esc leaves tab entry)' },
  { group: 'Tab entry', keys: '← → ↑ ↓', what: 'Move by beat / change string' },
  {
    group: 'Tab entry',
    keys: '0–9',
    what: 'Type a fret (two digits quickly for 10–24); pins the note to that string',
  },
  { group: 'Tab entry', keys: '+ / −', what: 'Longer / shorter note value' },
  { group: 'Tab entry', keys: '.  /  T', what: 'Dotted / triplet' },
  { group: 'Tab entry', keys: 'R  /  L', what: 'Rest / tie to previous' },
  { group: 'Tab entry', keys: 'Ins  /  Ctrl+Del', what: 'Insert beat / delete beat' },
  { group: 'Tab entry', keys: 'Del', what: 'Delete the note on this string' },
  { group: 'Techniques', keys: 'H S B V', what: 'Hammer/pull, slide, bend, vibrato' },
  { group: 'Techniques', keys: 'P X G A', what: 'Palm mute, dead note, ghost, accent' },
  { group: 'Techniques', keys: 'I N K O', what: 'Let ring, harmonic, tap, staccato' },
  { group: 'Techniques', keys: 'U D F M', what: 'Pick up/down, fade in, tremolo picking' },
  { group: 'Song', keys: 'Section chips', what: 'Jump to a section (double-click to rename)' },
  {
    group: 'Global view',
    keys: 'Click / drag / Shift+click',
    what: 'Go to a bar / select bars across tracks / extend',
  },
  { group: 'Global view', keys: 'Click a section name', what: 'Select that section in every track' },
  {
    group: 'Global view',
    keys: 'Ctrl+C / Ctrl+X / Ctrl+V',
    what: 'Copy / cut / paste bars (Ctrl+Shift+V pastes and inserts)',
  },
  { group: 'Global view', keys: 'Delete / Ctrl+Delete', what: 'Clear the bars / delete them from the song' },
  { group: 'Global view', keys: 'Insert / Ctrl+D', what: 'Insert a bar / duplicate the selected bars' },
  { group: 'Global view', keys: 'Double-click a bar', what: 'Open that track at that bar' },
];

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement;
  const tag = el?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea' || el?.isContentEditable;
};

/** FL Studio style moves: ←/→ one grid step (or a bar), ↑/↓ a semitone (drums: a lane), or an octave. */
function move(dtSteps: number, dtBars: number, semis: number): boolean {
  const st = useStore.getState();
  const dt = dtSteps * st.snap + dtBars * st.song.ppq * 4;
  if (currentTrack(st)?.type === 'drums') return nudgeHits(dt, -Math.sign(semis));
  return nudge(dt, semis, Math.abs(semis) !== 12);
}

const toggle = (k: 'globalView' | 'palette') => {
  const st = useStore.getState();
  st.set({ [k]: !st[k] });
};
const modal = (m: NonNullable<ReturnType<typeof useStore.getState>['modal']>) => {
  const st = useStore.getState();
  st.set({ modal: st.modal === m ? null : m });
};

/** What each keymap action does. Files add theirs (save, open…) with registerActions. */
const actions: Record<string, () => boolean | void> = {
  play: togglePlay,
  undo: () => useStore.getState().undo(),
  redo: () => useStore.getState().redo(),
  copy,
  cut,
  paste,
  duplicate,
  duplicateAfter,
  selectAll,
  delete: deleteSelection,
  quantize,
  deselect: () => useStore.getState().select([]),
  left: () => move(-1, 0, 0),
  right: () => move(1, 0, 0),
  barLeft: () => move(0, -1, 0),
  barRight: () => move(0, 1, 0),
  up: () => move(0, 0, 1),
  down: () => move(0, 0, -1),
  octUp: () => move(0, 0, 12),
  octDown: () => move(0, 0, -12),
  globalView: () => toggle('globalView'),
  palette: () => toggle('palette'),
  mixer: () => modal('mixer'),
  settings: () => modal('settings'),
  help: () => modal('shortcuts'),
};
export function registerActions(more: Record<string, () => boolean | void>) {
  Object.assign(actions, more);
  return () => {
    for (const k of Object.keys(more)) if (actions[k] === more[k]) delete actions[k];
  };
}

/** Extra handlers views can register (e.g. the tab editor's keyboard entry) — return true if handled. */
const handlers: ((e: KeyboardEvent) => boolean)[] = [];
export function registerKeyHandler(h: (e: KeyboardEvent) => boolean) {
  handlers.unshift(h);
  return () => {
    const i = handlers.indexOf(h);
    if (i >= 0) handlers.splice(i, 1);
  };
}

export function installShortcuts() {
  // after choosing from a menu (snap, view, ghost…) hand the keyboard back to the editor, so arrows and
  // shortcuts don't keep changing that menu
  const onChange = (e: Event) => {
    const el = e.target as HTMLElement;
    if (el?.tagName === 'SELECT' && !el.closest('.modal')) setTimeout(() => el.blur(), 0);
  };
  document.addEventListener('change', onChange, true);
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const st = useStore.getState();
    if (st.modal && e.key === 'Escape') return st.set({ modal: null });
    for (const h of handlers) if (h(e)) return e.preventDefault();
    if (e.code !== 'Space' && handleTabKey(e)) return e.preventDefault();
    const id = actionFor(e);
    if (!id) return;
    const fn = actions[id];
    // an action returns false when it had nothing to do (e.g. arrows with nothing selected scroll instead)
    if (fn && fn() !== false) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    document.removeEventListener('change', onChange, true);
  };
}
