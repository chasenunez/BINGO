#!/usr/bin/env node
/**
 * scripts/reveal-board.js
 *
 * One-off admin utility to inspect a specific user's Bingo board directly
 * from the encrypted data file. Used to verify a winner's submitted evidence
 * — including for anonymous winners, whose URLs and descriptions are hidden
 * on the public Winners page.
 *
 * Runs LOCALLY against the encrypted store on disk. It does NOT go through
 * the server, so you should run it on the host that has both:
 *   - a copy of data/store.json.enc, and
 *   - the SECRET_KEY that decrypts it.
 *
 * If the server is running, there is a small chance of catching a
 * mid-save file (the server writes atomically-ish, but not with a lock).
 * If decryption fails or JSON parsing fails, just re-run.
 *
 * Usage:
 *
 *   SECRET_KEY="..." node scripts/reveal-board.js <email>
 *
 * Env vars:
 *   SECRET_KEY        Required. Same key the running server uses.
 *   STORE_FILE_PATH   Optional. Defaults to ./data/store.json.enc
 *
 * Example output (verified against synthetic data locally):
 *
 *   User: Julia Swiatkowska <julia.swiatkowska@psi.ch>
 *   Display name: CHARMING HUMMINGBIRD (anonymous mode)
 *   Created:      2026-05-04T09:12:44.000Z
 *   Last sign-in: 2026-05-13T13:07:19.000Z
 *   Won at:       2026-05-13T13:41:02.000Z
 *
 *   Filled squares (14/25):
 *     [ 0] Publish your data online
 *          URL:  https://doi.org/10.5281/zenodo.1234567
 *          Desc: Deposited the SANS data set on Zenodo with CC-BY-4.0.
 *     [ 6] Create and customize a .gitignore file
 *          URL:  https://gitlab.psi.ch/js/sans-tools/-/commit/abc123
 *          Desc: Added a gitignore covering venv, data/, and IDE cruft.
 *     ...
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SECRET_KEY = process.env.SECRET_KEY;
// Resolve exactly the way server.js does: relative values are taken against
// the repo root, not the current working directory, so the same
// STORE_FILE_PATH value works for the server and for this script.
const STORE_PATH = process.env.STORE_FILE_PATH
  ? path.resolve(path.join(__dirname, '..'), process.env.STORE_FILE_PATH)
  : path.join(__dirname, '..', 'data', 'store.json.enc');
const email = process.argv[2];

if (!SECRET_KEY) {
  console.error('ERROR: SECRET_KEY env var must be set (same value the server uses).');
  process.exit(1);
}
if (!email) {
  console.error('Usage: SECRET_KEY="..." node scripts/reveal-board.js <email>');
  process.exit(2);
}
if (!fs.existsSync(STORE_PATH)) {
  console.error(`ERROR: encrypted store not found at ${STORE_PATH}`);
  console.error('       set STORE_FILE_PATH if it lives elsewhere.');
  process.exit(1);
}

// Decrypt using the same AES-256-GCM scheme as lib/store.js
let data;
try {
  const buf = fs.readFileSync(STORE_PATH);
  const key = crypto.createHash('sha256').update(SECRET_KEY).digest();
  const iv = buf.slice(0, 12);
  const tag = buf.slice(12, 28);
  const ciphertext = buf.slice(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  data = JSON.parse(plaintext);
} catch (err) {
  console.error('ERROR: could not decrypt store — wrong SECRET_KEY, or the file was mid-write.');
  console.error('       (' + (err && err.message) + ')');
  console.error('       Try again in a moment; if it still fails, the key is wrong.');
  process.exit(1);
}

const user = (data.users || []).find(u =>
  (u.email || '').toLowerCase() === email.toLowerCase()
);
if (!user) {
  console.error(`No user found with email "${email}".`);
  process.exit(1);
}

// Header
console.log('');
console.log('User:         ' + user.name + ' <' + user.email + '>');
console.log('Display name: ' + (user.displayName || user.name) +
  (user.isAnonymous ? ' (anonymous mode)' : ''));
console.log('Created:      ' + (user.createdAt || '-'));
console.log('Last sign-in: ' + (user.lastSignInAt || '-'));
console.log('Won at:       ' + (user.wonAt || '-'));
if (user.deletedAt) console.log('DELETED at:   ' + user.deletedAt);
if (user.privacyAck) {
  console.log('Privacy ack:  ' + (user.privacyAck.version || '?') +
    ' at ' + (user.privacyAck.acknowledgedAt || '?'));
}

// Board
const board = user.board || [];
const filled = board.filter(c => c && c.url);
console.log('');
console.log('Filled squares (' + filled.length + '/25):');
if (filled.length === 0) {
  console.log('  (none)');
} else {
  board.forEach((cell, i) => {
    if (!cell || !cell.url) return;
    const idx = String(i).padStart(2, ' ');
    console.log('  [' + idx + '] ' + (cell.phrase || '(no phrase)'));
    console.log('       URL:  ' + cell.url);
    console.log('       Desc: ' + (cell.description || '(no description)'));
  });
}

console.log('');
