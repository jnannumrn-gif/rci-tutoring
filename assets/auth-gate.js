(function() {
  var HASH = '23d05ddb639aeb9640fa35f571411be5214f5ee10865b604700265558706a02c';
  var KEY = 'rci_auth';

  if (sessionStorage.getItem(KEY) === 'ok') {
    document.documentElement.classList.remove('auth-pending');
    return;
  }

  var overlay = document.createElement('div');
  overlay.id = 'auth-gate';
  overlay.innerHTML =
    '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b1120;font-family:Inter,system-ui,sans-serif">' +
      '<div style="background:#141b2d;border:1px solid rgba(255,255,255,0.08);border-radius:20px;padding:40px;max-width:380px;width:calc(100% - 32px);text-align:center;box-shadow:0 20px 60px rgba(0,0,0,0.4)">' +
        '<img src="/assets/rci-tutoring-logo-premium.png" alt="RCI Tutoring" style="width:64px;height:64px;margin:0 auto 16px;border-radius:14px;background:#fff;padding:4px;display:block" />' +
        '<h2 style="color:#fff;margin:0 0 6px;font-size:1.3rem">RCI Tutoring</h2>' +
        '<p style="color:#8896a8;margin:0 0 24px;font-size:0.9rem">Acceso restringido / Restricted access</p>' +
        '<input id="auth-pw" type="password" placeholder="Contraseña / Password" autocomplete="off" style="width:100%;padding:14px 16px;border:1px solid rgba(255,255,255,0.12);border-radius:12px;background:#0b1120;color:#fff;font-size:1rem;font-family:inherit;outline:none;box-sizing:border-box" />' +
        '<button id="auth-btn" style="width:100%;margin-top:12px;padding:14px;border:none;border-radius:12px;background:linear-gradient(135deg,#0f5da6,#2da3ea);color:#fff;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit">Entrar / Enter</button>' +
        '<p id="auth-err" style="color:#ef4444;margin:12px 0 0;font-size:0.85rem;display:none">Contraseña incorrecta / Wrong password</p>' +
      '</div>' +
    '</div>';

  document.documentElement.appendChild(overlay);

  function sha256(str) {
    var buf = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', buf).then(function(h) {
      return Array.from(new Uint8Array(h)).map(function(b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  function attempt() {
    var pw = document.getElementById('auth-pw').value;
    try {
      sha256(pw).then(function(h) {
        if (h === HASH) {
          sessionStorage.setItem(KEY, 'ok');
          overlay.remove();
          document.documentElement.classList.remove('auth-pending');
        } else {
          document.getElementById('auth-err').style.display = 'block';
          document.getElementById('auth-pw').value = '';
          document.getElementById('auth-pw').focus();
        }
      }).catch(function() {
        document.getElementById('auth-err').style.display = 'block';
      });
    } catch (e) {
      document.getElementById('auth-err').style.display = 'block';
    }
  }

  document.getElementById('auth-btn').addEventListener('click', attempt);
  document.getElementById('auth-pw').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') attempt();
  });
})();
