# Testing RCI Tutoring App

## Overview
RCI Tutoring is a static site on Cloudflare Pages (branch: `init`) with Cloudflare Functions for API endpoints (registration, email cron). Emails are sent via Resend (Amazon SES backend).

## Devin Secrets Needed
- `RESEND_API_KEY` — Send-only API key for Resend (cannot list/read emails)
- `CLOUDFLARE_API_TOKEN` — For managing DNS records and Workers

## Site Access
- **Production**: https://rcitutoring.com
- **Registration page**: https://rcitutoring.com/register.html (no auth gate)
- **Main site**: Protected by `auth-gate.js` — requires a password (SHA-256 hashed). The registration and login pages do NOT have the auth gate.
- **Deploy**: Push to `init` branch triggers Cloudflare Pages deploy automatically.

## Testing Registration Flow
1. Navigate to `https://rcitutoring.com/register.html`
2. Fill in: Nombre, Email, Contraseña (min 8 chars), País (required)
3. Click "Crear cuenta gratuita"
4. Success: Page shows "¡Revisa tu email!" with the email address
5. A verification email is sent via Resend from `noreply@rcitutoring.com`

## Testing Email Delivery
- The Resend API key is **send-only** — you cannot list or read sent emails
- To test email sending, use the Resend API directly:
  ```bash
  curl -X POST "https://api.resend.com/emails" \
    -H "Authorization: Bearer $RESEND_API_KEY" \
    -H "Content-Type: application/json" \
    --data '{"from": "RCI Tutoring <noreply@rcitutoring.com>", "to": ["test@example.com"], "subject": "Test", "html": "<p>Test</p>"}'
  ```
- Success response: `{"id": "..."}`
- You cannot verify inbox delivery directly — ask the user to check their inbox

## Testing DNS / Email Authentication
- SPF record should include both `_spf.google.com` and `amazonses.com`
- Verify via Cloudflare API:
  ```bash
  curl -s "https://api.cloudflare.com/client/v4/zones/7b0d2937b68ce0e8207bc8a6258fdc7c/dns_records?type=TXT&name=rcitutoring.com" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN"
  ```
- DKIM records are managed by Resend (CNAME records)
- DMARC record: `v=DMARC1; p=none;`

## Testing Domain Redirects
- `rci-tutoring.com` and `www.rci-tutoring.com` redirect to `rcitutoring.com` via Cloudflare Worker
- Test with curl: `curl -sI https://rci-tutoring.com` should return HTTP 301 with `location: https://rcitutoring.com/`
- Or test in browser — URL bar should change to `rcitutoring.com`

## Email Template Gotchas
- AOL/Yahoo Mail does NOT support CSS `linear-gradient` — always use `background-color` with solid colors for email buttons
- Use `color:#ffffff` instead of `color:#fff` for broader email client compatibility
- Email templates are in `functions/api/register.js` (verification) and `functions/api/cron-emails.js` (drip sequence)

## Cloudflare Zone IDs
- `rcitutoring.com`: `7b0d2937b68ce0e8207bc8a6258fdc7c`
- `rci-tutoring.com`: `df6125e0faf4e202c9f670d0c7aab7b7`
- Account ID: `854aab207a73dde863412e20220ba220`
