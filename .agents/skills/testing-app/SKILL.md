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
- To reset for testing: `localStorage.removeItem('rci_cookie_consent')`
- Banner language switches reactively via `MutationObserver` on `<html lang>`
- The "More info" link path is derived from the script's own `src` attribute to resolve correctly from any page depth

## Analytics / Tracking Tests (Meta Pixel, etc.)

- The Chrome test profile ships with **uBlock Origin enabled**, which blocks `connect.facebook.net` and `facebook.com`. Before verifying any Meta Pixel / analytics / tracking behavior, disable it via `chrome://extensions`, otherwise the tracker requests are silently blocked and tests give false negatives.
- The Meta Pixel (`assets/meta-pixel.js`, ID `22328706637567894`) is consent-aware and **opt-out**: it fires `fbq('track','PageView')` on load unless `localStorage.rci_cookie_consent === 'rejected'`. On `'rejected'` it defers and only loads after a `rci-cookie-consent` CustomEvent with `detail: 'accepted'` (dispatched by `cookie-banner.js`).
- Note: once consent is `'rejected'`, the cookie banner never re-displays, so the deferred `accepted` branch is only reachable by clearing consent or dispatching the event programmatically.

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
