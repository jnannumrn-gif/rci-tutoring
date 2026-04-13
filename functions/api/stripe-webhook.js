/**
 * POST /api/stripe-webhook
 *
 * Handles Stripe webhook events.
 * On successful checkout, activates the user's subscription.
 *
 * Verifies the stripe-signature header using STRIPE_WEBHOOK_SECRET
 * to prevent forged events from activating accounts.
 */

import { corsHeaders } from './_shared/auth.js';

const encoder = new TextEncoder();

/**
 * Verify Stripe webhook signature using Web Crypto API.
 */
async function verifyStripeSignature(rawBody, signatureHeader, webhookSecret) {
  if (!signatureHeader || !webhookSecret) return false;

  const parts = {};
  signatureHeader.split(',').forEach(function(item) {
    const [key, value] = item.split('=');
    parts[key] = value;
  });

  const timestamp = parts['t'];
  const signature = parts['v1'];
  if (!timestamp || !signature) return false;

  // Reject events older than 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (isNaN(age) || age > 300) return false;

  // Compute expected signature: HMAC-SHA256 of "timestamp.rawBody"
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(webhookSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signedPayload = `${timestamp}.${rawBody}`;
  const expectedBytes = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const expectedHex = Array.from(new Uint8Array(expectedBytes))
    .map(function(b) { return b.toString(16).padStart(2, '0'); })
    .join('');

  // Timing-safe comparison
  if (expectedHex.length !== signature.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedHex.length; i++) {
    mismatch |= expectedHex.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders(),
  };

  // Read raw body first (needed for signature verification)
  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return new Response(JSON.stringify({ error: 'Could not read body' }), { status: 400, headers });
  }

  // Verify Stripe webhook signature
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET;
  const stripeSignature = request.headers.get('stripe-signature');

  if (!webhookSecret) {
    console.error('[WEBHOOK] STRIPE_WEBHOOK_SECRET not configured — rejecting request');
    return new Response(JSON.stringify({ error: 'Webhook not configured' }), { status: 500, headers });
  }

  const isValid = await verifyStripeSignature(rawBody, stripeSignature, webhookSecret);
  if (!isValid) {
    console.error('[WEBHOOK] Invalid signature — rejecting request');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401, headers });
  }

  // Parse the verified body
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers });
  }

  const type = event.type;
  console.log('[WEBHOOK] Verified event:', type);

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

        // Only activate if payment is confirmed (handles async payment methods)
        if (session.payment_status !== 'paid') {
          console.log('[WEBHOOK] Payment not yet completed for user:', userId, 'status:', session.payment_status);
          break;
        }

        console.log('[WEBHOOK] Checkout completed for user:', userId, 'plan:', plan);

        // --- Handle Human RN Session Deposit ---
        const paymentType = session.metadata?.payment_type;
        if (paymentType === 'deposit') {
          const depositAmount = parseInt(session.metadata?.deposit_amount || '2000', 10);
          const totalAmount = parseInt(session.metadata?.total_amount || '4900', 10);
          const remainingAmount = parseInt(session.metadata?.remaining_amount || '2900', 10);
          const now = new Date().toISOString();

          // Billing address cross-check (fraud detection)
          const depositBillingCountry = session.customer_details?.address?.country || null;
          let depositBillingFlag = 0;
          if (depositBillingCountry) {
            const depositUserRow = await env.DB.prepare(
              'SELECT pais FROM users WHERE id = ?'
            ).bind(userId).first();
            if (depositUserRow && depositUserRow.pais) {
              const normalize = (c) => (c || '').toUpperCase() === 'PR' ? 'US' : (c || '').toUpperCase();
              if (normalize(depositBillingCountry) !== normalize(depositUserRow.pais)) {
                depositBillingFlag = 1;
                console.log('[BILLING] Deposit country mismatch — declared:', depositUserRow.pais, 'billing:', depositBillingCountry, 'user:', userId);
              }
            }
            await env.DB.prepare(
              'UPDATE users SET billing_country = ?, billing_flag = ?, stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?'
            ).bind(depositBillingCountry, depositBillingFlag, customerId, now, userId).run();
          } else {
            await env.DB.prepare(
              'UPDATE users SET stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?'
            ).bind(customerId, now, userId).run();
          }

          // Create deposit booking record in subscriptions table
          // tier = 'human_session_deposit', active = 0 (not yet fully paid)
          const existingDeposit = await env.DB.prepare(
            'SELECT id FROM subscriptions WHERE user_id = ? AND tier = ?'
          ).bind(userId, 'human_session_deposit').first();

          if (existingDeposit) {
            await env.DB.prepare(
              'UPDATE subscriptions SET stripe_subscription_id = ?, start_date = ?, active = 0 WHERE id = ?'
            ).bind(session.payment_intent, now, existingDeposit.id).run();
          } else {
            await env.DB.prepare(
              'INSERT INTO subscriptions (user_id, stripe_subscription_id, tier, start_date, end_date, active) VALUES (?, ?, ?, ?, ?, 0)'
            ).bind(userId, session.payment_intent, 'human_session_deposit', now, null).run();
          }

          console.log('[WEBHOOK] Deposit of $' + (depositAmount / 100) + ' recorded for user:', userId, 'remaining: $' + (remainingAmount / 100));
          break;
        }

        // --- Billing address cross-check ---
        // Stripe provides customer_details.address.country on the checkout session
        const billingCountry = session.customer_details?.address?.country || null;

        let billingFlag = 0;
        if (billingCountry) {
          // Fetch user's declared country
          const userRow = await env.DB.prepare(
            'SELECT pais FROM users WHERE id = ?'
          ).bind(userId).first();

          if (userRow && userRow.pais) {
            // Puerto Rico (PR) maps to US billing, treat PR ↔ US as matching
            const normalize = (c) => (c || '').toUpperCase() === 'PR' ? 'US' : (c || '').toUpperCase();
            if (normalize(billingCountry) !== normalize(userRow.pais)) {
              billingFlag = 1;
              console.log('[BILLING] Country mismatch — declared:', userRow.pais, 'billing:', billingCountry, 'user:', userId);
            }
          }

          // Store billing country and flag
          await env.DB.prepare(
            'UPDATE users SET billing_country = ?, billing_flag = ?, updated_at = datetime(?) WHERE id = ?'
          ).bind(billingCountry, billingFlag, new Date().toISOString(), userId).run();
        }

        // Determine tier and dates
        const isLifetime = plan && plan.startsWith('lifetime');
        const isHumanSession = plan === 'human_session';
        const tier = plan || 'unknown';
        const now = new Date().toISOString();
        const endDate = isLifetime
          ? '2099-12-31T23:59:59Z'  // Lifetime = effectively never expires
          : isHumanSession
            ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString() // 90 days for human sessions
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days for monthly

        // Update user status to active
        await env.DB.prepare(
          'UPDATE users SET status = ?, stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?'
        ).bind('active', customerId, now, userId).run();

        // Create or update subscription record (exclude deposit records)
        const existingSub = await env.DB.prepare(
          'SELECT id FROM subscriptions WHERE user_id = ? AND tier != ?'
        ).bind(userId, 'human_session_deposit').first();

        if (existingSub) {
          await env.DB.prepare(
            'UPDATE subscriptions SET stripe_subscription_id = ?, tier = ?, start_date = ?, end_date = ?, active = 1 WHERE id = ?'
          ).bind(session.subscription || session.payment_intent, tier, now, endDate, existingSub.id).run();
        } else {
          await env.DB.prepare(
            'INSERT INTO subscriptions (user_id, stripe_subscription_id, tier, start_date, end_date, active) VALUES (?, ?, ?, ?, ?, 1)'
          ).bind(userId, session.subscription || session.payment_intent, tier, now, endDate).run();
        }

        console.log('[WEBHOOK] User', userId, 'activated with plan:', tier);
        break;
      }

      case 'checkout.session.async_payment_succeeded': {
        // Handle deferred payment confirmation (bank transfers, SEPA, etc.)
        const asyncSession = event.data.object;
        const asyncUserId = asyncSession.metadata?.rci_user_id;
        const asyncPlan = asyncSession.metadata?.plan;
        const asyncCustomerId = asyncSession.customer;

        if (!asyncUserId) {
          console.error('[WEBHOOK] No rci_user_id in async payment metadata');
          break;
        }

        console.log('[WEBHOOK] Async payment succeeded for user:', asyncUserId, 'plan:', asyncPlan);

        const asyncNow = new Date().toISOString();

        // --- Handle deposit via async payment (SEPA, bank transfer, etc.) ---
        const asyncPaymentType = asyncSession.metadata?.payment_type;
        if (asyncPaymentType === 'deposit') {
          const asyncDepositAmount = parseInt(asyncSession.metadata?.deposit_amount || '2000', 10);
          const asyncRemainingAmount = parseInt(asyncSession.metadata?.remaining_amount || '2900', 10);

          // Billing address cross-check (fraud detection)
          const asyncDepositBillingCountry = asyncSession.customer_details?.address?.country || null;
          let asyncDepositBillingFlag = 0;
          if (asyncDepositBillingCountry) {
            const asyncDepositUserRow = await env.DB.prepare(
              'SELECT pais FROM users WHERE id = ?'
            ).bind(asyncUserId).first();
            if (asyncDepositUserRow && asyncDepositUserRow.pais) {
              const normalize = (c) => (c || '').toUpperCase() === 'PR' ? 'US' : (c || '').toUpperCase();
              if (normalize(asyncDepositBillingCountry) !== normalize(asyncDepositUserRow.pais)) {
                asyncDepositBillingFlag = 1;
                console.log('[BILLING] Async deposit country mismatch — declared:', asyncDepositUserRow.pais, 'billing:', asyncDepositBillingCountry, 'user:', asyncUserId);
              }
            }
            await env.DB.prepare(
              'UPDATE users SET billing_country = ?, billing_flag = ?, stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?'
            ).bind(asyncDepositBillingCountry, asyncDepositBillingFlag, asyncCustomerId, asyncNow, asyncUserId).run();
          } else {
            await env.DB.prepare(
              'UPDATE users SET stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?'
            ).bind(asyncCustomerId, asyncNow, asyncUserId).run();
          }

          // Create deposit booking record (active = 0, not yet fully paid)
          const asyncExistingDeposit = await env.DB.prepare(
            'SELECT id FROM subscriptions WHERE user_id = ? AND tier = ?'
          ).bind(asyncUserId, 'human_session_deposit').first();

          if (asyncExistingDeposit) {
            await env.DB.prepare(
              'UPDATE subscriptions SET stripe_subscription_id = ?, start_date = ?, active = 0 WHERE id = ?'
            ).bind(asyncSession.payment_intent, asyncNow, asyncExistingDeposit.id).run();
          } else {
            await env.DB.prepare(
              'INSERT INTO subscriptions (user_id, stripe_subscription_id, tier, start_date, end_date, active) VALUES (?, ?, ?, ?, ?, 0)'
            ).bind(asyncUserId, asyncSession.payment_intent, 'human_session_deposit', asyncNow, null).run();
          }

          console.log('[WEBHOOK] Async deposit of $' + (asyncDepositAmount / 100) + ' recorded for user:', asyncUserId, 'remaining: $' + (asyncRemainingAmount / 100));
          break;
        }

        // --- Regular async payment activation ---
        const asyncIsLifetime = asyncPlan && asyncPlan.startsWith('lifetime');
        const asyncIsHumanSession = asyncPlan === 'human_session';
        const asyncTier = asyncPlan || 'unknown';
        const asyncEndDate = asyncIsLifetime
          ? '2099-12-31T23:59:59Z'
          : asyncIsHumanSession
            ? new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

        await env.DB.prepare(
          'UPDATE users SET status = ?, stripe_customer_id = ?, updated_at = datetime(?) WHERE id = ?'
        ).bind('active', asyncCustomerId, asyncNow, asyncUserId).run();

        const asyncExistingSub = await env.DB.prepare(
          'SELECT id FROM subscriptions WHERE user_id = ? AND tier != ?'
        ).bind(asyncUserId, 'human_session_deposit').first();

        if (asyncExistingSub) {
          await env.DB.prepare(
            'UPDATE subscriptions SET stripe_subscription_id = ?, tier = ?, start_date = ?, end_date = ?, active = 1 WHERE id = ?'
          ).bind(asyncSession.subscription || asyncSession.payment_intent, asyncTier, asyncNow, asyncEndDate, asyncExistingSub.id).run();
        } else {
          await env.DB.prepare(
            'INSERT INTO subscriptions (user_id, stripe_subscription_id, tier, start_date, end_date, active) VALUES (?, ?, ?, ?, ?, 1)'
          ).bind(asyncUserId, asyncSession.subscription || asyncSession.payment_intent, asyncTier, asyncNow, asyncEndDate).run();
        }

        console.log('[WEBHOOK] User', asyncUserId, 'activated via async payment with plan:', asyncTier);
        break;
      }

      case 'checkout.session.async_payment_failed': {
        const failedSession = event.data.object;
        const failedUserId = failedSession.metadata?.rci_user_id;
        console.log('[WEBHOOK] Async payment failed for user:', failedUserId);
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
