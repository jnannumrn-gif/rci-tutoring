// POST /api/admin/questions/bulk-review — apply one review status to many questions.
//
// Body either targets explicit ids:
//   { status, reviewed_by?, reviewer_notes?, ids: [...] }
// or every question currently in a status for an exam (optionally one domain):
//   { status, reviewed_by?, reviewer_notes?, exam_type, from_status?, domain? }
//
// Bulk editing of question content is deliberately not supported — only the
// review status changes, so nothing is published without a human choosing it.

import { requireAdmin, adminJson } from '../../_shared/admin.js';
import { EXAM_TYPES, DOMAINS } from '../../_shared/question-prompts.js';

const STATUSES = ['pending_review', 'approved', 'rejected', 'needs_edit'];
const MAX_IDS = 200;

export async function onRequestPost(context) {
  const { request, env } = context;

  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return adminJson({ error: 'Invalid JSON body' }, 400);
  }

  if (!STATUSES.includes(body.status)) {
    return adminJson({ error: `status must be one of ${STATUSES.join(', ')}` }, 400);
  }

  const reviewedBy = body.reviewed_by ? String(body.reviewed_by).trim() : 'pablo';
  const notes = body.reviewer_notes ? String(body.reviewer_notes).trim() : null;

  const filters = [];
  const binds = [body.status, reviewedBy, notes];

  if (Array.isArray(body.ids)) {
    const ids = body.ids.filter((id) => typeof id === 'string' && id.trim());
    if (!ids.length) {
      return adminJson({ error: 'ids must contain at least one question id' }, 400);
    }
    if (ids.length > MAX_IDS) {
      return adminJson({ error: `ids is limited to ${MAX_IDS} questions per call` }, 400);
    }
    filters.push(`id IN (${ids.map(() => '?').join(', ')})`);
    binds.push(...ids);
  } else {
    const examType = body.exam_type;
    const fromStatus = body.from_status || 'pending_review';
    if (!EXAM_TYPES.includes(examType)) {
      return adminJson({ error: `exam_type must be one of ${EXAM_TYPES.join(', ')}` }, 400);
    }
    if (!STATUSES.includes(fromStatus)) {
      return adminJson({ error: `from_status must be one of ${STATUSES.join(', ')}` }, 400);
    }
    filters.push('exam_type = ?', 'status = ?');
    binds.push(examType, fromStatus);

    if (body.domain) {
      if (!Object.hasOwn(DOMAINS[examType], body.domain)) {
        return adminJson({ error: `unknown domain for ${examType}` }, 400);
      }
      filters.push('domain = ?');
      binds.push(body.domain);
    }
  }

  try {
    const result = await env.DB.prepare(
      `UPDATE question_bank
          SET status = ?,
              reviewed_by = ?,
              reviewer_notes = COALESCE(?, reviewer_notes),
              reviewed_at = datetime('now'),
              updated_at = datetime('now')
        WHERE ${filters.join(' AND ')}`
    )
      .bind(...binds)
      .run();

    return adminJson({
      status: body.status,
      updated_count: result.meta?.changes ?? 0,
    });
  } catch (err) {
    console.error('Bulk review error:', err);
    return adminJson({ error: 'Failed to update questions' }, 500);
  }
}
