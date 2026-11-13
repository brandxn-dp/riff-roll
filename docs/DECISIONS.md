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
- **spessasynth_lib is not used.** SF2/SF3 are supported by converting to SFZ instead (see "SoundFonts" below).
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
- **Instruments panel** (File → Instruments…): lists installed packs by role and adds a user SFZ instrument from a
  folder (the .sfz plus its WAV/FLAC/OGG samples). Docker uploads file by file to `PUT /api/instruments/:id/files/*`
  in the writable volume; the desktop app copies into `<userData>/instruments` over IPC. Both then write an
  `instrument.json` and a merged `index.json` (user packs first, bundled packs read-only). User ids are `user-…`,
  paths are clamped inside the instrument folder, and only audio/SFZ/text file types are accepted. The plain-browser
  (IndexedDB) mode can't host sample files, so the panel explains that instead. Samples referenced outside the
  chosen folder (`../`) aren't supported. User drum kits should use General MIDI keys (Riff Roll's keymap is GM
  except the half-open hat and the two choke lanes).
- **SF2/SF3**: superseded, see "SoundFonts (SF2 / SF3)" below.
- **Accessibility pass**: track rows are buttons (Enter/Space), the roll/tab/drum canvases are focusable with
  descriptive labels, dialogs trap focus and Escape closes them, the status bar is a polite live region, and tab
  entry announces string/bar/beat/fret there. Colour is never the only cue (string letters and fret numbers are
  always drawn). `prefers-reduced-motion` disables transitions.

## Stretch (milestone 10)

- **Web MIDI input**: while playing with Rec armed, notes are recorded at the playhead into the current track
  (optionally quantized to the snap grid) and the whole take is one undo step; drum tracks record GM notes as hits.
  When stopped, keys step-enter notes at the cursor (chords = keys held together) and advance by the note length.
  "Ch=Str" mode treats MIDI-guitar channels 1–6 as strings and pins notes to them. Notes are monitored through the
  track's current tone. Pairing/quantize logic is the pure, tested `NoteRecorder` in core.
- **Live guitar input**: `getUserMedia` (no echo cancellation/noise suppression/AGC) → input gain → the selected
  track's DI input, so its amp chain, pedal and stomps apply — including stomps during playback. macOS builds declare
  `NSMicrophoneUsageDescription` and the audio-input entitlement. Latency is the browser's (~10–50 ms); the desktop
  app shows its output latency in the mixer.
- **Neural Amp Modeler: not done.** NAM's reference DSP is C++ (MIT) but there's no maintained, permissively licensed
  WebAssembly build with an AudioWorklet wrapper to depend on, and compiling/maintaining one (plus measuring that a
  .nam model runs in real time inside a 128-sample worklet quantum on typical laptops) is a project of its own. The
  `ToneChain` model leaves room for it as another amp type.

- **PUID/PGID entrypoint**: the image starts as root only to make `/data` owned by `PUID:PGID` (default 1000, Unraid
  99/100), then runs the server unprivileged via `su-exec`. Bind-mounted appdata folders created by the host as
  root would otherwise be unwritable. Starting the container with `--user` skips this and runs as that user.
- **Image publishing**: `docker.yml` pushes `ghcr.io/<owner>/riff-roll:latest` (amd64) on every push to main and
  multi-arch tags on version tags; the release workflow only builds desktop installers.

## Phone layout

- **Detection** (`device.ts`): the phone layout is used when the viewport is narrower than 700 px, or on a
  touch-first device (`pointer: coarse`) whose short screen side is under 600 px (phones in either orientation).
  Tablets keep the full layout, with 40 px touch targets via `@media (pointer: coarse)`. The choice follows rotation
  and resizing, and can be forced to Phone/Desktop/Automatic (stored per device in localStorage; File → Phone layout
  on desktop, ☰ → App → Layout on phones).
- **Phone shell**: compact top bar (menu, title, undo/redo, play), swipeable track chips, the editor, and a bottom
  navigation bar (Edit / Tab / Score / Tones / Mixer). Every other control lives in a bottom sheet that reuses the
  desktop toolbar and song bar, so there's one implementation of each control. Status messages become toasts;
  dialogs go full screen.
