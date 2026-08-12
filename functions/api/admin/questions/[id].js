// PATCH /api/admin/questions/:id — Pablo's review action on one question.
//
// Body: { status?, reviewer_notes?, reviewed_by?, question_text?, option_a?..option_d?,
//         correct_option?, rationale?, difficulty?, domain?, subdomain?, cognitive_level? }
// Editing fields and setting a status can happen in the same call, so an edited
// question can be approved in one step.

import { requireAdmin, adminJson } from '../../_shared/admin.js';
import { COGNITIVE_LEVELS, DIFFICULTIES, DOMAINS } from '../../_shared/question-prompts.js';

const STATUSES = ['pending_review', 'approved', 'rejected', 'needs_edit'];

const TEXT_FIELDS = [
  'question_text',
  'option_a',
  'option_b',
  'option_c',
  'option_d',
  'rationale',
];

export async function onRequestPatch(context) {
  const { request, env, params } = context;

  const denied = requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return adminJson({ error: 'Invalid JSON body' }, 400);
  }

  try {
    const question = await env.DB.prepare('SELECT * FROM question_bank WHERE id = ?')
      .bind(params.id)
      .first();
    if (!question) {
      return adminJson({ error: 'Question not found' }, 404);
    }

    const sets = [];
    const binds = [];

    for (const field of TEXT_FIELDS) {
      if (body[field] === undefined) continue;
      if (typeof body[field] !== 'string' || !body[field].trim()) {
        return adminJson({ error: `${field} must be a non-empty string` }, 400);
      }
      sets.push(`${field} = ?`);
      binds.push(body[field].trim());
    }

    if (body.correct_option !== undefined) {
      const option = String(body.correct_option).trim().toUpperCase();
      if (!['A', 'B', 'C', 'D'].includes(option)) {
        return adminJson({ error: 'correct_option must be A, B, C or D' }, 400);
      }
      sets.push('correct_option = ?');
      binds.push(option);
    }

    if (body.difficulty !== undefined) {
      if (!DIFFICULTIES.includes(body.difficulty)) {
        return adminJson({ error: `difficulty must be one of ${DIFFICULTIES.join(', ')}` }, 400);
      }
      sets.push('difficulty = ?');
      binds.push(body.difficulty);
    }

    if (body.cognitive_level !== undefined) {
      if (!COGNITIVE_LEVELS.includes(body.cognitive_level)) {
        return adminJson({ error: `cognitive_level must be one of ${COGNITIVE_LEVELS.join(', ')}` }, 400);
      }
      sets.push('cognitive_level = ?');
      binds.push(body.cognitive_level);
    }

    if (body.domain !== undefined) {
      if (!Object.hasOwn(DOMAINS[question.exam_type], body.domain)) {
        return adminJson({ error: `unknown domain for ${question.exam_type}` }, 400);
      }
      sets.push('domain = ?');
      binds.push(body.domain);
    }

    if (body.subdomain !== undefined) {
      sets.push('subdomain = ?');
      binds.push(body.subdomain ? String(body.subdomain).trim() : null);
    }

    if (body.reviewer_notes !== undefined) {
      sets.push('reviewer_notes = ?');
      binds.push(body.reviewer_notes ? String(body.reviewer_notes).trim() : null);
    }

    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) {
        return adminJson({ error: `status must be one of ${STATUSES.join(', ')}` }, 400);
      }
      sets.push('status = ?', 'reviewed_by = ?', "reviewed_at = datetime('now')");
      binds.push(body.status, body.reviewed_by ? String(body.reviewed_by).trim() : 'pablo');
    }

    if (!sets.length) {
      return adminJson({ error: 'No fields to update' }, 400);
    }

    sets.push("updated_at = datetime('now')");

    await env.DB.prepare(`UPDATE question_bank SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...binds, params.id)
      .run();

    const updated = await env.DB.prepare('SELECT * FROM question_bank WHERE id = ?')
      .bind(params.id)
      .first();

    return adminJson({ question: updated });
  } catch (err) {
    console.error('Question update error:', err);
    return adminJson({ error: 'Failed to update question' }, 500);
  }
}
