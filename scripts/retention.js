#!/usr/bin/env node
/**
 * scripts/retention.js
 *
 * Automated data retention job for RDM Bingo. Mirrors the policy stated in
 * the Privacy Notice (public/privacy.html, section 5):
 *
 *   - Inactive accounts: deleted after 12 months without sign-in (or 12
 *     months since registration, if the user has never signed in).
 *
 *   - Post-campaign cleanup: 90 days after CAMPAIGN_END_DATE, all
 *     non-winner accounts and submitted content are deleted.
 *
 *   - Prize-delivery carve-out: winner accounts are kept for up to 180 days
 *     (6 months) after CAMPAIGN_END_DATE, then deleted regardless of prize
 *     status. The Privacy Notice promises an *earlier* deletion if the
 *     prize has actually been delivered — that is a manual operation; this
 *     script enforces only the upper bound.
 *
 * Talks to the running server via the same admin HTTP API that
 * scripts/admin.js uses, so no race conditions with the live process.
 *
 * Usage:
 *
 *   ADMIN_TOKEN="..." node scripts/retention.js              # report only
 *   ADMIN_TOKEN="..." node scripts/retention.js --apply      # actually delete
 *
 * Env vars:
 *   ADMIN_TOKEN          Required. Must match the server's ADMIN_TOKEN.
 *   SERVER_URL           Optional. Defaults to http://localhost:3000
 *   CAMPAIGN_END_DATE    Optional. ISO date (YYYY-MM-DD). Defaults to 2026-07-01.
 *   INACTIVE_DAYS        Optional. Defaults to 365.
 *   POST_CAMPAIGN_DAYS   Optional. Defaults to 90.
 *   PRIZE_GRACE_DAYS     Optional. Defaults to 180.
 *
 * Cron example (daily at 02:30):
 *
 *   30 2 * * *  ADMIN_TOKEN=... /usr/bin/node /opt/bingo/scripts/retention.js --apply >> /var/log/bingo/retention.log 2>&1
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const CAMPAIGN_END_DATE = process.env.CAMPAIGN_END_DATE || '2026-07-01';
const INACTIVE_DAYS = parseInt(process.env.INACTIVE_DAYS || '365', 10);
const POST_CAMPAIGN_DAYS = parseInt(process.env.POST_CAMPAIGN_DAYS || '90', 10);
const PRIZE_GRACE_DAYS = parseInt(process.env.PRIZE_GRACE_DAYS || '180', 10);

const APPLY = process.argv.slice(2).includes('--apply');

const DAY_MS = 86_400_000;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(SERVER_URL + path); }
    catch (e) { return reject(new Error(`Invalid SERVER_URL: ${SERVER_URL}`)); }
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
      } else { reject(err); }
    });
    if (data) req.write(data);
    req.end();
  });
}

// Returns either null (keep this user) or a string explaining why they
// should be deleted.
function shouldDelete(user, now) {
  if (user.deletedAt) return null; // already gone

  const campaignEnd = new Date(CAMPAIGN_END_DATE + 'T00:00:00Z');
  const postCampaignCutoff = new Date(campaignEnd.getTime() + POST_CAMPAIGN_DAYS * DAY_MS);
  const prizeCutoff       = new Date(campaignEnd.getTime() + PRIZE_GRACE_DAYS   * DAY_MS);
  const inactiveCutoff    = new Date(now.getTime() - INACTIVE_DAYS * DAY_MS);

  const isWinner = !!user.wonAt;
  const lastActive = new Date(user.lastSignInAt || user.createdAt);

  // 1. Hard upper bound: prize-delivery carve-out has expired.
  if (isWinner && now >= prizeCutoff) {
    return `winner kept for prize delivery until ${prizeCutoff.toISOString().slice(0,10)}, now expired`;
  }

  // 2. Post-campaign cleanup of non-winners.
  if (!isWinner && now >= postCampaignCutoff) {
    return `non-winner past post-campaign cutoff ${postCampaignCutoff.toISOString().slice(0,10)}`;
  }

  // 3. Inactive-account cleanup (applies during and after the campaign).
  if (lastActive < inactiveCutoff) {
    const days = Math.floor((now - lastActive) / DAY_MS);
    return `inactive for ${days} days (last active ${lastActive.toISOString().slice(0,10)})`;
  }

  return null;
}

async function main() {
  if (!ADMIN_TOKEN) {
    console.error('ERROR: ADMIN_TOKEN env var must be set.');
    process.exit(1);
  }

  const now = new Date();
  console.log(`[retention] now=${now.toISOString()} apply=${APPLY}`);
  console.log(`[retention] campaign_end=${CAMPAIGN_END_DATE} inactive_days=${INACTIVE_DAYS} post_campaign_days=${POST_CAMPAIGN_DAYS} prize_grace_days=${PRIZE_GRACE_DAYS}`);

  const { status, body } = await request('GET', '/api/admin/users');
  if (status === 503) { console.error('ERROR: server has no ADMIN_TOKEN configured'); process.exit(1); }
  if (status === 403) { console.error('ERROR: token rejected'); process.exit(1); }
  if (status !== 200) { console.error(`ERROR: HTTP ${status}`, body); process.exit(1); }

  const users = body.users || [];
  let toDelete = [];
  for (const u of users) {
    const reason = shouldDelete(u, now);
    if (reason) toDelete.push({ user: u, reason });
  }

  if (toDelete.length === 0) {
    console.log('[retention] no accounts match deletion criteria');
    return;
  }

  console.log(`[retention] ${toDelete.length} account(s) match deletion criteria:`);
  for (const { user, reason } of toDelete) {
    console.log(`  - ${user.email}  (id=${user.id})  reason: ${reason}`);
  }

  if (!APPLY) {
    console.log('[retention] dry run only. Re-run with --apply to actually delete.');
    return;
  }

  let ok = 0, fail = 0;
  for (const { user } of toDelete) {
    const r = await request('POST', '/api/admin/users/delete', { email: user.email });
    if (r.status === 200) {
      console.log(`[retention] deleted ${user.email}`);
      ok++;
    } else {
      console.error(`[retention] failed to delete ${user.email}: HTTP ${r.status}`, r.body);
      fail++;
    }
  }
  console.log(`[retention] done. deleted=${ok} failed=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => { console.error('FATAL:', err.message || err); process.exit(1); });
