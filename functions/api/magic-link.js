/**
 * POST /api/magic-link
 *
 * Sends a magic sign-in link to the user's email.
 * Works for both verified and unverified users (passwordless registration flow).
 * Rate limited: max 1 request per 2 minutes per email.
 */

import { jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

function generateToken() {
  var bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
}

async function sendMagicLinkEmail(env, to, nombre, lang, magicUrl) {
  var apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[EMAIL] Resend API key not set — skipping magic link email to:', to);
    return { skipped: true };
  }

  var fromEmail = env.EMAIL_FROM || 'RCI Tutoring <noreply@rcitutoring.com>';
  var name = (nombre ? nombre.split(' ')[0] : '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  var templates = {
    es: {
      subject: 'Tu enlace de acceso — RCI Tutoring',
      html: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
        '<h2 style="color:#1e40af;">\u00a1Hola ' + name + '!</h2>' +
        '<p>Recibimos tu solicitud de acceso a <strong>RCI Tutoring</strong>. Haz clic en el bot\u00f3n para iniciar sesi\u00f3n instant\u00e1neamente:</p>' +
        '<p style="text-align:center;margin:30px 0;"><a href="' + magicUrl + '" style="background:linear-gradient(135deg,#6366f1,#3b82f6);color:#fff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;font-size:16px;">\u2728 Iniciar sesi\u00f3n</a></p>' +
        '<p style="color:#64748b;font-size:0.85rem;">Si no puedes hacer clic en el bot\u00f3n, copia y pega este enlace en tu navegador:</p>' +
        '<p style="color:#64748b;font-size:0.8rem;word-break:break-all;">' + magicUrl + '</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">Este enlace expira en 24 horas y solo puede usarse una vez.</p>' +
        '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />' +
        '<p style="color:#94a3b8;font-size:0.75rem;">Si no solicitaste este enlace, puedes ignorar este email. Tu cuenta est\u00e1 segura.</p>' +
        '</div>'
    },
    en: {
      subject: 'Your sign-in link — RCI Tutoring',
      html: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
        '<h2 style="color:#1e40af;">Hi ' + name + '!</h2>' +
        '<p>We received your sign-in request for <strong>RCI Tutoring</strong>. Click the button below to sign in instantly:</p>' +
        '<p style="text-align:center;margin:30px 0;"><a href="' + magicUrl + '" style="background:linear-gradient(135deg,#6366f1,#3b82f6);color:#fff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;font-size:16px;">\u2728 Sign in</a></p>' +
        '<p style="color:#64748b;font-size:0.85rem;">If you can\'t click the button, copy and paste this link into your browser:</p>' +
        '<p style="color:#64748b;font-size:0.8rem;word-break:break-all;">' + magicUrl + '</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">This link expires in 24 hours and can only be used once.</p>' +
        '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />' +
        '<p style="color:#94a3b8;font-size:0.75rem;">If you didn\'t request this link, you can ignore this email. Your account is safe.</p>' +
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

export async function onRequestPost(context) {
  var env = context.env;

  try {
    var body = await context.request.json();
    var email = body.email;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Email inv\u00e1lido', error_en: 'Invalid email' }, 400);
    }

    var normalizedEmail = email.toLowerCase().trim();

    // Find user
    var user = await env.DB.prepare(
      'SELECT id, nombre, email, idioma, email_verified, magic_token_expires FROM users WHERE email = ?'
    ).bind(normalizedEmail).first();

    if (!user) {
      // Don't reveal if user exists or not — return success anyway
      return jsonResponse({
        success: true,
        message: 'Si existe una cuenta con ese email, recibir\u00e1s un enlace de acceso.',
        message_en: 'If an account exists with that email, you will receive a sign-in link.'
      });
    }

    // Allow both verified and unverified users to request magic links
    // (unverified users registered via passwordless flow need magic links to verify + log in)

    // Rate limit: check if last magic token was created less than 2 minutes ago
    if (user.magic_token_expires) {
      var expiresAt = new Date(user.magic_token_expires);
      // Token expires 24h after creation, so creation = expires - 24h
      var createdAt = new Date(expiresAt.getTime() - 24 * 60 * 60 * 1000);
      var now = new Date();
      var minutesSinceCreation = (now.getTime() - createdAt.getTime()) / (1000 * 60);
      if (minutesSinceCreation < 2) {
        // Return same opaque response to prevent email enumeration via rate limit timing
        console.log('[MAGIC] Rate limited magic link request for:', normalizedEmail);
        return jsonResponse({
          success: true,
          message: 'Si existe una cuenta con ese email, recibir\u00e1s un enlace de acceso.',
          message_en: 'If an account exists with that email, you will receive a sign-in link.'
        });
      }
    }

    // Generate magic token (24 hour expiration)
    var magicToken = generateToken();
    var now2 = new Date();
    var tokenExpires = new Date(now2.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    await env.DB.prepare(
      "UPDATE users SET magic_token = ?, magic_token_expires = ?, updated_at = datetime('now') WHERE id = ?"
    ).bind(magicToken, tokenExpires.toISOString(), user.id).run();

    // Send magic link email
    var appUrl = env.APP_URL || 'https://rcitutoring.com';
    var magicUrl = appUrl + '/verify-magic.html?token=' + magicToken;
    var lang = body.lang || user.idioma || 'es';
    var emailResult = await sendMagicLinkEmail(env, user.email, user.nombre, lang, magicUrl);

    if (emailResult.error || emailResult.skipped) {
      console.error('[MAGIC] Magic link email not sent for:', user.email, emailResult);
      // Clear token so user isn't rate-limited on retry
      await env.DB.prepare(
        "UPDATE users SET magic_token = NULL, magic_token_expires = NULL, updated_at = datetime('now') WHERE id = ?"
      ).bind(user.id).run();
      return jsonResponse({
        success: false,
        error: 'No se pudo enviar el email. Intenta de nuevo.',
        error_en: 'Could not send email. Please try again.'
      }, 500);
    }

    return jsonResponse({
      success: true,
      message: 'Enlace de acceso enviado a tu email.',
      message_en: 'Sign-in link sent to your email.'
    });

  } catch (err) {
    console.error('Magic link error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
