(function() {
  var PIXEL_ID = '2232870637567894';
  var COOKIE_KEY = 'rci_cookie_consent';

  function loadPixel() {
    if (window.fbq) return;
    !function(f,b,e,v,n,t,s)
    {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
    n.callMethod.apply(n,arguments):n.queue.push(arguments)};
    if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
    n.queue=[];t=b.createElement(e);t.async=!0;
    t.src=v;s=b.getElementsByTagName(e)[0];
    s.parentNode.insertBefore(t,s)}(window, document,'script',
    'https://connect.facebook.net/en_US/fbevents.js');
    window.fbq('init', PIXEL_ID);
    window.fbq('track', 'PageView');
  }

  if (localStorage.getItem(COOKIE_KEY) === 'rejected') {
    window.addEventListener('rci-cookie-consent', function(e) {
      if (e.detail === 'accepted') loadPixel();
    });
    return;
  }

  loadPixel();
})();
