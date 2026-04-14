#!/usr/bin/env node
/**
 * scripts/admin.js
 *
 * Administrative CLI for the RDM Bingo app.
 *
 * Talks to a *running* Bingo server over HTTP using a Bearer token. The server
 * is the only writer to the encrypted store, so there are no race conditions
 * and no need to take the app offline.
 *
 * Usage:
 *
 *   ADMIN_TOKEN="..." node scripts/admin.js list
 *   ADMIN_TOKEN="..." node scripts/admin.js list --json
 *   ADMIN_TOKEN="..." node scripts/admin.js delete <email>
 *   node scripts/admin.js help
 *
 * Env vars:
 *   ADMIN_TOKEN   Required. Must match the ADMIN_TOKEN set on the server.
 *   SERVER_URL    Optional. Defaults to http://localhost:3000
 *
 * Notes:
 *   - The server must be running and reachable from this machine.
 *   - For remote/production deployments, set SERVER_URL to your HTTPS URL
 *     (e.g. SERVER_URL="https://bingo.example.org") and make admin requests
 *     from a trusted machine.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');

function printHelp() {
  console.log(`
RDM Bingo admin CLI

Commands:
  list                  Show all users (table format)
  list --json           Show all users (JSON output)
  delete <email>        Soft-delete the user with the given email
  help                  Show this message

Env:
  ADMIN_TOKEN           Required. Must match the server's ADMIN_TOKEN.
  SERVER_URL            Optional. Defaults to http://localhost:3000
`);
}

function pad(s, n) {
  s = String(s == null ? '' : s);
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function formatTable(users) {
  if (users.length === 0) {
    console.log('(no users)');
    return;
  }
  const header = [
    pad('Email', 32),
    pad('Real Name', 22),
    pad('Display Name', 22),
    pad('Anon', 5),
    pad('Won At', 22),
    pad('Deleted At', 22)
  ].join('  ');
  console.log(header);
  console.log('-'.repeat(header.length));
  for (const u of users) {
    console.log([
      pad(u.email, 32),
      pad(u.name, 22),
      pad(u.displayName, 22),
      pad(u.isAnonymous ? 'yes' : 'no', 5),
      pad(u.wonAt || '-', 22),
      pad(u.deletedAt || '-', 22)
    ].join('  '));
  }
  console.log(`\nTotal users: ${users.length}`);
  console.log(`Bingo winners (active): ${users.filter(u => u.wonAt && !u.deletedAt).length}`);
  console.log(`Soft-deleted: ${users.filter(u => u.deletedAt).length}`);
}

// Make an authenticated HTTP request to the server. Returns parsed JSON.
function request(method, path, body) {
  return new Promise((resolve, reject) => {
    let url;
    try {
      url = new URL(SERVER_URL + path);
    } catch (e) {
      return reject(new Error(`Invalid SERVER_URL: ${SERVER_URL}`));
    }
    const lib = url.protocol === 'https:' ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Authorization': `Bearer ${ADMIN_TOKEN}`,
        'Accept': 'application/json'
      }
    };
    if (data) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(data);
    }
    const req = lib.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = chunks ? JSON.parse(chunks) : {}; } catch (_) { parsed = { raw: chunks }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', (err) => {
      if (err.code === 'ECONNREFUSED') {
        reject(new Error(`Cannot reach server at ${SERVER_URL}. Is it running?`));
      } else {
        reject(err);
      }
    });
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  if (!ADMIN_TOKEN) {
    console.error('ERROR: ADMIN_TOKEN env var must be set (same value as the server).');
    console.error('See README "Administration" section for setup instructions.');
    process.exit(1);
  }

  if (cmd === 'list') {
    const { status, body } = await request('GET', '/api/admin/users');
    if (status === 503) {
      console.error('ERROR: The server has no ADMIN_TOKEN configured. Set it and restart.');
      process.exit(1);
    }
    if (status === 403) {
      console.error('ERROR: Token rejected. Make sure ADMIN_TOKEN matches the server\'s.');
      process.exit(1);
    }
    if (status !== 200) {
      console.error(`ERROR: server returned HTTP ${status}:`, body);
      process.exit(1);
    }
    if (args.includes('--json')) {
      console.log(JSON.stringify(body.users, null, 2));
    } else {
      formatTable(body.users);
    }
    return;
  }

  if (cmd === 'delete') {
    const email = args[1];
    if (!email) {
      console.error('ERROR: please provide an email. Usage: delete <email>');
      process.exit(1);
    }
    const { status, body } = await request('POST', '/api/admin/users/delete', { email });
    if (status === 503) {
      console.error('ERROR: The server has no ADMIN_TOKEN configured. Set it and restart.');
      process.exit(1);
    }
    if (status === 403) {
      console.error('ERROR: Token rejected. Make sure ADMIN_TOKEN matches the server\'s.');
      process.exit(1);
    }
    if (status === 404) {
      console.error(`ERROR: no user found with email "${email}"`);
      process.exit(1);
    }
    if (status === 409) {
      console.error(`ERROR: ${body.error}`);
      process.exit(1);
    }
    if (status !== 200) {
      console.error(`ERROR: server returned HTTP ${status}:`, body);
      process.exit(1);
    }
    console.log(`Deleted user "${body.deletedEmail}" (${body.deletedName}). Their winner entry has been removed.`);
    return;
  }

  console.error(`Unknown command: ${cmd}`);
  printHelp();
  process.exit(1);
}

main().catch((err) => {
  console.error('FATAL:', err.message || err);
  process.exit(1);
});