- **Touch editing** keeps the prototype's model: tap empty grid to add, tap a note to select, edit in the inspector
  (techniques collapse into a section). Rows are 24 px in the roll, tab strings 21 px apart, drum lanes 28 px; drum
  cells toggle on tap (dragging scrolls instead of painting).
- **Fret pad**: phones have no keyboard for Guitar Pro–style entry, so tapping a tab line opens an on-screen pad
  (frets 0–24, beat/string arrows, durations, rest, delete, common techniques). It sends the same commands as the
  keyboard (`tabKey()`), so both paths share code and tests.

## MIDI import: Songsterr / Guitar Pro exports

Songsterr's MIDI (and Guitar Pro's own MIDI export) puts every string of an instrument on its own channel (channel 0 =
highest string) so bends can be per string, offsets chord notes by a few ticks to fake a strum, writes dead notes as
blips ~30 ticks long, and adds a `MEASURE_n` marker on every bar plus `END_OF_VOICE`. The old importer split each
guitar into one track per string and guessed the tuning from the lowest note only (Drop D guitars became 7-strings or
bass). Now, in format 1 files, one MTrk = one track; a track whose channels look like strings (each almost always one
note at a time, lowest note falling channel by channel) keeps the string as `pinnedString`, and the tuning is the known
tuning closest to the lowest note on each string (parts that only use the top strings take the tuning the other parts
clearly use). Strums are lined up on their first note, blips become dead notes with their written length, pitch bend
(with the RPN bend range) becomes a bend curve or vibrato, GM drum keys without a lane map to the nearest piece, and GM
40 is the main snare when a part has no 38. Format 0 files still split by channel.

## Accounts, launch screen and sharing

- **Where accounts live**: only the server (Docker / Unraid) has accounts, because that's where several people use
  the same songs folder. The desktop app is already per OS user and the browser-only mode has no server to share
  through, so both stay single-user without a sign-in; they still get the launch screen.
- **Storage**: `accounts.json` (users with scrypt hashes, sessions stored as sha-256 of the token) and
  `library.json` (owner, title, version and shares per song; recently opened per user) sit next to the `.riff`
  files in the projects volume. One volume to back up, no database to run, and the old layout of
  `<id>.riff` files is unchanged. JSON writes are serialised and written atomically (write, then rename).
- **First run**: the first account is created on the sign-in screen and is an admin; songs already on disk (from
  before accounts, or copied in by hand later) belong to the first admin. Their titles are read from `song.json`
  inside the zip on the server so the list isn't "Untitled".
- **Who can sign up**: admins add people by default; `RIFFROLL_SIGNUP=open` allows self sign-up. Forgotten
  passwords are reset with a one-off `RIFFROLL_RESET_PASSWORD=user:pass` variable, which works from the Unraid GUI
  (no shell needed). A JSON-editing CLI was rejected: it would race the running server's in-memory copy.
- **Sessions**: random 32-byte token in an HttpOnly, SameSite=Lax cookie (Secure behind HTTPS), 30 days.
  SameSite plus JSON / octet-stream bodies covers CSRF for this API. Eight wrong passwords for an address +
  username pause sign-in for 10 minutes. Changing a password signs out other devices.
- **Isolation**: every `/api` route except health, instrument status and the auth routes needs a session. A song
  you can't access answers 404 (not 403), so ids don't leak. Instruments stay shared by everyone on the server:
  sample libraries are large and not personal.
- **Sharing**: per person, `view` or `edit`. Viewers can play and try changes, which aren't saved; "Save a copy"
  makes it theirs. Editors save into the owner's song. Recipients can remove a shared song from their own list
  without touching the owner's. Deleting a user hands their songs to the admin who deleted them.
- **Two people editing at once**: no live collaboration. Each save carries the version it was based on; if
  someone else saved in between, the server refuses (409) and the editor stops saving and offers "Load their
  version" or "Keep mine as a copy". Saves are queued so one tab never conflicts with itself.
- **Imports** always get a new song id, so importing someone else's `.riff` can't collide with their copy (a
  collision on save still falls back to a new id).
- **Opening a song** doesn't count as an edit (no save, no version bump); "recently opened" is recorded by the
  server when a song is loaded, or in localStorage in single-user mode.

