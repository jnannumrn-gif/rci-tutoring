import { hashPassword, createJWT, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
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
      'SELECT id FROM users WHERE email = ?'
    ).bind(email.toLowerCase().trim()).first();

    if (existing) {
      return jsonResponse({ error: 'Este email ya está registrado', field: 'email' }, 409);
    }

    // Calculate trial dates
    const now = new Date();
    const trialEnd = new Date(now);
    trialEnd.setDate(trialEnd.getDate() + 7);

    // Hash password
    const passwordHash = await hashPassword(password);

    // Insert user
    await env.DB.prepare(`
      INSERT INTO users
      (nombre, email, password_hash, telefono, codigo_pais, pais, rol, idioma,
       trial_start_date, trial_end_date, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'trial')
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
      trialEnd.toISOString()
    ).run();

    // Get the created user
    const user = await env.DB.prepare(
      'SELECT id, nombre, email, idioma, trial_end_date, status FROM users WHERE email = ?'
    ).bind(email.toLowerCase().trim()).first();

    // Create JWT
    const jwtSecret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
    const token = await createJWT(
      { sub: user.id, email: user.email, nombre: user.nombre },
      jwtSecret
    );

    // Set cookie and return response
    const headers = new Headers({
      'Content-Type': 'application/json',
      ...corsHeaders()
    });
    headers.append('Set-Cookie', `rci_token=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${7 * 86400}`);

    return new Response(JSON.stringify({
      success: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        idioma: user.idioma,
        status: user.status,
        trial_end: user.trial_end_date
      }
    }), { status: 201, headers });

  } catch (err) {
    console.error('Register error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
