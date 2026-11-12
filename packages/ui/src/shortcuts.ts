import { copy, cut, deleteSelection, duplicate, nudge, paste, quantize, selectAll } from './editing';
import { currentTrack, useStore } from './store';
import { togglePlay } from './transport';
import { handleTabKey } from './tabEntry';

export interface Shortcut {
  keys: string;
  what: string;
  group: string;
}

/** Listed in the cheat sheet (press ?). FL Studio conventions in the piano roll, Guitar Pro in the tab. */
export const SHORTCUTS: Shortcut[] = [
  { group: 'Transport', keys: 'Space', what: 'Play / stop' },
  { group: 'Transport', keys: 'Click ruler', what: 'Set playback start' },
  { group: 'Edit', keys: 'Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y', what: 'Undo / redo' },
  { group: 'Edit', keys: 'Ctrl+C / Ctrl+X / Ctrl+V', what: 'Copy / cut / paste at the start marker' },
  { group: 'Edit', keys: 'Ctrl+D', what: 'Duplicate selection after itself' },
  { group: 'Edit', keys: 'Ctrl+A', what: 'Select all' },
  { group: 'Edit', keys: 'Delete / Backspace', what: 'Delete selection' },
  { group: 'Edit', keys: 'Q', what: 'Quantize selection (or whole track) to the snap grid' },
  { group: 'Edit', keys: 'Esc', what: 'Clear selection' },
  { group: 'Piano roll', keys: 'Click', what: 'Add a note at the last-used length (drag to set length)' },
  { group: 'Piano roll', keys: 'Drag note / right edge', what: 'Move / resize' },
  { group: 'Piano roll', keys: 'Alt+drag', what: 'Duplicate and move' },
  { group: 'Piano roll', keys: 'Right-click (drag)', what: 'Delete notes' },
  { group: 'Piano roll', keys: 'Ctrl+drag / Shift+drag', what: 'Box select / add to selection' },
  { group: 'Piano roll', keys: 'Ctrl+click', what: 'Toggle a note in the selection' },
  { group: 'Piano roll', keys: '← → / ↑ ↓', what: 'Move by grid step / semitone (Shift: bar / octave)' },
  { group: 'Piano roll', keys: 'Ctrl+wheel', what: 'Zoom' },
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
  { group: 'Help', keys: '?', what: 'This cheat sheet' },
];

const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement;
  const tag = el?.tagName?.toLowerCase();
  return tag === 'input' || tag === 'select' || tag === 'textarea' || el?.isContentEditable;
};

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
  const onKey = (e: KeyboardEvent) => {
    if (isTyping(e)) return;
    const st = useStore.getState();
    if (st.modal && e.key === 'Escape') return st.set({ modal: null });
    for (const h of handlers) if (h(e)) return e.preventDefault();
    if (e.code !== 'Space' && handleTabKey(e)) return e.preventDefault();
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    let handled = true;
    if (e.code === 'Space') togglePlay();
    else if (mod && k === 'z' && !e.shiftKey) st.undo();
    else if (mod && ((k === 'z' && e.shiftKey) || k === 'y')) st.redo();
    else if (mod && k === 'c') copy();
    else if (mod && k === 'x') cut();
    else if (mod && k === 'v') paste();
    else if (mod && k === 'd') duplicate();
    else if (mod && k === 'a') selectAll();
    else if (!mod && (e.key === 'Delete' || e.key === 'Backspace')) deleteSelection();
    else if (!mod && k === 'q') quantize();
    else if (e.key === 'Escape') st.select([]);
    else if (e.key === '?') st.set({ modal: st.modal === 'shortcuts' ? null : 'shortcuts' });
    else if (!mod && e.key.startsWith('Arrow') && currentTrack(st)?.type !== 'drums') {
      const bar = st.song.ppq * 4;
      const dt =
        e.key === 'ArrowLeft'
          ? -(e.shiftKey ? bar : st.snap)
          : e.key === 'ArrowRight'
            ? e.shiftKey
              ? bar
              : st.snap
            : 0;
      const dp =
        e.key === 'ArrowUp' ? (e.shiftKey ? 12 : 1) : e.key === 'ArrowDown' ? (e.shiftKey ? -12 : -1) : 0;
      handled = nudge(dt, dp);
    } else handled = false;
    if (handled) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
