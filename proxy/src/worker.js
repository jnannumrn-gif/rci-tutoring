// Cloudflare Worker — RCI Tutoring Anthropic API Proxy
// This worker securely proxies chat requests to the Anthropic API
// without exposing the API key to the client.

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Origins allowed to spend this worker's Anthropic quota. The tutor pages are
// always cross-origin to workers.dev, so a browser request always carries an
// Origin; requests without one are rejected.
const ALLOWED_ORIGINS = [
  'https://rcitutoring.com',
  'https://www.rcitutoring.com',
];

// Cloudflare Pages previews (per-branch and per-deployment) plus local dev.
const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/[a-z0-9-]+\.rci-tutoring\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

// Single source of truth for the tutor model. A client-supplied `model` is
// ignored so that a model swap is a redeploy of this worker alone, and so cached
// or stale pages pinned to a retired model keep working.
const MODEL = 'claude-sonnet-4-5-20250929';

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    if (!isAllowedOrigin(origin)) {
      return new Response(JSON.stringify({ error: { message: 'Origin not allowed' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', Vary: 'Origin' },
      });
    }

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
          model: MODEL,
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

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
}

function corsHeaders(request) {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin'),
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
