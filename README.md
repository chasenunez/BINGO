
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

| Variable | Purpose | How to generate |
|---|---|---|
| `SECRET_KEY` | Encrypts the data file at rest (AES-256-GCM) | `openssl rand -hex 48` |
| `SESSION_SECRET` | Signs session cookies so they can't be tampered with | `openssl rand -hex 48` |

If `SESSION_SECRET` is not set, the server will generate a random one at startup. This means **all user sessions will be invalidated every time the server restarts**. So for roll out, we need to set it explicitly, and make sure it is available.

2. Place the app behind a reverse proxy that terminates TLS (HTTPS). Session cookies are `httpOnly` but not marked `secure` by default, so with HTTPS in front this is handled at the proxy layer.

3. Use a secrets manager (e.g., Render environment variables, Docker secrets, systemd `EnvironmentFile`, etc.). Command-line arguments are visible in process listings.

   Example with a `.env` file (keep `.env` in `.gitignore`):
   ```bash
   SECRET_KEY=your-64-char-hex-string-here
   SESSION_SECRET=another-64-char-hex-string-here
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

# License

This project is provided under the Apache License. See `LICENSE` for details.
