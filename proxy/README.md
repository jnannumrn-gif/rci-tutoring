# RCI Tutor Proxy

Cloudflare Worker that proxies AI Tutor chat requests to the Anthropic API, keeping
`ANTHROPIC_API_KEY` server-side and adding CORS headers.

Deployed at: https://rci-tutor-proxy.jnannum-rn.workers.dev

## Model

`MODEL` in `src/worker.js` is the single source of truth. A client-supplied `model`
is ignored, so swapping models means editing this worker and redeploying it — no site
deploy needed, and stale/cached pages pinned to an old model keep working.

## Commands

```bash
cd proxy
npm install
npx wrangler deploy                      # deploy
npx wrangler secret put ANTHROPIC_API_KEY # set/rotate the API key
npx wrangler tail rci-tutor-proxy         # live logs
```
