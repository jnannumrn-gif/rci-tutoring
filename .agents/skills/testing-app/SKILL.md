---
name: testing-app
description: How to test the RCI Tutoring static site (auth gate, language toggle, cookie consent, analytics/tracking pixels, deployment/preview URLs).
---

# Testing RCI Tutoring

## Auth Gate

All pages are protected by `assets/auth-gate.js`. It checks `sessionStorage.getItem('rci_auth') === 'ok'`.

To bypass for testing, run in the browser console:
```js
sessionStorage.setItem('rci_auth', 'ok');
location.reload();
```

The auth gate uses SHA-256 password hashing. The password hash is stored in `auth-gate.js`.

## Language Toggle

- The site is bilingual (ES/EN)
- Main site (`index.html`): Uses `data-i18n` map for translations, toggled via ES/EN buttons in the sticky header
- Legal pages (`legal.html`, `privacy.html`, `cookies.html`): Use `.lang` class with `data-lang` attributes, toggled via ES/EN buttons
- Language preference is stored in `localStorage` as `rci_lang`
- The `<html lang>` attribute is updated when language is toggled

## Cookie Consent Banner

- `assets/cookie-banner.js` shows a slide-up banner on first visit
- User choice stored in `localStorage` as `rci_cookie_consent` (values: `'accepted'` or `'rejected'`)
- To reset for testing: `localStorage.removeItem('rci_cookie_consent')` (or delete the key in DevTools →
  Application → Local storage, which is more demonstrable in a recording)
- Once a choice is stored the banner never reappears and there is no "manage cookies" UI, so the
  `rejected → accepted` runtime transition (the `rci-cookie-consent` CustomEvent listened to by
  `assets/meta-pixel.js`) is not reachable through the UI — clear the key and reload to test the accepted path
- Banner language switches reactively via `MutationObserver` on `<html lang>`
- The "More info" link path is derived from the script's own `src` attribute to resolve correctly from any page depth

## Analytics / Tracking Pixels (Meta Pixel, Google Ads)

**The Devin test browser ships with uBlock Origin enabled** (`--load-extension=/opt/.devin/package/chrome_extensions/adblock`).
It blocks `connect.facebook.net`, `facebook.com/tr`, googleads, etc. — the request shows
`Provisional headers are shown` / `(blocked)` in DevTools, which looks *exactly* like a broken pixel.
Before testing any tracking/analytics change:

1. Open `chrome://extensions` and toggle **uBlock Origin development build** off.
2. Reload the page and re-check the Network panel.

A quick way to tell whether the block is the extension or the network: `curl -sI https://connect.facebook.net/en_US/fbevents.js`
from the shell. If the shell gets `200` but the browser does not, it is the extension.

Verifying the Meta Pixel:

- `assets/meta-pixel.js` holds `PIXEL_ID` and is included by every HTML page; each page also has a
  `<noscript><img src="https://www.facebook.com/tr?id=...&ev=PageView&noscript=1">` fallback.
- Open DevTools → Network, filter on `facebook`. A healthy load shows three `200`s:
  `fbevents.js`, `signals/config/<PIXEL_ID>`, and `tr/?id=<PIXEL_ID>&ev=PageView`.
- To prove a *wrong* ID is absent, type the bad ID into the Network filter box and confirm `0 / N requests`.
- Enable **Preserve log** to capture pages that redirect (e.g. `/dashboard` bounces to `/login` when logged out —
  the dashboard still fires its own PageView before the redirect).
- Site-wide sweep without a browser:
  `for p in / /login /register /upgrade /dashboard /tutoring/ ...; do curl -s "$PREVIEW$p" | grep -o "<ID>"; done`
  (note `.html` URLs 308-redirect to clean URLs, so use `/login` not `/login.html` with `curl`).
- Confirming events actually land in Meta Events Manager requires the account owner — agents can only prove the
  outbound `200` request.

## Deployment

- Hosted on Cloudflare Pages
- Preview URLs are generated per commit on PRs
- No build step required (static HTML site)

## Pages Structure

- `/` — Main landing page
- `/legal` — Legal disclaimer (Aviso Legal)
- `/privacy` — Privacy policy (Política de Privacidad)
- `/cookies` — Cookies policy (Política de Cookies)
- `/tutoring/` — Tutoring mode selection
- `/tutoring/ai/` — AI tutor
- `/tutoring/human/` — Human tutor booking
