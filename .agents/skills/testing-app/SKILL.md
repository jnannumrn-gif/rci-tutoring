---
name: testing-app
description: How to test the RCI Tutoring static Cloudflare Pages site — auth gate, language toggle, cookie consent, registration flow, and Meta Pixel / analytics verification.
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

## Registration Flow (`/register`)

- `/register` is **not** behind the auth gate (`register.html` does not load `assets/auth-gate.js`), so it can be tested directly.
- Required fields: nombre (min 2 chars), email (regex), país. Client-side validation returns before any `fetch`, so an
  invalid submit produces **no** `/api/register` request — useful as a clean negative case for analytics tests.
- Backend: `functions/api/register.js` (Cloudflare Pages Function + D1). Preview deployments have the D1 binding, so real
  registrations work on preview URLs. Verify before a run:
  `curl -X POST <preview>/api/register -H 'Content-Type: application/json' -d '{"nombre":"T","email":"x+<ts>@example.com","pais":"US"}'`
  → expect `201 {"success":true,"needs_verification":true,...}`.
- Submitting an **already-registered but unverified** email returns `409` with `needs_verification:true`, and the page
  renders the *same* "¡Revisa tu email!" confirmation screen. This is the easy way to reproduce the duplicate/409 path:
  just submit the same address twice.
- Registrations insert rows into the users table; use `devin-...+<timestamp>@example.com` addresses and mention created
  rows in the report so they can be cleaned up.

## Meta Pixel / analytics verification

- **The test browser profile ships with uBlock Origin enabled, and it blocks `connect.facebook.net/en_US/fbevents.js`
  (`(blocked:other)`).** When blocked, `typeof window.fbq` is still `"function"` (the inline stub queues calls), so the
  page looks fine while **zero** `facebook.com/tr` requests are sent — this will silently invalidate a pixel test.
  Disable the extension at `chrome://extensions` before testing any third-party tracking, and re-check that
  `fbevents.js` loads with status 200.
- `assets/meta-pixel.js` loads the pixel and fires `PageView` on every page; it is skipped entirely when
  `localStorage.rci_cookie_consent === 'rejected'` (then `window.fbq` is `undefined`), and re-loads on the
  `rci-cookie-consent` event when the user accepts.
- Capture request URLs verbatim with Resource Timing in the console:
  `performance.getEntriesByType('resource').map(r=>r.name).filter(n=>n.includes('facebook.com/tr'))`,
  plus a DevTools Network panel filtered to `facebook.com/tr` for the recording.
- Custom data (`fbq('track','Lead',{content_name:...})`) may **not** appear as `cd[content_name]` in the `/tr/` query
  string: recent fbevents builds (e.g. `v=2.9.368`, `pm=1`) emit `pm_metadata={"cd":true}` and send custom data
  out-of-band. Do not treat its absence as a bug — confirm with a control `fbq` call from the console, and prove the app
  payload by wrapping `window.fbq` before the UI action and logging its arguments.
- Per-email dedup for the Lead event uses `localStorage.rci_lead_tracked`; clear it explicitly between cases rather than
  relying on profile state.
- A healthy load shows three `200`s in the Network panel filtered on `facebook`: `fbevents.js`,
  `signals/config/<PIXEL_ID>`, and `tr/?id=<PIXEL_ID>&ev=PageView`. To prove a *wrong* ID is absent, type the bad ID
  into the filter box and confirm `0 / N requests`.
- Enable **Preserve log** to capture pages that redirect (e.g. `/dashboard` bounces to `/login` when logged out — the
  dashboard still fires its own PageView before the redirect).
- Site-wide sweep without a browser:
  `for p in / /login /register /upgrade /dashboard /tutoring/ ...; do curl -s "$PREVIEW$p" | grep -o "<ID>"; done`
  (note `.html` URLs 308-redirect to clean URLs, so use `/login` not `/login.html` with `curl`).
- To tell an extension block from a network problem: `curl -sI https://connect.facebook.net/en_US/fbevents.js` from the
  shell. If the shell gets `200` but the browser does not, it is uBlock Origin
  (`--load-extension=/opt/.devin/package/chrome_extensions/adblock`).
- Every HTML page also has a `<noscript><img src="https://www.facebook.com/tr?id=...&ev=PageView&noscript=1">` fallback,
  so the pixel ID lives in both `assets/meta-pixel.js` and each page — grep for it everywhere when it changes.
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
