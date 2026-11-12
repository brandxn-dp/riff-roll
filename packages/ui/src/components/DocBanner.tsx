import { useStore } from '../store';
import { reopenProject, saveCopy, storeId } from '../files/actions';

/** Open the share dialog for the song in the editor. */
export function shareCurrentSong() {
  const st = useStore.getState();
  st.set({ shareTarget: { id: storeId(st.song.id), title: st.song.title || 'Untitled' }, modal: 'share' });
}

const run = (fn: () => unknown) => () => {
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().set({ status: `Error: ${(e as Error).message}` }));
};

/** Shown above the editor when this song can't be saved: shared read-only, or someone else saved it first. */
export function DocBanner() {
  const doc = useStore((s) => s.doc);
  const accounts = useStore((s) => s.auth.accounts);
  if (doc.blocked === 'conflict')
    return (
      <div className="doc-banner warn" role="alert">
        <span>
          <b>{doc.conflictBy || 'Someone else'}</b> saved this song after you opened it, so your changes
          aren’t being saved.
        </span>
        <button className="ib" onClick={run(reopenProject)}>
          Load their version
        </button>
        <button className="ib" onClick={run(saveCopy)}>
          Keep mine as a copy
        </button>
      </div>
    );
  if (doc.access === 'view')
    return (
      <div className="doc-banner" role="status">
        <span>
          Shared by <b>{doc.owner || 'someone'}</b>, view only. You can play and try changes, but they aren’t
          saved.
        </span>
        <button className="ib" onClick={run(saveCopy)}>
          Save a copy
        </button>
      </div>
    );
  if (accounts && doc.access === 'edit')
    return (
      <div className="doc-banner subtle" role="status">
        <span>
          Shared by <b>{doc.owner || 'someone'}</b>. Your changes save into their song.
        </span>
      </div>
    );
  return null;
}
