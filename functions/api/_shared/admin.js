// Shared helpers for the internal-only /api/admin/* routes.
//
// Auth is a single shared secret (ADMIN_PASSWORD, set with
// `wrangler pages secret put ADMIN_PASSWORD`) sent in the X-Admin-Password
// header. When the secret is not configured the routes stay closed instead of
// failing open. Admin responses carry no CORS headers: the review panel is
// served from the same origin.

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function adminJson(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

// Returns null when the caller is authorized, otherwise the response to send.
export function requireAdmin(request, env) {
  const expected = env.ADMIN_PASSWORD;
  if (!expected) {
    return adminJson({ error: 'Admin API not configured' }, 503);
  }
  const provided = request.headers.get('X-Admin-Password') || '';
  if (!timingSafeEqual(provided, expected)) {
    return adminJson({ error: 'Unauthorized' }, 401);
  }
  return null;
}
