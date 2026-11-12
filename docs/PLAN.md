# Riff Roll — implementation plan

This plan follows `SPEC.md`. The prototype (`riff-roll-prototype.html`) defines the behaviour to keep: piano roll with
string-coloured notes showing fret + note name, auto string/fret assignment, position picker, pedal stomp lane, and a
linked tab view on the same time axis.

## Architecture

```
            ┌────────────── packages/ui (React + Vite, canvas views) ──────────────┐
            │  PianoRoll · TabView · PedalLane · DrumGrid · Notation(alphaTab)     │
            │  Zustand store ──► History (commands/undo) ──► Song (immutable)      │
            │  StorageAdapter (rest | electron-ipc | indexeddb)                    │
            └───────────────┬──────────────────────────────┬──────────────────────┘
                            │                              │
          packages/core (pure TS, no DOM)        packages/audio (Web Audio)
          model · zod schema · migrations        engine · scheduler · sampler
          commands/history · tempo map           SFZ parser · amp sim · tones
          fingering engine · pedal · tunings     offline render (WAV)
          import/export mapping                  AudioWorklets (gate)
                            │
       apps/server (Fastify)                apps/desktop (Electron)
       serves UI + /instruments + REST      loads the same UI build, IPC storage,
       projects on disk (/data)             native menus/dialogs, bundled instruments
```

**One note model, many views.** A track holds exactly one `notes` array (guitar/bass) or `hits` array (drums). Views
derive everything else: the fingering engine computes `{string, fret}` from the notes + tuning on every change
(memoised per track), the tab/notation views lay out from the same arrays, and alphaTab receives a score model built
from our song (never the other way round).

**Edits are commands.** Every mutation goes through `History.execute(command)`. A command is a pure function
`Song → Song` with a label. The history stores the song before each command (structural sharing makes this cheap),
so undo/redo covers notes, stomps, tempo, track settings — everything. Drags are grouped into one undo step with
`history.begin()/commit()` transactions.

**Time.** 960 ticks per quarter note. The tempo map converts ticks ↔ seconds with constant segments and linear
(gradual) ramps, solved in closed form. Time signatures convert bars ↔ ticks.

## Folder layout

```
package.json, pnpm-workspace.yaml, tsconfig.base.json, eslint.config.js, .prettierrc
packages/core      src/{model,schema,tunings,tempo,timesig,fingering,pedal,history,commands,templates,…}.ts + tests
packages/audio     src/{engine,scheduler,sampler,sfz,amp/*,tones,offline}.ts, worklets/
packages/ui        index.html, src/{main.tsx,App.tsx,store.ts,views/*,storage/*,components/*}
apps/server        src/index.ts (Fastify: static UI, /instruments, /api/projects)
apps/desktop       src/{main,preload}.ts, electron-builder.yml
scripts            fetch-instruments.ts, gen-notices.ts
instruments        manifest.json (+ downloaded packs, git-ignored)
docs               PLAN.md, DECISIONS.md
Dockerfile, docker-compose.yml, .github/workflows/{ci,release}.yml
```

## Library choices

| Purpose | Library | Version | License |
|---|---|---|---|
| Language | TypeScript | 6.0.x | Apache-2.0 |
| Package manager | pnpm (workspaces) | 10.12 | MIT |
| UI | React / react-dom | 19.x | MIT |
| Bundler / dev server | Vite + @vitejs/plugin-react | 8.x / 6.x | MIT |
| State | Zustand | 5.x | MIT |
| Schema validation | zod | 4.x | MIT |
| Tests | Vitest | 5.x | MIT |
| Lint / format | ESLint 10 + typescript-eslint 8, Prettier 3 | | MIT |
| Server | Fastify 5 + @fastify/static | | MIT |
| Desktop | Electron + electron-builder | 45.x / 26.x | MIT |
| Notation | @coderline/alphatab | 1.9.x | MPL-2.0 (used unmodified, file-level copyleft OK) |
| SF2/SF3 synth | spessasynth_lib | 4.x | Apache-2.0 |
| Zip (.riff) | fflate | 0.8.x | MIT |
| 7z extraction (fetch script) | 7zip-bin | 5.x | MIT (bundles 7-Zip, LGPL) |
| TS script runner | tsx | 4.x | MIT |

