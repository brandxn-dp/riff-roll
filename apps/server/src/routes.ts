/** Sign-in, users, per-user songs and sharing. */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import { readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { riffTitle } from './riff-title.js';
import { Accounts, HttpError, SESSION_DAYS, publicUser, type User } from './accounts.js';
import type { ServerOptions } from './app.js';
import { mergedIndex } from './instruments/user.js';
import { McpRelay } from './mcp/relay.js';
import { handleBody } from './mcp/protocol.js';

const ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const COOKIE = 'rr_session';
/** Routes that work signed out. Everything else under /api/ needs a session. */
const OPEN = new Set([
  '/api/health',
  '/api/instruments/status',
  '/api/auth/state',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/signup',
  '/api/auth/logout',
]);

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function setSessionCookie(req: FastifyRequest, reply: FastifyReply, token: string | null) {
  const secure = req.protocol === 'https' ? '; Secure' : '';
  reply.header(
    'set-cookie',
    token
      ? `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`
      : `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
  );
}

/** Slow down password guessing: after 8 failures for an address + username, wait 10 minutes. */
class Throttle {
  private fails = new Map<string, { n: number; until: number }>();
  check(key: string) {
    const f = this.fails.get(key);
    if (f && f.until > Date.now()) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  }
  fail(key: string) {
    const f = this.fails.get(key) ?? { n: 0, until: 0 };
    f.n++;
    if (f.n >= 8) [f.n, f.until] = [0, Date.now() + 10 * 60_000];
    this.fails.set(key, f);
  }
  ok(key: string) {
    this.fails.delete(key);
  }
}

export async function registerAccounts(app: FastifyInstance, opts: ServerOptions) {
  const accounts = await Accounts.open(opts.projectsDir);
  const throttle = new Throttle();
  const started = Date.now();
  // settings an admin can change at runtime (override the environment variables)
  const settingsFile = path.join(opts.projectsDir, 'server-settings.json');
  let serverSettings: { signup?: boolean } = {};
  try {
    if (existsSync(settingsFile)) serverSettings = JSON.parse(await readFile(settingsFile, 'utf8'));
  } catch (e) {
    app.log.warn(`server-settings.json unreadable: ${(e as Error).message}`);
  }
  const signupOpen = () => serverSettings.signup ?? !!opts.openSignup;
  const relay = new McpRelay();
  app.addHook('onClose', async () => relay.closeAll());
  const projectFile = (id: string) => path.join(opts.projectsDir, `${id}.riff`);

  /** .riff files on disk that the library doesn't know yet, with their titles. */
  const unknownFiles = async () => {
    const out = [];
    for (const f of (await readdir(opts.projectsDir)).filter((x) => x.endsWith('.riff'))) {
      const id = f.slice(0, -5);
      if (!ID_RE.test(id) || accounts.song(id)) continue;
      const file = path.join(opts.projectsDir, f);
      const s = await stat(file);
      out.push({
        id,
        updatedAt: s.mtime.toISOString(),
        size: s.size,
        title: riffTitle(await readFile(file)),
      });
    }
    return out;
  };
  /** Songs that are on disk but not in the library (saved before accounts, or copied in by hand) go to an admin. */
  const claimUnowned = async () => {
    const admin = accounts.users().find((u) => u.admin);
    if (admin) await accounts.claimUnowned(await unknownFiles(), admin.id);
  };
  await claimUnowned();
  if (opts.resetPassword) {
    const [name, ...pw] = opts.resetPassword.split(':');
    const u = accounts.users().find((x) => x.username === name.trim().toLowerCase());
    if (u) {
      await accounts
        .setPassword(u.id, pw.join(':'))
        .catch((e) => app.log.error(`RIFFROLL_RESET_PASSWORD: ${e.message}`));
      app.log.warn(
        `password for "${u.username}" was reset from RIFFROLL_RESET_PASSWORD; remove that variable now`,
      );
    } else app.log.warn(`RIFFROLL_RESET_PASSWORD: no user called "${name}"`);
  }

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    req.user = accounts.sessionUser(cookie(req, COOKIE));
    const url = req.url.split('?')[0];
    if (!url.startsWith('/api/') || OPEN.has(url)) return;
    if (!req.user) return reply.code(401).send({ error: 'Sign in first.' });
  });
  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.code(status).send({ error: (err as Error).message });
  });

  const me = (req: FastifyRequest) => req.user!;
  const admin = (req: FastifyRequest) => {
    if (!req.user?.admin) throw new HttpError(403, 'Only admins can do that.');
    return req.user;
  };
  const body = (req: FastifyRequest) =>
    (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, unknown>;
  const songId = (id: string) => {
    if (!ID_RE.test(id)) throw new HttpError(400, 'bad id');
    return id;
  };
  const signIn = async (req: FastifyRequest, reply: FastifyReply, user: User) => {
    setSessionCookie(req, reply, await accounts.startSession(user.id));
    return { user: publicUser(user) };
  };

  // ---------------- auth ----------------
  app.get('/api/auth/state', async (req) => ({
    accounts: true,
    setupNeeded: !accounts.hasUsers,
    signup: signupOpen(),
    user: req.user ? publicUser(req.user) : null,
  }));

  // first run: the first account is an admin and takes over the songs that are already there
  app.post('/api/auth/setup', async (req, reply) => {
    if (accounts.hasUsers) throw new HttpError(409, 'This server is already set up. Sign in instead.');
    const b = body(req);
    const user = await accounts.createUser({ ...b, admin: true });
    await claimUnowned();
    return signIn(req, reply, user);
  });

  app.post('/api/auth/signup', async (req, reply) => {
    if (!signupOpen()) throw new HttpError(403, 'Ask an admin to create an account for you.');
    if (!accounts.hasUsers) throw new HttpError(409, 'Set the server up first.');
    const b = body(req);
    const user = await accounts.createUser({
      username: b.username,
      password: b.password,
      displayName: b.displayName,
    });
    return signIn(req, reply, user);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const b = body(req);
    const key = `${req.ip}:${String(b.username ?? '').toLowerCase()}`;
    throttle.check(key);
    const user = await accounts.verify(b.username, b.password);
    if (!user) {
      throttle.fail(key);
      throw new HttpError(401, 'Wrong username or password.');
    }
    throttle.ok(key);
    return signIn(req, reply, user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await accounts.endSession(cookie(req, COOKIE));
    setSessionCookie(req, reply, null);
    return { ok: true };
  });

  // ---------------- users ----------------
  app.get('/api/users', async () => accounts.users().map(publicUser));

  app.post('/api/users', async (req) => {
    admin(req);
    const b = body(req);
    return publicUser(
      await accounts.createUser({
        username: b.username,
        password: b.password,
        displayName: b.displayName,
        admin: b.admin === true,
      }),
    );
  });

  app.patch<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const b = body(req);
    const self = me(req).id === req.params.id;
    if (!self) admin(req);
    // admins change admin rights; anyone can change their own display name
    const patch = { displayName: b.displayName, admin: self && !me(req).admin ? undefined : b.admin };
    return publicUser(await accounts.updateUser(req.params.id, patch));
  });

  app.put<{ Params: { id: string } }>('/api/users/:id/password', async (req, reply) => {
    const b = body(req);
    const user = me(req);
    if (user.id === req.params.id) {
      if (!(await accounts.verify(user.username, b.current)))
        throw new HttpError(403, 'Your current password is wrong.');
      await accounts.setPassword(user.id, b.password);
      return signIn(req, reply, user); // keep this device signed in
    }
    admin(req);
    await accounts.setPassword(req.params.id, b.password);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/users/:id', async (req) => {
    const a = admin(req);
    await accounts.deleteUser(req.params.id, a.id);
    return { ok: true };
  });

  // ---------------- Claude (MCP) ----------------
  // Claude → POST /mcp with the user's token → their open tab runs the tool → result back to Claude
  app.post('/mcp', async (req, reply) => {
    const token = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
    const user = accounts.mcpUser(token || undefined);
    if (!user) {
      reply.header('www-authenticate', 'Bearer');
      return reply.code(401).send({ error: 'Missing or wrong token (Riff Roll → Settings → Claude).' });
    }
    const out = await handleBody(req.body, (name, args) => relay.call(user.id, name, args), {
      version: opts.version ?? '0',
    });
    if (!out) return reply.code(202).send();
    return out;
  });
  app.get('/mcp', async (_req, reply) => reply.code(405).header('allow', 'POST').send());

  app.get('/api/mcp/token', async (req) => ({
    token: accounts.mcpTokenInfo(me(req).id),
    tabs: relay.connected(me(req).id),
  }));
  app.post('/api/mcp/token', async (req) => ({ token: await accounts.createMcpToken(me(req).id) }));
  app.delete('/api/mcp/token', async (req) => {
    await accounts.revokeMcpToken(me(req).id);
    return { ok: true };
  });
  // the open tab: event stream of calls, results back, "this tab is the one I'm using"
  app.get('/api/mcp/live', (req, reply) => {
    reply.hijack();
    const conn = relay.open(me(req).id, reply.raw);
    req.raw.on('close', () => relay.close(conn));
  });
  app.post('/api/mcp/result', async (req) => {
    const b = body(req);
    return { ok: relay.result(me(req).id, String(b.id ?? ''), b.result) };
  });
  app.post('/api/mcp/active', async (req) => {
    relay.touch(String(body(req).conn ?? ''), me(req).id);
    return { ok: true };
  });

  // ---------------- admin ----------------
  app.get('/api/admin/stats', async (req) => {
    admin(req);
    const instruments = (await mergedIndex(opts.instrumentsDirs)).instruments.length;
    const mem = process.memoryUsage();
    return {
      version: opts.version ?? 'unknown',
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptime: Math.round((Date.now() - started) / 1000),
      memory: mem.rss,
      instruments,
      signup: signupOpen(),
      signupFromEnv: !!opts.openSignup,
      basicAuth: !!opts.basicAuth,
      ...accounts.stats(),
    };
  });

  app.put('/api/admin/settings', async (req) => {
    admin(req);
    const b = body(req);
    // true / false override RIFFROLL_SIGNUP; null goes back to it
    if (typeof b.signup === 'boolean') serverSettings.signup = b.signup;
    else if (b.signup === null) delete serverSettings.signup;
    const tmp = settingsFile + '.tmp';
    await writeFile(tmp, JSON.stringify(serverSettings, null, 1), { mode: 0o600 });
    await rename(tmp, settingsFile);
    return { signup: signupOpen() };
  });

  app.post<{ Params: { id: string } }>('/api/users/:id/sign-out', async (req) => {
    admin(req);
    return { ended: await accounts.endSessionsOf(req.params.id) };
  });

  // ---------------- songs ----------------
  app.get('/api/projects', async (req) => {
    if (me(req).admin) await claimUnowned();
    return accounts.listFor(me(req).id);
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (req, reply) => {
    const id = songId(req.params.id);
    const access = accounts.access(me(req).id, id);
    const file = projectFile(id);
    // a song you can't see looks the same as one that doesn't exist
    if (!access || !existsSync(file)) throw new HttpError(404, 'not found');
    await accounts.recordOpen(me(req).id, id);
    const s = accounts.song(id)!;
    const owner = accounts.user(s.owner);
    reply.header('x-access', access);
    reply.header('x-version', String(s.version));
    reply.header('x-owner', encodeURIComponent(owner?.displayName ?? ''));
    return reply.type('application/zip').send(await readFile(file));
  });

  app.put<{ Params: { id: string }; Body: Buffer }>('/api/projects/:id', async (req, reply) => {
    const id = songId(req.params.id);
    if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'send application/octet-stream' });
    const user = me(req);
    const existing = accounts.song(id);
    if (existing) {
      const access = accounts.access(user.id, id);
      // somebody else's song with the same id (e.g. you imported a copy of their .riff): save under a new id
      if (!access) return reply.code(409).send({ error: 'taken' });
      if (access === 'view') throw new HttpError(403, 'This song is shared with you read-only.');
      const base = Number(req.headers['x-base-version']);
      if (Number.isFinite(base) && base > 0 && base !== existing.version) {
        const by = accounts.user(existing.updatedBy);
        return reply
          .code(409)
          .send({ error: 'conflict', updatedBy: by?.displayName ?? '', version: existing.version });
      }
    }
    // write-then-rename so a crash never leaves a half-written project
    const tmp = projectFile(id) + '.tmp';
    await writeFile(tmp, req.body);
    await rename(tmp, projectFile(id));
    let title = '';
    try {
      title = decodeURIComponent(String(req.headers['x-song-title'] ?? '')).slice(0, 200);
    } catch {
      /* keep the old title */
    }
    const s = await accounts.recordSave(user.id, id, { title, size: req.body.length });
    return { ok: true, id, size: req.body.length, version: s.version };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (req) => {
    const id = songId(req.params.id);
    const access = accounts.access(me(req).id, id);
    if (!access) throw new HttpError(404, 'not found');
    if (access === 'owner') {
      await rm(projectFile(id), { force: true });
      await accounts.removeSong(id);
    } else await accounts.leaveShare(me(req).id, id); // shared with me: just take it off my list
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id/shares', async (req) => {
    const id = songId(req.params.id);
    if (accounts.access(me(req).id, id) !== 'owner') throw new HttpError(404, 'not found');
    return accounts.sharesOf(id);
  });

  app.put<{ Params: { id: string } }>('/api/projects/:id/shares', async (req) => {
    const id = songId(req.params.id);
    if (accounts.access(me(req).id, id) !== 'owner')
      throw new HttpError(403, 'Only the owner can share this song.');
    const b = body(req);
    const access = b.access === 'view' || b.access === 'edit' ? b.access : null;
    await accounts.setShare(id, String(b.userId ?? ''), access);
    return accounts.sharesOf(id);
  });
}
