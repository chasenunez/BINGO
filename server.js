/**
 * server.js
 * Minimal Express server for Bingo app.
 *
 * Stores all data in an encrypted JSON file via lib/store.js
 * Sessions are handled with a simple signed cookie (small session id).
 */

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

const Store = require('./lib/store');

const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.SECRET_KEY;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || null;

// Privacy Notice version recorded against every new account at signup.
// Bump when the substantive content of public/privacy.html changes.
// The "-en" suffix indicates the language the user saw on the registration
// form (the form itself is English-only; translations are reference material).
const PRIVACY_NOTICE_VERSION = '1.0-en';

// BASE_PATH: optional URL prefix the app is mounted under. Default is "" (root).
// Examples:
//   BASE_PATH=""        -> app served at https://example.com/
//   BASE_PATH="/bingo"  -> app served at https://example.com/bingo/
// Must start with "/" if set, and must NOT end with "/". The check below
// normalises common mistakes.
let BASE_PATH = process.env.BASE_PATH || '';
if (BASE_PATH && !BASE_PATH.startsWith('/')) BASE_PATH = '/' + BASE_PATH;
BASE_PATH = BASE_PATH.replace(/\/+$/, ''); // strip trailing slashes

// COOKIE_SECURE: when "true", session cookies are flagged Secure (only sent
// over HTTPS). Required for production behind an HTTPS reverse proxy. Leave
// unset for local HTTP development.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

// TRUST_PROXY: how many reverse-proxy hops to trust for X-Forwarded-* headers.
// Set to "1" if you have a single reverse proxy (nginx/Apache/Traefik) in
// front of the app, "2" if there's also a load balancer, etc. Defaults to
// "1" if BASE_PATH or COOKIE_SECURE is set (since both imply a proxy).
const TRUST_PROXY = process.env.TRUST_PROXY ||
  ((BASE_PATH || COOKIE_SECURE) ? '1' : '');

if (!ADMIN_TOKEN) {
  console.warn('WARNING: ADMIN_TOKEN not set. Admin API endpoints will return 503.');
  console.warn('Set ADMIN_TOKEN env var to enable user management via scripts/admin.js.');
} else if (ADMIN_TOKEN.length < 32) {
  console.warn('WARNING: ADMIN_TOKEN is shorter than 32 characters. Use a stronger token.');
}

// SESSION_SECRET: use env var if set, otherwise generate a random one (ephemeral)
let SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET) {
  SESSION_SECRET = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: SESSION_SECRET not set. A random secret has been generated.');
  console.warn('Sessions will NOT survive server restarts. Set SESSION_SECRET env var for persistence.');
}

if (!SECRET_KEY) {
  console.error('ERROR: You must set SECRET_KEY env var (used to encrypt data file).');
  console.error('Example (mac/linux): export SECRET_KEY="super-secret-32-chars"');
  process.exit(1);
}

// initialize store
const store = new Store({
  filePath: path.join(__dirname, 'data', 'store.json.enc'),
  secretKey: SECRET_KEY
});

const app = express();

// If we're behind a reverse proxy, trust it for protocol/IP info so that
// req.protocol, req.ip, etc. reflect the real client. This must happen
// BEFORE any middleware that depends on those values.
if (TRUST_PROXY) {
  // Numeric strings are coerced to numbers (hop count). Non-numeric strings
  // are passed through (e.g. "loopback", "uniquelocal").
  const tp = /^\d+$/.test(TRUST_PROXY) ? parseInt(TRUST_PROXY, 10) : TRUST_PROXY;
  app.set('trust proxy', tp);
}

// HSTS: when cookies are flagged Secure (production behind HTTPS), tell the
// browser to use HTTPS for the entire host for the next year. This prevents
// downgrade attacks on return visits. We gate this on COOKIE_SECURE because
// HSTS over plain HTTP is meaningless and would only confuse local dev.
if (COOKIE_SECURE) {
  app.use((req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}

app.use(bodyParser.json());
app.use(cookieParser(SESSION_SECRET));

// Cookie options used for the session cookie. `path` scopes the cookie to
// the app's mount point so it doesn't leak across sibling apps on the same
// domain. `secure` keeps the cookie out of HTTP requests in production.
const SESSION_COOKIE_OPTS = {
  signed: true,
  httpOnly: true,
  sameSite: 'lax',
  path: BASE_PATH || '/',
  secure: COOKIE_SECURE
};

// All app routes (static files + API) live on this router, which is
// mounted under BASE_PATH so the same code works whether the app is at
// "/" or "/bingo/".
const router = express.Router();

router.use(express.static(path.join(__dirname, 'public')));

// Constant-time bearer-token check for the admin API. Returns true only if
// ADMIN_TOKEN is set AND the provided token matches exactly.
function isValidAdminToken(headerValue) {
  if (!ADMIN_TOKEN) return false;
  if (typeof headerValue !== 'string') return false;
  const m = headerValue.match(/^Bearer\s+(.+)$/);
  if (!m) return false;
  const provided = Buffer.from(m[1], 'utf8');
  const expected = Buffer.from(ADMIN_TOKEN, 'utf8');
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ error: 'Admin API is not configured on this server' });
  }
  if (!isValidAdminToken(req.headers.authorization)) {
    return res.status(403).json({ error: 'Invalid or missing admin token' });
  }
  next();
}

