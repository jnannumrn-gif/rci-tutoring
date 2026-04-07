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
      subject: '\u00a1Bienvenido a RCI Tutoring! Accede a tu cuenta',
      html: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
        '<h2 style="color:#1e40af;">\u00a1Hola ' + name + '!</h2>' +
        '<p>Gracias por registrarte en <strong>RCI Tutoring</strong>. Haz clic en el bot\u00f3n para activar tu cuenta y comenzar tu prueba gratuita de 7 d\u00edas:</p>' +
        '<p style="text-align:center;margin:30px 0;"><a href="' + magicUrl + '" style="background:linear-gradient(135deg,#6366f1,#3b82f6);color:#fff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;font-size:16px;">\u2728 Acceder a mi cuenta</a></p>' +
        '<p style="color:#64748b;font-size:0.85rem;">Sin contrase\u00f1a necesaria \u2014 este enlace te da acceso instant\u00e1neo.</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">Si no puedes hacer clic en el bot\u00f3n, copia y pega este enlace en tu navegador:</p>' +
        '<p style="color:#64748b;font-size:0.8rem;word-break:break-all;">' + magicUrl + '</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">Este enlace expira en 24 horas y solo puede usarse una vez.</p>' +
        '<hr style="border:none;border-top:1px solid #e2e8f0;margin:20px 0;" />' +
        '<p style="color:#94a3b8;font-size:0.75rem;">Si no creaste una cuenta en RCI Tutoring, puedes ignorar este email.</p>' +
        '</div>'
    },
    en: {
      subject: 'Welcome to RCI Tutoring! Access your account',
      html: '<div style="font-family:Inter,Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;">' +
        '<h2 style="color:#1e40af;">Hi ' + name + '!</h2>' +
        '<p>Thanks for signing up for <strong>RCI Tutoring</strong>. Click the button below to activate your account and start your 7-day free trial:</p>' +
        '<p style="text-align:center;margin:30px 0;"><a href="' + magicUrl + '" style="background:linear-gradient(135deg,#6366f1,#3b82f6);color:#fff;padding:14px 28px;border-radius:12px;display:inline-block;font-weight:700;text-decoration:none;font-size:16px;">\u2728 Access my account</a></p>' +
        '<p style="color:#64748b;font-size:0.85rem;">No password needed \u2014 this link gives you instant access.</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">If you can\'t click the button, copy and paste this link into your browser:</p>' +
        '<p style="color:#64748b;font-size:0.8rem;word-break:break-all;">' + magicUrl + '</p>' +
        '<p style="color:#64748b;font-size:0.85rem;">This link expires in 24 hours and can only be used once.</p>' +
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

/**
 * Lookup the user's country via ipapi.co (free tier: 30k/month).
 * Returns { ip, country } or { ip: clientIp, country: null } on failure.
 */
async function lookupIpCountry(clientIp) {
  if (!clientIp) return { ip: null, country: null };
  try {
    const res = await fetch(`https://ipapi.co/${clientIp}/json/`, {
      headers: { 'User-Agent': 'RCITutoring/1.0' }
    });
    if (!res.ok) {
      console.error('[GEO] ipapi.co error:', res.status);
      return { ip: clientIp, country: null };
    }
    const data = await res.json();
    return { ip: clientIp, country: data.country_code || null };
  } catch (err) {
    console.error('[GEO] ipapi.co fetch failed:', err.message);
    return { ip: clientIp, country: null };
  }
}

export async function onRequestPost(context) {
  const { env } = context;

  try {
    const body = await context.request.json();
    const { nombre, email, pais, telefono, codigo_pais, rol, idioma } = body;

    // Validate required fields
    if (!nombre || nombre.trim().length < 2) {
      return jsonResponse({ error: 'Nombre es requerido (mín. 2 caracteres)', field: 'nombre' }, 400);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Email inválido', field: 'email' }, 400);
    }
    if (!pais) {
      return jsonResponse({ error: 'País es requerido', field: 'pais' }, 400);
    }

    // Check email uniqueness
    const existing = await env.DB.prepare(
      'SELECT id, email_verified FROM users WHERE email = ?'
    ).bind(email.toLowerCase().trim()).first();

    if (existing) {
      if (existing.email_verified === 0) {
        // User exists but hasn't verified — allow resending verification
        return jsonResponse({
          error: 'Este email ya está registrado pero no verificado. Revisa tu bandeja de entrada.',
          error_en: 'This email is already registered but not verified. Check your inbox.',
          field: 'email',
          needs_verification: true,
          email: email.toLowerCase().trim()
        }, 409);
      }
      return jsonResponse({ error: 'Este email ya está registrado', field: 'email' }, 409);
    }

    // IP geolocation check via ipapi.co
    const clientIp = context.request.headers.get('CF-Connecting-IP')
      || context.request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
      || null;
    const geo = await lookupIpCountry(clientIp);
    const ipCountry = geo.country; // e.g. "US", "HN", etc.

    // Determine if there is a country mismatch (geo_flag)
    // Puerto Rico (PR) maps to US IP, so treat PR ↔ US as matching
    const normalizeCountry = (c) => (c || '').toUpperCase() === 'PR' ? 'US' : (c || '').toUpperCase();
    const geoFlag = (ipCountry && pais && normalizeCountry(ipCountry) !== normalizeCountry(pais)) ? 1 : 0;

    if (geoFlag) {
      console.log('[GEO] Country mismatch — declared:', pais, 'IP country:', ipCountry, 'IP:', clientIp);
    }

    // Use placeholder trial dates (real dates set on verification)
    const now = new Date();
    const placeholderEnd = new Date(now);
    placeholderEnd.setDate(placeholderEnd.getDate() + 7);

    // Generate a random password hash (passwordless registration — users sign in via magic link)
    const randomBytes = crypto.getRandomValues(new Uint8Array(32));
    const placeholderHash = 'MAGIC_LINK_USER:' + Array.from(randomBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    // Generate magic token for instant access
    const magicToken = generateToken();
    const tokenExpires = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

    // Insert user (unverified) with geo data — no real password
    await env.DB.prepare(`
      INSERT INTO users
      (nombre, email, password_hash, telefono, codigo_pais, pais, rol, idioma,
       trial_start_date, trial_end_date, status, email_verified,
       magic_token, magic_token_expires,
       registration_ip, ip_country, geo_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial', 0, ?, ?, ?, ?, ?)
    `).bind(
      nombre.trim(),
      email.toLowerCase().trim(),
      placeholderHash,
      telefono || null,
      codigo_pais || null,
      pais,
      rol || null,
      idioma || 'es',
      now.toISOString(),
      placeholderEnd.toISOString(),
      magicToken,
      tokenExpires.toISOString(),
      clientIp || null,
      ipCountry || null,
      geoFlag
    ).run();

    // Send magic link email (verifies email + logs in when clicked)
    const appUrl = env.APP_URL || 'https://rcitutoring.com';
    const magicUrl = appUrl + '/verify-magic.html?token=' + magicToken;
    const emailResult = await sendMagicLinkEmail(env, email.toLowerCase().trim(), nombre.trim(), idioma || 'es', magicUrl);

    if (emailResult.error || emailResult.skipped) {
      console.error('[REGISTER] Magic link email not sent for:', email, emailResult);
      // Clear token so user isn't rate-limited on retry (consistent with magic-link.js)
      await env.DB.prepare(
        "UPDATE users SET magic_token = NULL, magic_token_expires = NULL, updated_at = datetime('now') WHERE email = ?"
      ).bind(email.toLowerCase().trim()).run();
    }

    return jsonResponse({
      success: true,
      needs_verification: true,
      email_sent: !(emailResult.error || emailResult.skipped),
      message: 'Cuenta creada. Revisa tu email para acceder a tu cuenta.',
      message_en: 'Account created. Check your email to access your account.'
    }, 201);

  } catch (err) {
    console.error('Register error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
