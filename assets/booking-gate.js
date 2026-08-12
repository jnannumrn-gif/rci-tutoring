// Payment gate for the Human RN Tutor booking pages.
// The calendar is only rendered for a logged-in student whose $20 deposit has
// been recorded by the Stripe webhook (`human_session_deposit_paid` in /api/me).
(function(global) {
  var CAL_CONTAINER = '.cal-container';

  function lang() {
    return localStorage.getItem('rci_lang') === 'en' ? 'en' : 'es';
  }

  function toLogin() {
    window.location.replace('/login.html');
  }

  function panel(html) {
    var container = document.querySelector(CAL_CONTAINER);
    if (!container) return null;
    container.innerHTML =
      '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;' +
      'text-align:center;padding:32px 20px;height:100%;box-sizing:border-box">' + html + '</div>';
    return container;
  }

  function showDepositCta(token) {
    var es = lang() === 'es';
    panel(
      '<div style="font-size:2rem">&#x1F512;</div>' +
      '<div style="font-size:1.05rem;font-weight:700">' +
        (es ? 'Reserva con dep\u00f3sito de $20' : 'Book with a $20 deposit') +
      '</div>' +
      '<div style="font-size:0.9rem;opacity:0.8;max-width:420px">' +
        (es
          ? 'Para agendar tu sesi\u00f3n 1:1 con un RN necesitas pagar el dep\u00f3sito de $20. Total: $49 \u2014 los $29 restantes se cobran al confirmar la sesi\u00f3n.'
          : 'To schedule your 1:1 session with an RN you need to pay the $20 deposit. Total: $49 \u2014 the remaining $29 is charged when the session is confirmed.') +
      '</div>' +
      '<button id="booking-deposit-btn" style="margin-top:6px;padding:14px 22px;border:none;border-radius:12px;' +
      'background:linear-gradient(135deg,#0f5da6,#2da3ea);color:#fff;font-size:1rem;font-weight:700;cursor:pointer;font-family:inherit">' +
        (es ? 'Reservar con dep\u00f3sito de $20' : 'Book with $20 deposit') +
      '</button>' +
      '<div id="booking-deposit-error" style="color:#ef4444;font-size:0.85rem;display:none"></div>'
    );

    var btn = document.getElementById('booking-deposit-btn');
    if (!btn) return;
    btn.addEventListener('click', function() {
      var errEl = document.getElementById('booking-deposit-error');
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.textContent = lang() === 'es' ? 'Redirigiendo a Stripe...' : 'Redirecting to Stripe...';

      fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ plan: 'human_session_deposit' })
      })
        .then(function(res) { return res.json(); })
        .then(function(data) {
          if (data && data.url) {
            window.location.href = data.url;
            return;
          }
          throw new Error(data && data.error ? data.error : 'checkout_failed');
        })
        .catch(function(err) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.textContent = lang() === 'es' ? 'Reservar con dep\u00f3sito de $20' : 'Book with $20 deposit';
          if (errEl) {
            errEl.style.display = 'block';
            errEl.textContent = (lang() === 'es' ? 'No se pudo iniciar el pago: ' : 'Could not start checkout: ') + err.message;
          }
        });
    });
  }

  function showRetry(renderEmbed) {
    var es = lang() === 'es';
    panel(
      '<div style="font-size:0.95rem">' +
        (es ? 'No pudimos verificar tu reserva. Recarga la p\u00e1gina.' : 'We could not verify your booking. Please reload the page.') +
      '</div>'
    );
  }

  global.RCIBookingGate = function(renderEmbed) {
    var token = localStorage.getItem('rci_token');
    if (!token) {
      toLogin();
      return;
    }

    fetch('/api/me', { headers: { 'Authorization': 'Bearer ' + token } })
      .then(function(res) {
        if (res.status === 401) {
          localStorage.removeItem('rci_token');
          localStorage.removeItem('rci_user');
          toLogin();
          return null;
        }
        return res.json();
      })
      .then(function(data) {
        if (!data) return;
        if (!data.user) {
          toLogin();
          return;
        }
        if (data.user.human_session_deposit_paid) {
          renderEmbed();
        } else {
          showDepositCta(token);
        }
      })
      .catch(function() {
        showRetry(renderEmbed);
      });
  };
})(window);