// Middlewares
function requireAuth(req, res, next) {
  const sessionId = req.signedCookies['sid'];
  if (!sessionId) return res.status(401).json({ error: 'Not signed in' });
  const user = store.getUserBySession(sessionId);
  if (!user) return res.status(401).json({ error: 'Session invalid' });
  if (user.deletedAt) return res.status(401).json({ error: 'Account no longer exists' });
  req.user = user;
  req.sessionId = sessionId;
  next();
}

// API endpoints

// Sign up
router.post('/api/signup', async (req, res) => {
  const { name, email, password, useAnonymous, privacyAck } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  // Privacy Notice acknowledgement is required (server-side enforcement,
  // not just client-side). The browser checkbox has `required`, but a request
  // crafted directly against the API must also be rejected here. We record
  // the version, timestamp, and boolean for audit purposes (see
  // PRIVACY_NOTICE_VERSION above).
  if (privacyAck !== true) {
    return res.status(400).json({ error: 'You must acknowledge the Privacy Notice to register' });
  }

  const exists = store.getUserByEmail(email);
  if (exists) return res.status(400).json({ error: 'Email already registered' });

  const hashed = await bcrypt.hash(password, 10);
  // default phrases
  const defaultPhrases = store.defaultPhrases();
  const board = defaultPhrases.map((p) => ({ phrase: p, url: null, description: null }));

  // displayName is used everywhere public; name is the real name (admin-only and "signed in as")
  const isAnonymous = !!useAnonymous;
  const displayName = isAnonymous ? store.generateAnonymousName() : name;

  const now = new Date().toISOString();
  const user = {
    id: uuidv4(),
    name,
    email,
    passwordHash: hashed,
    board,   // 25 entries
    createdAt: now,
    displayName,
    isAnonymous,
    wonAt: null,
    deletedAt: null,
    lastSignInAt: now,
    privacyAck: {
      version: PRIVACY_NOTICE_VERSION,
      acknowledgedAt: now,
      value: true
    }
  };

  store.addUser(user);
  store.save();

  // create a session id and set cookie
  const sid = store.createSessionForUser(user.id);
  res.cookie('sid', sid, SESSION_COOKIE_OPTS);
  res.json({ ok: true });
});

// Sign in
router.post('/api/signin', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = store.getUserByEmail(email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  if (user.deletedAt) return res.status(400).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });

  const sid = store.createSessionForUser(user.id);
  // Track last sign-in for inactivity-based retention (see scripts/retention.js).
  store.setUserLastSignIn(user.id, new Date().toISOString());
  store.save();
  res.cookie('sid', sid, SESSION_COOKIE_OPTS);
  res.json({ ok: true });
});

// Sign out
router.post('/api/signout', (req, res) => {
  const sid = req.signedCookies['sid'];
  if (sid) store.destroySession(sid);
  // clearCookie must use the same path/secure flags as the cookie was set
  // with, otherwise the browser keeps the original cookie.
  res.clearCookie('sid', { path: SESSION_COOKIE_OPTS.path, secure: SESSION_COOKIE_OPTS.secure });
  store.save();
  res.json({ ok: true });
});

// Get current user's board
router.get('/api/board', requireAuth, (req, res) => {
  // return 5x5 board as array of 25 {phrase, url, description}
  res.json({ board: req.user.board, name: req.user.name, email: req.user.email });
});

