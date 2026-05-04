
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

# Hosting under a subpath (`BASE_PATH`)

The app can be served either at the root of a domain (`https://bingo.example.org/`) or under a subpath of a larger site (`https://www.example.org/bingo/`). All client-side URLs in the HTML and JS are written as **relative paths**, so the browser resolves them against whatever URL the page was loaded from — no rebuild needed when the mount point changes.

For server-side support, set the `BASE_PATH` env var:

```bash
# Root deploy (default)
# BASE_PATH unset

# Subpath deploy
export BASE_PATH="/bingo"
```

When `BASE_PATH` is set, the server:

- Mounts every static file and API route under that prefix (so the app responds at `https://example.org/bingo/api/winners`, not `/api/winners`).
- Scopes the session cookie's `Path` attribute to `BASE_PATH`, so the cookie isn't sent to sibling apps on the same domain.
- Adds a redirect from `/` to `BASE_PATH/` so a user who lands on the bare root sees the app.

## Recommended production env vars

| Variable | Example | Purpose |
|---|---|---|
| `BASE_PATH` | `/bingo` | URL prefix the app is mounted under. Leave unset for root. |
| `COOKIE_SECURE` | `true` | Flags the session cookie `Secure` so it's only sent over HTTPS. **Set this in production.** Leave unset for local HTTP development. |
| `TRUST_PROXY` | `1` | Number of reverse-proxy hops to trust for `X-Forwarded-*` headers. Auto-set to `1` if `BASE_PATH` or `COOKIE_SECURE` is set. |

## Reverse-proxy configuration

The reverse proxy must forward `X-Forwarded-Proto` so `req.protocol` reports `https` correctly. The two common patterns:

**Pattern A — proxy keeps the prefix, app expects it (recommended).** Set `BASE_PATH=/bingo` on the app. nginx config:

```nginx
location /bingo/ {
    proxy_pass http://localhost:3000;          # NO trailing slash
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

**Pattern B — proxy strips the prefix, app sees `/`.** Leave `BASE_PATH` unset. nginx config:

```nginx
location /bingo/ {
    proxy_pass http://localhost:3000/;         # WITH trailing slash — strips /bingo
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
}
```

Pattern A is preferred because the cookie ends up scoped to `/bingo` (not the whole domain), and the app's logged URLs match what the user sees.

## Note for contributors

All URLs in HTML/JS must remain **relative** (no leading `/`). A leading slash would break subpath hosting. See the comment at the top of `public/js/common.js`.

# Privacy & data protection

The app is published with a **Privacy Notice** at `public/privacy.html`, with translations at `public/privacy.de.html` and `public/privacy.fr.html`. Every page links to it via the auto-injected footer in `public/js/common.js`, and the registration form (`public/new.html`) links to it from a required acknowledgement checkbox.

## What the code enforces

- **Acknowledgement checkbox.** The signup endpoint (`POST /api/signup`) rejects requests where `privacyAck !== true`, regardless of what the browser sent. The version, timestamp, and boolean are written to the user record (`privacyAck.version`, `privacyAck.acknowledgedAt`, `privacyAck.value`) for audit purposes.
- **Privacy Notice version.** Hard-coded as `PRIVACY_NOTICE_VERSION` near the top of `server.js`. Bump this string whenever the substantive content of `privacy.html` changes (e.g. `1.0-en` → `1.1-en`).
- **HSTS header.** Set automatically when `COOKIE_SECURE=true` (i.e. behind an HTTPS reverse proxy). Disabled in HTTP dev so it doesn't pollute your browser's HSTS cache. Header value: `max-age=31536000; includeSubDomains`.
- **Last-sign-in tracking.** The signup and signin endpoints record `lastSignInAt`, used by the retention job below to identify inactive accounts.

## Retention job

`scripts/retention.js` enforces the retention policy stated in §5 of the Privacy Notice. It talks to the running server via the same admin HTTP API as `scripts/admin.js`, so there are no race conditions and no downtime is required.

Three deletion criteria, in order of precedence:

1. **Winners past the prize-delivery cut-off** (180 days after `CAMPAIGN_END_DATE`).
2. **Non-winners past the post-campaign cut-off** (90 days after `CAMPAIGN_END_DATE`).
3. **Inactive accounts** (no sign-in for 365 days, applied year-round).

Each threshold is configurable via env var. Defaults match the Privacy Notice:

| Env var | Default | Meaning |
|---|---|---|
| `CAMPAIGN_END_DATE` | `2026-07-01` | The date on which the campaign closes. |
| `POST_CAMPAIGN_DAYS` | `90` | Grace period after `CAMPAIGN_END_DATE` for non-winners. |
| `PRIZE_GRACE_DAYS` | `180` | Maximum prize-delivery window for winners. |
| `INACTIVE_DAYS` | `365` | Sign-in inactivity threshold (always-on). |

Usage:

```bash
# Dry-run (report what would be deleted, no writes)
ADMIN_TOKEN="..." node scripts/retention.js

# Actually apply
ADMIN_TOKEN="..." node scripts/retention.js --apply
```

Recommended cron entry on the production host (daily at 02:30):

```cron
30 2 * * *  ADMIN_TOKEN=... /usr/bin/node /opt/bingo/scripts/retention.js --apply >> /var/log/bingo/retention.log 2>&1
```

The script logs each deletion with email + user-id and a reason. Per the Privacy Notice, the data itself is gone after deletion — only the deletion record remains.

## When the Privacy Notice changes

When you change the substantive content of `privacy.html` (or its translations):

1. Update the "Last updated" date and version number at the top of each language file.
2. Bump `PRIVACY_NOTICE_VERSION` in `server.js` so new sign-ups record the new version.
3. Append an entry to your privacy-changelog page (planned, not yet in repo).
4. If existing users are still active, email them a one-line note pointing at the new version before it takes effect for them.

# License

This project is provided under the Apache License. See `LICENSE` for details.
