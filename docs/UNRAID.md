# Running Riff Roll on Unraid

The Docker image is published to GitHub Container Registry on every push to `main`:
`ghcr.io/brandxn-dp/riff-roll:latest` (instruments included, ~650 MB).

## Option A: Add Container in the Docker tab (no files needed)

1. **Docker** tab → **Add Container** (at the bottom). Turn on **Advanced View** (top right).
2. Fill in:

   | Field | Value |
   |---|---|
   | Name | `riff-roll` |
   | Repository | `ghcr.io/brandxn-dp/riff-roll:latest` |
   | Network Type | `Bridge` |
   | WebUI | `http://[IP]:[PORT:8080]/` |
   | Icon URL | `https://raw.githubusercontent.com/brandxn-dp/riff-roll/main/packages/ui/public/icon-512.png` |
   | Extra Parameters | `--restart unless-stopped` |

3. Click **Add another Path, Port, Variable, Label or Device** for each row below:

   | Config Type | Name | Container value | Host value |
   |---|---|---|---|
   | Port | Web UI port | Container Port `8080` | Host Port `8080` (or any free port) |
   | Path | Projects | `/data/projects` | `/mnt/user/appdata/riff-roll/projects` |
   | Path | Instruments | `/data/instruments` | `/mnt/user/appdata/riff-roll/instruments` |
   | Variable | PUID | Key `PUID` | `99` |
   | Variable | PGID | Key `PGID` | `100` |
   | Variable | Basic auth (optional) | Key `RIFFROLL_BASIC_AUTH` | `user:password` |

4. **Apply**. Unraid pulls the image and starts it. When the icon turns green (healthy), click it → **WebUI**.

## Option B: Use the template

1. Open the Unraid **Terminal** (top-right `>_` icon) and run:
   ```bash
   wget -O /boot/config/plugins/dockerMan/templates-user/my-riff-roll.xml https://raw.githubusercontent.com/brandxn-dp/riff-roll/main/unraid/riff-roll.xml
   ```
2. **Docker** tab → **Add Container** → **Template** dropdown → choose **riff-roll** under *User templates*.
3. Check the port and paths, then **Apply**.

## Updating

Every push to `main` builds a new `latest` image. In the **Docker** tab, click **Check for Updates**, then
**apply update** on riff-roll (or enable auto-updates with the CA Auto Update plugin). Your songs in
`/mnt/user/appdata/riff-roll/projects` are kept.

## HTTPS (recommended)

Browsers only allow some audio features on secure origins. Over plain `http://<unraid-ip>:8080` the app works,
but the amp's noise gate is skipped, and **MIDI input** and **live guitar input** are unavailable. Put it behind
HTTPS with the reverse proxy you already use on Unraid:

- **Nginx Proxy Manager**: add a Proxy Host for e.g. `riffroll.yourdomain.com` → forward to `<unraid-ip>:8080`,
  enable *Websockets Support*, request an SSL certificate.
- **SWAG**: copy a generic subdomain conf and set `upstream_app` to the Unraid IP and `upstream_port` to `8080`.
- **Tailscale**: `tailscale serve` (or the Tailscale plugin) gives you an HTTPS `*.ts.net` address.

Set **Basic auth** if the app is reachable from outside your LAN.

## Backups

Your songs are plain `.riff` files in `/mnt/user/appdata/riff-roll/projects`. Back up that folder (for example
with the *Appdata Backup* plugin), or download songs from the app with **File → Download .riff**.

## Troubleshooting

- **Container stops right away / can't save**: check `PUID=99` and `PGID=100` are set. The container fixes
  ownership of the two appdata folders on start and then runs as that user.
- **Port already in use**: change the *Host Port* (e.g. `8090`) and open `http://<unraid-ip>:8090`.
- **Image not found when pulling**: the GitHub package must be public (it is for this repo); retry after the
  first build on GitHub Actions has finished.