## "Other" instrument tracks, bulk velocity, vertical zoom, drum selection

- **Other tracks** (`type: 'other'`) are for anything pitched without strings: piano, synth, strings, organ. They
  have no tuning, tab, fingering, amp or pedal: piano roll + velocity lane, a score-only staff (alphaTex
  `\tuning piano` with note names, bass clef when the part sits low), one MusicXML staff, GM program 0 in MIDI.
  Audio goes straight to the mixer with a little reverb. The sound is any instrument uploaded with the new
  "Other" role; with none installed a synthesised electric-piano tone plays so the track is never silent. MIDI
  files with a non-guitar, non-bass program (and no string-per-channel layout) and Guitar Pro tracks without a
  tab tuning and a non-guitar program now import as Other tracks instead of being forced onto a guitar.
- **Bulk velocity**: one pure function (`editVelocities`: set / scale / add / ramp / humanize, chords share a
  ramp value) behind a dialog that works on the selection, or the whole track when nothing is selected, as one
  undo step. Alt+drag in the velocity lane draws a line through the stems. In the drum grid, dragging a selected
  hit's stem moves every selected hit.
- **Zoom**: horizontal zoom already existed; vertical zoom (row/lane height ×0.6–×2.5) is separate state shared
  by the piano roll and drum grid, keeping the middle pitch in view. Ctrl+wheel = horizontal, Alt+wheel =
  vertical (Shift+wheel is horizontal scrolling in browsers, so it can't be used).
- **Drum grid selection**: Shift-drag now box-selects (adding to the selection) and Ctrl-drag starts a new
  selection, matching the piano roll; painting across lanes moved from Shift-drag to Alt-drag. Shift+click a drum
  name (or a piano-roll key) selects every hit (note) of it; Ctrl+click adds.

## Global view

A Guitar Pro style panel under the editor: one row per track (mute, solo, volume, pan, tone) next to a grid of bar
cells, filled where a bar has notes or hits. Selection is a rectangle of track rows × bars (stored as indices in
the UI store, not in the song). Bar operations live in core (`bars.ts`) as pure commands, so they're one undo step
each and tested without the UI:

- copy keeps positions relative to the range and the time signature of each copied bar; paste maps clip track i to
  the i-th row from the paste point, never mixes drum and pitched parts, carries pedal stomps between guitar/bass
  tracks (dropping advanced-mode tone ids the target doesn't have), and grows the song if it runs past the end;
- overwrite-paste clears the target bars first; insert-paste makes room in every track with the clip's own time
  signatures (GP behaviour);
- insert/delete bars move everything positional: notes, hits, stomps, sections, tempo points, time signatures,
  repeats/endings and the loop. Deleting bars keeps the tempo that was in effect at their end, never deletes the
  last bar, and shortens notes that ring into the deleted range;
- the global view is desktop-only for now (a phone screen has no room for it); it can be collapsed.

## Edit palette, global view columns, top bar

- The track list sidebar is gone (the global view has every track, with add / rename / move / delete on the
  track names). Its place is an edit palette in Guitar Pro's order so people can move between the two programs:
  bar items (section, tempo, time signature, repeat at the cursor), note values (whole → 64th, dot, triplet, tie,
  rest), dynamics (ppp–fff using Guitar Pro's velocity mapping, hairpins as velocity ramps), articulations, then
  effects. Symbols come from Bravura (already bundled for the score), effects use Guitar Pro's text labels. Every
  button acts on the selection or the note under the tab cursor; a button is "on" when all of them have it.
  Guitar-only effects are disabled on drum and other tracks. Multiple voices, grace notes and lyrics/chords
  aren't modelled, so they aren't in the palette.
- Global view columns: drag the line after the names (narrower names) or the panel's right edge (longer
  sliders); double-click resets; widths are remembered per device.
- Top bar: two rows. Row 1: song on the left, transport and tempo centred, inputs/tones/mixer on the right.
  Row 2: view, tuning/capo, snap, bars, zoom, undo. Note lengths moved to the palette (phones keep them).

## SoundFonts (SF2 / SF3)

SoundFonts are converted, not played by a second synth: when you add one, the browser parses the file
(`parseSoundFont`), you tick the presets you want, and each preset becomes an ordinary user instrument, an SFZ file
plus one audio file per sample, uploaded through the same path as a folder of SFZ (desktop IPC or the server). So
playback, the amp chains, offline WAV export, Docker storage and the desktop app need no changes, and a converted
instrument can be inspected or edited like any SFZ.

Conversion follows SF2.04: instrument zones over the instrument's global zone, preset generators added on top
(tuning, attenuation, pan, envelope times), key/velocity ranges intersected. Root key (overriding or the sample's
own), coarse/fine tune plus the sample's pitch correction, attenuation (applied at 0.4 strength, as FluidSynth and
most players do, so fonts sound the way people expect), pan, the volume envelope (timecents → seconds, sustain
centibels → %), loops (continuous / until release), sample start/end/loop offsets, and exclusive classes (hi-hat
choke → `group`/`off_by`) are kept. Not converted: modulators, filters, LFOs, chorus/reverb sends (our amp and mixer
cover those). SF2 samples are written as 16-bit mono WAV; SF3 samples are already Ogg Vorbis and are copied as
`.ogg` (browsers decode it). Presets from bank 128 default to drum instruments, GM programs 24–31 to guitar,
32–39 to bass, the rest to "Other"; each can be changed before adding. Checked against the Sonivox GM SoundFont
that ships with alphaTab: all 132 presets of the .sf2 and .sf3 convert, and piano, guitar and kit render audibly
in the browser.

## Amp on/off, Ctrl+A, palette icons (0.2.0)

- **Amp off**: the Amp block now has an On/Off switch like the other blocks (`amp.on`, default on, so older songs
  are unchanged). Off routes the signal around the preamp stages, tone stack and power amp; the cabinet keeps its
  own switch, so "amp off + cab off" is a clean DI (acoustic sounds, or re-amping elsewhere) and "amp off + cab on"
  is a cab-only sound. The bypass is level-matched to the clean amp (×0.7, measured on the example guitar and bass
  parts: 0.69 and 0.75).
- **What the amp is**: Riff Roll's own amp model built from Web Audio nodes, no third-party plug-in or neural
  model: noise gate (AudioWorklet), compressor, overdrive pedal (mid-hump → soft clip → tone), then the amp: tight
  high-pass, two 4× oversampled tube-style waveshaper stages with an interstage filter (the second only on the
  driven channels), a bass/mid/treble/presence tone stack and a power-amp waveshaper; then a convolution cabinet
  (synthesised IRs or your own .wav), post EQ, chorus, delay and the reverb send.
- **Ctrl+A** already selected every note of the track in the editor; it now also selects every bar of every track
  in the global view (and Ctrl+A with the global view focused does that), so copy / cut / delete can act on the
  whole song.
- **Palette note icons** are drawn as SVG: a music font's glyphs sit on a staff baseline and looked off-centre
  inside buttons. Dynamics and articulations keep the Bravura glyphs, which centre well.

## Editing like FL Studio / Guitar Pro, scales, ghost notes, loop handles, resizable layout

- **Arrow keys (FL Studio)**: ←/→ move the selection one grid step (Ctrl: a bar); ↑/↓ and Shift+↑/↓ a semitone;
  Ctrl+↑/↓ an octave. In the drum grid ↑/↓ move hits to the neighbouring drum. With Snap to scale on, a semitone
  step goes to the next scale note instead.
- **Drum grid mouse**: like the piano roll, a click on a hit selects it and dragging moves the selection (time and
  drum); empty cells still paint; right-click erases; Alt-drag paints across lanes.
- **Notation + Tab (Guitar Pro)**: clicking a tab line puts the tab cursor on that string at that beat (rests
  included: they now have beat refs), and the normal tab keys type frets and techniques there. The string comes
  from the click height against the tab staff's line spacing in alphaTab's bounds; clicking the notation staff still
  selects the beat.
- **Scales**: the song keeps an optional scale type (`song.scale`) next to its key signature; the piano roll shades
  out-of-scale rows dark, tints the tonic and marks scale notes in the key column ("chromatic" = plain piano keys).
  Snap to scale (toolbar) applies to new notes, dragged notes and ↑/↓ steps.
- **Ghost notes**: the toolbar's Ghost menu draws another track's notes (drums at their GM pitch) faintly behind
  the current track; not editable, view state only.
- **Loop**: the green bar's edges drag to change the loop, the middle drags to move it (snapped to the grid); a
  plain click inside it still sets the playback start. Shift-drag still draws a new loop.
- **Resizable workspace**: drag handles for the palette width, the piano roll height and the global view height;
  remembered per device, double-click resets.
- **Track type** can be changed in the Mixer (Guitar / Bass / Drums / Other, `convertTrack`): notes are kept,
  drums ↔ pitched map through GM drum numbers. Guitar Pro import now also treats tracks named piano/keys/synth/…
  or with a non-guitar program and no visible tab as Other (Guitar Pro gives keyboard tracks a guitar tuning too).
- **Playback fixes**: a looping sample (SoundFont pianos, organs, pads) no longer "ends" at the end of its file (a
  note was cut after ~0.05 s); a failed or empty instrument list is retried instead of leaving every track on the
  fallback sound for the session, and a track on the fallback sound tries its real instrument again.

## Desktop auto-update (0.3.1)

electron-updater with the GitHub provider: the installed app reads `latest.yml` (Windows) / `latest-linux.yml`
(AppImage) from the newest GitHub release, downloads the installer in the background (taskbar progress; `.blockmap`
files allow partial downloads) and asks to restart; "Later" installs on quit (`autoInstallOnAppQuit`). Checks run
8 s after start and every 6 hours unless switched off in the Help menu (stored in `updates.json` in app data). The
song is saved before the restart. The release workflow still builds with `--publish never` and uploads everything
(installers + update info) with one action, so the `publish` section in electron-builder.yml only tells the app
where to look. The Windows installer was renamed `riff-roll-setup-x.y.z.exe`: `latest.yml` names the file, and
GitHub would turn the old name's spaces into dots, breaking the download. macOS is excluded (unsigned apps can't
self-update on macOS); the Help menu item there opens the releases page.

