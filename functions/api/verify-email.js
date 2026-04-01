/**
 * GET /api/verify-email?token=XXX
 *
 * Verifies a user's email address using the token sent during registration.
 * On success, marks email as verified and starts the 7-day trial.
 */

import { createJWT, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const { env, request } = context;

  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return jsonResponse({ error: 'Token de verificación requerido', error_en: 'Verification token required' }, 400);
    }

    // Find user with this verification token
    const user = await env.DB.prepare(
      'SELECT id, nombre, email, idioma, email_verified, email_verify_token, email_verify_expires FROM users WHERE email_verify_token = ?'
    ).bind(token).first();

    if (!user) {
      return jsonResponse({ error: 'Token inválido o ya utilizado', error_en: 'Invalid or already used token' }, 400);
    }

    // Check if already verified
    if (user.email_verified === 1) {
      return jsonResponse({ success: true, already_verified: true });
    }

    // Check token expiration
    const now = new Date();
    const expires = new Date(user.email_verify_expires);
    if (now > expires) {
      return jsonResponse({ error: 'Token expirado. Solicita uno nuevo.', error_en: 'Token expired. Request a new one.' }, 410);
    }

    // Mark email as verified and start trial
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 7);

    await env.DB.prepare(`
      UPDATE users
      SET email_verified = 1,
          email_verify_token = NULL,
          email_verify_expires = NULL,
          trial_start_date = ?,
          trial_end_date = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).bind(now.toISOString(), trialEnd.toISOString(), user.id).run();

    // Create JWT so user can be auto-logged in
    const jwtSecret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
    const jwtToken = await createJWT(
      { sub: user.id, email: user.email, nombre: user.nombre },
      jwtSecret
    );

    return jsonResponse({
      success: true,
      token: jwtToken,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        idioma: user.idioma,
        status: 'trial',
        email_verified: true
      }
    });

  } catch (err) {
    console.error('Verify email error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
