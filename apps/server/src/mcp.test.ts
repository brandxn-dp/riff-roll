import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from './app.js';

let dir: string;
let app: FastifyInstance;
let base = '';
let cookie = '';

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'riffroll-mcp-'));
  app = await buildServer({
    uiDir: path.join(dir, 'nope'),
    projectsDir: path.join(dir, 'projects'),
    instrumentsDirs: [path.join(dir, 'instruments')],
    version: '9.9.9',
  });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const a = app.server.address();
  base = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
  const r = await fetch(base + '/api/auth/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'secret1' }),
  });
  cookie = String(r.headers.get('set-cookie')).split(';')[0];
});
afterAll(async () => {
  await app.close();
  await rm(dir, { recursive: true, force: true });
});

const api = (url: string, method = 'GET', body?: unknown) =>
  fetch(base + url, {
    method,
    headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
const mcp = (token: string, body: unknown) =>
  fetch(base + '/mcp', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

/** A fake browser tab: reads the event stream and answers every call. */
async function fakeTab(answer: (name: string, args: Record<string, unknown>) => unknown) {
  const ctrl = new AbortController();
  const r = await fetch(base + '/api/mcp/live', { headers: { cookie }, signal: ctrl.signal });
  const reader = r.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let conn = '';
  const ready = new Promise<void>((resolve) => {
    void (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (\w+)$/m.exec(chunk)?.[1];
            const data = /^data: (.*)$/m.exec(chunk)?.[1];
            if (!ev || !data) continue;
            const d = JSON.parse(data);
            if (ev === 'hello') {
              conn = d.conn;
              resolve();
            }
            if (ev === 'call')
              await api('/api/mcp/result', 'POST', {
                id: d.id,
                result: { content: [{ type: 'text', text: JSON.stringify(answer(d.name, d.args)) }] },
              });
          }
        }
      } catch {
        /* aborted */
      }
    })();
  });
  await ready;
  return { conn, close: () => ctrl.abort() };
}

describe('Claude (MCP)', () => {
  let token = '';

  it('needs a token, which a signed-in user creates in settings', async () => {
    expect((await mcp('nope', { jsonrpc: '2.0', id: 1, method: 'initialize' })).status).toBe(401);
    expect((await (await api('/api/mcp/token')).json()).token).toBeNull();
    token = (await (await api('/api/mcp/token', 'POST')).json()).token;
    expect(token).toMatch(/^rr_/);
    expect((await (await api('/api/mcp/token')).json()).token.createdAt).toBeTruthy();
    // signed-out callers can't make one
    expect((await fetch(base + '/api/mcp/token', { method: 'POST' })).status).toBe(401);
  });

  it('speaks MCP: initialize, tools/list, notifications', async () => {
    const init = await (
      await mcp(token, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
      })
    ).json();
    expect(init.result).toMatchObject({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'riff-roll', version: '9.9.9' },
      capabilities: { tools: {} },
    });
    expect((await mcp(token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    const list = await (await mcp(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toContain('add_notes');
    const unknown = await (await mcp(token, { jsonrpc: '2.0', id: 3, method: 'nope' })).json();
    expect(unknown.error.code).toBe(-32601);
    expect((await fetch(base + '/mcp')).status).toBe(405);
  });

  it('says so when no tab is open', async () => {
    const r = await (
      await mcp(token, {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'get_song', arguments: {} },
      })
    ).json();
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/isn’t open/);
  });

  it('runs tool calls in the open tab and returns the answer', async () => {
    const tab = await fakeTab((name, args) => ({ ran: name, args }));
    const r = await (
      await mcp(token, {
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'add_notes', arguments: { notes: [{ pitch: 'E2' }] } },
      })
    ).json();
    expect(JSON.parse(r.result.content[0].text)).toEqual({
      ran: 'add_notes',
      args: { notes: [{ pitch: 'E2' }] },
    });
    // the most recently used tab gets the calls
    const tab2 = await fakeTab(() => 'second');
    const ask = () =>
      mcp(token, {
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'get_song', arguments: {} },
      }).then((x) => x.json());
    expect((await ask()).result.content[0].text).toBe('"second"');
    await api('/api/mcp/active', 'POST', { conn: tab.conn });
    expect(JSON.parse((await ask()).result.content[0].text).ran).toBe('get_song');
    tab.close();
    tab2.close();
  });

  it('a revoked token stops working', async () => {
    await api('/api/mcp/token', 'DELETE');
    expect((await mcp(token, { jsonrpc: '2.0', id: 7, method: 'ping' })).status).toBe(401);
  });
});
