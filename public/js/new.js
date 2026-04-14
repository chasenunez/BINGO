document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('signupForm');
  const msg = document.getElementById('msg');

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    showMsg(msg, '');
    const fd = new FormData(form);
    const payload = {
      name: fd.get('name').trim(),
      email: fd.get('email').trim(),
      password: fd.get('password'),
      useAnonymous: !!fd.get('useAnonymous')
    };
    try {
      await api('/api/signup', { method: 'POST', body: JSON.stringify(payload) });
      // redirect to board
      window.location = '/board.html';
    } catch (err) {
      showMsg(msg, err.message || 'Sign up failed', true);
    }
  });
});