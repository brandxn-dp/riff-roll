# Riff Roll

Songwriting for rock bands. Draw a riff in an FL Studio–style piano roll and get colour-coded Guitar Pro–style tab
with frets and note names. Drop a stomp on the pedal lane to go from clean to distorted in the same guitar track. Add
drums and bass, and hear the song through sampled instruments and an amp sim. Save it, export it, print it.

It runs two ways from one codebase: as a **Docker** web app and as a **desktop app** for Windows, macOS and Linux.

![Piano roll with string colours, pedal lane and linked tab](docs/screenshots/roll-and-tab.png)

| Notation + tab (alphaTab) | Drum grid |
|---|---|
| ![Notation](docs/screenshots/notation.png) | ![Drum grid](docs/screenshots/drum-grid.png) |

## Features

- **One note model, many views.** The piano roll, tab, notation and drum grid all show the same data. An edit in one
  view appears in all of them, and undo/redo covers every edit, including stomps, tempo and track settings.
- **Piano roll → tab.** A fingering engine picks string and fret for every note. It keeps riffs in one position,
  puts power chords on neighbouring strings and avoids strings that are still ringing. Notes are coloured by string.
  Click a note to see every place it can be played and pin it to one, or use **Auto**.
- **Tab editor**: keyboard entry like Guitar Pro (arrows, frets, durations, dots, triplets, rests, ties, insert/delete
  beat) and techniques (hammer/pull, slides, bend curves, vibrato, palm mute, let ring, dead notes, harmonics,
  tapping, tremolo picking, ghost notes, accents, staccato, pick direction, whammy, volume swell, trills).
- **Pedal lane**: tones (Clean, Crunch, Dist, Lead …) switched by stomps. Each switch crossfades between amp chains,
  so ringing strings change tone the way they do with a real footswitch. Stomps show up in the tab and the notation.
- **Sound**: SFZ sampler (velocity layers, round robins, choke groups) with CC0 instruments:
  - FreePats FSBS DI guitar, played through an amp sim (gate, drive, two-stage amp, tone stack, cab IR, effects)
  - FreePats Yamaha bass
  - Karoryfer Big Rusty Drums
- **Song structure**: sections with jump-to chips, tempo changes (including gradual ones), time-signature and key
  changes, repeats with alternate endings, a loop region, a metronome with count-in, playback at 50–150 % speed
  without changing pitch, and a minimap.
- **Files**: `.riff` projects with autosave and crash recovery.
  - Import: Guitar Pro 3–8/GPX, MusicXML, MIDI.
  - Export: MIDI, MusicXML, Guitar Pro 7, WAV (full mix or per-track stems), PDF/print, and ASCII tab copied to the
    clipboard.

- **Tones**: a pedalboard-style editor for every amp-chain parameter, your own cabinet IRs (WAV), and an A/B
  listening tool for tuning tones.
- **Your own instruments**: **File → Instruments…** adds an SFZ instrument from a folder (Docker and desktop).
- **Inputs**: record from a MIDI keyboard or MIDI guitar (step entry when stopped, string-per-channel mode for MIDI
  guitars), or play a real guitar through a track's amp and pedal via your audio interface.

Press **?** in the app for the keyboard cheat sheet.

## Run with Docker

```bash
docker compose up -d
```

Then open **http://localhost:8080**.

- The image contains the default instruments (about 160 MB of CC0 samples). To build a smaller image, build with
  `INCLUDE_INSTRUMENTS=false docker compose up -d --build`. The server then downloads the instruments into the
  `instruments` volume on first start; progress is at `/api/instruments/status`.
- Use another host port with `RIFFROLL_PORT=8090 docker compose up -d`.
- Your songs live in the `projects` volume (`/data/projects/*.riff`). To add your own SFZ instruments, put them in
  the `instruments` volume (`/data/instruments/<id>/` plus an `instrument.json`, as `pnpm fetch-instruments` writes
  them).

### Backups

Projects are plain `.riff` files (zip archives). To back up the volume:

```bash
docker run --rm -v better-tab-program_projects:/data -v "$PWD":/backup alpine tar czf /backup/riffroll-projects.tgz -C /data .
```

To restore, run the same command with `tar xzf /backup/riffroll-projects.tgz -C /data`. The volume name is your
compose project name plus `_projects`; `docker volume ls` lists them.

### Password protection for LAN use

Set `RIFFROLL_BASIC_AUTH=user:password`, for example in a `.env` file next to `docker-compose.yml`:

```bash
RIFFROLL_BASIC_AUTH=band:correct-horse-battery-staple
```

Every route except `/api/health` then requires HTTP basic auth.

### HTTPS and reverse proxies (important for LAN access)

Browsers only allow AudioWorklet (used by the noise gate) and some other audio features on **secure origins**.
`http://localhost` counts as secure. `http://192.168.x.x:8080` does **not**. Without a secure origin the app still
works, but the gate is skipped. To use Riff Roll from other machines, put it behind HTTPS.

**Caddy** (automatic local certificates):

```
riffroll.lan {
  tls internal
  reverse_proxy localhost:8080
}
```

**Traefik** (labels on the `riffroll` service):

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.riffroll.rule=Host(`riffroll.example.com`)
  - traefik.http.routers.riffroll.entrypoints=websecure
  - traefik.http.routers.riffroll.tls.certresolver=letsencrypt
  - traefik.http.services.riffroll.loadbalancer.server.port=8080
```

Basic auth over plain HTTP sends the password unencrypted. Use it together with HTTPS.

## Desktop app

Installers are attached to each GitHub release:

| OS | File |
|---|---|
| Windows | `Riff Roll Setup x.y.z.exe` (NSIS) |
| macOS | `Riff Roll-x.y.z-universal.dmg` |
| Linux | `Riff Roll-x.y.z.AppImage`, `riff-roll_x.y.z_amd64.deb` |

The instruments are bundled, so the app works offline. It also has native menus and open/save dialogs, recent
files, `.riff` file association, remembered window size and position, and autosave. Songs are stored in the app data
folder.

macOS builds are unsigned unless signing secrets are configured, so on first launch right-click the app and choose
**Open**. The secrets are listed in `.github/workflows/release.yml`.

## Development

You need Node 22+ and pnpm 10:

```bash
corepack prepare pnpm@10.12.1 --activate
```

Then:

```bash
pnpm install
pnpm fetch-instruments      # downloads the CC0 sample packs into instruments/packs (never committed)
pnpm dev                    # UI on http://localhost:5173 (serves instruments too)
pnpm desktop:dev            # Electron window on the dev server
pnpm server                 # Fastify server (after `pnpm build`), port 8080
pnpm test                   # Vitest
pnpm lint && pnpm typecheck
pnpm desktop:build          # installer for the current OS (apps/desktop/release)
```

Repository layout:

```
packages/core    song model, commands/undo, fingering engine, tempo map, rhythm, import/export (pure TS)
packages/audio   SFZ sampler, amp sim, scheduler, offline render
packages/ui      React + Vite app (canvas editors, alphaTab notation)
apps/server      Fastify: UI, instruments, projects REST API
apps/desktop     Electron shell (app:// protocol, narrow preload API)
scripts          fetch-instruments, notices, icon
```

`docs/PLAN.md` describes the architecture and milestones. `docs/DECISIONS.md` explains the non-obvious choices.
Third-party licences are listed in `THIRD_PARTY_NOTICES.md` and in the app under **File → About & credits**.

## Licences of bundled sounds

All default instruments are CC0. See `THIRD_PARTY_NOTICES.md`; it is generated from `instruments/manifest.json`. The
cabinet impulse responses are synthesised by the app, so no third-party IR files are included.
