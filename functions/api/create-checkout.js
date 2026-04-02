/**
 * POST /api/create-checkout
 *
 * Creates a Stripe Checkout Session for the authenticated user.
 * Expects JSON body: { plan: "monthly" | "monthly_latam" | "lifetime" | "lifetime_latam" | "human_session" }
 *
 * Returns: { url: "https://checkout.stripe.com/..." }
 */

import { verifyJWT, extractToken, jsonResponse, corsHeaders } from './_shared/auth.js';

// Price IDs from Stripe Dashboard (test mode)
// Launch pricing (until June 30, 2026)
const PRICE_MAP_LAUNCH = {
  monthly:        'price_1THAsICPTBMEWNnkBreOkbJZ',   // $19.00/month
  monthly_latam:  'price_1THB6TCPTBMEWNnkaiUJLEp5',   // $5.00/month
  lifetime:       'price_1THPBDCPTBMEWNnkHFyxrkR8',   // $59.00 one-time
  lifetime_latam: 'price_1THPRXCPTBMEWNnkAjhgTa8q',   // $19.00 one-time
  human_session:  'price_1THqmJCPTBMEWNnkrvEFolaP',   // $49.00 one-time per session
};

// Regular pricing (July 1, 2026 onwards)
const PRICE_MAP_REGULAR = {
  monthly:        'price_1THXL3CPTBMEWNnkF0aQ3ezS',   // $29.00/month
  monthly_latam:  'price_1THXL9CPTBMEWNnkfUJPCd6y',   // $9.00/month
  lifetime:       'price_1THXLECPTBMEWNnkqwobHtWQ',   // $99.00 one-time
  lifetime_latam: 'price_1THXLJCPTBMEWNnk55ASU0iO',   // $39.00 one-time
  human_session:  'price_1THqmJCPTBMEWNnkrvEFolaP',   // $49.00 one-time per session
};

// Cutover date: July 1, 2026 00:00 UTC
const REGULAR_PRICING_DATE = new Date('2026-07-01T00:00:00Z');

function getPriceMap() {
  return new Date() >= REGULAR_PRICING_DATE ? PRICE_MAP_REGULAR : PRICE_MAP_LAUNCH;
}

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
  const priceId = getPriceMap()[plan];
  if (!priceId) {
    return jsonResponse({ error: 'Invalid plan. Valid: monthly, monthly_latam, lifetime, lifetime_latam, human_session' }, 400);
  }

  // Determine mode based on price type
  const isRecurring = plan.startsWith('monthly');
  const isHumanSession = plan === 'human_session';
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
  const params = new URLSearchParams({
    'customer': customerId,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'mode': mode,
    'billing_address_collection': 'required',
    'success_url': `${appUrl}/dashboard.html?payment=success`,
    'cancel_url': `${appUrl}/upgrade.html?payment=cancelled`,
    'metadata[rci_user_id]': user.id,
    'metadata[plan]': plan,
  });

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
