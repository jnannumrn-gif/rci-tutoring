(function() {
  var COOKIE_KEY = 'rci_cookie_consent';
  var consent = localStorage.getItem(COOKIE_KEY);

  if (consent === 'accepted' || consent === 'rejected') return;

  var lang = document.documentElement.lang || 'es';

  // Compute absolute path to cookies.html from current page location
  var scriptEls = document.querySelectorAll('script[src*="cookie-banner.js"]');
  var basePath = '';
  if (scriptEls.length) {
    var src = scriptEls[0].getAttribute('src');
    basePath = src.replace(/assets\/cookie-banner\.js$/, '');
  }
  var cookiesUrl = basePath + 'cookies.html';

  var bannerHTML =
    '<div id="cookie-banner" style="' +
      'position:fixed;bottom:0;left:0;right:0;z-index:9999;' +
      'background:rgba(15,23,42,0.97);backdrop-filter:blur(12px);' +
      'border-top:1px solid rgba(255,255,255,0.1);' +
      'padding:20px 24px;font-family:Inter,system-ui,-apple-system,sans-serif;' +
      'animation:cookieSlideUp 0.4s ease-out">' +
      '<style>@keyframes cookieSlideUp{from{transform:translateY(100%);opacity:0}to{transform:translateY(0);opacity:1}}</style>' +
      '<div style="max-width:1200px;margin:0 auto;display:flex;align-items:center;gap:20px;flex-wrap:wrap">' +
        '<div style="flex:1;min-width:280px">' +
          '<p class="cb-es" style="color:#e2e8f0;font-size:0.92rem;line-height:1.6;margin:0;' + (lang !== 'es' ? 'display:none' : '') + '">' +
            '<strong style="color:#fff">&#127850; Uso de Cookies</strong><br>' +
            'Este sitio utiliza cookies y tecnolog\u00edas de almacenamiento local para mejorar tu experiencia. ' +
            'Puedes aceptar o rechazar las cookies no esenciales. ' +
            '<a href="' + cookiesUrl + '" style="color:#60a5fa;text-decoration:underline">M\u00e1s informaci\u00f3n</a>' +
          '</p>' +
          '<p class="cb-en" style="color:#e2e8f0;font-size:0.92rem;line-height:1.6;margin:0;' + (lang !== 'en' ? 'display:none' : '') + '">' +
            '<strong style="color:#fff">&#127850; Cookie Usage</strong><br>' +
            'This site uses cookies and local storage technologies to improve your experience. ' +
            'You can accept or reject non-essential cookies. ' +
            '<a href="' + cookiesUrl + '" style="color:#60a5fa;text-decoration:underline">Learn more</a>' +
          '</p>' +
        '</div>' +
        '<div style="display:flex;gap:10px;flex-shrink:0">' +
          '<button id="cookie-reject" style="' +
            'padding:12px 24px;border-radius:10px;font-size:0.88rem;font-weight:700;' +
            'cursor:pointer;font-family:inherit;transition:all 0.2s;' +
            'background:transparent;color:#94a3b8;border:1px solid rgba(255,255,255,0.15)">' +
            '<span class="cb-es"' + (lang !== 'es' ? ' style="display:none"' : '') + '>Rechazar</span>' +
            '<span class="cb-en"' + (lang !== 'en' ? ' style="display:none"' : '') + '>Reject</span>' +
          '</button>' +
          '<button id="cookie-accept" style="' +
            'padding:12px 24px;border-radius:10px;font-size:0.88rem;font-weight:700;' +
            'cursor:pointer;font-family:inherit;transition:all 0.2s;' +
            'background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;border:none;' +
            'box-shadow:0 4px 16px rgba(30,64,175,0.3)">' +
            '<span class="cb-es"' + (lang !== 'es' ? ' style="display:none"' : '') + '>Aceptar</span>' +
            '<span class="cb-en"' + (lang !== 'en' ? ' style="display:none"' : '') + '>Accept</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  var container = document.createElement('div');
  container.innerHTML = bannerHTML;
  document.body.appendChild(container.firstChild);

  function closeBanner(choice) {
    localStorage.setItem(COOKIE_KEY, choice);
    observer.disconnect();
    var banner = document.getElementById('cookie-banner');
    if (banner) {
      banner.style.animation = 'cookieSlideDown 0.3s ease-in forwards';
      var style = document.createElement('style');
      style.textContent = '@keyframes cookieSlideDown{from{transform:translateY(0);opacity:1}to{transform:translateY(100%);opacity:0}}';
      document.head.appendChild(style);
      setTimeout(function() { banner.remove(); style.remove(); }, 350);
    }
  }

  document.getElementById('cookie-accept').addEventListener('click', function() {
    closeBanner('accepted');
  });

  document.getElementById('cookie-reject').addEventListener('click', function() {
    closeBanner('rejected');
  });

  var observer = new MutationObserver(function() {
    var esEls = document.querySelectorAll('#cookie-banner .cb-es');
    var enEls = document.querySelectorAll('#cookie-banner .cb-en');
    var currentLang = document.documentElement.lang || 'es';
    esEls.forEach(function(el) { el.style.display = currentLang === 'es' ? '' : 'none'; });
    enEls.forEach(function(el) { el.style.display = currentLang === 'en' ? '' : 'none'; });
  });

  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
})();
