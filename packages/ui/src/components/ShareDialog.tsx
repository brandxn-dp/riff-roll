import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { Modal } from './Modal';
import { getShares, listUsers, setShare, type PublicUser, type ShareAccess } from '../account';

/** Share a song with other people on this server: view only, or allowed to edit. */
export function ShareDialog() {
  const target = useStore((s) => s.shareTarget);
  const me = useStore((s) => s.user);
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [shares, setShares] = useState<Record<string, ShareAccess>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    Promise.all([listUsers(), getShares(target.id)])
      .then(([u, s]) => {
        setUsers(u.filter((x) => x.id !== me?.id));
        setShares(Object.fromEntries(s.map((x) => [x.userId, x.access])));
      })
      .catch((e) => setError((e as Error).message));
  }, [target, me?.id]);

  if (!target) return null;
  const change = async (userId: string, access: ShareAccess | null) => {
    setBusy(userId);
    setError('');
    try {
      const s = await setShare(target.id, userId, access);
      setShares(Object.fromEntries(s.map((x) => [x.userId, x.access])));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title={`Share “${target.title}”`}>
      <p className="mute">
        People you share with see this song under <b>Shared with me</b>. <b>Can edit</b> lets them change it
        (their changes save into your song); <b>View only</b> lets them open, play and save their own copy.
      </p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {users === null ? (
        <p className="mute">Loading…</p>
      ) : users.length === 0 ? (
        <p className="mute">
          There’s nobody else on this server yet.{' '}
          {me?.admin ? 'Add people under your name → Manage users.' : 'Ask an admin to add people.'}
        </p>
      ) : (
        <ul className="share-list">
          {users.map((u) => (
            <li key={u.id}>
              <span className="avatar" aria-hidden="true">
                {u.displayName.slice(0, 1).toUpperCase()}
              </span>
              <span className="share-name">
                {u.displayName}
                <small className="mute">@{u.username}</small>
              </span>
              <select
                aria-label={`Access for ${u.displayName}`}
                value={shares[u.id] ?? ''}
                disabled={busy === u.id}
                onChange={(e) => void change(u.id, (e.target.value || null) as ShareAccess | null)}
              >
                <option value="">Not shared</option>
                <option value="view">View only</option>
                <option value="edit">Can edit</option>
              </select>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
