# RCI Tutor Proxy

Cloudflare Worker that proxies AI Tutor chat requests to the Anthropic API, keeping
`ANTHROPIC_API_KEY` server-side and adding CORS headers.

Deployed at: https://rci-tutor-proxy.jnannum-rn.workers.dev

## Model

`DEFAULT_MODEL` in `src/worker.js` is the single source of truth. The tutor pages
(`tutoring/{ccht,cna,hha}/ai/index.html`) omit `model` in their request body, so
swapping models means editing this worker and redeploying it — no site deploy needed.

## Commands

```bash
cd proxy
npm install
npx wrangler deploy                      # deploy
npx wrangler secret put ANTHROPIC_API_KEY # set/rotate the API key
npx wrangler tail rci-tutor-proxy         # live logs
```
