// board.js
// Responsible for rendering user's board and UI interactions

let state = {
  board: [],    // array of 25 {phrase, url, description}
  name: ''
};

document.addEventListener('DOMContentLoaded', init);

function init() {
  fetchBoard();
  setupModals();
  document.getElementById('signoutBtn').addEventListener('click', signout);
}

async function fetchBoard() {
  try {
    const data = await api('/api/board');
    state.board = data.board;
    state.name = data.name;
    document.getElementById('welcome').textContent = `Signed in as ${state.name}`;
    renderBoard();
  } catch (err) {
    // redirect to sign in if not authenticated
    window.location = '/signin.html';
  }
}

function renderBoard() {
  const boardEl = document.getElementById('board');
  boardEl.innerHTML = '';
  state.board.forEach((cell, idx) => {
    const div = document.createElement('div');
    div.className = 'cell' + (cell.url ? ' linked' : '');
    div.tabIndex = 0;
    if (cell.url) {
      const a = document.createElement('a');
      a.href = cell.url;
      a.target = '_blank';
      a.textContent = cell.phrase;
      div.appendChild(a);
      // Show description as tooltip on own board
      if (cell.description) {
        div.title = cell.description;
      }
    } else {
      div.textContent = cell.phrase;
    }
    div.addEventListener('click', () => openUrlModal(idx));
    div.addEventListener('keydown', (e) => { if (e.key === 'Enter') openUrlModal(idx); });
    boardEl.appendChild(div);
  });

  checkBingoAndShow();
}

function setupModals() {
  // url modal
  window.currentEditIndex = null;
  const urlModal = document.getElementById('urlModal');
  const urlInput = document.getElementById('urlInput');
  const descInput = document.getElementById('descInput');
  document.getElementById('urlSave').addEventListener('click', async () => {
    const val = urlInput.value.trim();
    const desc = descInput.value.trim();
    if (val.length === 0) {
      showUrlError('Please enter a URL or click Clear to remove.');
      return;
    }
    if (!validateUrl(val)) {
      showUrlError('Invalid URL (must start with http:// or https://)');
      return;
    }
    // Validate description
    if (desc.length === 0) {
      showUrlError('Please enter a description of what you did.');
      return;
    }
    const wordCount = desc.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 3) {
      showUrlError('Description must be at least 3 words.');
      return;
    }
    if (wordCount > 1000) {
      showUrlError('Description must be at most 1000 words.');
      return;
    }
    await saveCellUrl(window.currentEditIndex, val, desc);
    closeUrlModal();
  });
  document.getElementById('urlClear').addEventListener('click', async () => {
    await saveCellUrl(window.currentEditIndex, null, null);
    closeUrlModal();
  });
  document.getElementById('urlCancel').addEventListener('click', closeUrlModal);

  // bingo modal
  const bingoModal = document.getElementById('bingoModal');
  document.getElementById('bingoSubmit').addEventListener('click', async () => {
    try {
      await api('/api/bingo', { method: 'POST', body: JSON.stringify({}) });
      // Generate and show the badge instead of redirecting immediately
      document.getElementById('bingoSubmit').disabled = true;
      document.getElementById('bingoSubmit').textContent = 'Submitted!';
      await generateBadge();
    } catch (err) {
      alert('Failed to submit bingo: ' + (err.message || ''));
    }
  });
  document.getElementById('bingoCancel').addEventListener('click', () => {
    closeBingoModal();
    // If already submitted, go to winners page
    if (document.getElementById('bingoSubmit').disabled) {
      window.location = '/winners.html';
    }
  });
}

function openUrlModal(index) {
  window.currentEditIndex = index;
  const modal = document.getElementById('urlModal');
  const input = document.getElementById('urlInput');
  const descInput = document.getElementById('descInput');
  const err = document.getElementById('urlError');
  err.classList.add('hidden');
  const current = state.board[index];
  input.value = current.url || '';
  descInput.value = current.description || '';
  modal.classList.remove('hidden');
  input.focus();
}

function closeUrlModal() {
  const modal = document.getElementById('urlModal');
  modal.classList.add('hidden');
  window.currentEditIndex = null;
}

function showUrlError(msg) {
  const el = document.getElementById('urlError');
  el.textContent = msg;
  el.classList.remove('hidden');
}

async function saveCellUrl(index, urlOrNull, descOrNull) {
  try {
    await api('/api/board/update', {
      method: 'POST',
      body: JSON.stringify({ index, url: urlOrNull, description: descOrNull })
    });
    // update local state then re-render
    state.board[index].url = urlOrNull;
    state.board[index].description = descOrNull;
    renderBoard();
  } catch (err) {
    alert('Failed to save: ' + (err.message || ''));
  }
}

function checkBingoAndShow() {
  const modal = document.getElementById('bingoModal');
  const wasHidden = modal.classList.contains('hidden');
  if (hasBingo(state.board.map(c => !!c.url))) {
    modal.classList.remove('hidden');
    // Fire confetti only on transition from hidden -> visible
    if (wasHidden) fireConfetti();
  } else {
    modal.classList.add('hidden');
  }
}

