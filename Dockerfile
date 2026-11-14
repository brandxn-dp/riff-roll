# syntax=docker/dockerfile:1.7
# ---------- build stage ----------
# Debian (glibc) for the build: the bundled 7-Zip binary used to unpack instruments needs it.
FROM node:22-bookworm-slim AS build
ARG INCLUDE_INSTRUMENTS=true
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate
WORKDIR /src

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/audio/package.json packages/audio/
COPY packages/ui/package.json packages/ui/
COPY apps/server/package.json apps/server/
COPY apps/desktop/package.json apps/desktop/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter '!@riffroll/desktop...'

# instruments first, so code changes don't re-download ~160 MB of samples (layer is cached)
COPY instruments/manifest.json instruments/
COPY scripts/fetch-instruments.ts scripts/gen-notices.ts scripts/
COPY apps/server/src/instruments apps/server/src/instruments
RUN mkdir -p /out/instruments packages/ui/src && \
    if [ "$INCLUDE_INSTRUMENTS" = "true" ]; then \
      pnpm fetch-instruments --out /out/instruments && rm -rf /out/instruments/.cache && \
      chmod -R a+rX /out/instruments; \
    fi

COPY . .
RUN pnpm --filter @riffroll/ui build && pnpm --filter @riffroll/server build
RUN pnpm --filter @riffroll/server deploy --prod --legacy /out/server

# ---------- runtime stage ----------
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0 PUID=1000 PGID=1000 \
    UI_DIR=/app/ui PROJECTS_DIR=/data/projects INSTRUMENTS_DIR=/data/instruments \
    BUNDLED_INSTRUMENTS_DIR=/app/instruments MANIFEST_PATH=/app/manifest.json
WORKDIR /app
RUN apk add --no-cache su-exec
COPY --from=build /out/server /app/server
COPY --from=build /src/packages/ui/dist /app/ui
COPY --from=build /src/instruments/manifest.json /app/manifest.json
COPY --from=build /out/instruments /app/instruments
COPY docker/entrypoint.sh /usr/local/bin/riffroll-entrypoint
RUN chmod 755 /usr/local/bin/riffroll-entrypoint && mkdir -p /data/projects /data/instruments && chown -R node:node /data
# starts as root only to fix /data ownership, then runs the server as PUID:PGID (see docker/entrypoint.sh)
EXPOSE 8080
VOLUME ["/data/projects", "/data/instruments"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
ENTRYPOINT ["riffroll-entrypoint"]
CMD ["node", "/app/server/dist/index.js"]
