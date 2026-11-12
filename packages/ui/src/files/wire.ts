import { useStore } from '../store';
import { registerKeyHandler } from '../shortcuts';
import {
  copyAsciiTab,
  exportMidi,
  exportMusicXml,
  exportWav,
  importBytes,
  installAutosave,
  newProject,
  openFromDisk,
  restoreLastSession,
  saveProject,
} from './actions';
import { printScore } from './print';

const run = (fn: () => unknown) =>
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().set({ status: `Error: ${(e as Error).message}` }));

/** File keyboard shortcuts, desktop menu commands, autosave and session restore. */
export function installFileActions(): () => void {
  const offs: (() => void)[] = [];
  let started = false;
  // restore first, then start autosaving (so restoring doesn't immediately write a copy of the example)
  void restoreLastSession().then(() => {
    if (started) return;
    started = true;
    offs.push(installAutosave());
  });

  offs.push(
    registerKeyHandler((e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return false;
      const k = e.key.toLowerCase();
      if (k === 's') run(() => saveProject());
      else if (k === 'o') useStore.getState().set({ modal: 'files' });
      else if (k === 'n' && !e.shiftKey) run(newProject);
      else if (k === 'p') run(() => printScore());
      else if (k === 'c' && e.shiftKey) run(copyAsciiTab);
      else return false;
      return true;
    }),
  );

  const d = window.riffroll as
    | undefined
    | {
        onMenuCommand(fn: (c: string) => void): () => void;
        onOpenPath(fn: (p: string) => void): () => void;
        readPath(p: string): Promise<{ name: string; data: Uint8Array }>;
      };
  if (d) {
    offs.push(
      d.onMenuCommand((cmd) => {
        const st = useStore.getState();
        const map: Record<string, () => unknown> = {
          'file:new': newProject,
          'file:open': openFromDisk,
          'file:save': () => saveProject(),
          'file:save-as': () => import('./actions').then((m) => m.exportRiff()),
          'export:wav': () => exportWav(false),
          'export:midi': exportMidi,
          'export:musicxml': exportMusicXml,
          'export:print': () => printScore(),
          'edit:undo': st.undo,
          'edit:redo': st.redo,
          'help:shortcuts': () => st.set({ modal: 'shortcuts' }),
          'help:about': () => st.set({ modal: 'about' }),
        };
        if (map[cmd]) run(map[cmd]);
      }),
    );
    offs.push(
      d.onOpenPath((p) =>
        run(async () => {
          const f = await d.readPath(p);
          await importBytes(f.name, f.data);
        }),
      ),
    );
  }
  return () => offs.forEach((f) => f());
}
