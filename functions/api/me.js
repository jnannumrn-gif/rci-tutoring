import { verifyJWT, extractToken, jsonResponse, corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestGet(context) {
  const { env } = context;

  try {
    const token = extractToken(context.request);
    if (!token) {
      return jsonResponse({ error: 'No autenticado' }, 401);
    }

    const jwtSecret = env.JWT_SECRET || 'rci-dev-secret-change-in-production';
    const payload = await verifyJWT(token, jwtSecret);
    if (!payload) {
      return jsonResponse({ error: 'Token inválido o expirado' }, 401);
    }

    const user = await env.DB.prepare(
      'SELECT id, nombre, email, telefono, pais, rol, idioma, trial_start_date, trial_end_date, status, created_at FROM users WHERE id = ?'
    ).bind(payload.sub).first();

    if (!user) {
      return jsonResponse({ error: 'Usuario no encontrado' }, 404);
    }

    // Check and update trial status
    let status = user.status;
    let daysLeft = null;
    if (status === 'trial') {
      const now = new Date();
      const trialEnd = new Date(user.trial_end_date);
      if (now >= trialEnd) {
        await env.DB.prepare(
          "UPDATE users SET status = 'expired', updated_at = datetime('now') WHERE id = ?"
        ).bind(user.id).run();
        status = 'expired';
      } else {
        daysLeft = Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }
    }

    return jsonResponse({
      user: {
        id: user.id,
        nombre: user.nombre,
        email: user.email,
        telefono: user.telefono,
        pais: user.pais,
        rol: user.rol,
        idioma: user.idioma,
        status,
        trial_start: user.trial_start_date,
        trial_end: user.trial_end_date,
        days_left: daysLeft,
        created_at: user.created_at
      }
    });

  } catch (err) {
    console.error('Me error:', err);
    return jsonResponse({ error: 'Error interno del servidor' }, 500);
  }
}
