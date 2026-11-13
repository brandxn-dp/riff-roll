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
  - Bread Bread's Overdriven Guitar (public domain): the default distorted tone, sampled through its own amp, with
    real palm-mute, hammer-on/pull-off and up/down-stroke samples
  - Bread Bread's Drum Kit (the default kit; public domain) and Karoryfer Big Rusty Drums
- **Song structure**: sections with jump-to chips, tempo changes (including gradual ones), time-signature and key
  changes, repeats with alternate endings, a loop region, a metronome with count-in, playback at 50–150 % speed
  without changing pitch, and a minimap.
- **Files**: `.riff` projects with autosave and crash recovery.
  - Import: Guitar Pro 3–8/GPX, MusicXML, MIDI.
  - Export: MIDI, MusicXML, Guitar Pro 7, WAV (full mix or per-track stems), PDF/print, and ASCII tab copied to the
    clipboard.

- **Tones**: each tone either runs the track's DI guitar through the amp chain or plays a sampled guitar (Tone
  editor → Sound). A pedalboard-style editor for every amp-chain parameter, your own cabinet IRs (WAV), and an A/B
  listening tool for tuning tones.
- **Your own instruments**: **File → Instruments…** adds an SFZ instrument from a folder, or any presets of an
  SF2 / SF3 SoundFont (Docker and desktop).
- **Inputs**: record from a MIDI keyboard or MIDI guitar (step entry when stopped, string-per-channel mode for MIDI
  guitars), or play a real guitar through a track's amp and pedal via your audio interface.

- **Phones**: a dedicated touch layout is picked automatically on phones (tap to add notes, an on-screen fret
  pad for tab, bottom navigation, full controls in the ☰ sheet). Tablets keep the full layout with larger touch
  targets. Override it under File → Phone layout or ☰ → App → Layout.
- **Global view** (Guitar Pro style, under the editor): every track as a row of bars with mute, solo, volume
  and pan. Drag to select bars across tracks, click a section name to select the section, then copy, cut, paste
  (overwrite or insert), clear, duplicate, insert or delete bars; right-click for the menu.
- **Other instruments**: add an **Other** track for piano, synth, strings and so on, and give it any SFZ
  instrument you upload with the *Other* role (File → Instruments…). Piano roll and notation, no tab or amp.
- **Editing helpers**: bulk velocity (set, scale, add, ramp, humanize) for selected notes or drum hits, Alt+drag to
  draw velocities, separate horizontal and vertical zoom, Shift-drag box select and Shift+click a drum or key to
  select all of it.
- **Accounts and sharing** (Docker / Unraid server): everyone signs in and sees only their own songs plus songs
  shared with them. Share a song **view only** (they can open, play and save their own copy) or **can edit**
  (their changes save into your song; if two people save over each other, the second one is asked to reload or
  keep a copy). After signing in, a launch screen shows recently opened songs and all your songs.

- **Settings** (File → Settings…, Ctrl+,): themes (Studio, Midnight, Ember, High contrast, Light, Paper, or
  match the system) with six accent colours; audio output device, latency and sample rate; editable keyboard
  shortcuts; starting grid and note length, note preview, follow playhead; interface size in the desktop app. Server
  admins also get a **Server admin** page: version, uptime, users, songs and storage, a sign-up switch, and signing
  a person out of every device.
- **Bulk edits**: with several notes selected, technique buttons apply to all of them, and the inspector moves them
  to one string, a string up or down, or around a fret, by octaves, or clears their techniques.
- **Lanes**: the velocity and pedal lanes under the piano roll can each be hidden and resized (Lanes menu, or drag
  their edges); the bar count can be typed, and **＋ Bars** in the global view inserts 1, 2, 4, 8 or 16 bars.

- **Note colour palettes** (Settings → Appearance): Classic, Pastel, Neon, Colour-blind safe, Ocean, Sunset, One
  colour or your own; strings, drums and new tracks follow it. Piano roll notes can be coloured by string, track,
  velocity or pitch.
- **Connect Claude** (Settings → Claude): an MCP endpoint so Claude Code or Claude Desktop can read and edit the
  open song (see below).

Press **?** in the app for the keyboard cheat sheet.

## Connect Claude (MCP)

