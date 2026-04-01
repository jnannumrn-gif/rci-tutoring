/**
 * POST /api/resend-verification
 *
 * Resends the email verification link to the authenticated user.
 * Rate limited: max 1 resend per 2 minutes.
 */

import { verifyJWT, extractToken, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestPost(context) {
  var env = context.env;
  var request = context.request;

  try {
    // Allow both JWT auth and email-based resend
    var userId = null;
    var userEmail = null;

    var token = extractToken(request);
    if (token) {
      var jwtSecret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
      var payload = await verifyJWT(token, jwtSecret);
      if (payload) {
        userId = payload.sub;
      }
    }

    // Also accept email in body for users who don't have a token yet
    if (!userId) {
      try {
        var body = await request.json();
        userEmail = body.email;
      } catch (e) {
        // No body or invalid JSON
      }
    }

    if (!userId && !userEmail) {
      return jsonResponse({ error: 'Autenticación requerida o email necesario', error_en: 'Authentication required or email needed' }, 401);
    }

    // Find user
    var user;
    if (userId) {
      user = await env.DB.prepare(
        'SELECT id, nombre, email, idioma, email_verified, email_verify_expires FROM users WHERE id = ?'
      ).bind(userId).first();
    } else {
      user = await env.DB.prepare(
        'SELECT id, nombre, email, idioma, email_verified, email_verify_expires FROM users WHERE email = ?'
      ).bind(userEmail.toLowerCase().trim()).first();
    }

    if (!user) {
      return jsonResponse({ error: 'Usuario no encontrado', error_en: 'User not found' }, 404);
    }

    if (user.email_verified === 1) {
      return jsonResponse({ error: 'Email ya verificado', error_en: 'Email already verified' }, 400);
    }

    // Rate limit: check if last token was created less than 2 minutes ago
    if (user.email_verify_expires) {
      var expiresAt = new Date(user.email_verify_expires);
      // Token expires 24h after creation, so creation = expires - 24h
      var createdAt = new Date(expiresAt.getTime() - 24 * 60 * 60 * 1000);
      var now = new Date();
      var minutesSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60);
      if (minutesSinceCreation < 2) {
        var waitSeconds = Math.ceil((2 - minutesSinceCreation) * 60);
        return jsonResponse({
          error: 'Espera ' + waitSeconds + ' segundos antes de reenviar',
          error_en: 'Wait ' + waitSeconds + ' seconds before resending',
          retry_after: waitSeconds
        }, 429);
      }
    }

    // Generate new verification token
    var verifyToken = generateToken();
    var now2 = new Date();
    var expiresAt2 = new Date(now2.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    await env.DB.prepare(
      "UPDATE users SET email_verify_token = ?, email_verify_expires = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(verifyToken, expiresAt2.toISOString(), user.id).run();

    // Send verification email
    var appUrl = env.APP_URL || 'https://rcitutoring.com';
    var verifyUrl = appUrl + '/verify-email.html?token=' + verifyToken;
    await sendVerificationEmail(env, user.email, user.nombre, user.idioma || 'es', verifyUrl);

    return jsonResponse({ success: true, message: 'Email de verificación reenviado' });

  } catch (err) {
    console.error('Resend verification error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}

function generateToken() {
  var bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function sendVerificationEmail(env, to, nombre, lang, verifyUrl) {
  var apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[EMAIL] Resend API key not set — skipping verification email to:', to);
    return { skipped: true };
  }

  var fromEmail = env.EMAIL_FROM || 'RCI Tutoring <noreply@rcitutoring.com>';
  var name = (nombre ? nombre.split(' ')[0] : '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  var templates = {
    es: {
      subject: 'Verifica tu email — RCI Tutoring',
      html: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
        '<h2 style="color:#1e40af;">\u00a1Hola ' + name + '!</h2>' +
        '<p>Gracias por registrarte en <strong>RCI Tutoring</strong>. Para activar tu cuenta y comenzar tu prueba gratuita de 7 d\u00edas, verifica tu email haciendo clic en el bot\u00f3n:</p>' +
        '<p style="text-align:center;margin:30px 0;"><a href="' + verifyUrl + '" style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;font-size:16px;">Verificar mi email</a></p>' +
        '<p style="color:#64748b;font-size:0.85rem;">Si no puedes hacer clic en el bot\u00f3n, copia y pega este enlace en tu navegador:</p>' +
        '<p style="color:#64748b;font-size:0.8rem;word-break:break-all;">' + verifyUrl + '</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">Este enlace expira en 24 horas.</p>' +
        '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />' +
        '<p style="color:#94a3b8;font-size:0.75rem;">Si no creaste una cuenta en RCI Tutoring, puedes ignorar este email.</p>' +
        '</div>'
    },
    en: {
      subject: 'Verify your email — RCI Tutoring',
      html: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
        '<h2 style="color:#1e40af;">Hi ' + name + '!</h2>' +
        '<p>Thanks for signing up for <strong>RCI Tutoring</strong>. To activate your account and start your 7-day free trial, verify your email by clicking the button below:</p>' +
        '<p style="text-align:center;margin:30px 0;"><a href="' + verifyUrl + '" style="background:linear-gradient(135deg,#1e40af,#3b82f6);color:#fff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;font-size:16px;">Verify my email</a></p>' +
        '<p style="color:#64748b;font-size:0.85rem;">If you can\'t click the button, copy and paste this link into your browser:</p>' +
        '<p style="color:#64748b;font-size:0.8rem;word-break:break-all;">' + verifyUrl + '</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">This link expires in 24 hours.</p>' +
        '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />' +
        '<p style="color:#94a3b8;font-size:0.75rem;">If you didn\'t create an account on RCI Tutoring, you can ignore this email.</p>' +
        '</div>'
    }
  };

  var template = templates[lang] || templates['es'];

  var res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [to],
      subject: template.subject,
      html: template.html
    })
  });

  if (!res.ok) {
    var err = await res.text();
    console.error('[EMAIL] Resend error:', res.status, err);
    return { error: true };
  }

  return await res.json();
}
