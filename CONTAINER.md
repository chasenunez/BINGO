# Running RDM Bingo in a container

The app is packaged as a standard OCI image. Everything it needs (Node, the
compiled `bcrypt` module, the static site, the admin scripts) is inside the
image. The only thing outside it is the encrypted data file, which lives on a
volume so it survives every rebuild.

This works with Docker and, unchanged, with Podman: substitute `podman` for
`docker` throughout.

---

## 1. First run

```bash
cp .env.example .env
```

Fill in `SECRET_KEY`, `SESSION_SECRET`, and `ADMIN_TOKEN`. Generate each one
with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

> `.env` uses plain `KEY=value` lines, not `export KEY=value`. The older
> `.env.local` file used shell syntax because it was meant to be `source`d;
> Compose does not understand `export`.

Then start it:

```bash
docker compose up -d --build
```

Check it came up:

```bash
docker compose ps
curl http://127.0.0.1:3000/healthz
```

`{"ok":true}` means the process is serving. The app itself is at
`http://127.0.0.1:3000/` (or under `BASE_PATH` if you set one).

### Without Compose

Compose is a convenience, not a requirement. The equivalent plain commands:

```bash
docker build -t rdm-bingo:local .
```

```bash
docker run -d --name bingo --init --restart unless-stopped --env-file .env -e STORE_FILE_PATH=/data/store.json.enc -v bingo-data:/data -p 127.0.0.1:3000:3000 --read-only --tmpfs /tmp --security-opt no-new-privileges:true rdm-bingo:local
```

---

## 2. Deploying a code change

This is the loop you will use most. Data is untouched by it.

```bash
git pull
```

```bash
docker compose up -d --build
```

Compose rebuilds the image, replaces the container, and reattaches the same
`bingo-data` volume. Expect a few seconds of downtime.

Because `package.json` and `package-lock.json` are copied before the source,
a change that touches only application code reuses the cached dependency
layer and rebuilds in seconds. Changing a dependency triggers a full
reinstall, which is correct and takes a couple of minutes.

### What each kind of change requires

| You changed | What to do |
|---|---|
| `server.js`, `lib/`, `public/`, `scripts/` | `docker compose up -d --build` |
| `package.json` / `package-lock.json` | same command; the install layer rebuilds |
| A value in `.env` | `docker compose up -d` (no rebuild needed) |
| `Dockerfile` or `docker-compose.yml` | `docker compose up -d --build` |
| Added a new top-level directory the app loads at runtime | add a `COPY` line for it in the Dockerfile, then rebuild |

That last row is the one easy thing to get wrong. The Dockerfile copies named
paths rather than the whole tree, so a new runtime directory is invisible to
the image until it is listed. New files inside existing directories need no
change.

### Rolling back

Tag before you deploy and you can always step back:

```bash
IMAGE_TAG=$(git rev-parse --short HEAD) docker compose up -d --build
```

```bash
IMAGE_TAG=<previous-sha> docker compose up -d
```

---

## 3. The data

`bingo-data` is a named Docker volume holding a single file,
`store.json.enc`. It is AES-256-GCM encrypted with `SECRET_KEY`.

**The encrypted file is useless without `SECRET_KEY`.** Back up the key
separately from the data, and keep both. There is no recovery path.

### Back up

```bash
docker run --rm -v bingo-data:/data:ro -v "$PWD":/backup alpine tar czf /backup/bingo-data-$(date +%F).tar.gz -C /data .
```

### Restore

Stop the app first so nothing is mid-write:

```bash
docker compose down
```

```bash
docker run --rm -v bingo-data:/data -v "$PWD":/backup alpine tar xzf /backup/bingo-data-2026-08-31.tar.gz -C /data
```

```bash
docker compose up -d
```

### Inspect a winner's board

```bash
docker compose exec -e SECRET_KEY="$SECRET_KEY" bingo node scripts/reveal-board.js someone@example.org
```

### Prefer a plain directory over a volume

If you would rather see the file on the host filesystem, swap the volume line
in `docker-compose.yml` for a bind mount:

