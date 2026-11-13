import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import {
  finalizeUserInstrument,
  mergedIndex,
  putUserFile,
  removeUserInstrument,
  type UserInstrumentInfo,
} from './instruments/user.js';
import { registerAccounts } from './routes.js';

export interface ServerOptions {
  uiDir: string;
  projectsDir: string;
  /** Searched in order: user volume first, then instruments bundled into the image. */
  instrumentsDirs: string[];
  /** "user:password" — enables HTTP basic auth for every route except /api/health. */
  basicAuth?: string;
  logger?: boolean;
  /** Anyone can create an account from the sign-in screen (otherwise only admins add users). */
  openSignup?: boolean;
  /** "username:newpassword" — set that password at startup (for a forgotten admin password). */
  resetPassword?: string;
  /** Reports instrument download progress for the UI (first start without bundled instruments). */
  instrumentStatus?: () => unknown;
  /** shown in the admin panel */
  version?: string;
}

const MAX_PROJECT_BYTES = 512 * 1024 * 1024;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export async function buildServer(opts: ServerOptions): Promise<FastifyInstance> {
  // trustProxy: honour X-Forwarded-Proto/For from a reverse proxy (secure cookies, sign-in rate limits)
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: MAX_PROJECT_BYTES, trustProxy: true });
  await mkdir(opts.projectsDir, { recursive: true });
  await mkdir(opts.instrumentsDirs[0], { recursive: true });

  if (opts.basicAuth) {
    const expected = 'Basic ' + Buffer.from(opts.basicAuth).toString('base64');
    app.addHook('onRequest', async (req, reply) => {
      // /mcp has its own token (Claude can't send two Authorization headers)
      if (req.url === '/api/health' || req.url.split('?')[0] === '/mcp') return;
      const got = req.headers.authorization ?? '';
      if (!safeEqual(got, expected)) {
        reply.header('WWW-Authenticate', 'Basic realm="Riff Roll"').code(401).send('Authentication required');
      }
    });
  }

  app.addContentTypeParser(
    ['application/octet-stream', 'application/zip'],
    { parseAs: 'buffer', bodyLimit: MAX_PROJECT_BYTES },
    (_req, body, done) => done(null, body),
  );

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/instruments/status', async () => opts.instrumentStatus?.() ?? { state: 'ready' });

  await registerAccounts(app, opts);

  // merged index of every installed instrument across all instrument dirs
  app.get('/instruments/index.json', async (_req, reply) => {
    reply.header('cache-control', 'no-store');
    return mergedIndex(opts.instrumentsDirs);
  });

  // user instruments: upload files one by one, then finalize (writes instrument.json + index)
  const userRoot = opts.instrumentsDirs[0];
  app.put<{ Params: { id: string; '*': string }; Body: Buffer }>(
    '/api/instruments/:id/files/*',
    async (req, reply) => {
      if (!Buffer.isBuffer(req.body)) return reply.code(415).send({ error: 'send application/octet-stream' });
      try {
        await putUserFile(userRoot, req.params.id, req.params['*'], req.body);
        return { ok: true };
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );
  app.put<{ Params: { id: string }; Body: UserInstrumentInfo }>(
    '/api/instruments/:id',
    async (req, reply) => {
      try {
        return await finalizeUserInstrument(userRoot, req.params.id, req.body);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
    },
  );
  app.delete<{ Params: { id: string } }>('/api/instruments/:id', async (req, reply) => {
    try {
      await removeUserInstrument(userRoot, req.params.id);
      return { ok: true };
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message });
    }
  });

  await app.register(fastifyStatic, {
    root: opts.instrumentsDirs.filter((d) => existsSync(d)).map((d) => path.resolve(d)),
    prefix: '/instruments/',
    decorateReply: false,
    maxAge: '7d',
  });

  if (existsSync(opts.uiDir)) {
    await app.register(fastifyStatic, { root: path.resolve(opts.uiDir), prefix: '/' });
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/instruments/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  } else {
    app.get('/', async () => ({ message: `UI build not found at ${opts.uiDir}. Run "pnpm build" first.` }));
  }

  return app;
}
