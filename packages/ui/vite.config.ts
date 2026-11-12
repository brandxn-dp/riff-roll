import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

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

export default defineConfig({
  plugins: [react(), csp()],
  // relative base so the same build works from the Fastify server and Electron's app:// protocol
  base: './',
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8080', '/instruments': 'http://localhost:8080' },
  },
  build: { outDir: 'dist', sourcemap: true, chunkSizeWarningLimit: 4000 },
  worker: { format: 'es' },
});
