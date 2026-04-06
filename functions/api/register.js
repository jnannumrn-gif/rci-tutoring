import { hashPassword, createJWT, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
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
        '<p style="color:#64748b;font-size:0.85rem;">Este enlace expira en 72 horas.</p>' +
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
        '<p style="color:#64748b;font-size:0.85rem;">This link expires in 72 hours.</p>' +
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
    const { nombre, email, password, pais, telefono, codigo_pais, rol, idioma } = body;

    // Validate required fields
    if (!nombre || nombre.trim().length < 2) {
      return jsonResponse({ error: 'Nombre es requerido (mín. 2 caracteres)', field: 'nombre' }, 400);
    }
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return jsonResponse({ error: 'Email inválido', field: 'email' }, 400);
    }
    if (!password || password.length < 8) {
      return jsonResponse({ error: 'Contraseña debe tener mínimo 8 caracteres', field: 'password' }, 400);
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

    // Hash password
    const passwordHash = await hashPassword(password);

    // Generate verification token
    const verifyToken = generateToken();
    const tokenExpires = new Date(now.getTime() + 72 * 60 * 60 * 1000); // 72 hours

    // Insert user (unverified) with geo data
    await env.DB.prepare(`
      INSERT INTO users
      (nombre, email, password_hash, telefono, codigo_pais, pais, rol, idioma,
       trial_start_date, trial_end_date, status, email_verified, email_verify_token, email_verify_expires,
       registration_ip, ip_country, geo_flag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial', 0, ?, ?, ?, ?, ?)
    `).bind(
      nombre.trim(),
      email.toLowerCase().trim(),
      passwordHash,
      telefono || null,
      codigo_pais || null,
      pais,
      rol || null,
      idioma || 'es',
      now.toISOString(),
      placeholderEnd.toISOString(),
      verifyToken,
      tokenExpires.toISOString(),
      clientIp || null,
      ipCountry || null,
      geoFlag
    ).run();

    // Send verification email
    const appUrl = env.APP_URL || 'https://rcitutoring.com';
    const verifyUrl = appUrl + '/verify-email.html?token=' + verifyToken;
    const emailResult = await sendVerificationEmail(env, email.toLowerCase().trim(), nombre.trim(), idioma || 'es', verifyUrl);

    if (emailResult.error || emailResult.skipped) {
      console.error('[REGISTER] Verification email not sent for:', email, emailResult);
    }

    return jsonResponse({
      success: true,
      needs_verification: true,
      email_sent: !(emailResult.error || emailResult.skipped),
      message: 'Cuenta creada. Revisa tu email para verificar tu cuenta.',
      message_en: 'Account created. Check your email to verify your account.'
    }, 201);

  } catch (err) {
    console.error('Register error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
