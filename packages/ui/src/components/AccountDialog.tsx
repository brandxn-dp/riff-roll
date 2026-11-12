import { useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { Modal } from './Modal';
import { changeMyPassword, signOut, updateUser } from '../account';

/** Your display name and password. */
export function AccountDialog() {
  const user = useStore((s) => s.user);
  const [name, setName] = useState(user?.displayName ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  if (!user) return null;

  const act = async (e: FormEvent, fn: () => Promise<unknown>, done: string) => {
    e.preventDefault();
    setError('');
    setNote('');
    try {
      await fn();
      setNote(done);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal title="Account">
      <p className="mute">
        Signed in as <b>@{user.username}</b>
        {user.admin ? ' (admin)' : ''}.
      </p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {note && <p className="note">{note}</p>}
      <form
        className="acct-form"
        onSubmit={(e) =>
          act(
            e,
            async () => {
              const u = await updateUser(user.id, { displayName: name });
              useStore.getState().set({ user: u });
            },
            'Display name saved.',
          )
        }
      >
        <label className="auth-field">
          Display name
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button className="btn">Save name</button>
      </form>
      <form
        className="acct-form"
        onSubmit={(e) =>
          act(
            e,
            async () => {
              await changeMyPassword(user.id, current, next);
              setCurrent('');
              setNext('');
            },
            'Password changed. Other devices have been signed out.',
          )
        }
      >
        <label className="auth-field">
          Current password
          <input
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
        </label>
        <label className="auth-field">
          New password
          <input
            type="password"
            autoComplete="new-password"
            minLength={6}
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
        </label>
        <button className="btn">Change password</button>
      </form>
      <div className="row">
        <div className="spacer" />
        <button className="btn" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </Modal>
  );
}
