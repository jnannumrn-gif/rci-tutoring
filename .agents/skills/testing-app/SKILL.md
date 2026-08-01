---
name: Testing RCI Tutoring
description: How to test the RCI Tutoring static Cloudflare Pages site — auth/consent state, bilingual toggles, the AI Tutor proxy worker, and browser-profile gotchas that cause false negatives.
---

# Testing RCI Tutoring

## Auth Gate — no longer present (verify before assuming)

Historically all pages were gated by `assets/auth-gate.js` (`sessionStorage.rci_auth === 'ok'`).
**As of the current tree no HTML file references `auth-gate.js`, so pages load with no login wall
and no credentials are needed.** Always confirm with:

```bash
grep -rl "auth-gate.js" --include=*.html .   # empty output = no gate
```

If a gate is ever re-added, bypass it for testing with:
```js
sessionStorage.setItem('rci_auth', 'ok'); location.reload();
```
There is also no paywall or account requirement on the AI Tutor pages — they are freely usable.

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

## AI Tutor (proxy worker) tests

- The three tutor chat pages are `tutoring/{ccht,cna,hha}/ai/index.html`. Each POSTs to the Cloudflare
  Worker `https://rci-tutor-proxy.jnannum-rn.workers.dev` (`API_ENDPOINT` near the top of the inline
  `<script>`). The worker source is tracked in-repo at `proxy/src/worker.js`.
- **The worker owns the model.** `proxy/src/worker.js` pins `const MODEL = '<model-id>'` and ignores any
  client-supplied `model`. Consequence for testing: a model swap needs only a worker redeploy, and
  stale/cached pages still pinned to an old model keep working. Verify by comparing the DevTools
  **Payload** (what the page sent) against the **Response** JSON `"model"` (what actually ran) —
  they legitimately differ on production pages that predate the change.
- To assert the model at runtime, filter Network by `rci-tutor-proxy`, click the `fetch` row, and read
  `"model"` at the very top of the Response JSON. The panel often opens scrolled slightly past it —
  scroll up. Enlarge DevTools first; dragging the splitter can be finicky, F12 toggling is more reliable.
- **A rendered chat bubble is NOT proof of success.** The frontend error path prints literally
  `Error: ` + the API message, and Anthropic's 404 for a retired model is literally `model: <id>` —
  which is exactly how the historic "Error: model: claude-sonnet-4-…" bug surfaced. Always pair
  "an answer appeared" with the Network-level model/status assertion.
- Worker error responses are shaped `{error:{message}}` (the frontend reads `data.error.message`).
  If it ever regresses to `{error:"string"}` the UI degrades to a generic "Service unavailable.".
- Expect **~17–20 s** per response for long answers. Wait at least ~20 s before concluding a request
  hung, and don't mistake latency for a failure.
- Chat state: history lives in `sessionStorage.rci_chat_history` and is restored by `restoreMessages()`
  on load, so it survives reloads and navigation. Clear it between test runs with
  `sessionStorage.removeItem('rci_chat_history')`.
- Known cosmetic quirk (pre-existing, unrelated to model changes): toggling ES/EN on a tutor page
  updates the header but does **not** re-translate the quick-topic chips or the input placeholder.
  The reply language does follow the toggle (it drives the `system` prompt), so don't report this as
  a model/proxy bug.
- Requires the `ANTHROPIC_API_KEY` secret only on the worker side (bound in Cloudflare); browser-based
  testing needs no key.

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
- `/tutoring/{ccht,cna,hha}/ai/` — AI tutor chat (one per certification track)
- `/tutoring/{ccht,cna,hha}/human/` — Human tutor booking
- `/login.html`, `/register.html`, `/dashboard.html`, `/upgrade.html`, `/verify-email.html`, `/verify-magic.html`

## Environments

- Production: `https://rcitutoring.com` — useful as the "stale page" case, since it may serve older
  markup than the branch under test.
- Branch preview: `https://devin-<slug>.rci-tutoring.pages.dev` (per-PR Cloudflare Pages deploy).
- Local: `npx wrangler pages dev .` (no build step). `CLOUDFLARE_API_TOKEN` is only needed for
  deploys/D1 migrations, not for read-only UI testing.
