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

  it('stores, lists, reads and deletes projects', async () => {
    const body = Buffer.from([1, 2, 3, 4]);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/projects/song-1',
      payload: body,
      headers: { 'content-type': 'application/octet-stream' },
    });
    expect(put.statusCode).toBe(200);
    const list = await app.inject('/api/projects');
    expect(list.json().map((p: { id: string }) => p.id)).toEqual(['song-1']);
    const get = await app.inject('/api/projects/song-1');
    expect(get.rawPayload.equals(body)).toBe(true);
    await app.inject({ method: 'DELETE', url: '/api/projects/song-1' });
    expect((await app.inject('/api/projects')).json()).toEqual([]);
  });

  it('rejects path traversal ids', async () => {
    const r = await app.inject('/api/projects/..%2F..%2Fetc');
    expect(r.statusCode).toBe(400);
  });

  it('basic auth protects routes when enabled', async () => {
    const a = await buildServer({
      uiDir: path.join(dir, 'nope'),
      projectsDir: path.join(dir, 'p2'),
      instrumentsDirs: [path.join(dir, 'i2')],
      basicAuth: 'band:secret',
    });
    expect((await a.inject('/api/projects')).statusCode).toBe(401);
    expect((await a.inject('/api/health')).statusCode).toBe(200);
    const ok = await a.inject({
      url: '/api/projects',
      headers: { authorization: 'Basic ' + Buffer.from('band:secret').toString('base64') },
    });
    expect(ok.statusCode).toBe(200);
    await a.close();
  });
});

describe('user instruments', () => {
  it('uploads an SFZ instrument, lists it in the merged index, and deletes it', async () => {
    const put = (url: string, payload: Buffer | string, type = 'application/octet-stream') =>
      app.inject({ method: 'PUT', url, payload, headers: { 'content-type': type } });
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
    await app.inject({ method: 'DELETE', url: '/api/instruments/user-test' });
    expect((await app.inject('/instruments/index.json')).json().instruments).toEqual([]);
  });
});
