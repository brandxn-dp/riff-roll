# Riff Roll: build spec for Claude Code

You are building **Riff Roll**, a songwriting app for rock bands. It combines Guitar Pro style tablature, an FL Studio style piano roll that turns what you draw into tabs, a drum editor, and realistic sample-based playback. It must run two ways from one codebase:

1. a **Docker** web app (`docker compose up`, open in a browser)
2. a **standalone desktop app** (Windows, macOS, Linux installers)

`riff-roll-prototype.html` in this folder is a working single-file prototype of the core idea: piano roll, auto string/fret assignment, string colors, pedal stomp lane, and tab view. Open it, try it, and keep its behavior. Everything else in this document extends it.

---

## How to work

- First read this whole file and the prototype. Then write `docs/PLAN.md` with your architecture, folder layout, library choices (with versions and licenses), and the milestone list below. Flag anything you think is wrong or risky. Then start building. Don't wait for approval unless something in this spec is impossible.
- Build milestone by milestone (see the end of this file). After each one: all tests pass, the app runs, commit with a clear message, and print a short "how to try it" note.
- Keep `docs/DECISIONS.md` up to date with every non-obvious choice and why.
- Never commit sample audio to git. Instruments are downloaded by a script (see Audio).
- If a library or sample pack named here turns out to be unavailable, abandoned, or has a different license than stated, pick the best alternative, note it in DECISIONS.md, and keep going.

---

## The core idea: one note model, many views

Every track stores **one list of musical events**. The piano roll, the tab, the standard notation and the drum grid are all **views of that same data**. An edit in any view shows up in all of them immediately. Never keep two copies of the notes.

A guitar or bass note stores:
- `pitch` (MIDI), `start` and `duration` (ticks, 960 per quarter note), `velocity`
- `string` and `fret`, which are **derived** by the fingering engine unless the user pinned them (`pinnedString`)
- techniques (see list below)

A drum hit stores `start`, `piece` (kick, snare, etc.), `articulation`, `velocity`.

Use a command pattern for every edit so that **undo/redo** covers everything, including pedal stomps, tempo changes and track settings.

---

## Tracks

