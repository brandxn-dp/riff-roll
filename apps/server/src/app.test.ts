import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';

let dir: string;
let app: FastifyInstance;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'riffroll-'));
  app = await buildServer({
    uiDir: path.join(dir, 'nope'),
    projectsDir: path.join(dir, 'projects'),
    instrumentsDirs: [path.join(dir, 'instruments')],
  });
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

describe('server', () => {
  it('health', async () => {
    const r = await app.inject('/api/health');
    expect(r.json()).toEqual({ ok: true });
  });

  it('needs a signed-in user for songs', async () => {
    expect((await app.inject('/api/projects')).statusCode).toBe(401);
    expect((await app.inject('/api/auth/state')).json()).toMatchObject({ setupNeeded: true, user: null });
  });

  it('basic auth protects routes when enabled', async () => {
    const a = await buildServer({
      uiDir: path.join(dir, 'nope'),
      projectsDir: path.join(dir, 'p2'),
      instrumentsDirs: [path.join(dir, 'i2')],
      basicAuth: 'band:secret',
    });
    expect((await a.inject('/api/auth/state')).statusCode).toBe(401);
    expect((await a.inject('/api/health')).statusCode).toBe(200);
    const ok = await a.inject({
      url: '/api/auth/state',
      headers: { authorization: 'Basic ' + Buffer.from('band:secret').toString('base64') },
    });
    expect(ok.statusCode).toBe(200);
    await a.close();
  });
});

describe('user instruments', () => {
  it('uploads an SFZ instrument, lists it in the merged index, and deletes it', async () => {
    const setup = await app.inject({
      method: 'POST',
      url: '/api/auth/setup',
      payload: { username: 'admin', password: 'secret1' },
    });
    const cookie = String(setup.headers['set-cookie']).split(';')[0];
    const put = (url: string, payload: Buffer | string, type = 'application/octet-stream') =>
      app.inject({ method: 'PUT', url, payload, headers: { 'content-type': type, cookie } });
    expect(
      (await put('/api/instruments/user-test/files/My%20Kit/kit.sfz', Buffer.from('<region> sample=a.wav')))
        .statusCode,
    ).toBe(200);
    expect(
      (await put('/api/instruments/user-test/files/My%20Kit/a.wav', Buffer.from([1, 2]))).statusCode,
    ).toBe(200);
    // refuses traversal and odd file types
    // traversal is clamped into the instrument's own folder
    await put('/api/instruments/user-test/files/..%2F..%2Fevil.sfz', Buffer.from('x'));
    expect(existsSync(path.join(dir, 'instruments', 'evil.sfz'))).toBe(false);
    expect(existsSync(path.join(dir, 'evil.sfz'))).toBe(false);
    expect((await put('/api/instruments/user-test/files/run.sh', Buffer.from('x'))).statusCode).toBe(400);
    expect((await put('/api/instruments/not-user/files/a.sfz', Buffer.from('x'))).statusCode).toBe(400);
    const fin = await put(
      '/api/instruments/user-test',
      JSON.stringify({ name: 'My Kit', role: 'drums', sfz: 'My Kit/kit.sfz' }),
      'application/json',
    );
    expect(fin.json().sfz).toBe('user-test/My Kit/kit.sfz');
    const idx = (await app.inject('/instruments/index.json')).json();
    expect(idx.instruments.map((i: { id: string }) => i.id)).toContain('user-test');
    expect((await app.inject('/instruments/user-test/My%20Kit/kit.sfz')).statusCode).toBe(200);
    await app.inject({ method: 'DELETE', url: '/api/instruments/user-test', headers: { cookie } });
    expect((await app.inject('/instruments/index.json')).json().instruments).toEqual([]);
  });
});
