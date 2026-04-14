document.addEventListener('DOMContentLoaded', async () => {
  const el = document.getElementById('winnersList');
  try {
    const data = await api('/api/winners');
    const winners = data.winners || [];
    if (winners.length === 0) {
      el.textContent = 'No winners yet.';
      return;
    }

    winners.forEach(w => {
      const row = document.createElement('div');
      row.className = 'winner';

      const left = document.createElement('div');
      left.style.flex = '1';
      // Use displayName (anonymous or real); fall back to name for legacy entries
      const shown = w.displayName || w.name || 'Anonymous';
      left.innerHTML = `<strong>${escapeHtml(shown)}</strong><div class="muted">on ${new Date(w.createdAt).toLocaleString()}</div>`;

      const small = document.createElement('div');
      small.className = 'small-board';

      // Normalize snapshot to 25 cells
      const cells = (w.snapshot || []).slice(0, 25);
      while (cells.length < 25) cells.push({ phrase: '', url: null, description: null });

      cells.forEach(cell => {
        const sc = document.createElement('div');
        sc.className = 'small-cell';

        const phrase = (cell && cell.phrase) ? cell.phrase : '';
        const description = (cell && cell.description) ? cell.description : '';

        // accessible hidden text for screen readers
        const hidden = document.createElement('span');
        hidden.className = 'visually-hidden';
        hidden.textContent = phrase;

        if (cell && cell.url) {
          // linked: green, clickable
          sc.classList.add('linked');
          const a = document.createElement('a');
          a.href = cell.url;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
          // Show description as tooltip on hover; fall back to phrase
          a.title = description || phrase;
          a.setAttribute('aria-label', phrase || 'Linked bingo box');
          a.appendChild(hidden);
          sc.appendChild(a);
        } else {
          // unlinked: neutral, not clickable, show phrase tooltip on hover
          sc.classList.add('unlinked');
          sc.title = phrase;
          sc.setAttribute('aria-label', phrase || 'Unlinked bingo box');
          sc.appendChild(hidden);
        }

        small.appendChild(sc);
      });

      row.appendChild(left);
      row.appendChild(small);
      el.appendChild(row);
    });
  } catch (err) {
    el.textContent = 'Failed to load winners: ' + (err.message || '');
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c)=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