- Track types: **Guitar** (6, 7 or 8 strings), **Bass** (4, 5 or 6 strings), **Drums**. Any number of each.
- New-song template: **Drums, Guitar 1, Guitar 2, Bass**. Each guitar track handles both clean and distorted parts through its pedal lane, so the old setup of 2 clean + 2 distorted guitar tracks is no longer needed.
- Per track: name, color, tuning (presets: Standard E, Drop D, D Standard, Drop C, C Standard, Drop B, B Standard, 7-string Standard B, 7-string Drop A, 8-string Standard F#, Bass Standard E, Bass Drop D, 5-string Bass Standard B, plus fully custom), capo, volume, pan, mute, solo, instrument/tone preset.
- Changing a tuning re-runs the fingering engine. Notes no tuning position can reach are shown in grey with an ✕ and listed in a warning.

---

## Views and editors

Layout: a track list on the left, a song-wide timeline (bars, sections, tempo) on top, and the selected track's editor in the main area. The user can switch the main area between **Piano roll**, **Tab**, **Notation + Tab** and, for drum tracks, **Drum grid**, or split it to show two views at once (piano roll above tab, like the prototype).

### Piano roll (all tracks)
- FL Studio feel: click to place a note at the last-used length, drag to move, drag the right edge to resize, right-click to delete, box-select, copy/paste, duplicate (Ctrl+D), quantize, snap settings (1/4 to 1/64, triplets), velocity lane underneath.
- **Guitar/bass notes are colored by string** (the prototype's colors: low string red, then orange, yellow, green, blue, violet for 6 strings; extend the palette sensibly for 7/8-string guitars and keep bass consistent). Each note shows its **fret number and note name** inside it, shrinking gracefully when the note is short.
- The key column marks the open-string pitches of the current tuning with their string color.
- Selecting a note shows every string/fret where it can be played. Clicking one pins the note there, and an "Auto" option unpins it.
- Drum tracks in the piano roll show named lanes (Kick, Snare, Hi-hat closed...) instead of piano keys.

### Tab editor (guitar/bass)
- Guitar Pro style keyboard entry: arrows move the cursor across beats and strings, number keys type frets (two-digit frets work), and keys change duration, add dots, triplets/tuplets, rests and ties. Insert/delete beats. Copy/paste bars.
- Shows durations (rhythm stems under the tab), bar numbers, time signatures, tempo markings, section names, repeats and alternate endings.
- Entering a fret on a string sets the pitch. That note becomes **pinned** to that string, because the user chose it.

### Notation view
- Standard notation + tab together, rendered for reading and printing (see Libraries: alphaTab). Drums render on a percussion staff. Editing in this view can be limited in v1 if needed: selection and the cursor must still sync with the other views.

### Drum grid
- A step-sequencer grid with one row per kit piece and a velocity per hit, plus articulations: hi-hat closed / half-open / open / pedal, snare center / rimshot / ghost / cross-stick / flam, ride bow / bell, crash choke, china, splash, toms, double kick.
- Pattern tools: paint mode (drag to fill hits), fill a bar with 8ths/16ths on a row, copy bar, "accent every beat".

### Song-level
- Sections/markers (Intro, Verse, Chorus...), time signature changes, tempo changes (also gradual), key signature, repeats, a loop region, a metronome with count-in, and playback speed (50 to 150%) without changing pitch.
- A global "jump to section" bar and a minimap.

---

## Fingering engine (string/fret assignment)

This is the heart of "draw in the piano roll, get tabs". Port the prototype's `assign()` function into a **pure, fully unit-tested module** and improve it:

- Process notes in time order, grouping notes that start together (chords).
- Every note's candidates: each string where `0 <= pitch - openPitch(string) <= maxFret` (default 24, configurable per track).
- Cost of a candidate: distance from the current hand position, plus a small penalty for high frets. Open strings are cheap, but get slightly more expensive the higher the hand is.
- Chords: strings must be distinct. Penalize a fret span over 4, and penalize skipped strings between chord notes (so power chords land on neighboring strings).
- A string that is still ringing from an earlier note should be avoided for a new note (big penalty, not forbidden).
- Hand position moves toward the frets just used (smoothed).
- Pinned notes keep their string. The engine works around them.
- Search: exhaustive per chord group (max 8 notes) with pruning. Later, consider a short look-ahead (e.g. dynamic programming over the next few groups) so riffs stay in one position. Benchmark: 2,000 notes re-assigned in under 20 ms.

**Required unit tests** (Standard E tuning, all notes length 1/8, hand starting near fret 2):
- Em arpeggio E2, B2, E3, G3, B3 → low E 0, A 2, D 2, G 0, B 0
- C3, G3, C4, E4 → A 3, G 0, B 1, high e 0
- Power chord G2+D3 → low E 3 + A 5 (not low E 3 + open D)
- Power chord A2+E3 → A 0 + D 2
- Power chord C3+G3 → A 3 + D 5
- Power chord B2+F#3 → A 2 + D 4
- A note pinned to a string stays there even if another string is cheaper
- Two notes ringing at the same time never land on the same string when another option exists
- Out-of-range notes return "unplayable"
- Drop D: D2 → low string open

---

## Pedal stomp lane (clean/distorted in one track)

This is the user's key feature. Keep the prototype's behavior and extend it:

- Every guitar track (and optionally bass) has a **Pedal lane** under its editor, on the same time axis.
- A track has a list of **tones** (amp/effects presets). Default: **Clean** and **Dist**. The user can add more (Crunch, Lead, Ambient...) and edit each one.
- A **stomp** is an event at a tick position that switches the track to a tone. Simple mode (default, like the prototype): a stomp toggles between two tones. Advanced mode: each stomp names the tone it switches to.
- The pedal lane shows colored segments with the tone name. Tapping/clicking the lane adds a stomp at the nearest grid position, clicking a stomp removes it, and stomps can be dragged.
- The tab and notation views show a marker at each stomp (e.g. a small footswitch icon with "Dist") so a printed tab tells the player when to stomp.
- **Audio behavior must feel like a real pedal**: the guitar is always played as a clean DI signal, and the stomp switches which amp chain that signal goes through. Strings that are still ringing when you stomp change tone, exactly like a real footswitch. Use a short (~5 to 15 ms) crossfade between the tone chains to avoid clicks.
- Import/export: map stomps to Guitar Pro sound automations where the format supports it, and to MIDI CC/program changes in MIDI export.

---

## Guitar/bass techniques

Each one needs notation in the tab, a piano-roll indicator, and playback behavior:

hammer-on, pull-off, slide in/out/legato/shift, bend (with an editable bend curve: full, half, bend-release, pre-bend), release, vibrato (normal/wide), palm mute, let ring, dead/muted note, natural and artificial harmonics, pinch harmonic, tapping, tremolo picking, ghost note, accent, staccato, pick direction, whammy dip/dive (curve), fade in (volume swell), trill.

On a single string, a new note **cuts off the previous note on that string** unless "let ring" is on. This is a big part of why guitar playback sounds real.

---

## Audio engine: real instrument sounds

Requirements: sample-based instruments, sample-accurate scheduling, no synth-sounding defaults.

### Architecture
- Web Audio API with AudioWorklets where custom DSP is needed. One engine shared by the web and desktop builds (this is one reason to use Electron, see below).
- Lookahead scheduler (~100 ms ahead) driven by song ticks with tempo-map conversion.
- Per track: instrument → tone chain(s) → volume/pan → mute/solo → master bus (glue compressor + limiter) → output. Global reverb send.
- Offline export to **WAV** (and MP3 if a permissively licensed encoder is available) through OfflineAudioContext, the same graph.
- Instrument assets load progressively with a progress bar and are cached (Cache Storage/IndexedDB on web, app data folder on desktop).

### Sampler
- Write a sampler that plays an **SFZ subset** directly: `<region>`, `<group>`, `<control>`/`default_path`, `sample`, `lokey/hikey/key`, `pitch_keycenter`, `lovel/hivel`, `seq_length/seq_position` (round robins), `trigger` (attack/release), `group`/`off_by` (choke groups, e.g. open hi-hat choked by closed), `ampeg_*` envelope, `tune`, `transpose`, `volume`, `pan`, `loop_*`. Support WAV and FLAC samples.
- Use **spessasynth_lib** (Apache-2.0, SF2/SF3/DLS synth for Web Audio) for SF2/SF3 instruments and for any General MIDI fallback sounds.
- Expressive playback: velocity layers, round-robin rotation, a little random variation in timing (±3 ms) and velocity (configurable "humanize"), string-aware note cutoff, slides/bends as pitch automation on the playing voice, palm mute via dedicated samples if the pack has them, otherwise a short envelope + low-pass filter.

### Guitar: DI samples → amp simulation
- Default guitar instrument: **FreePats "FSBS Electric Guitar Direct"**, an unprocessed (DI) Fender sample bank, CC0 1.0, available as SFZ FLAC/WAV and SF2: https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html. Use the DI version because the app's own amp sim adds the tone.
- Each **tone** is an amp chain built from these blocks (all parameters editable in a pedalboard-style tone editor):
  - noise gate (AudioWorklet)
  - overdrive/boost (pre-EQ + soft clip)
  - amp: input gain → waveshaper with 4x oversampling (or a custom oversampled AudioWorklet) → tone stack (bass/mid/treble/presence) → power-amp saturation
  - **cabinet IR** via ConvolverNode. Bundle only IRs with a license that allows redistribution (CC0 preferred, and document each one). Let users load their own IR WAV files.
  - post effects: chorus, delay, reverb, EQ
- Ship presets: **Clean** (clean channel, light compression, a little reverb), **Crunch**, **Dist** (tight high-gain rhythm, gated), **Lead** (more gain, delay). Tune them by ear until a palm-muted E5 chug and an open clean Em chord both sound convincing. Add an A/B listening page in dev mode for tuning presets.
- Stretch goal (separate milestone, only if licensing and browser performance work out): Neural Amp Modeler (`.nam`) model support via WebAssembly.

### Bass
- Default: a CC0 bass sample set, e.g. Karoryfer **Growlybass** or **Black And Blue Basses** (5-string), both listed as CC0 on https://sfzinstruments.github.io/basses, or FreePats' CC0 Yamaha RBX bass (pick and finger variants): https://freepats.zenvoid.org/ElectricGuitar/clean-electric-bass.html
- Tones: clean DI + bass amp, and a driven tone with low/high split so the lows stay clean.

### Drums
- Default rock kit: DrumGizmo **Muldjord Kit** (described as a metal/rock kit, CC-BY-4.0, needs attribution in the About screen) or Karoryfer **Big Rusty Drums** (CC0). See https://sfzinstruments.github.io/drums. Alternative CC0 kit: Versilian **Virtuosity Drums**.
- Map every kit piece and articulation in the drum grid to the kit's SFZ regions. Choke groups for hi-hat and cymbal chokes.
- Drum mixer: per-piece volume, a kick/snare/overheads/room balance if the kit has mic positions, plus a kit-wide compressor.

### Asset pipeline
- `scripts/fetch-instruments.ts` downloads the packs listed in `instruments/manifest.json` (URL, SHA-256, license, attribution text), unpacks them, optionally converts WAV to FLAC or Opus to cut size, and writes a normalized SFZ per instrument.
- Generate `THIRD_PARTY_NOTICES.md` and the in-app About/credits screen from the manifest.
- Users can add their own SFZ/SF2 instruments and IRs through an "Instruments" panel.

---

## Files

- Native project format: `.riff` = a zip containing `song.json` (versioned schema, validated with zod, with migrations between versions) plus any user-imported assets. Autosave and crash recovery.
- **Import**: Guitar Pro 3/4/5/GPX/GP7/GP8, MusicXML, MIDI (via alphaTab's importers where possible). Map GP tracks, tunings, techniques, and GP sound automations to tones and stomps.
- **Export**: MIDI, MusicXML, Guitar Pro (if alphaTab's exporter supports a GP format), WAV/MP3 audio (full mix or per-track stems), PDF/print of tabs and notation.
- Copy a selection as ASCII tab to the clipboard.

---

## Tech stack (suggested; justify any change in DECISIONS.md)

- **TypeScript** everywhere, **pnpm** workspaces monorepo.
- `packages/core`: song model, commands/undo, fingering engine, tempo map, import/export mapping. Pure TS, no DOM, Vitest unit tests.
- `packages/audio`: engine, sampler, SFZ parser, amp sim, scheduler, offline render.
- `packages/ui`: React + Vite, Zustand (or similar) for state. Piano roll, tab editor, drum grid and pedal lane drawn on **canvas** for performance (virtualized; a 10-minute song with 6 tracks must scroll at 60 fps). Notation rendering via **alphaTab** (`@coderline/alphatab`, MPL-2.0): build its score model from our song model. Don't make alphaTab the source of truth.
- `apps/server`: small Node server (Fastify) that serves the built UI, the instrument files, and a REST API for projects stored on disk.
- `apps/desktop`: **Electron** + electron-builder. Chosen over Tauri because the audio engine depends on Web Audio/AudioWorklet, and Electron's bundled Chromium behaves the same on every OS, while system webviews (especially WebKitGTK on Linux) differ.
- A `StorageAdapter` interface with three implementations: server REST (Docker), Electron IPC + native file system (desktop), and IndexedDB (plain browser fallback). The UI never knows which one it's using.
- Lint (ESLint), format (Prettier), type-check in CI.

---

## Docker

- Multi-stage `Dockerfile`: build stage (pnpm install, build packages, run `fetch-instruments`) → slim runtime stage (Node alpine or distroless), non-root user.
- `docker-compose.yml`: one service, port `8080`, named volumes for `/data/projects` and `/data/instruments` (so users can add their own instruments and IRs), a healthcheck, `restart: unless-stopped`.
- A build arg `INCLUDE_INSTRUMENTS=true|false`. If false, the server downloads the instruments into the volume on first start and the UI shows progress.
- README section: `docker compose up -d` → open http://localhost:8080. Also: how to back up projects, how to put it behind a reverse proxy, and an optional basic-auth env var for LAN use.
- Note in the README that browsers only allow AudioWorklet on secure origins: `localhost` works, but LAN access needs HTTPS (document a Caddy/Traefik example).

---

## Desktop app

- electron-builder targets: Windows (NSIS installer), macOS (dmg, universal), Linux (AppImage + deb).
- Instruments bundled with the installer by default (offline-first), with an option to store them elsewhere.
- Native menus, keyboard shortcuts, open/save dialogs, recent files, `.riff` file association, window state memory, autosave.
- Security: `contextIsolation: true`, `nodeIntegration: false`, narrow preload IPC API, strict CSP.
- Low-latency audio: request the `interactive` latency hint. Show the actual output latency in settings.
- GitHub Actions workflow that builds the Docker image and all three desktop installers on tag push.

---

## Look and feel

- Dark DAW-style UI (the prototype's direction). Dense but readable. String colors are the main color system: keep UI chrome neutral so string and tone colors stand out.
- Shortcuts close to Guitar Pro for tab entry, and close to FL Studio for the piano roll. Make a shortcut cheat sheet (press `?`).
- Must work well with mouse + keyboard on desktop. Tablet touch support is nice to have (the prototype's tap behavior: tap empty to add, tap note to select, inspector for edits).

---

## Milestones (each must end runnable, tested and committed)

1. **Scaffold**: monorepo, lint/test/CI, an empty app running via `pnpm dev`, `docker compose up` and `pnpm desktop:dev`. Storage adapters stubbed.
2. **Core model + fingering engine**: song model, commands/undo, tempo map, fingering engine with all the required tests above passing.
3. **Piano roll + tab view (one guitar track)**: parity with the prototype: string colors, fret + note name on notes, position picker, pedal lane UI, linked tab view.
4. **Audio v1**: sampler + SFZ parser, instrument fetch script, guitar DI + amp sim with Clean/Dist tones, pedal stomps switching tones live with crossfade, transport, metronome, loop.
5. **Multi-track**: drums (grid + kit), bass, mixer, the 4-track template, solo/mute, track colors.
6. **Tab editing depth**: keyboard tab entry, durations/tuplets/rests/ties, techniques with playback, sections, repeats, time signature and tempo changes, notation view via alphaTab.
7. **Files**: `.riff` save/load with autosave, GP/MusicXML/MIDI import, MIDI/MusicXML/WAV/stems/PDF export, ASCII tab copy.
8. **Packaging**: production Docker image, Electron installers for all three OSes, CI release workflow, README with screenshots.
9. **Polish**: tone preset tuning by ear, humanize, performance pass (big songs), accessibility pass, cheat sheet, About/credits from the manifest.
10. **Stretch**: NAM amp models, Web MIDI input (record from a MIDI keyboard or MIDI guitar into the piano roll), guitar audio input with real-time amp sim.

### Definition of done for the whole project
- I can start a new song, draw a riff in the piano roll, see it as colored tab with frets and note names, drop a stomp to go from clean to distorted in one guitar track, add drums and bass, hear it with real sampled instruments through a convincing amp, save it, reopen it, export a WAV and a printable tab, and do all of that both in Docker and in the installed desktop app.
