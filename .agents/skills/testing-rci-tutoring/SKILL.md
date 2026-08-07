# Testing RCI Tutoring

## Overview
RCI Tutoring is a Cloudflare Pages app with Pages Functions (serverless API). The frontend is static HTML/JS, the backend runs as Cloudflare Workers, and data is stored in Cloudflare D1 (SQLite).

## Devin Secrets Needed
- `CLOUDFLARE_API_TOKEN_FULL` — Cloudflare API token with D1 read/write permissions (used for DB queries and migrations)
- `STRIPE_SECRET_KEY` — Stripe test mode secret key
- `STRIPE_PUBLISHABLE_KEY` — Stripe test mode publishable key
- `STRIPE_WEBHOOK_SECRET` — Stripe webhook signing secret
- `RESEND_API_KEY` — Resend email API key

## Preview Deployments
- Each PR branch gets a preview URL at `https://<branch-slug>.rci-tutoring.pages.dev`
- Preview deployments share the **same D1 database** as production — be careful with test data
- The `APP_URL` env var defaults to `https://rcitutoring.com`, so verification emails will link to production URLs. When testing, grab tokens from D1 directly instead of clicking email links.

## D1 Database Access
The D1 database can be queried directly via the Cloudflare API:

```bash
curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/854aab207a73dde863412e20220ba220/d1/database/d4cbe54c-998d-49e0-bc4a-a4ce01d732e0/query" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN_FULL" \
  -H "Content-Type: application/json" \
  -d '{"sql": "SELECT * FROM users WHERE email = ?", "params": ["user@example.com"]}'
```

This is useful for:
- Retrieving email verification tokens (instead of checking a real inbox)
- Verifying DB state after operations (email_verified, trial dates, etc.)
- Running migrations (ALTER TABLE, UPDATE statements)
- Cleaning up test data after testing

## Testing Email Verification Flow
1. Register a new user on the preview deployment with a test email (e.g., `test-{timestamp}@devin-testing.com`)
2. The registration UI should show "check your email" state instead of auto-login
3. Query D1 to get the `email_verify_token` for the test user
4. Navigate to `/verify-email.html?token={token}` on the preview URL
5. Verify: success state appears, auto-redirect to dashboard, trial banner shows 7 days
6. Query D1 to confirm: `email_verified=1`, `email_verify_token=NULL`, trial dates set

## Testing Login Blocking
- After registration (before verification), try logging in — should see yellow banner "Tu email no ha sido verificado"
- After verification, login should work normally and redirect to dashboard

## Testing Invalid/Expired Tokens
- Navigate to `/verify-email.html?token=invalid_fake_token` — should show red error state
- For expired tokens: the token expiration is 24 hours, so this is hard to test in real-time. Verify the expiration check logic in code review.

## Key Pages
- `/register.html` — Registration with email verification
- `/login.html` — Login with unverified user blocking
- `/verify-email.html` — Email verification landing page
- `/dashboard.html` — Main dashboard (blocks unverified users)
- `/upgrade.html` — Stripe checkout integration

## Bilingual Support
The app supports ES (Spanish) and EN (English). Toggle is in the top-right corner. All UI messages and emails are bilingual. Test both languages when relevant.

## Common Issues
- Cookie banner may block interactions — dismiss it first or clear `cookieConsent` from localStorage
- Browser autocomplete dropdowns may interfere with form filling — press Escape to dismiss
- The `browser_console` tool may not work if Chrome isn't properly focused — use DevTools keyboard shortcut (Ctrl+Shift+J) and type directly in the console instead
- Preview deployments use the same D1 as production — clean up test users after testing if needed