// Fireworks confetti effect — adapted from canvas-confetti's "Fireworks" example
function fireConfetti() {
  if (typeof confetti !== 'function') return;
  const duration = 5 * 1000;
  const animationEnd = Date.now() + duration;
  const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 9999 };
  function randomInRange(min, max) {
    return Math.random() * (max - min) + min;
  }
  const interval = setInterval(function () {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) return clearInterval(interval);
    const particleCount = 50 * (timeLeft / duration);
    confetti(Object.assign({}, defaults, {
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }
    }));
    confetti(Object.assign({}, defaults, {
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }
    }));
  }, 250);
}

function closeBingoModal() {
  document.getElementById('bingoModal').classList.add('hidden');
}

// bingo checking: board is 25 booleans: true if filled
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

async function signout() {
  await api('/api/signout', { method: 'POST' });
  window.location = '/';
}

// Badge generation: composites social_card.png with the user's bingo board
async function generateBadge() {
  const canvas = document.getElementById('badgeCanvas');
  const ctx = canvas.getContext('2d');

  // Load the background image
  const bg = new Image();
  bg.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    bg.onload = resolve;
    bg.onerror = reject;
    bg.src = '/assets/social_card.png';
  });

  // Use the image's natural dimensions
  const W = bg.naturalWidth;
  const H = bg.naturalHeight;
  canvas.width = W;
  canvas.height = H;

  // Draw background
  ctx.drawImage(bg, 0, 0, W, H);

  // Board layout: centered in the lower 60% with margin from edges
  const margin = W * 0.075;
  const lowerTop = H * 0.4;
  const lowerHeight = H * 0.6;
  const availW = W - margin * 2;
  const availH = lowerHeight - margin * 2;
  const boardSize = Math.min(availW, availH);
  const gap = Math.round(boardSize * 0.02);
  const cellSize = (boardSize - gap * 4) / 5;
  const startX = (W - (cellSize * 5 + gap * 4)) / 2;
  const startY = lowerTop + (lowerHeight - (cellSize * 5 + gap * 4)) / 2;

  // Colors matching the app theme
  const linkedColor = 'rgba(143, 204, 153, 0.95)';
  const linkedBorder = 'rgba(40, 78, 132, 1)';
  const emptyColor = 'rgba(255, 255, 255, 0.85)';
  const emptyBorder = 'rgba(200, 210, 225, 1)';
  const textColor = '#222';

  // Draw each cell
  state.board.forEach((cell, idx) => {
    const col = idx % 5;
    const row = Math.floor(idx / 5);
    const x = startX + col * (cellSize + gap);
    const y = startY + row * (cellSize + gap);
    const r = Math.round(cellSize * 0.08);

    // Filled rounded rectangle
    ctx.beginPath();
    ctx.roundRect(x, y, cellSize, cellSize, r);
    ctx.fillStyle = cell.url ? linkedColor : emptyColor;
    ctx.fill();
    ctx.strokeStyle = cell.url ? linkedBorder : emptyBorder;
    ctx.lineWidth = Math.max(1, Math.round(cellSize * 0.02));
    ctx.stroke();

    // Only draw text for completed (linked) cells
    if (cell.url) {
      const maxFontSize = Math.round(cellSize * 0.14);
      const minFontSize = Math.round(cellSize * 0.08);
      const padding = cellSize * 0.08;
      const maxTextWidth = cellSize - padding * 2;

      let fontSize = maxFontSize;
      ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
      const words = cell.phrase.split(' ');
      let lines = wrapText(ctx, words, maxTextWidth);

      while (lines.length * (fontSize * 1.2) > cellSize - padding * 2 && fontSize > minFontSize) {
        fontSize--;
        ctx.font = `${fontSize}px Inter, system-ui, sans-serif`;
        lines = wrapText(ctx, words, maxTextWidth);
      }

      ctx.fillStyle = textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const lineHeight = fontSize * 1.2;
      const totalTextHeight = lines.length * lineHeight;
      const textStartY = y + (cellSize - totalTextHeight) / 2;

      lines.forEach((line, li) => {
        ctx.fillText(line, x + cellSize / 2, textStartY + li * lineHeight);
      });
    }
  });

  // Show the badge area and set download link
  const badgeArea = document.getElementById('badgeArea');
  badgeArea.classList.remove('hidden');
  canvas.toBlob(blob => {
    const url = URL.createObjectURL(blob);
    const dl = document.getElementById('badgeDownload');
    dl.href = url;
  }, 'image/png');
}

// Helper: wrap words into lines that fit within maxWidth
function wrapText(ctx, words, maxWidth) {
  const lines = [];
  let current = '';
  for (const word of words) {
    const test = current ? current + ' ' + word : word;
    if (ctx.measureText(test).width <= maxWidth) {
      current = test;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}
