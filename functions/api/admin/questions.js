// GET /api/admin/questions — review queue for the question bank.
//
// Query params: exam_type (required), status (default 'pending_review'),
// domain, limit (default 25, max 100), offset.
// Also returns per-status counts for the selected exam_type so the panel can
// show how big the queue is.

import { requireAdmin, adminJson } from '../_shared/admin.js';
import { EXAM_TYPES, DOMAINS } from '../_shared/question-prompts.js';

const STATUSES = ['pending_review', 'approved', 'rejected', 'needs_edit'];
const MAX_LIMIT = 100;

export async function onRequestGet(context) {
  const { request, env } = context;

  const denied = requireAdmin(request, env);
  if (denied) return denied;

  const url = new URL(request.url);
  const examType = url.searchParams.get('exam_type');
  const status = url.searchParams.get('status') || 'pending_review';
  const domain = url.searchParams.get('domain');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 25, MAX_LIMIT);
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0);

  if (!EXAM_TYPES.includes(examType)) {
    return adminJson({ error: `exam_type must be one of ${EXAM_TYPES.join(', ')}` }, 400);
  }
  if (!STATUSES.includes(status)) {
    return adminJson({ error: `status must be one of ${STATUSES.join(', ')}` }, 400);
  }
  if (domain && !Object.hasOwn(DOMAINS[examType], domain)) {
    return adminJson({ error: `unknown domain for ${examType}` }, 400);
  }

  try {
    const filters = ['exam_type = ?', 'status = ?'];
    const binds = [examType, status];
    if (domain) {
      filters.push('domain = ?');
      binds.push(domain);
    }

    const { results } = await env.DB.prepare(
      `SELECT id, exam_type, domain, subdomain, cognitive_level, question_text,
              option_a, option_b, option_c, option_d, correct_option, rationale,
              difficulty, status, generated_by, model_used, generation_batch_id,
              reviewer_notes, reviewed_by, reviewed_at, created_at
         FROM question_bank
        WHERE ${filters.join(' AND ')}
        ORDER BY created_at ASC
        LIMIT ? OFFSET ?`
    )
      .bind(...binds, limit, offset)
      .all();

    const countRows = await env.DB.prepare(
      'SELECT status, COUNT(*) AS n FROM question_bank WHERE exam_type = ? GROUP BY status'
    )
      .bind(examType)
      .all();

    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const row of countRows.results || []) counts[row.status] = row.n;

    return adminJson({ questions: results || [], counts });
  } catch (err) {
    console.error('Question list error:', err);
    return adminJson({ error: 'Failed to load questions' }, 500);
  }
}
