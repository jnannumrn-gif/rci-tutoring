/**
 * POST /api/stripe-webhook
 *
 * Handles Stripe webhook events.
 * On successful checkout, activates the user's subscription.
 *
 * Note: For Phase 1 (test mode), we do basic signature-less verification.
 * Phase 2 will add full webhook signature verification with STRIPE_WEBHOOK_SECRET.
 */

import { corsHeaders } from './_shared/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(),
  };

  let event;
  try {
    event = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  // Phase 1: Basic event processing without signature verification
  // Phase 2: Add STRIPE_WEBHOOK_SECRET verification
  const stripeSignature = request.headers.get('stripe-signature');
  if (!stripeSignature) {
    console.warn('[WEBHOOK] No stripe-signature header — accepting in test mode');
  }

  const type = event.type;
  console.log('[WEBHOOK] Received event:', type);

  try {
    switch (type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.rci_user_id;
        const plan = session.metadata?.plan;
        const customerId = session.customer;

        if (!userId) {
          console.error('[WEBHOOK] No rci_user_id in session metadata');
          break;
        }

        console.log('[WEBHOOK] Checkout completed for user:', userId, 'plan:', plan);

        // Determine tier and dates
        const isLifetime = plan && plan.startsWith('lifetime');
        const tier = plan || 'unknown';
        const now = new Date().toISOString();
        const endDate = isLifetime
          ? '2099-12-31T23:59:59Z'  // Lifetime = effectively never expires
          : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days for monthly

        // Update user status to active
        await env.DB.prepare(
          'UPDATE users SET status = ?, stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?'
        ).bind('active', customerId, now, userId).run();

        // Create or update subscription record
        const existingSub = await env.DB.prepare(
          'SELECT id FROM subscriptions WHERE user_id = ?'
        ).bind(userId).first();

        if (existingSub) {
          await env.DB.prepare(
            'UPDATE subscriptions SET stripe_subscription_id = ?, tier = ?, start_date = ?, end_date = ?, active = 1 WHERE user_id = ?'
          ).bind(session.subscription || session.payment_intent, tier, now, endDate, userId).run();
        } else {
          await env.DB.prepare(
            'INSERT INTO subscriptions (user_id, stripe_subscription_id, tier, start_date, end_date, active) VALUES (?, ?, ?, ?, ?, 1)'
          ).bind(userId, session.subscription || session.payment_intent, tier, now, endDate).run();
        }

        console.log('[WEBHOOK] User', userId, 'activated with plan:', tier);
        break;
      }

      case 'customer.subscription.deleted': {
        // Handle subscription cancellation
        const subscription = event.data.object;
        const customerId = subscription.customer;

        // Find user by Stripe customer ID
        const user = await env.DB.prepare(
          'SELECT id FROM users WHERE stripe_customer_id = ?'
        ).bind(customerId).first();

        if (user) {
          await env.DB.prepare(
            'UPDATE users SET status = ?, updated_at = datetime(?) WHERE id = ?'
          ).bind('expired', new Date().toISOString(), user.id).run();

          await env.DB.prepare(
            'UPDATE subscriptions SET active = 0 WHERE user_id = ?'
          ).bind(user.id).run();

          console.log('[WEBHOOK] Subscription cancelled for user:', user.id);
        }
        break;
      }

      default:
        console.log('[WEBHOOK] Unhandled event type:', type);
    }
  } catch (err) {
    console.error('[WEBHOOK] Processing error:', err.message);
    return new Response(JSON.stringify({ error: 'Webhook processing failed' }), { status: 500, headers });
  }

  // Always return 200 to acknowledge receipt
  return new Response(JSON.stringify({ received: true }), { headers });
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}
