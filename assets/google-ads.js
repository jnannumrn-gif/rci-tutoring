(function() {
  var TAG_ID = 'AW-18359333650';
  var COOKIE_KEY = 'rci_cookie_consent';

  function loadTag() {
    if (window.gtag) return;
    window.dataLayer = window.dataLayer || [];
    window.gtag = function() { window.dataLayer.push(arguments); };
    var t = document.createElement('script');
    t.async = true;
    t.src = 'https://www.googletagmanager.com/gtag/js?id=' + TAG_ID;
    var s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(t, s);
    window.gtag('js', new Date());
    window.gtag('config', TAG_ID);
  }

  if (localStorage.getItem(COOKIE_KEY) === 'rejected') {
    window.addEventListener('rci-cookie-consent', function(e) {
      if (e.detail === 'accepted') loadTag();
    });
    return;
  }

  loadTag();
})();
