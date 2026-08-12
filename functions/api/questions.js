// GET /api/questions — the approved question pool consumed by CCHT Prep.
//
// Only status = 'approved' rows are ever returned, so nothing reaches students
// before Pablo reviews it. Query params: exam_type (required), domain,
// cognitive_level, difficulty, limit (default 25, max 100), order ('random'
// default, or 'created').
//
// CCHT Prep is a separate Pages project, so this route is CORS-scoped to the
// known RCI origins instead of the wildcard used by the auth endpoints.

import { EXAM_TYPES, COGNITIVE_LEVELS, DIFFICULTIES, DOMAINS } from './_shared/question-prompts.js';

const ALLOWED_ORIGINS = ['https://rcitutoring.com', 'https://www.rcitutoring.com'];

const ALLOWED_ORIGIN_PATTERNS = [
  /^https:\/\/([a-z0-9-]+\.)?rci-tutoring\.pages\.dev$/,
  /^https:\/\/([a-z0-9-]+\.)?rci-prep\.pages\.dev$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

const MAX_LIMIT = 100;

export function onRequestOptions({ request }) {
  return new Response(null, { headers: corsHeaders(request.headers.get('Origin')) });
}

export async function onRequestGet({ request, env }) {
  const origin = request.headers.get('Origin');
  const url = new URL(request.url);

  const examType = url.searchParams.get('exam_type');
  const domain = url.searchParams.get('domain');
  const cognitiveLevel = url.searchParams.get('cognitive_level');
  const difficulty = url.searchParams.get('difficulty');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, MAX_LIMIT);
  const order = url.searchParams.get('order') === 'created' ? 'created_at ASC' : 'RANDOM()';

  if (!EXAM_TYPES.includes(examType)) {
    return json({ error: `exam_type must be one of ${EXAM_TYPES.join(', ')}` }, 400, origin);
  }
  if (domain && !Object.hasOwn(DOMAINS[examType], domain)) {
    return json({ error: `unknown domain for ${examType}` }, 400, origin);
  }
  if (cognitiveLevel && !COGNITIVE_LEVELS.includes(cognitiveLevel)) {
    return json({ error: `cognitive_level must be one of ${COGNITIVE_LEVELS.join(', ')}` }, 400, origin);
  }
  if (difficulty && !DIFFICULTIES.includes(difficulty)) {
    return json({ error: `difficulty must be one of ${DIFFICULTIES.join(', ')}` }, 400, origin);
  }

  try {
    const filters = ["status = 'approved'", 'exam_type = ?'];
    const binds = [examType];
    if (domain) {
      filters.push('domain = ?');
      binds.push(domain);
    }
    if (cognitiveLevel) {
      filters.push('cognitive_level = ?');
      binds.push(cognitiveLevel);
    }
    if (difficulty) {
      filters.push('difficulty = ?');
      binds.push(difficulty);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, exam_type, domain, subdomain, cognitive_level, question_text,
              option_a, option_b, option_c, option_d, correct_option, rationale, difficulty
         FROM question_bank
        WHERE ${filters.join(' AND ')}
        ORDER BY ${order}
        LIMIT ?`
    )
      .bind(...binds, limit)
      .all();

    return json({ questions: results || [] }, 200, origin);
  } catch (err) {
    console.error('Public questions error:', err);
    return json({ error: 'Failed to load questions' }, 500, origin);
  }
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function corsHeaders(origin) {
  const allowed =
    origin && (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin)));
  return {
    ...(allowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}
