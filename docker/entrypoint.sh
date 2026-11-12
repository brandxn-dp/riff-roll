#!/bin/sh
# Runs the server as an unprivileged user. Started as root (the default), it makes /data writable for
# PUID:PGID (Unraid: 99:100, default 1000:1000) and then drops privileges with su-exec.
# Started with `--user`, it just runs as that user.
set -e
if [ "$(id -u)" = "0" ]; then
  PUID="${PUID:-1000}"
  PGID="${PGID:-1000}"
  mkdir -p /data/projects /data/instruments
  # only touch what isn't owned yet, so big instrument folders aren't re-chowned on every start
  find /data \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} + 2>/dev/null || true
  exec su-exec "$PUID:$PGID" "$@"
fi
exec "$@"
