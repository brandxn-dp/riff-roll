import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';

let dir: string;
let app: FastifyInstance;

const start = (extra: Record<string, unknown> = {}) =>
  buildServer({
    uiDir: path.join(dir, 'nope'),
    projectsDir: path.join(dir, 'projects'),
    instrumentsDirs: [path.join(dir, 'instruments')],
    ...extra,
  });

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'riffroll-acc-'));
  // a song saved before accounts existed
  await mkdir(path.join(dir, 'projects'), { recursive: true });
  await writeFile(path.join(dir, 'projects', 'old-song.riff'), Buffer.from([9, 9]));
  app = await start();
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

type Res = Awaited<ReturnType<FastifyInstance['inject']>>;
const cookieOf = (r: Res) => String(r.headers['set-cookie']).split(';')[0];
const post = (url: string, payload: object, cookie = '') =>
  app.inject({ method: 'POST', url, payload, headers: { cookie } });
const as = (cookie: string) => ({
  get: (url: string) => app.inject({ url, headers: { cookie } }),
  put: (url: string, data: Buffer, headers: Record<string, string> = {}) =>
    app.inject({
      method: 'PUT',
      url,
      payload: data,
      headers: { cookie, 'content-type': 'application/octet-stream', ...headers },
    }),
  json: (method: 'PUT' | 'PATCH' | 'POST' | 'DELETE', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } }),
});
const ids = (r: Res) => r.json().map((p: { id: string }) => p.id);

let admin: ReturnType<typeof as>, bob: ReturnType<typeof as>, cat: ReturnType<typeof as>;
let bobId = '',
  catId = '';

