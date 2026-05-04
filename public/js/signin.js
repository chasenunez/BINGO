document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signinForm');
  const msg = document.getElementById('msg');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showMsg(msg, '');
    const fd = new FormData(form);
    const payload = {
      email: fd.get('email').trim(),
      password: fd.get('password')
    };
    try {
      await api('api/signin', { method: 'POST', body: JSON.stringify(payload) });
      window.location = 'board.html';
    } catch (err) {
      showMsg(msg, err.message || 'Sign in failed', true);
    }
  });
});