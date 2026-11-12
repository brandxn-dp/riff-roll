/** Server accounts: sign-in, users and sharing (Docker / Unraid server only). */
import { useStore } from './store';
import { stop } from './transport';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  admin: boolean;
}
export interface AuthState {
  accounts: boolean;
  setupNeeded: boolean;
  signup: boolean;
  user: PublicUser | null;
}
export type ShareAccess = 'view' | 'edit';

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    cache: 'no-store',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.status === 401 && !url.includes('/api/auth/')) signedOut();
  const json = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(json.error || `Request failed (${r.status})`);
  return json as T;
}

export const getAuthState = () => api<AuthState>('GET', './api/auth/state');

function signedIn(res: { user: PublicUser }) {
  const st = useStore.getState();
  st.set({ user: res.user, screen: 'home', status: '', auth: { ...st.auth, setupNeeded: false } });
  return res.user;
}
export const setupServer = (b: { username: string; password: string; displayName: string }) =>
  api<{ user: PublicUser }>('POST', './api/auth/setup', b).then(signedIn);
export const signUp = (b: { username: string; password: string; displayName: string }) =>
  api<{ user: PublicUser }>('POST', './api/auth/signup', b).then(signedIn);
export const signIn = (username: string, password: string) =>
  api<{ user: PublicUser }>('POST', './api/auth/login', { username, password }).then(signedIn);

export async function signOut() {
  const { flushSaves } = await import('./files/actions');
  await flushSaves();
  await api('POST', './api/auth/logout').catch(() => {});
  signedOut();
}

/** Session gone (signed out here, expired, or the password changed elsewhere): back to the sign-in screen. */
export function signedOut() {
  const st = useStore.getState();
  if (!st.auth.accounts) return;
  if (st.playing) stop();
  st.set({ user: null, screen: 'signin', modal: null, sheet: false, shareTarget: null });
  void import('./files/actions').then((m) => m.clearEditor());
}

export const listUsers = () => api<PublicUser[]>('GET', './api/users');
export const createUser = (b: { username: string; password: string; displayName: string; admin: boolean }) =>
  api<PublicUser>('POST', './api/users', b);
export const updateUser = (id: string, b: { displayName?: string; admin?: boolean }) =>
  api<PublicUser>('PATCH', `./api/users/${encodeURIComponent(id)}`, b);
export const deleteUser = (id: string) => api('DELETE', `./api/users/${encodeURIComponent(id)}`);
export const resetPassword = (id: string, password: string) =>
  api('PUT', `./api/users/${encodeURIComponent(id)}/password`, { password });
export const changeMyPassword = (id: string, current: string, password: string) =>
  api<{ user: PublicUser }>('PUT', `./api/users/${encodeURIComponent(id)}/password`, { current, password });

export const getShares = (songId: string) =>
  api<{ userId: string; access: ShareAccess }[]>(
    'GET',
    `./api/projects/${encodeURIComponent(songId)}/shares`,
  );
export const setShare = (songId: string, userId: string, access: ShareAccess | null) =>
  api<{ userId: string; access: ShareAccess }[]>(
    'PUT',
    `./api/projects/${encodeURIComponent(songId)}/shares`,
    {
      userId,
      access,
    },
  );
