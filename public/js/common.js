// common.js - small utility functions for client pages
//
// NOTE on URL paths: All URLs in this app (HTML href/src attributes, fetch
// calls, window.location assignments) MUST be relative — i.e. NO leading "/".
// This makes the app portable across mount points: it can be hosted at
// https://example.com/ or https://example.com/bingo/ without code changes,
// because the browser resolves relative URLs against the current page URL.
// If you add a leading "/" to a fetch or link, the app breaks under subpath
// hosting. See README "Hosting under a subpath" for details.

async function api(path, opts = {}) {
  const res = await fetch(path, Object.assign({
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin'
  }, opts));
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data && data.error) throw new Error(data.error);
  return data;
}

function showMsg(el, text, isError = false) {
  el.textContent = text;
  el.classList.toggle('error', isError);
}

function validateUrl(url) {
  try {
    const u = new URL(url);
    return ['http:', 'https:'].includes(u.protocol);
  } catch (e) {
    return false;
  }
}

// Auto-inject a small footer with the Privacy Notice link on every page that
// loads common.js. Pages that don't load common.js (e.g. the standalone
// privacy.html translations) are responsible for their own footer. To
// suppress the auto-footer on a specific page, add `data-no-footer` to the
// <body> tag.
document.addEventListener('DOMContentLoaded', () => {
  if (document.body.hasAttribute('data-no-footer')) return;
  if (document.querySelector('footer.app-footer')) return;
  const f = document.createElement('footer');
  f.className = 'app-footer';
  f.innerHTML =
    '<small>&copy; Lib4RI &middot; ' +
    '<a href="privacy.html" target="_blank" rel="noopener">Privacy Notice</a></small>';
  document.body.appendChild(f);
});