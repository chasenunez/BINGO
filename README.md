
![RDMBingoHeader](public/assets/RDMBingo.png)


This is a small, lightweight web application originally created as an outreach and engagement tool for researchers. It helps teams and trainees demonstrate and celebrate good data practices (e.g., "Write a README", "Publish your data in a repository") in an interactive bingo format. The app is intentionally general-purpose and can also be used for workshops, onboarding, community events, or any setting where people want to mark and link evidence of completed tasks.

![RDMBingoHeader](public/assets/overview.png)

This repository contains the full app (Node + Express backend + static frontend). All user data (accounts, boards, winners) are stored in a single AES-GCM–encrypted JSON file on the host. Passwords are hashed with `bcrypt`. This design keeps the code small, auditable, and appropriate for small-scale deployments such as workshops, departmental demos, or research-group use.

* Each completed bingo entry can be linked to live evidence (a DOI, repository record, README file, pull request, or project page).
* Winners are recorded (one winner entry per account) and presented with a thumbnail of their board so evidence is discoverable.
* Minimal infrastructure and clear encryption: the data file is encrypted at rest using a server-side `SECRET_KEY`. This makes the app safe enough for outreach use without a full database stack.
* Easy to adapt: change phrases, board size, UI styling, or swap the file store for a database.

# Contents

* `server.js` — Express server and API endpoints
* `lib/store.js` — small encrypted file-backed store (AES-256-GCM)
* `public/` — static frontend (HTML/CSS/JS)
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

2. Generate a strong `SECRET_KEY` (must be at least 32 characters). Recommended examples:

   * Node:

     ```bash
     node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
     ```
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

# License

This project is provided under the Apache License. See `LICENSE` (or add one) for details.
