# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# RDM Bingo container image
#
# Two stages so the shipped image carries no compilers or npm cache:
#   1. deps    installs production dependencies (including the native bcrypt
#              module, which may need to be compiled).
#   2. runtime copies in those dependencies plus the app source and runs it.
#
# Both stages use the SAME base image on purpose. bcrypt compiles against the
# system C library, so a module built on one distro will not load on another.
#
# The Node version is pinned rather than floating on `22` or `latest`, because
# the point of this image is that a rebuild years from now produces the same
# thing. Bump NODE_VERSION deliberately, test, then commit the change.
# For an even stronger guarantee, replace the tag with a digest, e.g.
#   FROM node:22.21.0-bookworm-slim@sha256:<digest> AS deps
# ---------------------------------------------------------------------------

ARG NODE_VERSION=22.21.0
ARG BASE_IMAGE=node:${NODE_VERSION}-bookworm-slim

# --- Stage 1: dependencies -------------------------------------------------
FROM ${BASE_IMAGE} AS deps

# Toolchain for building native modules from source. bcrypt normally downloads
# a prebuilt binary, but those downloads will not be available forever; with
# these packages present the build falls back to compiling and keeps working.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy only the manifests first. As long as they are unchanged, Docker reuses
# the cached install layer, so ordinary code edits rebuild in seconds.
COPY package.json package-lock.json ./

# `npm ci` installs exactly what package-lock.json pins, which is what makes
# this build reproducible. --omit=dev keeps test/build-only packages out.
RUN npm ci --omit=dev && npm cache clean --force

# --- Stage 2: runtime ------------------------------------------------------
FROM ${BASE_IMAGE} AS runtime

# Build metadata. Passed in by docker-compose or the build command so a
# running container can always be traced back to a commit.
ARG GIT_COMMIT=unknown
ARG BUILD_DATE=unknown
LABEL org.opencontainers.image.title="RDM Bingo" \
      org.opencontainers.image.description="Encrypted-file bingo web app" \
      org.opencontainers.image.source="https://github.com/chasenunez/BINGO" \
      org.opencontainers.image.licenses="GPL-3.0" \
      org.opencontainers.image.revision="${GIT_COMMIT}" \
      org.opencontainers.image.created="${BUILD_DATE}"

ENV NODE_ENV=production \
    PORT=3000 \
    STORE_FILE_PATH=/data/store.json.enc

WORKDIR /app

# Dependencies first (they change rarely), then source (changes often).
COPY --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json server.js ./
COPY --chown=node:node lib ./lib
COPY --chown=node:node public ./public
COPY --chown=node:node scripts ./scripts

# The encrypted store lives here. Creating the directory in the image (owned by
# the unprivileged `node` user) means an empty named volume mounted over it
# inherits that ownership, so the app can write without running as root.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Never run the app as root. The `node` user ships with the base image.
USER node

EXPOSE 3000

# Liveness check against the BASE_PATH-independent /healthz route. Uses Node's
# built-in fetch so the image needs no curl or wget.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is the container's main process and receives signals
# directly. Run the container with --init (or `init: true` in compose) to get
# a proper PID 1 that reaps zombies and forwards SIGTERM promptly.
CMD ["node", "server.js"]
