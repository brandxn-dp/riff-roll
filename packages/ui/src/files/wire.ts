import { useStore } from '../store';
import { registerActions } from '../shortcuts';
import {
  copyAsciiTab,
  exportMidi,
  exportMusicXml,
  exportWav,
  importBytes,
  installAutosave,
  newProject,
  openFromDisk,
  getStorage,
  goHome,
  clearRecent,
  openProject,
  openProjectFolder,
  syncRecentMenu,
  saveProject,
} from './actions';
import { printScore } from './print';
import { getAuthState } from '../account';

/** Start-up: sign-in screen when the server has accounts and nobody is signed in, otherwise the launch screen. */
async function boot() {
  const st = useStore.getState();
  const storage = await getStorage();
  if (storage.kind === 'rest') {
    try {
      const a = await getAuthState();
      st.set({
        auth: { accounts: a.accounts, setupNeeded: a.setupNeeded, signup: a.signup },
        user: a.user,
        screen: a.user ? 'home' : 'signin',
      });
      return;
    } catch {
      /* an older server without accounts */
    }
  }
  st.set({ screen: 'home' });
}

const run = (fn: () => unknown) =>
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().set({ status: `Error: ${(e as Error).message}` }));

/** Keyboard actions that only make sense with a song open; false lets the key through elsewhere. */
const editorOnly = (fn: () => unknown) => () => {
  if (useStore.getState().screen !== 'editor') return false;
  run(fn);
};

/** File keyboard shortcuts, desktop menu commands, autosave and session restore. */
export function installFileActions(): () => void {
  const offs: (() => void)[] = [];
  void boot().then(() => syncRecentMenu());
  offs.push(installAutosave());

  offs.push(
    registerActions({
      save: editorOnly(() => saveProject()),
      home: editorOnly(goHome),
      new: editorOnly(newProject),
      print: editorOnly(() => printScore()),
      ascii: editorOnly(copyAsciiTab),
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
        if (cmd.startsWith('project:open:')) {
          void run(() => openProject(cmd.slice('project:open:'.length)));
          return;
        }
        const map: Record<string, () => unknown> = {
          'file:new': newProject,
          'file:home': goHome,
          'file:open-folder': openProjectFolder,
          'recent:clear': clearRecent,
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
          'app:settings': () => st.set({ modal: 'settings' }),
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