## Open Recent and Open Project Folder (0.3.2)

Electron's `recentDocuments` menu role only works on macOS, so on Windows File → Open Recent did nothing. The menu
is now built by the app: the page (which knows song titles and what was opened) sends the ten most recent songs to
the main process (`recent:set`), which rebuilds the native menu; it updates on start, after opening, saving and
deleting. A song you save counts as recently opened (new songs, imports and the example included), matching what
the server already did. The in-app File menu shows the five most recent too. "Open Project Folder" (native File
menu, in-app File menu and the launch screen menu, desktop only) opens the songs folder in Explorer/Finder.

## Settings, themes, keymap, admin panel (0.3.3)

- **Settings live per device** (`riffroll.settings` in localStorage): they describe this screen, these speakers and
  this keyboard, not the song or the account, so they are not synced through the server.
- **Themes**: one palette (bg, panel, raise, line, ink, mute, tone colours) drives both the CSS variables and the
  canvas colour table `COL`, which theme.ts mutates in place; the canvases repaint on a `themeRev` bump. The other
  canvas colours (key rows, beat lines, selection) are mixed from the palette, so a new theme is ten colours.
  Track/string colours are song data and stay as they are. alphaTab takes its colours once, so the notation view is
  rebuilt when the theme changes; it can also stay black-on-white regardless of theme.