```yaml
    volumes:
      - ./data:/data
```

Then make the directory writable by the container's unprivileged user, whose
uid is 1000:

```bash
mkdir -p data && sudo chown 1000:1000 data
```

---

## 4. Admin scripts

They run inside the container and talk to the server over localhost.

```bash
docker compose exec bingo node scripts/admin.js list
```

```bash
docker compose exec bingo node scripts/retention.js
```

```bash
docker compose exec bingo node scripts/retention.js --apply
```

`ADMIN_TOKEN` comes from `.env` and is already in the container's environment.

If you set `BASE_PATH`, the scripts need to know, because the admin API moves
under the prefix too:

```bash
docker compose exec -e SERVER_URL=http://127.0.0.1:3000/bingo bingo node scripts/admin.js list
```

To run the retention job on a schedule, use a host cron entry that calls into
the container:

```
30 2 * * * cd /opt/bingo && /usr/bin/docker compose exec -T bingo node scripts/retention.js --apply >> /var/log/bingo-retention.log 2>&1
```

---

## 5. Reverse proxy

The container publishes on `127.0.0.1:3000` only. It speaks plain HTTP and
expects something in front of it to terminate TLS. The Apache configuration in
`server_deployment_notes.md` section 6 applies unchanged: the container is a
drop-in replacement for the systemd service, listening on the same port.

Set `COOKIE_SECURE=true` and `BASE_PATH` in `.env` to match the proxy.

---

## 6. Keeping it runnable years from now

The point of containerizing this is that a rebuild in 2031 produces the same
working app. Three things make that true, and each needs a little care.

**The Node version is pinned.** `Dockerfile` sets
`ARG NODE_VERSION=22.21.0` rather than tracking `22` or `latest`. Bump it
deliberately: change the value, rebuild, test, commit. For a stronger
guarantee, pin the base image by digest instead of tag, since tags can be
re-pushed and digests cannot:

```bash
docker buildx imagetools inspect node:22.21.0-bookworm-slim
```

Put the resulting digest in the `FROM` line as
`node:22.21.0-bookworm-slim@sha256:...`.

**Dependencies are locked.** The build uses `npm ci`, which installs exactly
what `package-lock.json` pins and fails rather than silently resolving
something newer. Always commit the lockfile alongside a dependency change.

**Native compilation still works.** `bcrypt` is a C++ addon. It normally
downloads a prebuilt binary, and those downloads will not be hosted forever,
so the build stage installs `python3`, `make`, and `g++`. When the prebuild
disappears, the build compiles from source and keeps working instead of
failing.

### Archive a known-good build

The most durable option is to keep the built image itself, which depends on no
registry and no network:

```bash
docker compose build
```

```bash
docker save rdm-bingo:local | gzip > rdm-bingo-$(git rev-parse --short HEAD).tar.gz
```

Load it anywhere later:

```bash
docker load < rdm-bingo-abc1234.tar.gz
```

A complete archive is three things, stored together: that image tarball, a
data backup from section 3, and the `SECRET_KEY`. With those, the app can be
brought back on any machine that runs containers, whether or not this
repository, npm, or Docker Hub still exist.

---

## 7. Troubleshooting

**Container restarts in a loop.** `docker compose logs bingo`. The usual cause
is a missing or too-short `SECRET_KEY`; the app exits deliberately rather than
starting with no encryption key.

**`EACCES` writing the data file.** The app runs as uid 1000. A bind-mounted
host directory needs `chown 1000:1000`; a named volume handles this itself.

**Everyone logged out after a deploy.** `SESSION_SECRET` is unset, so a new
random one was generated at startup. Set it in `.env`.

**Health check failing but the site loads.** `/healthz` sits at the true root,
outside `BASE_PATH`, on purpose. Check `http://127.0.0.1:3000/healthz`, not
`http://127.0.0.1:3000/bingo/healthz`.

**Admin endpoints return 503.** `ADMIN_TOKEN` is unset in `.env`.
