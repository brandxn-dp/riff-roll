# Decisions

Non-obvious choices and why. Newest at the bottom of each section.

## Tooling

- **TypeScript 6.0, not 7.0.** TS 7 (the native Go compiler) is out, but typescript-eslint 8 supports `<6.1`. 6.0
  keeps lint + type-check working together. Revisit when typescript-eslint supports 7.
- **pnpm 10.12 pinned via `packageManager`.** Corepack's default (pnpm 12) failed to install on this machine; 10.x is
  the widely deployed line. Electron's binary download is a postinstall script; pnpm 10 blocks build scripts unless
  listed in `pnpm.onlyBuiltDependencies` (done). If `electron` reports a missing binary, run
  `node apps/desktop/node_modules/electron/install.js`.
- **Workspace packages are consumed as TypeScript source** (`main: src/index.ts`). Vite and Vitest compile them
  directly, so there is no package build step or stale `dist` to worry about. The only compiled Node target is
  `apps/server` (tsc → `dist`), and the Electron main/preload (esbuild → CJS).
- **Fonts are bundled** with `@fontsource/*` (OFL) instead of Google Fonts, because the desktop app must work offline
  and the strict CSP only allows `'self'`.
- **CSP is injected only in production builds** by a small Vite plugin; the dev server needs inline scripts for React
  Fast Refresh.

## Desktop

- **Custom `app://` protocol** (registered as standard + secure) serves the UI and instruments in the packaged app.
  `file://` is not a secure context in all cases and breaks `fetch` for local files; `app://` gives us a secure origin
  so AudioWorklet, Cache Storage and fetch behave exactly as on `https://`/`localhost`.
- **Sandboxed preload, bundled to CJS with esbuild**, exposing a narrow `window.riffroll` API (projects, dialogs, menu
  commands). No generic `ipcRenderer` exposure.
- `RIFFROLL_SMOKE=1` makes the desktop app print what the renderer sees and quit; used to smoke-test without a human.

## Server / Docker

- **Projects are stored as `.riff` blobs** (`/data/projects/<id>.riff`) written via temp-file + rename so a crash
  never leaves a half-written file. Ids are restricted to `[A-Za-z0-9_-]` (no path traversal).
- **Basic auth** is implemented as a small `onRequest` hook (constant-time compare) instead of another dependency.
  `/api/health` stays open for the Docker healthcheck.
- **Two instrument directories**: the user volume (`/data/instruments`, writable, user's own SFZ/IRs) and the
  instruments baked into the image (`/app/instruments`). Static serving searches both; `/instruments/index.json` is
  a merged index. With `INCLUDE_INSTRUMENTS=false` the server downloads the default packs into the volume on first
  start and reports progress at `/api/instruments/status`.
- The fetch logic lives in `apps/server/src/instruments/fetch.ts` so the server can reuse it at runtime;
  `scripts/fetch-instruments.ts` is a thin CLI over it. Archives are `.7z`/`.zip`, extracted with `7zip-bin`.

## Instruments

- Guitar: FreePats FSBS Electric Guitar **Direct** SFZ+FLAC (CC0), as specified.
- Bass: FreePats Yamaha RBX picked + finger SFZ+FLAC (CC0, ~3 MB each). Growlybass is 167 MB and Black And Blue is
  1 GB; the FreePats set is small enough to bundle in every installer.
- **SHA-256 pins start as `null`**: the script prints each archive's hash on first download; it is then pinned in the
  manifest so later downloads are verified.