- **Audio "driver" settings**: web audio can only pick an output device (`AudioContext.setSinkId`, Chromium and
  Electron), a latency hint and a sample rate. Latency and rate are fixed when the AudioContext is made, so changing
  them restarts the engine. ASIO is not available to Chromium; the settings page says so and how to get low latency
  through WASAPI instead.
- **Keymap**: rebindable actions (keymap.ts) with default combos; overrides are stored per action. Combos are
  "Ctrl+Shift+Z" with Ctrl meaning Cmd on a Mac and shifted symbols written as the symbol ("?"). Binding a combo
  that another action uses moves it. Tab entry keys, mouse gestures and the global view's bar keys stay fixed; the
  cheat sheet lists both. The arrow keys move notes even while the tab cursor is active when Shift or Ctrl is held
  and notes are selected (plain arrows still move the cursor, as in Guitar Pro).
- **Admin panel**: `GET /api/admin/stats` (counts from the library, live sessions, memory, version) and
  `PUT /api/admin/settings` for a runtime sign-up switch saved in `server-settings.json` (`null` goes back to
  `RIFFROLL_SIGNUP`); `POST /api/users/:id/sign-out` ends someone's sessions. All admin-only.
- **Lanes**: velocity and pedal lanes hide separately and their sizes are remembered per device; the splitter above
  the lower panel sets the tab line spacing (the piano roll takes the rest). Drum lanes stretch to fill the editor
  (up to 2.5× their zoom height) instead of leaving empty space.

