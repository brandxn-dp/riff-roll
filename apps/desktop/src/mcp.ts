/**
 * "Connect Claude" for the desktop app: a Model Context Protocol endpoint on http://127.0.0.1:<port>/mcp,
 * off until switched on in Settings → Claude. Only this computer can reach it (loopback), and every request needs
 * the token shown there. Tool calls are passed to the page, which runs them on the open song.
 */
import http from 'node:http';
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { app, BrowserWindow, ipcMain } from 'electron';
import { handleBody, toolError, type ToolResult } from '../../server/src/mcp/protocol';

interface Conf {
  enabled: boolean;
  port: number;
  token: string;
}
export const DEFAULT_PORT = 3917;
const file = () => path.join(app.getPath('userData'), 'mcp.json');
const newToken = () => 'rr_' + randomBytes(24).toString('base64url');

function load(): Conf {
  try {
    if (existsSync(file())) {
      const c = JSON.parse(readFileSync(file(), 'utf8')) as Partial<Conf>;
      return { enabled: !!c.enabled, port: Number(c.port) || DEFAULT_PORT, token: c.token || newToken() };
    }
  } catch {
    /* defaults */
  }
  return { enabled: false, port: DEFAULT_PORT, token: newToken() };
}
let conf: Conf;
const save = () => {
  try {
    writeFileSync(file(), JSON.stringify(conf), { mode: 0o600 });
  } catch {
    /* lasts this session */
  }
};

let server: http.Server | null = null;
let error = '';
const pending = new Map<string, { resolve: (r: ToolResult) => void; timer: NodeJS.Timeout }>();

/** Ask the page to run a tool, wait for its answer. */
function callPage(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win || win.isDestroyed()) return Promise.resolve(toolError('Riff Roll has no window open.'));
  const id = randomBytes(8).toString('hex');
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve(toolError('Riff Roll didn’t answer in time (is a dialog open?).'));
    }, 120_000);
    pending.set(id, { resolve, timer });
    win.webContents.send('mcp:call', { id, name, args });
  });
}

const sameToken = (a: string, b: string) => {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  const json = (code: number, body: unknown) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  if ((req.url ?? '').split('?')[0] !== '/mcp') return json(404, { error: 'The endpoint is /mcp' });
  // web pages can't drive it (DNS rebinding): only no Origin (desktop clients) or a local one
  const origin = req.headers.origin;
  if (origin && !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin))
    return json(403, { error: 'Forbidden origin' });
  const auth = String(req.headers.authorization ?? '');
  if (!sameToken(auth.replace(/^Bearer\s+/i, ''), conf.token)) {
    res.setHeader('www-authenticate', 'Bearer');
    return json(401, { error: 'Missing or wrong token (Riff Roll → Settings → Claude).' });
  }
  if (req.method !== 'POST') {
    res.writeHead(405, { allow: 'POST' });
    return res.end();
  }
  const chunks: Buffer[] = [];
  let size = 0;
  req.on('data', (c: Buffer) => {
    size += c.length;
    if (size > 4 * 1024 * 1024) req.destroy();
    else chunks.push(c);
  });
  req.on('end', async () => {
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      return json(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const out = await handleBody(body, callPage, { version: app.getVersion() });
    if (!out) {
      res.writeHead(202);
      return res.end();
    }
    json(200, out);
  });
}

function stopServer() {
  server?.close();
  server = null;
}

function startServer() {
  stopServer();
  error = '';
  if (!conf.enabled) return;
  const s = http.createServer(handle);
  s.on('error', (e: NodeJS.ErrnoException) => {
    error =
      e.code === 'EADDRINUSE'
        ? `Port ${conf.port} is already in use; pick another one.`
        : `Couldn’t start: ${e.message}`;
    server = null;
  });
  s.listen(conf.port, '127.0.0.1');
  server = s;
}

const state = () => ({
  enabled: conf.enabled,
  port: conf.port,
  token: conf.token,
  url: `http://127.0.0.1:${conf.port}/mcp`,
  running: !!server?.listening,
  error,
});

export function initMcp() {
  conf = load();
  save();
  ipcMain.on('mcp:result', (_e, id: string, result: ToolResult) => {
    const p = pending.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    pending.delete(id);
    p.resolve(result && Array.isArray(result.content) ? result : toolError('Bad answer from the page.'));
  });
  ipcMain.handle('mcp:state', async () => {
    // listening happens a moment after start
    await new Promise((r) => setTimeout(r, 150));
    return state();
  });
  ipcMain.handle('mcp:set', async (_e, p: { enabled?: boolean; port?: number }) => {
    if (typeof p?.enabled === 'boolean') conf.enabled = p.enabled;
    const port = Number(p?.port);
    if (Number.isInteger(port) && port >= 1024 && port <= 65535) conf.port = port;
    save();
    startServer();
    await new Promise((r) => setTimeout(r, 250));
    return state();
  });
  ipcMain.handle('mcp:regenerate', () => {
    conf.token = newToken();
    save();
    return state();
  });
  startServer();
}
