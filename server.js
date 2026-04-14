/**
 * server.js
 * Minimal Express server for Bingo app.
 *
 * Stores all data in an encrypted JSON file via lib/store.js
 * Sessions are handled with a simple signed cookie (small session id).
 *
 * WARNING: For production you'd want a proper DB and stronger session management.
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
app.use(bodyParser.json());
app.use(cookieParser(SESSION_SECRET));
app.use(express.static(path.join(__dirname, 'public')));

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
app.post('/api/signup', async (req, res) => {
  const { name, email, password, useAnonymous } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Missing fields' });

  const exists = store.getUserByEmail(email);
  if (exists) return res.status(400).json({ error: 'Email already registered' });

  const hashed = await bcrypt.hash(password, 10);
  // default phrases
  const defaultPhrases = store.defaultPhrases();
  const board = defaultPhrases.map((p) => ({ phrase: p, url: null, description: null }));

  // displayName is used everywhere public; name is the real name (admin-only and "signed in as")
  const isAnonymous = !!useAnonymous;
  const displayName = isAnonymous ? store.generateAnonymousName() : name;

  const user = {
    id: uuidv4(),
    name,
    email,
    passwordHash: hashed,
    board,   // 25 entries
    createdAt: new Date().toISOString(),
    displayName,
    isAnonymous,
    wonAt: null,
    deletedAt: null
  };

  store.addUser(user);
  store.save();

  // create a session id and set cookie
  const sid = store.createSessionForUser(user.id);
  res.cookie('sid', sid, { signed: true, httpOnly: true });
  res.json({ ok: true });
});

// Sign in
app.post('/api/signin', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Missing fields' });

  const user = store.getUserByEmail(email);
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  if (user.deletedAt) return res.status(400).json({ error: 'Invalid credentials' });

  const match = await bcrypt.compare(password, user.passwordHash);
  if (!match) return res.status(400).json({ error: 'Invalid credentials' });

  const sid = store.createSessionForUser(user.id);
  store.save();
  res.cookie('sid', sid, { signed: true, httpOnly: true });
  res.json({ ok: true });
});

// Sign out
app.post('/api/signout', (req, res) => {
  const sid = req.signedCookies['sid'];
  if (sid) store.destroySession(sid);
  res.clearCookie('sid');
  store.save();
  res.json({ ok: true });
});

// Get current user's board
app.get('/api/board', requireAuth, (req, res) => {
  // return 5x5 board as array of 25 {phrase, url, description}
  res.json({ board: req.user.board, name: req.user.name, email: req.user.email });
});

// Update a single cell (index 0..24)
app.post('/api/board/update', requireAuth, (req, res) => {
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
app.post('/api/bingo', requireAuth, (req, res) => {
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
app.get('/api/winners', (req, res) => {
  const winners = store.getWinners();
  res.json({ winners });
});

// ----- Admin API -----
// All admin endpoints require a Bearer token matching ADMIN_TOKEN env var.
// The server itself is the only writer to the encrypted store, so there are
// no race conditions with the admin script.

// List every user (active and soft-deleted)
app.get('/api/admin/users', requireAdmin, (req, res) => {
  res.json({ users: store.getAllUsersForAdmin() });
});

// Soft-delete a user by email
app.post('/api/admin/users/delete', requireAdmin, (req, res) => {
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

// Serve app (static files handled by express.static)

// Start server after store loads (it will create file if not exist)
store.init().then(() => {
  app.listen(PORT, () => {
    console.log(`Bingo app listening at http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to initialize store:', err);
  process.exit(1);
});
