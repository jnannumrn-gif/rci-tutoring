# RCI Tutor Proxy

Cloudflare Worker that proxies AI Tutor chat requests to the Anthropic API, keeping
`ANTHROPIC_API_KEY` server-side and adding CORS headers.

Deployed at: https://rci-tutor-proxy.jnannum-rn.workers.dev

## Model

`MODEL` in `src/worker.js` is the single source of truth. A client-supplied `model`
is ignored, so swapping models means editing this worker and redeploying it — no site
deploy needed, and stale/cached pages pinned to an old model keep working.

## Allowed origins

`ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_PATTERNS` in `src/worker.js` gate who may spend the
Anthropic quota: `rcitutoring.com`, `www.rcitutoring.com`, `*.rci-tutoring.pages.dev`
previews and localhost. Anything else — including a request with no `Origin` header —
gets `403 Origin not allowed`. Add a new site here before pointing it at this worker.

Note this stops other websites from embedding the tutor; it does not stop a scripted
client that forges an `Origin` header. Add Cloudflare Rate Limiting on the worker route
if abuse becomes a concern.

## Commands

```bash
cd proxy
npm install
npx wrangler deploy                      # deploy
npx wrangler secret put ANTHROPIC_API_KEY # set/rotate the API key
npx wrangler tail rci-tutor-proxy         # live logs
```