## Instruments (default packs)

| Role | Pack | Size | License |
|---|---|---|---|
| Guitar (DI) | FreePats FSBS Electric Guitar **Direct**, SFZ+FLAC | ~77 MB | CC0 1.0 |
| Bass | FreePats Yamaha RBX bass (picked + finger), SFZ+FLAC | ~3 MB each | CC0 1.0 |
| Drums | Karoryfer Big Rusty Drums (CC0) — trimmed on fetch | 620 MB download | CC0 1.0 |
| Cabinet IRs | generated in-app (see DECISIONS) + user IRs | — | — |

## Milestones

1. **Scaffold** — monorepo, lint/test/typecheck/CI, empty app via `pnpm dev`, `docker compose up`, `pnpm desktop:dev`; storage adapters stubbed.
2. **Core model + fingering engine** — song model + zod schema, commands/undo, tempo map, fingering engine with all required tests + benchmark.
3. **Piano roll + tab (one guitar track)** — prototype parity: string colours, fret + note name, position picker, pedal lane, linked tab.
4. **Audio v1** — SFZ sampler, fetch script, guitar DI → amp sim with Clean/Dist, live stomp switching with crossfade, transport, metronome, loop.
5. **Multi-track** — drums (grid + kit), bass, mixer, 4-track template, mute/solo, track colours.
6. **Tab editing depth** — keyboard tab entry, durations/tuplets/rests/ties, techniques + playback, sections, repeats, time sig + tempo changes, alphaTab notation.
7. **Files** — `.riff` save/load + autosave, GP/MusicXML/MIDI import, MIDI/MusicXML/WAV/stems/PDF export, ASCII tab copy.
8. **Packaging** — production Docker image, Electron installers (Win/macOS/Linux), CI release workflow, README.
9. **Polish** — tone tuning, humanize, performance, accessibility, cheat sheet, About/credits from manifest.
10. **Stretch** — NAM models, Web MIDI input, live guitar input.

## Risks and things I think are wrong or need care

- **Drum kit size.** Every CC0 / CC-BY rock kit listed is 0.6–1.2 GB. Shipping that in a Docker image or installer is
  unreasonable. The fetch script will download once, keep only one mic mix and a reduced set of velocity layers, and
  re-encode; the full kit can be enabled with a flag. See DECISIONS.md.
- **No CC0 cabinet IR set with clear redistribution terms was confirmed.** Default cabs are synthesised impulse
  responses generated at runtime from a modelled speaker/cab response (no licensing question). Users can load any IR.
- **alphaTab exporter.** alphaTab can export GP7 (`Gp7Exporter`); GP3/4/5 export is not available. MusicXML export is
  not in alphaTab, so we write our own MusicXML exporter.
- **Time-stretched playback (50–150 % without pitch change)** is not natively possible for a sampler in Web Audio.
  For a MIDI-driven sampler we don't need time-stretching at all: we schedule notes at a scaled tempo, which leaves
  pitch untouched. Only audio-file playback would need it, and we have none.
- **AudioWorklet on LAN needs HTTPS.** Documented in README; the app falls back to non-worklet nodes where possible.
- **Desktop installers for macOS** need signing/notarisation to open without warnings; the workflow builds unsigned
  artefacts and documents the secrets to add.
- **Scope.** The spec is large; each milestone is kept shippable, and remaining work is tracked at the bottom of this
  file as it lands.

## Status

See the git log; each milestone ends with a commit `Mx: …` and a "how to try it" note in this file's history section.
