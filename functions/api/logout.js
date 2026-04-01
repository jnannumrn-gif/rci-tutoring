import { corsHeaders } from './_shared/auth.js';

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

export async function onRequestPost() {
  const headers = new Headers({
    'Content-Type': 'application/json',
    ...corsHeaders()
  });
  headers.append('Set-Cookie', 'rci_token=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');

  return new Response(JSON.stringify({ success: true }), { status: 200, headers });
}
