import { verifyPassword, createJWT, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestPost(context) {
  const { env } = context;

  try {
    const body = await context.request.json();
    const { email, password } = body;

    if (!email || !password) {
      return jsonResponse({ error: 'Email y contraseña son requeridos' }, 400);
    }

    const user = await env.DB.prepare(
      'SELECT id, nombre, email, password_hash, idioma, trial_end_date, status FROM users WHERE email = ?'
    ).bind(email.toLowerCase().trim()).first();

    if (!user) {
      return jsonResponse({ error: 'Credenciales incorrectas' }, 401);
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      return jsonResponse({ error: 'Credenciales incorrectas' }, 401);
    }

    // Check and update trial status if expired
    let status = user.status;
    if (status === 'trial') {
      const now = new Date();
      const trialEnd = new Date(user.trial_end_date);
      if (now >= trialEnd) {
        await env.DB.prepare(
          "UPDATE users SET status = 'expired', updated_at = datetime('now') WHERE id = ?"
        ).bind(user.id).run();
        status = 'expired';
      }
    }

    const jwtSecret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
    const token = await createJWT(
      { sub: user.id, email: user.email, nombre: user.nombre },
      jwtSecret
    );

    const headers = new Headers({
      'Content-Type': 'application/json',
      ...corsHeaders()
    });
    headers.append('Set-Cookie', `rci_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`);

    return new Response(JSON.stringify({
      success: true,
      token,
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        idioma: user.idioma,
        status,
        trial_end: user.trial_end_date
      }
    }), { status: 200, headers });

  } catch (err) {
    console.error('Login error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
