// Account gate for the study tools (AI Tutor, prep app).
//
// Two entry points, both wired declaratively:
//   <html data-require-login>            -> the page itself is members-only
//   <a data-requires-account href="...">  -> the link is members-only
//
// Visitors without a session are sent to /register.html (not /login.html): the
// goal is to capture the lead, and the register page already links to sign-in.
// The intended destination travels in ?next= and is also mirrored into
// localStorage.rci_next, because the email-verification flow returns from a
// magic link that never carries our query string.
(function (global) {
  var TOKEN_KEY = 'rci_token';
  var NEXT_KEY = 'rci_next';
  var REGISTER = '/register.html';
  var NEXT_TTL_MS = 60 * 60 * 1000;

  function samePath(value) {
    // Only same-origin absolute paths are honored, so ?next= cannot be used as
    // an open redirect.
    return typeof value === 'string' && /^\/[^/\\]/.test(value) ? value : null;
  }

  function rememberNext(path) {
    var safe = samePath(path);
    if (!safe) return null;
    try { localStorage.setItem(NEXT_KEY, JSON.stringify({ p: safe, t: Date.now() })); } catch (e) {}
    return safe;
  }

  function storedNext() {
    var raw = null;
    try { raw = localStorage.getItem(NEXT_KEY); } catch (e) { return null; }
    if (!raw) return null;
    try {
      var saved = JSON.parse(raw);
      if (!saved || Date.now() - saved.t > NEXT_TTL_MS) return null;
      return samePath(saved.p);
    } catch (e) {
      return null;
    }
  }

  function toRegister(next) {
    var safe = rememberNext(next);
    global.location.replace(REGISTER + (safe ? '?next=' + encodeURIComponent(safe) : ''));
  }

  function loggedIn() {
    return !!localStorage.getItem(TOKEN_KEY);
  }

  // Consumed by login.html / register.html / verify-magic.html to land the user
  // where they were originally headed. Falls back to the dashboard.
  function takeNext(fallback) {
    var params = new URLSearchParams(global.location.search);
    var next = samePath(params.get('next')) || storedNext();
    try { localStorage.removeItem(NEXT_KEY); } catch (e) {}
    return next || fallback || '/dashboard.html';
  }

  function protectPage() {
    if (!loggedIn()) {
      toRegister(global.location.pathname);
      return;
    }
    // A stale token still shows the page; the check below only kicks the user
    // out once the API confirms the session is dead.
    fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem(TOKEN_KEY) } })
      .then(function (res) {
        if (res.status !== 401) return;
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem('rci_user');
        toRegister(global.location.pathname);
      })
      .catch(function () {});
  }

  function protectLinks() {
    document.querySelectorAll('a[data-requires-account]').forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (loggedIn()) return;
        event.preventDefault();
        // External tools (the prep app) cannot be resumed by path, so those
        // links declare where to land instead.
        toRegister(link.getAttribute('data-requires-account') || link.getAttribute('href'));
      });
    });
  }

  global.RCIGate = { takeNext: takeNext, loggedIn: loggedIn };

  if (document.documentElement.hasAttribute('data-require-login')) {
    protectPage();
  } else {
    // Keep ?next= alive across the email-verification round trip.
    rememberNext(new URLSearchParams(global.location.search).get('next'));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', protectLinks);
  } else {
    protectLinks();
  }
})(window);
