/**
 * POST /api/billing-portal
 *
 * Creates a Stripe Billing Portal session so the authenticated user can switch
 * between the monthly and quarterly plans, update the card or cancel.
 *
 * Returns: { url: "https://billing.stripe.com/..." }
 */

import { verifyJWT, extractToken, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = extractToken(request);
  if (!token) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const secret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
  const payload = await verifyJWT(token, secret);
  if (!payload) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500);
  }

  const user = await env.DB.prepare('SELECT id, stripe_customer_id FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  if (!user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  // A customer only exists once the user has gone through Checkout at least once.
  if (!user.stripe_customer_id) {
    return jsonResponse({
      error: 'no_billing_account',
      message: 'Todavia no tienes pagos registrados. Elige un plan para empezar.',
    }, 404);
  }

  const appUrl = env.APP_URL || 'https://rcitutoring.com';
  const portalRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      customer: user.stripe_customer_id,
      return_url: `${appUrl}/dashboard.html`,
    }),
  });

  if (!portalRes.ok) {
    const err = await portalRes.text();
    console.error('[STRIPE] Billing portal error:', err);
    return jsonResponse({ error: 'Failed to open billing portal' }, 500);
  }

  const session = await portalRes.json();
  return jsonResponse({ url: session.url });
}