## Claude over MCP, note palettes (0.3.4)

- **The editor runs the tools.** Tool calls are executed in the page against the live store
  (packages/ui/src/mcp/tools.ts), not on files: changes appear instantly, share the user's undo history (one step
  per call, "Claude: …"), autosave, and never race the user's own saves. The desktop main process and the server
  only carry calls in and results out. Tool definitions and the JSON-RPC handling live in
  apps/server/src/mcp/protocol.ts (the server can't import the TypeScript core at runtime; the desktop bundles it);
  a UI test checks that every listed tool is implemented.
- **Transport**: stateless streamable HTTP, POST `/mcp` answered with plain JSON (no sessions, no SSE towards the
  client), which Claude Code supports directly and Claude Desktop through `mcp-remote`.
- **Desktop**: off by default; binds 127.0.0.1 only, needs a bearer token (kept in `mcp.json` in app data), and
  refuses requests with a non-local Origin (DNS rebinding). Calls reach the page over IPC.
- **Server**: per-user tokens (only a sha-256 is stored, shown once, revocable, removed with the user). Each signed-in
  tab holds an event stream (`/api/mcp/live`); a call goes to the user's most recently used tab and the result comes
  back by POST. No tab open → a clear error for Claude. `/mcp` is exempt from HTTP basic auth (it has its own
  token).
- **Positions for the model** are bar/beat (1-based, beats in quarter notes) and lengths in quarter notes, with ticks
  as an option; on guitar/bass, string 1 is the highest string as in tab. Errors come back as readable tool errors.
- **Palettes**: 8 string colours (roles 8th string … high e) per palette; drum and new-track colours are drawn from
  them so everything matches. Applied by mutating the shared tables (ROLE_COLORS, TRACK_COLORS, drum colours) and
  repainting. Piano roll notes can be coloured by string, track, velocity or pitch class.

## Bread's drum kit, palm mutes, partial tempo/metre over MCP (0.3.5)

- **Default drum kit: Bread Bread's Drum Kit v1.03.1** (Polyphone, public domain, General MIDI). Polyphone only
  serves files to signed-in members, so the build can't download the .sf2. `scripts/build-sf2-kit.ts` converts its
  "Drum Kit" preset once into a Riff Roll drum pack (SFZ + WAV on the riffroll-drums-v1 keymap): every region pinned
  to its key with the pitch the kit gave it, one-shot, fast choke. Pieces the kit lacks are made from its own samples:
  cross-stick (rimshot, higher, short), half-open hi-hat (open hat, short, same choke group), crash chokes (grabbed
  crashes), china (crash 2 tuned down), splash (crash 1 tuned up, shorter). The zipped pack is a release asset of this
  repository (tag `instruments-1`), pinned by sha256 in the manifest. New drum tracks use it; songs that chose Big
  Rusty Drums keep it (it is still installed).
- **Palm mute**: no muted samples exist in the packs, so the open note is shaped: a lowpass that starts bright (keeps
  the pick attack) and closes within ~30 ms to a few harmonics above the note, a small low-mid peak for the "chug",
  and an amplitude that drops to ~45 % in ~40 ms and is nearly gone by ~0.3 s whatever the written length. The old
  version low-passed at a fixed 950 Hz from the first sample (no attack) and held at 18 % for the whole note.
- **MCP**: `set_tempo` and `set_time_signature` change a bar range and restore the previous value after it (or run to
  the end), can ramp tempo, and remove a change; `set_song` tempo/time signature now mean the whole song. Time
  signature changes keep notes at their times (like the editor), which the tool description tells the model.
- **Velocity lane resize**: the drag lived inside an effect that re-ran on every size change, so a drag stopped after
  one step; it now lives in a ref, and uses screen coordinates (the panel grows upward as the lane grows).
