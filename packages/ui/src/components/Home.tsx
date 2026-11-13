import { useEffect, useMemo, useRef, useState } from 'react';
import { unpackRiff } from '@riffroll/core';
import { useStore } from '../store';
import {
  getStorage,
  newProject,
  openExample,
  openFromDisk,
  openProject,
  openProjectFolder,
  syncRecentMenu,
} from '../files/actions';
import { signOut } from '../account';
import type { ProjectInfo } from '../storage';

const run = (fn: () => unknown) => () => {
  Promise.resolve()
    .then(fn)
    .catch((e) => useStore.getState().set({ status: `Error: ${(e as Error).message}` }));
};

function ago(iso?: string): string {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

const title = (p: ProjectInfo) => p.name || 'Untitled';

function Owner({ p }: { p: ProjectInfo }) {
  if (!p.access || p.access === 'owner')
    return p.sharedWith ? <span className="badge">Shared with {p.sharedWith}</span> : null;
  return (
    <span className="badge shared">
      {p.owner?.displayName ?? 'Someone'} · {p.access === 'edit' ? 'can edit' : 'view only'}
    </span>
  );
}

function UserMenu() {
  const user = useStore((s) => s.user);
  const accounts = useStore((s) => s.auth.accounts);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const st = useStore.getState();
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  const item = (label: string, fn: () => unknown) => (
    <button
      role="menuitem"
      onClick={() => {
        setOpen(false);
        run(fn)();
      }}
    >
      <span>{label}</span>
    </button>
  );
  return (
    <div className="filemenu" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        {accounts && user ? (
          <>
            <span className="avatar" aria-hidden="true">
              {user.displayName.slice(0, 1).toUpperCase()}
            </span>
            {user.displayName} ▾
          </>
        ) : (
          'Menu ▾'
        )}
      </button>
      {open && (
        <div className="menu right" role="menu">
          {accounts && item('Account…', () => st.set({ modal: 'account' }))}
          {accounts && user?.admin && item('Manage users…', () => st.set({ modal: 'users' }))}
          {window.riffroll && item('Open project folder', openProjectFolder)}
          {item('Settings…', () => st.set({ modal: 'settings' }))}
          {item('Instruments…', () => st.set({ modal: 'instruments' }))}
          {item('About & credits', () => st.set({ modal: 'about' }))}
          {accounts && (
            <>
              <hr />
              {item('Sign out', signOut)}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Launch screen: recently opened songs, then every song you have (yours and shared with you). */
export function Home() {
  const accounts = useStore((s) => s.auth.accounts);
  const user = useStore((s) => s.user);
  const status = useStore((s) => s.status);
  const [list, setList] = useState<ProjectInfo[] | null>(null);
  const [kind, setKind] = useState('');
  const [filter, setFilter] = useState<'all' | 'mine' | 'shared'>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const modal = useStore((s) => s.modal);

  const refresh = async () => {
    try {
      const s = await getStorage();
      setKind(s.kind);
      const items = await s.list();
      setList(items);
      setError('');
      // songs saved by older versions on this device don't have a stored title yet: read it from the file
      const missing = items.filter((p) => !p.name && s.kind !== 'rest');
      if (missing.length) {
        const named = await Promise.all(
          items.map(async (p) => {
            if (p.name || s.kind === 'rest') return p;
            try {
              return { ...p, name: unpackRiff((await s.load(p.id)).data).song.title };
            } catch {
              return p;
            }
          }),
        );
        setList(named);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void refresh();
  }, [user?.id]);
  // the share dialog changes "shared with" counts
  useEffect(() => {
    if (modal === null) void refresh();
  }, [modal]);

  const recent = useMemo(
    () =>
      (list ?? [])
        .filter((p) => p.openedAt)
        .sort((a, b) => b.openedAt!.localeCompare(a.openedAt!))
        .slice(0, 6),
    [list],
  );
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (list ?? []).filter(
      (p) =>
        (filter === 'all' ||
          (filter === 'mine' ? (p.access ?? 'owner') === 'owner' : (p.access ?? 'owner') !== 'owner')) &&
        (!q || title(p).toLowerCase().includes(q) || p.owner?.displayName.toLowerCase().includes(q)),
    );
  }, [list, filter, query]);
  const sharedCount = (list ?? []).filter((p) => p.access && p.access !== 'owner').length;

  const open = (p: ProjectInfo) => run(() => openProject(p.id));
  const remove = (p: ProjectInfo) =>
    run(async () => {
      const mine = (p.access ?? 'owner') === 'owner';
      const msg = mine
        ? `Delete “${title(p)}” permanently?${p.sharedWith ? ' The people you shared it with lose it too.' : ''}`
        : `Remove “${title(p)}” from your songs? ${p.owner?.displayName ?? 'The owner'} still has it.`;
      if (!confirm(msg)) return;
      await (await getStorage()).remove(p.id);
      void syncRecentMenu();
      await refresh();
    });
  const share = (p: ProjectInfo) => () =>
    useStore.getState().set({ shareTarget: { id: p.id, title: title(p) }, modal: 'share' });

  return (
    <div className="home">
      <header className="home-top">
        <div className="brand">Riff Roll</div>
        <div className="spacer" />
        <UserMenu />
      </header>
      <main className="home-main">
        <section className="home-hero">
          <h1>{accounts && user ? `Hi, ${user.displayName}` : 'Your songs'}</h1>
          <div className="home-actions">
            <button className="btn primary" onClick={run(newProject)}>
              ＋ New song
            </button>
            <button className="btn" onClick={run(openFromDisk)}>
              Import file…
            </button>
            <button className="btn ghost" onClick={run(openExample)}>
              Try the example
            </button>
          </div>
          <p className="mute small">
            Import opens Guitar Pro (3–8, GPX), MusicXML, MIDI and .riff files. Songs save automatically{' '}
            {kind === 'rest'
              ? accounts
                ? 'to your account on this server.'
                : 'on the server.'
              : kind === 'electron'
                ? 'in your app data folder.'
                : 'in this browser.'}
          </p>
        </section>

        {error && (
          <p className="auth-error" role="alert">
            Couldn’t load your songs: {error}
          </p>
        )}

        {recent.length > 0 && (
          <section aria-labelledby="recent-h">
            <h2 id="recent-h">Recently opened</h2>
            <ul className="recent-grid">
              {recent.map((p) => (
                <li key={p.id}>
                  <button className="recent-card" onClick={open(p)}>
                    <span className="rc-title">{title(p)}</span>
                    <span className="rc-meta">
                      <Owner p={p} />
                      <span className="mute">opened {ago(p.openedAt)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="all-h">
          <div className="all-head">
            <h2 id="all-h">All songs {list && <span className="mute">({list.length})</span>}</h2>
            <div className="spacer" />
            {accounts && (
              <div className="group" role="group" aria-label="Show">
                {(['all', 'mine', 'shared'] as const).map((f) => (
                  <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                    {f === 'all'
                      ? 'All'
                      : f === 'mine'
                        ? 'Mine'
                        : `Shared with me${sharedCount ? ` (${sharedCount})` : ''}`}
                  </button>
                ))}
              </div>
            )}
            <input
              className="search"
              type="search"
              placeholder="Search"
              aria-label="Search songs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          {list === null ? (
            <p className="mute">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="mute empty">
              {list.length === 0
                ? 'No songs yet. Start a new one, import a file, or try the example.'
                : filter === 'shared' && !query
                  ? 'Nothing has been shared with you yet.'
                  : 'No songs match.'}
            </p>
          ) : (
            <ul className="song-list">
              {shown.map((p) => {
                const mine = (p.access ?? 'owner') === 'owner';
                return (
                  <li key={p.id}>
                    <button className="sl-main" onClick={open(p)}>
                      <span className="sl-title">{title(p)}</span>
                      <span className="sl-meta">
                        <Owner p={p} />
                        <span className="mute">edited {ago(p.updatedAt)}</span>
                      </span>
                    </button>
                    {accounts && mine && (
                      <button className="ib" onClick={share(p)} aria-label={`Share ${title(p)}`}>
                        Share
                      </button>
                    )}
                    <button
                      className="ib danger"
                      onClick={remove(p)}
                      aria-label={mine ? `Delete ${title(p)}` : `Remove ${title(p)} from your songs`}
                    >
                      {mine ? 'Delete' : 'Remove'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
      {status && (
        <div className="home-status" role="status" aria-live="polite">
          {status}
        </div>
      )}
    </div>
  );
}
