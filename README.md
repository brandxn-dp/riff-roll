# Riff Roll

Songwriting for rock bands: draw in a piano roll, get colour-coded guitar tab, stomp from clean to distorted in one
track, add drums and bass, and hear it through sampled instruments and an amp sim.

Runs as a **Docker** web app or as a **desktop app** (Windows, macOS, Linux) from one codebase.

## Development

Requires Node 22+ and pnpm 10 (`corepack prepare pnpm@10.12.1 --activate`).

```bash
pnpm install
pnpm fetch-instruments      # downloads the CC0 sample packs (not stored in git)
pnpm dev                    # UI at http://localhost:5173
pnpm desktop:dev            # Electron window on the dev server
pnpm test                   # unit tests
pnpm lint && pnpm typecheck
```

## Docker

```bash
docker compose up -d
```

Open http://localhost:8080. Projects live in the `projects` volume, instruments in the `instruments` volume.

More (backups, reverse proxy, HTTPS for LAN, basic auth) is documented below as the packaging milestone lands.

See `docs/PLAN.md` for the architecture and `docs/DECISIONS.md` for the reasoning behind non-obvious choices.
