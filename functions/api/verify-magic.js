/**
 * GET /api/verify-magic?token=XXX
 *
 * Verifies a magic sign-in token and logs the user in.
 * The token is single-use and expires after 24 hours.
 */

import { createJWT, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet(context) {
  var env = context.env;

  try {
    var url = new URL(context.request.url);
    var token = url.searchParams.get('token');

    if (!token) {
      return jsonResponse({
        error: 'Token de acceso requerido',
        error_en: 'Sign-in token required'
      }, 400);
    }

    // Find user with this magic token
    var user = await env.DB.prepare(
      'SELECT id, nombre, email, idioma, trial_end_date, status, email_verified, magic_token_expires FROM users WHERE magic_token = ?'
    ).bind(token).first();

    if (!user) {
      return jsonResponse({
        error: 'Enlace inv\u00e1lido o ya utilizado.',
        error_en: 'Invalid or already used link.'
      }, 400);
    }

    // Check token expiration
    var now = new Date();
    var expires = new Date(user.magic_token_expires);
    if (now > expires) {
      // Clear expired token
      await env.DB.prepare(
        "UPDATE users SET magic_token = NULL, magic_token_expires = NULL, updated_at = datetime('now') WHERE id = ?"
      ).bind(user.id).run();

      return jsonResponse({
        error: 'Enlace expirado. Solicita uno nuevo.',
        error_en: 'Link expired. Request a new one.',
        expired: true
      }, 410);
    }

    // Atomically invalidate token AND verify email (single-use) — only clears if token still matches,
    // preventing a race condition where two concurrent requests both consume the same token.
    // Also sets email_verified = 1 for new registrations (passwordless flow).
    var consume = await env.DB.prepare(
      "UPDATE users SET magic_token = NULL, magic_token_expires = NULL, email_verified = 1, updated_at = datetime('now') WHERE id = ? AND magic_token = ?"
    ).bind(user.id, token).run();

    if (!consume.meta.changes) {
      // Another request already consumed this token
      return jsonResponse({
        error: 'Enlace inv\u00e1lido o ya utilizado.',
        error_en: 'Invalid or already used link.'
      }, 400);
    }

    // If this was a new registration (first magic link click), reset trial dates to start now
    if (user.email_verified === 0) {
      var trialStart = now;
      var trialEnd = new Date(now);
      trialEnd.setDate(trialEnd.getDate() + 7);
      await env.DB.prepare(
        "UPDATE users SET trial_start_date = ?, trial_end_date = ?, updated_at = datetime('now') WHERE id = ?"
      ).bind(trialStart.toISOString(), trialEnd.toISOString(), user.id).run();
      user.trial_end_date = trialEnd.toISOString();
    }

    // Check and update trial status if expired
    var status = user.status;
    if (status === 'trial') {
      var trialEndDate = new Date(user.trial_end_date);
      if (now >= trialEndDate) {
        await env.DB.prepare(
          "UPDATE users SET status = 'expired', updated_at = datetime('now') WHERE id = ?"
        ).bind(user.id).run();
        status = 'expired';
      }
    }

    // Create JWT
    var jwtSecret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
    var jwtToken = await createJWT(
      { sub: user.id, email: user.email, nombre: user.nombre },
      jwtSecret
    );

    var headers = new Headers({
      'Content-Type': 'application/json',
      ...corsHeaders()
    });
    headers.append('Set-Cookie', 'rci_token=' + jwtToken + '; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=' + (7 * 86400));

    return new Response(JSON.stringify({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        idioma: user.idioma,
        status: status,
        trial_end: user.trial_end_date,
        email_verified: true
      }
    }), { status: 200, headers: headers });

  } catch (err) {
    console.error('Verify magic link error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
