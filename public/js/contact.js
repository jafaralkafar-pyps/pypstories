// Loaded from /js so production CSP script-src 'self' can run it.
var accountPrefill = null;
var loadedAtMs = Date.now();
var loadedAtField = document.getElementById('contact-loaded-at');

function stampLoadedAt() {
  if (loadedAtField) loadedAtField.value = String(loadedAtMs);
}
stampLoadedAt();

function applyAccountPrefill() {
  if (!accountPrefill) return;
  var nameEl = document.getElementById('contact-name');
  var emailEl = document.getElementById('contact-email');
  if (nameEl && !nameEl.value && accountPrefill.username) nameEl.value = accountPrefill.username;
  if (emailEl && !emailEl.value && accountPrefill.email) emailEl.value = accountPrefill.email;
}

fetch('/api/me', { credentials: 'same-origin' })
  .then(function (r) { return r.json(); })
  .then(function (data) {
    if (!data || !data.user) return;
    accountPrefill = {
      username: data.user.username || '',
      email: data.user.email || ''
    };
    applyAccountPrefill();
  })
  .catch(function () {});

var msg = document.getElementById('contact-message');
msg.addEventListener('input', function () {
  document.getElementById('contact-msg-count').textContent = String((msg.value || '').length);
});
document.getElementById('contact-form').addEventListener('submit', function (event) {
  event.preventDefault();
  var name = (document.getElementById('contact-name').value || '').trim();
  var email = (document.getElementById('contact-email').value || '').trim();
  var message = (document.getElementById('contact-message').value || '').trim();
  var websiteEl = document.getElementById('contact-website');
  var website = websiteEl ? (websiteEl.value || '') : '';
  var err = document.getElementById('contact-error');
  var ok = document.getElementById('contact-success');
  var btn = document.getElementById('contact-submit');
  err.classList.add('hidden');
  ok.classList.add('hidden');
  err.textContent = '';
  if (!name || name.length < 2) {
    err.textContent = 'Please enter your name';
    err.classList.remove('hidden');
    return;
  }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    err.textContent = 'Please enter a valid email';
    err.classList.remove('hidden');
    return;
  }
  if (message.length < 10) {
    err.textContent = 'Please write a short message (at least 10 characters)';
    err.classList.remove('hidden');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Sending…';
  fetch('/api/contact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      name: name,
      email: email,
      message: message,
      website: website,
      loaded_at: loadedAtField ? loadedAtField.value : ''
    })
  }).then(function (r) {
    return r.json().catch(function () { return {}; }).then(function (d) {
      return { ok: r.ok, data: d };
    });
  }).then(function (result) {
    if (!result.ok) {
      err.textContent = result.data.error || 'Could not send message';
      err.classList.remove('hidden');
      return;
    }
    ok.textContent = result.data.message || 'Thanks! Your message was sent.';
    ok.classList.remove('hidden');
    document.getElementById('contact-form').reset();
    document.getElementById('contact-msg-count').textContent = '0';
    stampLoadedAt();
    applyAccountPrefill();
  }).catch(function () {
    err.textContent = 'Network error. Please try again.';
    err.classList.remove('hidden');
  }).then(function () {
    btn.disabled = false;
    btn.textContent = 'Send message';
  });
});