describe('accounts', () => {
  it('first run: the first account is an admin and gets the songs already on the server', async () => {
    const r = await post('/api/auth/setup', { username: 'Ana', password: 'secret1', displayName: 'Ana' });
    expect(r.statusCode).toBe(200);
    expect(r.json().user).toMatchObject({ username: 'ana', admin: true });
    expect(String(r.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Lax/);
    admin = as(cookieOf(r));
    expect(ids(await admin.get('/api/projects'))).toEqual(['old-song']);
    // only once
    expect((await post('/api/auth/setup', { username: 'eve', password: 'secret1' })).statusCode).toBe(409);
  });

  it('admins add users; nobody else can, and sign-up is closed by default', async () => {
    const b = await admin.json('POST', '/api/users', {
      username: 'bob',
      password: 'secret2',
      displayName: 'Bob',
    });
    expect(b.statusCode).toBe(200);
    bobId = b.json().id;
    catId = (await admin.json('POST', '/api/users', { username: 'cat', password: 'secret3' })).json().id;
    expect(
      (await admin.json('POST', '/api/users', { username: 'bob', password: 'secret9' })).statusCode,
    ).toBe(409);
    expect((await admin.json('POST', '/api/users', { username: 'x', password: '1' })).statusCode).toBe(400);
    expect((await post('/api/auth/signup', { username: 'eve', password: 'secret1' })).statusCode).toBe(403);
    bob = as(cookieOf(await post('/api/auth/login', { username: 'bob', password: 'secret2' })));
    cat = as(cookieOf(await post('/api/auth/login', { username: 'CAT', password: 'secret3' })));
    expect((await bob.json('POST', '/api/users', { username: 'dan', password: 'secret4' })).statusCode).toBe(
      403,
    );
  });

  it('rejects wrong passwords and slows down guessing', async () => {
    expect((await post('/api/auth/login', { username: 'bob', password: 'nope' })).statusCode).toBe(401);
    for (let i = 0; i < 8; i++) await post('/api/auth/login', { username: 'cat', password: 'nope' });
    expect((await post('/api/auth/login', { username: 'cat', password: 'secret3' })).statusCode).toBe(429);
  });

  it('keeps every user’s songs to themselves', async () => {
    expect(
      (await bob.put('/api/projects/bob-song', Buffer.from([1]), { 'x-song-title': 'Bob%20Song' }))
        .statusCode,
    ).toBe(200);
    expect(ids(await bob.get('/api/projects'))).toEqual(['bob-song']);
    expect(ids(await cat.get('/api/projects'))).toEqual([]);
    expect(ids(await admin.get('/api/projects'))).toEqual(['old-song']);
    // can't read, overwrite or delete someone else's song
    expect((await cat.get('/api/projects/bob-song')).statusCode).toBe(404);
    expect((await cat.put('/api/projects/bob-song', Buffer.from([2]))).json()).toEqual({ error: 'taken' });
    expect((await cat.json('DELETE', '/api/projects/bob-song')).statusCode).toBe(404);
    expect((await bob.get('/api/projects/bob-song')).rawPayload).toEqual(Buffer.from([1]));
    expect((await bob.get('/api/projects')).json()[0]).toMatchObject({ name: 'Bob Song', access: 'owner' });
  });

  it('records what each user opened recently', async () => {
    const list = (await bob.get('/api/projects')).json();
    expect(list[0].openedAt).toBeTruthy();
  });

  it('shares view-only or editable, and only the owner can share', async () => {
    expect(
      (await cat.json('PUT', '/api/projects/bob-song/shares', { userId: catId, access: 'edit' })).statusCode,
    ).toBe(403);
    await bob.json('PUT', '/api/projects/bob-song/shares', { userId: catId, access: 'view' });
    const shared = (await cat.get('/api/projects')).json();
    expect(shared[0]).toMatchObject({ id: 'bob-song', access: 'view', owner: { displayName: 'Bob' } });
    const got = await cat.get('/api/projects/bob-song');
    expect(got.headers['x-access']).toBe('view');
    expect((await cat.put('/api/projects/bob-song', Buffer.from([3]))).statusCode).toBe(403);

    await bob.json('PUT', '/api/projects/bob-song/shares', { userId: catId, access: 'edit' });
    const v = Number((await cat.get('/api/projects/bob-song')).headers['x-version']);
    const save = await cat.put('/api/projects/bob-song', Buffer.from([4]), { 'x-base-version': String(v) });
    expect(save.json().version).toBe(v + 1);
    // the owner still has it, with Cat's change
    expect((await bob.get('/api/projects/bob-song')).rawPayload).toEqual(Buffer.from([4]));
    expect((await bob.get('/api/projects/bob-song/shares')).json()).toEqual([
      { userId: catId, access: 'edit' },
    ]);
  });

  it('refuses a save based on an older version (someone else saved in between)', async () => {
    const r = await bob.put('/api/projects/bob-song', Buffer.from([5]), { 'x-base-version': '1' });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ error: 'conflict', updatedBy: 'cat' });
  });

  it('a recipient removing a shared song only takes it off their own list', async () => {
    await cat.json('DELETE', '/api/projects/bob-song');
    expect(ids(await cat.get('/api/projects'))).toEqual([]);
    expect(ids(await bob.get('/api/projects'))).toEqual(['bob-song']);
  });

  it('password changes need the current password', async () => {
    expect(
      (await bob.json('PUT', `/api/users/${bobId}/password`, { current: 'bad', password: 'newpass1' }))
        .statusCode,
    ).toBe(403);
    const ok = await bob.json('PUT', `/api/users/${bobId}/password`, {
      current: 'secret2',
      password: 'newpass1',
    });
    expect(ok.statusCode).toBe(200);
    bob = as(cookieOf(ok));
    expect((await post('/api/auth/login', { username: 'bob', password: 'newpass1' })).statusCode).toBe(200);
  });

  it('deleting a user hands their songs to the admin', async () => {
    expect((await bob.json('DELETE', `/api/users/${catId}`)).statusCode).toBe(403);
    await admin.json('DELETE', `/api/users/${bobId}`);
    expect(ids(await admin.get('/api/projects')).sort()).toEqual(['bob-song', 'old-song']);
    expect((await bob.get('/api/projects')).statusCode).toBe(401);
  });

  it('admin panel: stats, sign-up switch, sign a user out everywhere', async () => {
    expect((await cat.get('/api/admin/stats')).statusCode).toBe(403);
    const s = (await admin.get('/api/admin/stats')).json();
    expect(s).toMatchObject({ users: 2, admins: 1, signup: false, songs: 2 });
    expect(s.perUser.find((u: { username: string }) => u.username === 'ana')).toMatchObject({ songs: 2 });
    expect((await cat.json('PUT', '/api/admin/settings', { signup: true })).statusCode).toBe(403);
    expect((await admin.json('PUT', '/api/admin/settings', { signup: true })).json()).toEqual({
      signup: true,
    });
    expect((await post('/api/auth/state', {})).statusCode).toBe(404); // GET only
    expect((await app.inject({ url: '/api/auth/state' })).json().signup).toBe(true);
    expect((await post('/api/auth/signup', { username: 'eve', password: 'secret6' })).statusCode).toBe(200);
    await admin.json('PUT', '/api/admin/settings', { signup: null });
    expect((await post('/api/auth/signup', { username: 'fay', password: 'secret6' })).statusCode).toBe(403);
    expect((await admin.json('POST', `/api/users/${catId}/sign-out`)).json().ended).toBeGreaterThan(0);
    expect((await cat.get('/api/projects')).statusCode).toBe(401);
  });

  it('signing out ends the session', async () => {
    await cat.json('POST', '/api/auth/logout');
    expect((await cat.get('/api/projects')).statusCode).toBe(401);
  });

  it('survives a restart, and RIFFROLL_RESET_PASSWORD resets a forgotten password', async () => {
    await app.close();
    app = await start({ resetPassword: 'ana:fresh-start' });
    expect((await post('/api/auth/login', { username: 'ana', password: 'secret1' })).statusCode).toBe(401);
    const r = await post('/api/auth/login', { username: 'ana', password: 'fresh-start' });
    expect(r.statusCode).toBe(200);
    expect(ids(await as(cookieOf(r)).get('/api/projects')).sort()).toEqual(['bob-song', 'old-song']);
  });

  it('open sign-up when enabled', async () => {
    await app.close();
    app = await start({ openSignup: true });
    const r = await post('/api/auth/signup', { username: 'dan', password: 'secret5' });
    expect(r.json().user).toMatchObject({ username: 'dan', admin: false });
  });
});
