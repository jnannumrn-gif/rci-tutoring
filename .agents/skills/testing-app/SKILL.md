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

## Getting an authenticated session WITHOUT registering (fastest path for gated-page testing)

Registering through the UI is unreliable from this box (Turnstile Managed challenges never solve here, and there is a
3-signups-per-IP-per-24h cap). Instead seed a user straight into D1 with a password hash you compute locally, then log
in through the real `/login.html` UI so the recording shows a genuine login:

1. Generate a hash in the app's PBKDF2 format (`saltHex:hashHex`, 100 000 iterations, SHA-256, 32 bytes — matches
   `hashPassword()` in `functions/api/_shared/auth.js`):
   ```
   node -e "const c=require('crypto');const s=c.randomBytes(16);console.log(s.toString('hex')+':'+c.pbkdf2Sync('DevinTest!2026',s,100000,32,'sha256').toString('hex'))"
   ```
2. Insert the user with `email_verified=1` (login returns 403 `needs_verification` otherwise):
   ```
   INSERT INTO users (id,nombre,email,pais,idioma,password_hash,trial_start_date,trial_end_date,status,email_verified)
   VALUES ('devin-test-<slug>','Devin Test','devin-<slug>@example.com','US','es','<hash>',datetime('now'),datetime('now','+30 day'),'trial',1)
   ```
3. Log in at `/login.html` (no Turnstile on login). `login.html` stores `rci_token` + `rci_user` in localStorage.
   For curl-side checks grab the JWT with
   `curl -s -X POST <base>/api/login -H 'Content-Type: application/json' -d '{"email":"...","password":"..."}'`.
4. **Always clean up**: `DELETE FROM subscriptions WHERE user_id='...'; DELETE FROM users WHERE id='...';` and verify
   with a follow-up SELECT. Preview deployments share the **production** D1, so never leave rows behind.

You cannot read `JWT_SECRET` (Cloudflare secrets are write-only), so minting a JWT yourself is not an option — this
seeded-user + real-login path is the reliable one.

## Human RN booking pages and the $20 deposit gate

- Pages: `/tutoring/{ccht,cna,hha}/human/`. `assets/booking-gate.js` wraps the Cal.com init: no `rci_token` →
  `location.replace('/login.html')`; `/api/me` 401 → clears `rci_token`/`rci_user` then redirects;
  `human_session_deposit_paid` false → `$20` CTA (button id `booking-deposit-btn`); true → renders the embed.
- Flip the gate state with a single row (no Stripe needed):
  ```
  INSERT INTO subscriptions (user_id,stripe_subscription_id,tier,start_date,end_date,active)
  VALUES ('<uid>','pi_devin_test','human_session_deposit',datetime('now'),NULL,0);   -- unlocks
  DELETE FROM subscriptions WHERE user_id='<uid>';                                    -- re-locks
  ```
  Note `active=0` is correct — the webhook writes deposits that way and `/api/me` matches on tier regardless.
- Assert on **`document.querySelectorAll('#my-cal-inline iframe').length`** and on
  `performance.getEntriesByType('resource').filter(n=>n.name.includes('cal.com')).length`. A gated page must show
  **0** for both; an ungated page shows >=1. This is what distinguishes "gate works" from "calendar just failed to load".
- **`/tutoring/cna/human/` and `/tutoring/hha/human/` show "Error Code: 404. Cal Link seems to be wrong."** even when
  the gate passes — their `calLink` slugs (`sesion-de-tutoria-cna` / `-hha`) 404 on cal.com; only the ccht slug
  (`sesion-de-tutoria-en-hemodialisis`) resolves. This is pre-existing and unrelated to gating; verify with
  `curl -o /dev/null -w '%{http_code}' https://cal.com/<slug>` before reporting it as a regression. The iframe still
  mounts, so the iframe-count assertion remains valid.
- **`STRIPE_SECRET_KEY` may be missing on preview Pages deployments**, in which case `/api/create-checkout` returns
  `500 {"error":"Stripe not configured"}` and any "click the CTA → Stripe" step cannot be completed on a preview URL.
  Prove the request is otherwise well-formed with a control call using a bogus plan (returns `400 Invalid plan`).
  Ask for the secret to be added to the preview environment (note: adding it requires **retrying the deployment** so
  the new binding is picked up — the old deployment keeps returning the error), or verify on production.
- **Stripe checkout is LIVE mode** (`cs_live_...` session ids). Testing the CTA → checkout hop is safe as long as you
  stop the moment the page loads: never type card details and never click **Pay**. Creating an unpaid checkout session
  costs nothing and leaves no DB row (the `subscriptions` row is only written by the webhook after payment).
  Checkout opens with the browser's geo currency preselected (e.g. €18.00); click the **$20.00** currency button in the
  "Choose currency" row to make the `$20.00 RCI Tutoring - Human RN Session` line item visible for the screenshot.

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

## Cloudflare Turnstile on /register

- Client: `register.html` renders the widget explicitly into `#turnstileWidget` from
  `var TURNSTILE_SITE_KEY = '0x...'`; `getTurnstileToken()` polls `turnstile.getResponse(id)` every 250 ms for up to
  5 s and sends the result as `turnstile_token`. Server: `verifyTurnstile()` in `functions/api/_shared/antibot.js`
  **skips entirely when `TURNSTILE_SECRET_KEY` is unset** (so local `pages dev` always passes) and returns
  `400 {field:'turnstile'}` with "No pudimos verificar que eres humano..." otherwise.
- **Always verify the site key string itself.** A one-character typo renders *nothing* (empty div, only a hidden
  `cf-turnstile-response` input) and the page looks merely "a bit short" — easy to miss. Grab the client-side error
  code with an explicit test render in the console:
  ```js
  const d=document.createElement('div');d.id='ts';document.body.appendChild(d);
  turnstile.render('#ts',{sitekey:'<key>','error-callback':c=>console.log('ERR',c),callback:t=>console.log('TOKEN',t.length)});
  ```
  `400020` = invalid sitekey, `110200` = domain not authorized, `600010`/`300*` = challenge failed (bot detection).
- List the account's real sitekeys/hostnames to compare against the code:
  ```
  curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/<account_id>/challenges/widgets"
  ```
  (account id via `.../client/v4/accounts`). This is the fastest way to prove a sitekey typo.
- Control test: render Cloudflare's always-passing test key `1x00000000000000000000AA` on the same page. If the
  control shows "Success!" and the app key errors, the problem is the key/config, not the browser or extensions.
- **This datacenter browser cannot solve a real Managed challenge** (interactive checkbox stays unchecked, error
  `600010`). So an end-to-end signup that carries a genuine token usually cannot be completed from the test box —
  plan to prove the client half (widget renders, token polled) and the server half (direct POST with missing/garbage
  token → 400 `field:'turnstile'`) separately, and say so in the report.
- Server-side enforcement in production is easy to prove with curl (no browser auth involved):
  ```
  curl -s -X POST https://rcitutoring.com/api/register -H 'Content-Type: application/json' \
    -d '{"nombre":"T","email":"x@gmail.com","pais":"US","form_ms":9000,"website":"","turnstile_token":"garbage"}'
  ```
  → `400 {"field":"turnstile"}` means `TURNSTILE_SECRET_KEY` really is set in the Pages project (no skip path).
  These rejected requests happen before any insert, so they do not consume the 3-signups-per-IP-per-24h budget.
- Remember `rcitutoring.com/register.html` 308-redirects to `/register`.

### Devin Secrets Needed
- `CLOUDFLARE_API_TOKEN` — wrangler D1 queries and the Turnstile widgets API listing above.

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
