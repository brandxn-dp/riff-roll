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

## Tab, notation, techniques

- **Notation via AlphaTex, not alphaTab's object model.** The notation view converts the song to AlphaTex text
  (`packages/core/src/alphatex.ts`) and calls `api.tex()`. The text format is stable, testable without a DOM, and
  alphaTab never becomes the source of truth. alphaTab renders on the main thread (`useWorkers: false`) with Bravura
  loaded through Vite `?url` imports, which keeps the strict CSP (`script-src 'self'`) and works under `app://`.
- **Percussion AlphaTex** needs `:8 (36 42)` (duration first); `42.8` is parsed as fret 42 / string 8. Found by
  probing the parser; the generator emits the duration-first form for drum tracks.
- **Rhythm quantisation** (`rhythm.ts`) turns free-timed notes into notatable beats: plain/dotted values first,
  triplets only when needed, ties across beats and bars, rests for gaps. Shared by notation, tab rhythm stems and
  (next milestone) MusicXML / Guitar Pro export.
- **Notation editing is limited in v1** (allowed by the spec): click a beat to select its notes and move the cursor;
  the selection is outlined using alphaTab's bounds lookup. All editing happens in the roll / tab / inspector.
- **Hammer-on/pull-off is stored on the destination note** ("from the previous note on this string"); exporters move
  it to the origin note where formats expect that (AlphaTex `h`).
- **Technique playback** with a single DI sample set: hammer/pull/tap = softer, faster attack (no pick transient);
  legato/shift slides = pitch glide from the previous note on the string; bends/whammy/vibrato = detune
  automation; natural harmonics use the harmonic series by fret (12→+12, 7→+19, 5→+24 …) with a high-pass;
  pinch = +19 semitones; tremolo picking/trills re-trigger the note; staccato halves the length.
- **Keyboard tab entry** follows Guitar Pro where it doesn't clash with the browser: digits enter frets (two digits
  within 0.7 s), +/− change the value, `.` dotted, `T` triplet, `R` rest, `L` tie, Ins/Ctrl+Del insert/delete beat,
  letter keys toggle techniques. Entering a fret pins the note to that string.
- **Repeats** are expanded into a playback order of tick segments (`repeats.ts`) that the scheduler walks, including
  alternate endings; the loop region overrides it.

## Files

- **`.riff`** = zip (fflate) with `song.json` (+ a `mimetype` entry and `assets/`). `song.json` is validated with
  zod and migrated by `schemaVersion` on load; a bad file gives a readable error instead of a broken session.
- **Autosave = crash recovery.** Every edit is saved to the active storage adapter 1.5 s after you stop editing,
  under the song's id. On startup the most recently edited song is reopened, so a crash or closed tab loses at most
  ~1.5 s. "Save" (Ctrl+S) just saves immediately; "Download .riff" / desktop "Save As…" writes a file elsewhere.
- **Imports**: Guitar Pro 3/4/5/GPX/GP7/GP8 and MusicXML go through alphaTab's `ScoreLoader` and are mapped to our
  model (strings pinned as in the file, techniques, tempo/time-signature/sections/repeats/alternate endings).
  GP instrument automations between clean (24–28) and overdrive/distortion (29–31, bass 34) programs become pedal
  stomps. MIDI import/export is our own SMF code (alphaTab has no MIDI importer); channel 10 → drum lanes.
  When a file has no tab tuning (common in MusicXML), a standard tuning that reaches every note is chosen.
- **Exports**: MIDI (stomps → program change + CC 80), MusicXML 4.0 (notation + TAB staff, technical marks,
  stomps as words), **Guitar Pro 7** via AlphaTex → alphaTab `Gp7Exporter` (stomps become instrument automations,
  so they round-trip), WAV mix and per-track stems (24-bit, offline render through the live graph; stems zipped).
- **No MP3 export**: every maintained MP3 encoder for the browser is LAME-based (LGPL) and none is permissively
  licensed, which is the spec's condition. WAV is lossless; users can convert.
- **PDF / print** renders every track (notation + tab, light theme) into a print-only container and opens the
  system print dialog; "Save as PDF" there produces the PDF on all OSes and in Electron (window.open-based
  `api.print()` is blocked by the desktop app's window-open policy, so it isn't used).
- **ASCII tab** (Ctrl+Shift+C) copies the selected bars (or 4 bars from the cursor) on a 1/16 grid with simple
  technique marks (h, /, b, ~, <harm>, (ghost), PM).

## Packaging

- **Docker build stage is Debian (bookworm-slim), runtime is Alpine.** The bundled 7-Zip binary (7zip-bin) needs
  glibc; it also loses its executable bit under pnpm, so the fetch code `chmod`s it before use. Instruments are
  fetched in their own layer before `COPY . .`, so code changes don't re-download ~160 MB.
- The image runs as the unprivileged `node` user, exposes 8080, and has two volumes (`/data/projects`,
  `/data/instruments`). Final size ≈ 635 MB with instruments, ≈ 290 MB without (`INCLUDE_INSTRUMENTS=false`).
- **Host port is configurable** (`RIFFROLL_PORT`, default 8080) because 8080 is often taken on dev machines.
- **Sample URLs are encoded with `encodeURI` per path segment**, not `encodeURIComponent`: `@fastify/static`/`send`
  decode with `decodeURI`, which leaves `%2B` alone, so the FreePats folder `SFZ+FLAC` 404'd. Found by running the
  real container; covered by a unit test.
- **Electron installers**: NSIS (Windows, per-user, choose directory), universal dmg (macOS), AppImage + deb
  (Linux). Instruments ship inside the installer (~160 MB, offline-first); `RIFFROLL_INSTRUMENTS_DIR` points the app
  at another folder. The Windows installer is ~285 MB. macOS signing/notarisation is wired to optional secrets.
- The app icon is generated from the same shapes as the SVG favicon by `scripts/gen-icon.mjs` (no image deps).
- README screenshots are captured by the packaged app itself (`RIFFROLL_SCREENSHOT=<file>`), so they show the real
  build.

## Polish (milestone 9, partial)

- **Tone editor** (Tones button): pedalboard blocks in signal order with every chain parameter, tone list
  (add from preset, rename, colour, delete), pedal mode/toggle pair/start tone, user IR loading (stored inside the
  `.riff` as an asset), and an **A/B listening tool** (palm-muted chug, open chord, lick; A→B→A→B).
- Humanize, custom tunings (type the open strings) and fret count are in the mixer.
- Performance, measured in a visible Electron window on a 10-minute, 6-track, 14k-event song: scroll and playback
  frames ~7 ms median, 8.2 ms max. The minimap's note layer is cached so playback doesn't redraw every note.