// Update a single cell (index 0..24)
router.post('/api/board/update', requireAuth, (req, res) => {
  const { index, url, description } = req.body || {};
  if (typeof index !== 'number' || index < 0 || index >= 25) return res.status(400).json({ error: 'Invalid index' });

  // allow url = null to clear
  if (url !== null && url !== undefined) {
    // basic validation (server-side): must be http(s)
    try {
      const u = new URL(url);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Invalid protocol');
    } catch (err) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // validate description: required when setting a URL
    if (!description || typeof description !== 'string') {
      return res.status(400).json({ error: 'A description is required' });
    }
    const wordCount = description.trim().split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 3) {
      return res.status(400).json({ error: 'Description must be at least 3 words' });
    }
    if (wordCount > 1000) {
      return res.status(400).json({ error: 'Description must be at most 1000 words' });
    }
  }

  if (url) {
    req.user.board[index].url = url;
    req.user.board[index].description = description ? description.trim() : null;
  } else {
    req.user.board[index].url = null;
    req.user.board[index].description = null;
  }

  store.updateUser(req.user);
  store.save();
  res.json({ ok: true, board: req.user.board });
});

// Submit bingo (user claims a bingo). Server validates and stores a winners entry.
router.post('/api/bingo', requireAuth, (req, res) => {
  // Use the server's copy of the board (not the client snapshot) to prevent cheating
  const board = req.user.board;
  const bools = board.map(c => !!c.url);

  // Validate that there is actually a bingo
  if (!hasBingo(bools)) {
    return res.status(400).json({ error: 'No bingo detected on your board' });
  }

  const now = new Date().toISOString();
  const winner = {
    id: uuidv4(),
    userId: req.user.id,
    displayName: req.user.displayName || req.user.name,
    snapshot: board,
    createdAt: now
  };
  store.addWinner(winner);
  store.setUserWonAt(req.user.id, now);
  store.save();
  res.json({ ok: true });
});

// Server-side bingo checking: board is 25 booleans
function hasBingo(bools) {
  if (!Array.isArray(bools) || bools.length !== 25) return false;
  // rows
  for (let r = 0; r < 5; r++) {
    let ok = true;
    for (let c = 0; c < 5; c++) if (!bools[r * 5 + c]) { ok = false; break; }
    if (ok) return true;
  }
  // columns
  for (let c = 0; c < 5; c++) {
    let ok = true;
    for (let r = 0; r < 5; r++) if (!bools[r * 5 + c]) { ok = false; break; }
    if (ok) return true;
  }
  // diagonal top-left to bottom-right: indices 0, 6, 12, 18, 24
  let ok = true;
  for (let i = 0; i < 5; i++) if (!bools[i * 6]) { ok = false; break; }
  if (ok) return true;
  // diagonal top-right to bottom-left: indices 4, 8, 12, 16, 20
  ok = true;
  for (let i = 1; i <= 5; i++) if (!bools[i * 4]) { ok = false; break; }
  if (ok) return true;
  return false;
}

// Get winners
router.get('/api/winners', (req, res) => {
  const winners = store.getWinners();
  res.json({ winners });
});

// ----- Admin API -----
// All admin endpoints require a Bearer token matching ADMIN_TOKEN env var.
// The server itself is the only writer to the encrypted store, so there are
// no race conditions with the admin script.

// List every user (active and soft-deleted)
router.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: store.getAllUsersForAdmin() });
});

// Soft-delete a user by email
router.post('/api/admin/users/delete', requireAdmin, (req, res) => {
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Missing email' });
  }
  const user = store.getUserByEmail(email);
  if (!user) return res.status(404).json({ error: 'User not found' });
  if (user.deletedAt) {
    return res.status(409).json({ error: `User already deleted at ${user.deletedAt}` });
  }
  const ok = store.markUserDeleted(user.id);
  if (!ok) return res.status(500).json({ error: 'Deletion failed' });
  store.save();
  res.json({ ok: true, deletedEmail: email, deletedName: user.name });
});

// Mount the entire app under BASE_PATH (or "/" if unset).
app.use(BASE_PATH || '/', router);

// If BASE_PATH is set, also redirect bare "/" hits to the mount point so a
// user who lands on the root sees the app rather than a 404.
if (BASE_PATH) {
  app.get('/', (req, res) => res.redirect(BASE_PATH + '/'));
}

// Start server after store loads (it will create file if not exist)
store.init().then(() => {
  app.listen(PORT, () => {
    const display = `http://localhost:${PORT}${BASE_PATH || ''}/`;
    console.log(`Bingo app listening at ${display}`);
    if (BASE_PATH) console.log(`(Mounted under BASE_PATH="${BASE_PATH}")`);
    if (COOKIE_SECURE) console.log('(Session cookie flagged Secure — only sent over HTTPS)');
  });
}).catch((err) => {
  console.error('Failed to initialize store:', err);
  process.exit(1);
});
