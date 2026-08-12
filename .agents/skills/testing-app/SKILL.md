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
- To reset for testing: `localStorage.removeItem('rci_cookie_consent')`
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

## Local Cloudflare Pages + D1 dev server (needed for anti-bot / register testing)

- `npm install -g wrangler` fails (root-owned `/usr/lib/node_modules`). Use `npx --yes wrangler@3` (3.114.17 works).
- Seed the local D1 **before** starting the dev server, with the default persist dir and no `--d1` override,
  otherwise the API returns `D1_ERROR: no such table: users`:
  ```
  npx --yes wrangler@3 d1 execute rci-tutoring-db --local --file schema.sql
  npx --yes wrangler@3 d1 execute rci-tutoring-db --local --file migrations/001_add_fraud_prevention_columns.sql
  npx --yes wrangler@3 d1 execute rci-tutoring-db --local --file migrations/002_add_magic_token_columns.sql
  npx --yes wrangler@3 pages dev . --port 8790
  ```
- If two `pages dev` processes race for the same port you get `SQLITE_CANTOPEN` and every `/api/*` call 500s.
  `pkill -f wrangler; pkill -f workerd` and start exactly one server.
- Inspect rows: `npx --yes wrangler@3 d1 execute rci-tutoring-db --local --command "SELECT id,nombre,email,registration_ip FROM users ORDER BY created_at DESC"`.
- Locally `CF-Connecting-IP` is absent; `registration_ip` comes out as `::1` from the browser and `127.0.0.1` from
  curl — they are **different IPs** for the 3-signups-per-IP cap, so keep one client type per rate-limit test.

## Anti-bot layer on /api/register (functions/api/_shared/antibot.js)

- Honeypot `#website` (offscreen, `tabindex=-1`) and `form_ms < 2500` produce a **fake HTTP 201 success**: the UI shows
  the normal "¡Revisa tu email!" screen but no row is inserted. Always verify these cases in the DB, never by the UI.
  Server logs `[ANTIBOT] Rejected automated submission: honeypot|too_fast`.
- To exercise a sub-2.5s submit from a page that has been open a while, inject a same-origin `<iframe src="/register">`
  and fill + `dispatchEvent(new Event('submit'))` in its `onload` — the iframe's `formRenderedAt` is fresh.
- The MX check uses DoH against cloudflare-dns.com and needs outbound network. Verify a domain's real MX before
  calling a rejection a false positive: `curl -s -H 'accept: application/dns-json' "https://cloudflare-dns.com/dns-query?type=MX&name=<domain>"`
  (e.g. `johns-hopkins.edu` is NXDOMAIN; the real domain is `jhu.edu`).
- Known gap to re-check after changes: `looksAutomated()` only rejects a **finite, non-negative** `form_ms`, so a direct
  POST that omits `form_ms` or sends a negative/non-numeric value passes the timing check.
- Reset the IP cap between test batches with `DELETE FROM users` on the local D1.

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
