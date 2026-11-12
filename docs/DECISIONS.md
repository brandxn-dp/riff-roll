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

## Audio

- **One engine, one graph, live and offline.** `TrackGraph`/`MasterBus`/`ToneChainNode` take a `BaseAudioContext`,
  so WAV export renders through exactly the same nodes as live playback.
- **Pedal = crossfade between parallel amp chains.** Each tone is a full chain that is always connected; the DI
  sampler feeds all of them and a stomp runs a 10 ms equal-power crossfade (`setValueCurveAtTime`) between their
  output gains. Notes that are still ringing switch tone mid-sustain, like a real footswitch. Cost: N chains of CPU
  per track (2 by default) — acceptable; inactive-chain suspension is a possible later optimisation.
- **Lazy sample loading.** The FSBS guitar is 120 FLAC files (76 MB). Decoding everything would take hundreds of MB
  of RAM, so samples are decoded per pitch range when a song needs them (`prepare()` before playback, on demand for
  previews). Fetches go through Cache Storage on http(s) so a browser downloads each file once.
- **Cabinet IRs are synthesised** (`impulses.ts`): an impulse + early cabinet reflections through each cab's
  modelled frequency response, rendered once with `OfflineAudioContext`. No third-party IR files ship, so there's no
  redistribution question. User IR WAVs are supported via `ToneChainNode.setUserIR`.
- **Amp sim** is Web Audio nodes: drive pedal (mid-hump → tanh), amp (tight low-cut → 4× oversampled asymmetric
  waveshaper → optional second gain stage → tone stack → power-amp saturation). The noise gate is an AudioWorklet
  (`worklets/gate-processor.js`); without a secure origin it is skipped and the rest still works.
- **Preset levels were matched by measurement, not by ear.** I can't listen, so I rendered an open Em chord and a
  palm-muted E5 chug through every preset offline and set each voicing's output compensation so they land at a
  similar RMS (guitar ≈0.16–0.22, bass ≈0.2). Tone *character* still needs a human ear; that's what the dev A/B
  page (milestone 9) is for. The DI samples are recorded hot, so each track has a DI trim (guitar 0.35).
- **Palm mute / dead notes**: the default pack has no palm-mute samples, so the sampler uses a short envelope +
  low-pass (spec's fallback).
- **Playback speed without pitch change** comes for free: we schedule note events at a scaled tempo; no audio is
  time-stretched.
- **spessasynth_lib is not wired in yet.** None of the default instruments are SF2. It is planned for user SF2/SF3
  instruments (Instruments panel); until then only SFZ is supported.
- **Fallback sound**: if no packs are installed, a Karplus-Strong pluck rendered into buffers is played through the
  same SFZ sampler and the status bar says to run `pnpm fetch-instruments`. It never replaces installed samples.

## Drums

- **Big Rusty Drums (CC0) instead of the Muldjord kit**: no attribution requirement, and its release is a single
  zip. The full kit is 620 MB, so `fetch-instruments` reads the zip's central directory and pulls only the needed
  files with HTTP range requests (`zipremote.ts`): close + overhead mics, every velocity layer, 2 round robins —
  492 files / ~75 MB. No 620 MB download, no unzip step.
- **Normalised kit SFZ.** The kit's own programs depend on CC-driven mic blends, `#include`s and curves. Rather than
  implement that SFZ superset, the fetch step writes `riffroll-kit.sfz` in Riff Roll's own drum keymap
  (`packages/core/src/drums.ts`): one key per lane, close and overhead regions layered (tagged `riffroll_mic=`),
  hi-hat and cymbal choke groups via `group`/`off_by`. Any kit can be supported by adding a mapping table.
- The kit has **no splash**; the splash lane plays the 17" crash tuned up a fifth. Ghost notes are the snare at ~1/3
  velocity (soft layers), flams are a grace hit 28 ms early.
- **Drum mixer** = per-piece gain, close/overhead balance (applied per region), and a kit-bus parallel compressor.
- For drum tracks the "piano roll" view *is* the drum grid (named lanes instead of keys, as the spec asks), so there
  is one editor to learn for drums.
- A synthesised fallback kit (same keymap) plays when no kit is installed.
