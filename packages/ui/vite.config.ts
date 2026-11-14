import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** Strict CSP for production builds (dev needs inline scripts for React Fast Refresh). */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' blob: data:",
  "connect-src 'self' blob: data:",
  "worker-src 'self' blob:",
].join('; ');

function csp(): Plugin {
  return {
    name: 'riffroll-csp',
    apply: 'build',
    transformIndexHtml: (html) =>
      html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

const TYPES: Record<string, string> = {
  '.json': 'application/json',
  '.sfz': 'text/plain; charset=utf-8',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.sf2': 'application/octet-stream',
};

/** Dev server: serve downloaded instrument packs at /instruments (the Fastify server does this in production). */
function instruments(): Plugin {
  const root = path.resolve(__dirname, '../../instruments/packs');
  return {
    name: 'riffroll-instruments',
    configureServer(server) {
      server.middlewares.use('/instruments', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '/').split('?')[0]);
        const file = path.resolve(root, '.' + path.posix.normalize('/' + rel));
        if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
          if (rel === '/index.json') {
            res.setHeader('content-type', 'application/json');
            return res.end('{"instruments":[]}');
          }
          return next();
        }
        res.setHeader('content-type', TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream');
        res.setHeader('content-length', String(statSync(file).size));
        createReadStream(file).pipe(res);
      });
    },
  };
}

/** the app's version (root package.json), shown in Settings */
const VERSION = JSON.parse(readFileSync(path.resolve(__dirname, '../../package.json'), 'utf8'))
  .version as string;

export default defineConfig({
  plugins: [react(), csp(), instruments()],
  define: { __APP_VERSION__: JSON.stringify(VERSION) },
  // relative base so the same build works from the Fastify server and Electron's app:// protocol
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080' },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
});