Riff Roll speaks the [Model Context Protocol](https://modelcontextprotocol.io), so Claude can work on the song open
in the editor: read notes and tab, write riffs (by pitch or string and fret, with techniques), program drums, change
tempo, key, time signature and sections, add or change tracks, play and stop. Every change shows up live and is one
undo step ("Claude: …").

- **Desktop app**: Settings → Claude → switch it on. The endpoint is `http://127.0.0.1:3917/mcp` (the port can be
  changed), reachable only from this computer and protected by the token shown there.
- **Docker server**: Settings → Claude → Make a token (per user; shown once). The endpoint is
  `https://your-server/mcp`; Claude works on the song in your most recently used Riff Roll tab, so keep one open.

The settings page shows ready-to-copy setup for both clients:

```bash
claude mcp add --transport http riff-roll http://127.0.0.1:3917/mcp --header "Authorization: Bearer <token>"
```

Tempo and time signature can change for part of a song (`set_tempo`, `set_time_signature` with `from_bar` / `to_bar`;
after the range they go back to what they were).

Claude Desktop uses `npx mcp-remote` in `claude_desktop_config.json` (needs Node.js). The claude.ai website can
only reach servers on a public https address.

Tools: `get_song`, `get_notes`, `get_tab`, `add_notes`, `add_drum_hits`, `edit_notes`, `delete_notes`,
`set_song`, `set_tempo`, `set_time_signature`, `set_sections`, `add_track`, `update_track`, `show`, `playback`, `undo`, `list_songs`, `open_song`,
`new_song`.

## Run with Docker

A prebuilt image is published on every push to `main`: `ghcr.io/brandxn-dp/riff-roll:latest`.
**Unraid**: see [docs/UNRAID.md](docs/UNRAID.md).

Or build it yourself:

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

Projects are plain `.riff` files (zip archives); `accounts.json` and `library.json` in the same volume hold the
accounts and who owns and shares what. To back up the volume:

```bash
docker run --rm -v better-tab-program_projects:/data -v "$PWD":/backup alpine tar czf /backup/riffroll-projects.tgz -C /data .
```

To restore, run the same command with `tar xzf /backup/riffroll-projects.tgz -C /data`. The volume name is your
compose project name plus `_projects`; `docker volume ls` lists them.

### Accounts

The first time you open the app it asks you to **create the first account**. That account is an admin, and it
takes over any songs already on the server. Admins add everyone else under **your name → Manage users** (people
can't sign themselves up unless you set `RIFFROLL_SIGNUP=open`, or switch sign-up on under **Settings → Server
admin**; that switch is saved in `server-settings.json` and overrides the variable). Each person sees only their own
songs and the ones shared with them, even on the same computer or browser.

Accounts, sessions and sharing live in `accounts.json` and `library.json` next to the songs in the projects
volume, so the usual backup covers them. Passwords are stored as scrypt hashes; sessions are HttpOnly cookies
that last 30 days. Repeated wrong passwords lock that username out for 10 minutes.

**Forgot the admin password?** Start the container once with `RIFFROLL_RESET_PASSWORD=username:new-password`,
sign in, then remove the variable.

The desktop app and the browser-only mode are single-user (no sign-in); they still get the launch screen.

### Extra password for LAN use (optional)

`RIFFROLL_BASIC_AUTH=user:password` adds HTTP basic auth in front of everything (including the sign-in page),
for example in a `.env` file next to `docker-compose.yml`:

```bash
RIFFROLL_BASIC_AUTH=band:correct-horse-battery-staple
```

Every route except `/api/health` then requires it. With accounts this is rarely needed.

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
| Windows | `riff-roll-setup-x.y.z.exe` (NSIS; 0.3.0 and older: `Riff.Roll.Setup.x.y.z.exe`) |
| macOS | `Riff.Roll-x.y.z-universal.dmg` |
| Linux | `riff-roll-x.y.z-x86_64.AppImage`, `riff-roll-x.y.z-amd64.deb` |

**Updates (Windows, Linux AppImage):** from 0.3.1 on, the installed app checks GitHub for a new release when it
starts (and every few hours), downloads it in the background and asks to restart when it is ready; "Later" installs it
when you quit. **Help → Check for Updates…** checks on demand, and **Help → Check for Updates Automatically** turns
the automatic check off. Versions 0.3.0 and older have no updater: install 0.3.1 once by hand. macOS builds are
unsigned, so macOS can't install updates by itself; download new versions from the releases page.

The instruments are bundled, so the app works offline. It also has native menus and open/save dialogs, recent
files, `.riff` file association, remembered window size and position, and autosave. Songs are stored in the app data
folder.

### Build the Windows installer yourself

You need [Node.js 22](https://nodejs.org) or newer and [Git](https://git-scm.com). In a terminal (PowerShell or
Command Prompt):

```bash
git clone https://github.com/brandxn-dp/riff-roll.git
cd riff-roll
corepack enable
pnpm install
pnpm fetch-instruments
pnpm desktop:build
```

`corepack enable` provides the pinned pnpm version (run that terminal as administrator if it complains about
permissions, or use `npm install -g pnpm@10` instead). `pnpm fetch-instruments` downloads the default sample packs
(about 160 MB, a few minutes) so they are bundled into the installer. The installer is written to `apps/desktop/release/riff-roll-setup-x.y.z.exe`. Windows SmartScreen
warns about an unknown publisher because the installer isn't code-signed: click **More info → Run anyway**. To
update later: `git pull`, `pnpm install`, `pnpm desktop:build`. Builds for macOS must be made on a Mac and Linux
builds on Linux (or let the release workflow build all three).

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

All default instruments are CC0 or public domain. See `THIRD_PARTY_NOTICES.md`; it is generated from `instruments/manifest.json`. The
cabinet impulse responses are synthesised by the app, so no third-party IR files are included.
