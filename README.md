
![RDMBingoHeader](public/assets/RDMBingo.png)


This MMO Bingo web application was created as an outreach and engagement tool for researchers. It provides an online way for users to demonstrate and celebrate good data practices (e.g., "Write a README", "Publish your data in a repository") in an interactive bingo format. The app is pretty general-purpose though, so the same nuts and bolts can be used for workshops, onboarding, community events, or any setting where people want to mark and link evidence of completed tasks.

![RDMBingoHeader](public/assets/overview.png)

This repository contains the full app (Node + Express backend + static frontend). All user data (accounts, boards, winners) are stored in a single AES-GCM–encrypted JSON file on the host. Passwords are hashed with `bcrypt`. This causes some minor hurdles for local setup (see below), but is generally appropriate for small-scale deployments (like workshops, departmental demos, or research-group use), but larger deployment will require some rethininking to scale the log-in credential storage. 

* Each completed bingo entry can be linked to live evidence (a DOI, repository record, README file, pull request, or project page). That way the wins can be audited by whoever needs to do that, and also serves as a cool way for folks to share their accomplishments. 
* Winners are recorded (one winner entry per account) and presented with a thumbnail of their board so evidence is discoverable. Also the links for the completed squares remain usable. 
* Minimal infrastructure and clear encryption: the data file is encrypted at rest using a server-side `SECRET_KEY`. This makes the app safe enough for outreach use without a full database stack.
* It is coded up so that changes to the phrases, board size, UI styling, etc. is prety easy to change.

# Contents

* `server.js` — Express server and API endpoints
* `lib/store.js` — small encrypted file-backed store (AES-256-GCM)
* `public/` — static frontend (HTML/CSS/JS)
* `public/help.html` — Help page with rules and resource links for each task
* `data/` — (ignored) where `store.json.enc` is created by the app unless you set a custom path
* `scripts/` — optional maintenance scripts (e.g., dedupe winners)
* `package.json` — Node deps and start script

# Requirements

* Node.js 16+ (recommended: Node 18+)
* npm
* A host for deployment that supports a persistent filesystem for the encrypted data file (or a refactor to a DB/object store). Example hosts: Render (with persistent disk), a small VPS, Docker + volume, or local machine.

# Local setup

1. Clone the repo and install:

   ```bash
   git clone <your-repo-url>
   cd <repo>
   npm install
   ```

2. Generate a strong `SECRET_KEY` (must be at least 32 characters). You can do this a couple of different ways:

   * Node:

     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
Or if you prefer:

   * OpenSSL:

     ```bash
     openssl rand -hex 48
     ```

   Copy the generated string; treat it as a secret.

3. Start the app with the `SECRET_KEY` set. For development you may set `STORE_FILE_PATH` to a local path (recommended to add `data/` to `.gitignore` so the encrypted file is never committed).

   macOS / Linux:

   ```bash
   export SECRET_KEY="paste-your-generated-key-here"
   export STORE_FILE_PATH="./data/store.json.enc"   # optional; defaults to ./data/store.json.enc
   npm start
   ```

   Windows PowerShell:

   ```powershell
   $env:SECRET_KEY = "paste-your-generated-key-here"
   $env:STORE_FILE_PATH = ".\data\store.json.enc"
   npm start
   ```

