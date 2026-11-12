import { useEffect, useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { Modal } from './Modal';
import { createUser, deleteUser, listUsers, resetPassword, updateUser, type PublicUser } from '../account';

/** Admins: add people, reset passwords, make admins, remove accounts. */
export function UsersDialog() {
  const me = useStore((s) => s.user);
  const [users, setUsers] = useState<PublicUser[] | null>(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [form, setForm] = useState({ username: '', displayName: '', password: '', admin: false });

  const refresh = () =>
    listUsers()
      .then(setUsers)
      .catch((e) => setError((e as Error).message));
  useEffect(() => {
    void refresh();
  }, []);
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    setError('');
    setNote('');
    try {
      await fn();
      if (done) setNote(done);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const add = (e: FormEvent) => {
    e.preventDefault();
    void act(
      async () => {
        await createUser(form);
        setForm({ username: '', displayName: '', password: '', admin: false });
      },
      `Added ${form.displayName || form.username}. Give them their username and password.`,
    );
  };

  return (
    <Modal title="Manage users" wide>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {note && <p className="note">{note}</p>}
      <ul className="user-list">
        {users?.map((u) => (
          <li key={u.id}>
            <span className="avatar" aria-hidden="true">
              {u.displayName.slice(0, 1).toUpperCase()}
            </span>
            <span className="share-name">
              {u.displayName}
              {u.id === me?.id && <em className="mute"> (you)</em>}
              <small className="mute">@{u.username}</small>
            </span>
            <label className="check">
              <input
                type="checkbox"
                checked={u.admin}
                disabled={u.id === me?.id}
                onChange={(e) => void act(() => updateUser(u.id, { admin: e.target.checked }))}
              />
              Admin
            </label>
            {u.id !== me?.id && (
              <>
                <button
                  className="ib"
                  onClick={() => {
                    const pw = prompt(`New password for ${u.displayName} (at least 6 characters):`);
                    if (pw) void act(() => resetPassword(u.id, pw), `Password for ${u.displayName} changed.`);
                  }}
                >
                  Reset password
                </button>
                <button
                  className="ib danger"
                  onClick={() => {
                    if (
                      confirm(
                        `Delete ${u.displayName}’s account? Their songs move to you, and they can no longer sign in.`,
                      )
                    )
                      void act(
                        () => deleteUser(u.id),
                        `Deleted ${u.displayName}. Their songs are now yours.`,
                      );
                  }}
                >
                  Delete
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      <form className="add-user" onSubmit={add}>
        <h3>Add someone</h3>
        <div className="add-user-fields">
          <label className="auth-field">
            Username
            <input
              value={form.username}
              autoCapitalize="none"
              spellCheck={false}
              onChange={(e) => setForm({ ...form, username: e.target.value })}
              required
            />
          </label>
          <label className="auth-field">
            Display name
            <input
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            />
          </label>
          <label className="auth-field">
            Password
            <input
              type="text"
              autoComplete="off"
              minLength={6}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
            />
          </label>
        </div>
        <div className="row">
          <label className="check">
            <input
              type="checkbox"
              checked={form.admin}
              onChange={(e) => setForm({ ...form, admin: e.target.checked })}
            />
            Admin (can manage users)
          </label>
          <div className="spacer" />
          <button className="btn primary">Add user</button>
        </div>
      </form>
    </Modal>
  );
}
