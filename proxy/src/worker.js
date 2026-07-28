// Cloudflare Worker — RCI Tutoring Anthropic API Proxy
// This worker securely proxies chat requests to the Anthropic API
// without exposing the API key to the client.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ALLOWED_ORIGINS = ['*']; // In production, restrict to your domain

// Single source of truth for the tutor model. Clients should omit `model` so a
// model swap only requires redeploying this worker, not the whole site.
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';

export default {
  async fetch(request, env) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(request),
      });
    }

    // Only allow POST
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), {
        status: 405,
        headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
      });
    }

    try {
      const body = await request.json();

      // Basic rate limiting via simple validation
      if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
        return new Response(JSON.stringify({ error: { message: 'Invalid request: messages required' } }), {
          status: 400,
          headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
        });
      }

      // Cap max_tokens to prevent abuse
      const maxTokens = Math.min(body.max_tokens || 1000, 2000);

      const anthropicResponse = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: body.model || DEFAULT_MODEL,
          max_tokens: maxTokens,
          system: body.system || '',
          messages: body.messages,
        }),
      });

      const data = await anthropicResponse.json();

      return new Response(JSON.stringify(data), {
        status: anthropicResponse.status,
        headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: { message: 'Proxy error: ' + err.message } }), {
        status: 500,
        headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
      });
    }
  },
};

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}
