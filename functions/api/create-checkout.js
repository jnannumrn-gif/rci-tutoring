/**
 * POST /api/create-checkout
 *
 * Creates a Stripe Checkout Session for the authenticated user.
 * Expects JSON body: { plan: "monthly" | "quarterly" | "human_session" | "human_session_deposit" }
 *
 * Returns: { url: "https://checkout.stripe.com/..." }
 */

import { verifyJWT, extractToken, jsonResponse, corsHeaders } from './_shared/auth.js';

// Price IDs from Stripe Dashboard (live mode).
// One global price per plan — no regional tiers, no date-based cutover.
const PRICE_MAP = {
  monthly:               'price_1TLt4a2IMKtbUPVgQ4dEYOH6',   // $19.00/month
  quarterly:             'price_1U5uqw2IMKtbUPVgRF0OPoHc',   // $45.00 every 3 months
  human_session:         'price_1TLt4p2IMKtbUPVgWcCppinY',   // $49.00 one-time per session (full price)
  human_session_deposit: 'price_1TLtU42IMKtbUPVgGr668rR4',   // $20.00 one-time deposit (deducted from $49 total)
};

const RECURRING_PLANS = ['monthly', 'quarterly'];

export async function onRequestPost(context) {
  const { request, env } = context;

  // Authenticate user
  const token = extractToken(request);
  if (!token) {
    return jsonResponse({ error: 'Not authenticated' }, 401);
  }

  const secret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
  const payload = await verifyJWT(token, secret);
  if (!payload) {
    return jsonResponse({ error: 'Invalid or expired token' }, 401);
  }

  // Parse request body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400);
  }

  const { plan } = body;
  const priceId = PRICE_MAP[plan];
  if (!priceId) {
    return jsonResponse({ error: 'Invalid plan. Valid: monthly, quarterly, human_session, human_session_deposit' }, 400);
  }

  // Determine mode based on price type
  const isRecurring = RECURRING_PLANS.includes(plan);
  const isDeposit = plan === 'human_session_deposit';
  const mode = isRecurring ? 'subscription' : 'payment';

  // Get or create Stripe customer
  const stripeKey = env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return jsonResponse({ error: 'Stripe not configured' }, 500);
  }

  const user = await env.DB.prepare('SELECT id, email, nombre, stripe_customer_id FROM users WHERE id = ?')
    .bind(payload.sub)
    .first();

  if (!user) {
    return jsonResponse({ error: 'User not found' }, 404);
  }

  let customerId = user.stripe_customer_id;

  // Create Stripe customer if one doesn't exist yet
  if (!customerId) {
    const customerRes = await fetch('https://api.stripe.com/v1/customers', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        email: user.email,
        name: user.nombre,
        'metadata[rci_user_id]': user.id,
      }),
    });

    if (!customerRes.ok) {
      const err = await customerRes.text();
      console.error('[STRIPE] Customer creation error:', err);
      return jsonResponse({ error: 'Failed to create Stripe customer' }, 500);
    }

    const customer = await customerRes.json();
    customerId = customer.id;

    // Save Stripe customer ID to DB
    await env.DB.prepare('UPDATE users SET stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?')
      .bind(customerId, new Date().toISOString(), user.id)
      .run();
  }

  // Create Checkout Session
  const appUrl = env.APP_URL || 'https://rcitutoring.com';
  const successUrl = isDeposit
    ? `${appUrl}/dashboard.html?payment=deposit_success`
    : `${appUrl}/dashboard.html?payment=success`;

  const params = new URLSearchParams({
    'customer': customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'mode': mode,
    'billing_address_collection': 'required',
    'success_url': successUrl,
    'cancel_url': `${appUrl}/upgrade.html?payment=cancelled`,
    'metadata[rci_user_id]': user.id,
    'metadata[plan]': plan,
  });

  // For deposits, add metadata to track the remaining balance
  if (isDeposit) {
    params.set('metadata[payment_type]', 'deposit');
    params.set('metadata[deposit_amount]', '2000');    // $20.00 in cents
    params.set('metadata[total_amount]', '4900');      // $49.00 in cents
    params.set('metadata[remaining_amount]', '2900');  // $29.00 in cents
  }

  const sessionRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${stripeKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    console.error('[STRIPE] Checkout session error:', err);
    return jsonResponse({ error: 'Failed to create checkout session' }, 500);
  }

  const session = await sessionRes.json();

  return jsonResponse({ url: session.url });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}
