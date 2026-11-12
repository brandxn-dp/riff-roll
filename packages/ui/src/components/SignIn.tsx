import { useState, type FormEvent } from 'react';
import { useStore } from '../store';
import { setupServer, signIn, signUp } from '../account';

/** First-run setup, sign in, or (when the server allows it) create an account. */
export function SignIn() {
  const auth = useStore((s) => s.auth);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const creating = auth.setupNeeded || mode === 'signup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (creating && password !== confirm) return setError('The passwords don’t match.');
    setBusy(true);
    try {
      if (auth.setupNeeded) await setupServer({ username, password, displayName });
      else if (mode === 'signup') await signUp({ username, password, displayName });
      else await signIn(username, password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand big">Riff Roll</div>
        {auth.setupNeeded ? (
          <>
            <h1>Set up this server</h1>
            <p className="mute">
              Create the first account. It’s an admin: it can add people, and it gets the songs already saved
              on this server.
            </p>
          </>
        ) : (
          <h1>{mode === 'signup' ? 'Create an account' : 'Sign in'}</h1>
        )}
        <label className="auth-field">
          Username
          <input
            autoFocus
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </label>
        {creating && (
          <label className="auth-field">
            Display name <span className="mute">(shown to people you share with)</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={username}
            />
          </label>
        )}
        <label className="auth-field">
          Password
          <input
            type="password"
            autoComplete={creating ? 'new-password' : 'current-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={creating ? 6 : undefined}
            required
          />
        </label>
        {creating && (
          <label className="auth-field">
            Repeat password
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          </label>
        )}
        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="btn primary wide" disabled={busy}>
          {busy
            ? '…'
            : auth.setupNeeded
              ? 'Create admin account'
              : mode === 'signup'
                ? 'Create account'
                : 'Sign in'}
        </button>
        {!auth.setupNeeded && auth.signup && (
          <button
            type="button"
            className="linkish"
            onClick={() => {
              setMode(mode === 'signin' ? 'signup' : 'signin');
              setError('');
            }}
          >
            {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
          </button>
        )}
        {!auth.setupNeeded && !auth.signup && mode === 'signin' && (
          <p className="mute small">No account? Ask whoever runs this server to add you.</p>
        )}
      </form>
    </div>
  );
}