4. Open the app at [http://localhost:3000](http://localhost:3000). The first run will create `data/store.json.enc` encrypted with your `SECRET_KEY`.

# Security for server deployment

When deploying on a server, we obviously need to get rid of the hard coded key. So:

1. Set **both** of these as environment variables on the server

| Variable | Required? | Purpose | How to generate |
|---|---|---|---|
| `SECRET_KEY` | Yes | Encrypts the data file at rest (AES-256-GCM) | `openssl rand -hex 48` |
| `SESSION_SECRET` | Strongly recommended | Signs session cookies so they can't be tampered with | `openssl rand -hex 48` |
| `ADMIN_TOKEN` | Required for admin CLI | Authenticates admin API requests (see "Administration" below) | `openssl rand -hex 32` |

If `SESSION_SECRET` is not set, the server will generate a random one at startup. This means **all user sessions will be invalidated every time the server restarts**. So for roll out, we need to set it explicitly, and make sure it is available.

2. Place the app behind a reverse proxy that terminates TLS (HTTPS). Session cookies are `httpOnly` but not marked `secure` by default, so with HTTPS in front this is handled at the proxy layer.

3. Use a secrets manager (e.g., Render environment variables, Docker secrets, systemd `EnvironmentFile`, etc.). Command-line arguments are visible in process listings.

   Example with a `.env` file (keep `.env` in `.gitignore`):
   ```bash
   SECRET_KEY=your-64-char-hex-string-here
   SESSION_SECRET=another-64-char-hex-string-here
   ADMIN_TOKEN=your-32-char-admin-token-here
   PORT=3000
   ```

   Then load with something like [dotenv](https://www.npmjs.com/package/dotenv) or your init system.

4. Restrict file permissions on the `data/` directory so only the application's user can read/write the encrypted store:
   ```bash
   chmod 700 data/
   ```

4. Back up `data/store.json.enc` regularly. The entire database is a single file — if it's corrupted or lost, all data is gone. A simple cron job can copy it to a safe location.

5. Consider rate limiting using the reverse proxy as the app does not currently include rate limiting natively.

6. Only expose the port the app listens on (default `3000`) through the reverse proxy. i.e. do not expose it directly to the internet.

# Administration

User management is done via the CLI script `scripts/admin.js`, which talks to the **running server** over HTTP using a Bearer token. The app stays online — there is no need to stop the server to add, list, or delete users.

## How it works (architecture)

- The server reads an `ADMIN_TOKEN` from its environment at startup.
- The server exposes two endpoints under `/api/admin/` that require a matching `Authorization: Bearer <token>` header.
- The CLI script reads the same token from its own environment and sends authenticated HTTP requests to the server.
- Because the server is the only writer to the encrypted store, there are no race conditions and no risk of one process overwriting the other's changes.

## One-time setup

### 1. Generate a strong admin token

A 32-byte hex string (64 chars) is plenty:

```bash
openssl rand -hex 32
```

Treat this token like a password. **Anyone with this token can list and delete user accounts.**

### 2. Set `ADMIN_TOKEN` on the server

Add it to whatever mechanism you use to set environment variables for the server (`.env` file, systemd `EnvironmentFile`, Docker secrets, hosting platform's secrets manager, etc.). For example:

```bash
# /etc/bingo.env (read by your service manager)
SECRET_KEY=...
SESSION_SECRET=...
ADMIN_TOKEN=paste-the-64-char-hex-string-here
```

Restart the server so it picks up the new value. On startup the server logs whether `ADMIN_TOKEN` is set:

```
WARNING: ADMIN_TOKEN not set. Admin API endpoints will return 503.   ← bad, fix this
Bingo app listening at http://localhost:3000                          ← good, no warning means it's set
```

If `ADMIN_TOKEN` is **not** set, the admin endpoints return HTTP 503 to every request and no one can manage users — the server is otherwise unaffected.

### 3. Save the token where you'll run admin commands

You can run admin commands from any machine that can reach the server. The simplest place is the server itself, over SSH. Common patterns:

**Per-command (most secure, no persistent secret on disk):**
```bash
ADMIN_TOKEN="paste-token" node scripts/admin.js list
```

**Persistent in your shell session (convenient for a series of commands):**
```bash
export ADMIN_TOKEN="paste-token"
node scripts/admin.js list
node scripts/admin.js delete spammer@example.com
```

**In a per-user dotfile (e.g., `~/.bingo-admin.env`, mode 600):**
```bash
chmod 600 ~/.bingo-admin.env
echo 'ADMIN_TOKEN=paste-token' > ~/.bingo-admin.env
# then before admin work:
set -a; source ~/.bingo-admin.env; set +a
```

Never commit the token to git or paste it into a chat/issue tracker.

## Daily admin commands

```bash
# Show every account (active and soft-deleted) with bingo status
node scripts/admin.js list

# Same, JSON output (useful for piping into jq, exports, etc.)
node scripts/admin.js list --json

# Soft-delete an account by email
node scripts/admin.js delete user@example.com

# Show help
node scripts/admin.js help
```

If you're administering a remote server (not localhost), point the script at it:

```bash
SERVER_URL="https://bingo.example.org" node scripts/admin.js list
```

## What "delete" does

`delete` is a **soft delete**:

- The user record is kept (so admins can audit when and who deleted whom) with a `deletedAt` timestamp
- The user's password hash and board are wiped — they cannot sign in again
- The user's winner entry is removed from the public Winners page immediately
- Any active sessions for that user are destroyed (they're logged out within seconds)
- The email address is preserved so the same person cannot trivially re-register

## Rotating the admin token

If you suspect the token has leaked:

1. Generate a new token: `openssl rand -hex 32`
2. Update `ADMIN_TOKEN` in your environment file
3. Restart the server
4. Update wherever you keep the token for admin use (shell, dotfile, etc.)
5. (Optional) Audit `node scripts/admin.js list --json` to make sure no unexpected accounts were deleted

## Security checklist for the admin endpoint

- ✅ The server uses a constant-time comparison (`crypto.timingSafeEqual`) when checking the token, so timing attacks cannot leak it.
- ✅ Tokens are sent in the `Authorization` header (not URL or query string), so they don't end up in access logs by default.
- ✅ If `ADMIN_TOKEN` is not set on the server, the admin endpoints reject every request with 503.
- ⚠️ Always run admin commands over HTTPS when administering a non-local server. The `SERVER_URL` should start with `https://` in production.
- ⚠️ Treat the token like a database root password: store it in a secrets manager, restrict who can read it, and rotate it if anyone leaves the team.

# License

This project is provided under the Apache License. See `LICENSE` for details.
