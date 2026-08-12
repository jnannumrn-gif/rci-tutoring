// POST /api/admin/generate-questions — internal-only AI question generation.
//
// Generates a batch of multiple-choice questions for one exam_type + domain with
// the Anthropic API and stores them in question_bank as 'pending_review'.
// Nothing generated here is ever visible to students until Pablo approves it in
// /admin/question-review.html.
//
// Body: { exam_type, domain, count, cognitive_level?, difficulty_mix?, triggered_by? }

import { requireAdmin, adminJson } from '../_shared/admin.js';
import {
  buildSystemPrompt,
  PROMPT_VERSION,
  EXAM_TYPES,
  COGNITIVE_LEVELS,
  DIFFICULTIES,
  DOMAINS,
} from '../_shared/question-prompts.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

// Kept in sync with the tutor proxy worker (proxy/src/worker.js).
const MODEL = 'claude-sonnet-4-5-20250929';

// Larger batches make the model truncate its JSON array mid-question.
const MAX_COUNT = 20;
const TOKENS_PER_QUESTION = 1000;

export async function onRequestPost(context) {
  const { request, env } = context;

  const denied = requireAdmin(request, env);
  if (denied) return denied;

  if (!env.ANTHROPIC_API_KEY) {
    return adminJson({ error: 'ANTHROPIC_API_KEY not configured' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return adminJson({ error: 'Invalid JSON body' }, 400);
  }

  const examType = body.exam_type;
  const domain = body.domain;
  const count = Number(body.count);
  const cognitiveLevel = body.cognitive_level || null;
  const difficultyMix = body.difficulty_mix || null;
  const triggeredBy = body.triggered_by || 'pablo_manual';

  if (!EXAM_TYPES.includes(examType)) {
    return adminJson({ error: `exam_type must be one of ${EXAM_TYPES.join(', ')}` }, 400);
  }
  if (!Object.hasOwn(DOMAINS[examType], domain)) {
    return adminJson(
      { error: `domain must be one of ${Object.keys(DOMAINS[examType]).join(', ')} for ${examType}` },
      400
    );
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_COUNT) {
    return adminJson({ error: `count must be an integer between 1 and ${MAX_COUNT}` }, 400);
  }
  if (cognitiveLevel && !COGNITIVE_LEVELS.includes(cognitiveLevel)) {
    return adminJson({ error: `cognitive_level must be one of ${COGNITIVE_LEVELS.join(', ')}` }, 400);
  }

  const systemPrompt = buildSystemPrompt({ examType, domain, count, cognitiveLevel, difficultyMix });

  let generated;
  try {
    generated = await generateQuestions({
      apiKey: env.ANTHROPIC_API_KEY,
      systemPrompt,
      count,
    });
  } catch (err) {
    console.error('Question generation error:', err);
    return adminJson({ error: `Generation failed: ${err.message}` }, 502);
  }

  const seen = await existingQuestionTexts(env.DB, examType);
  const rows = [];
  const skipped = [];

  for (const item of generated) {
    const problem = validationError(item);
    if (problem) {
      skipped.push({ reason: problem, question_text: item?.question_text ?? null });
      continue;
    }
    const key = normalizeText(item.question_text);
    if (seen.has(key)) {
      skipped.push({ reason: 'duplicate', question_text: item.question_text });
      continue;
    }
    seen.add(key);
    rows.push(item);
  }

  const batchId = crypto.randomUUID();

  try {
    const statements = [
      env.DB.prepare(
        `INSERT INTO generation_batch
           (id, exam_type, domain, cognitive_level, requested_count, generated_count, model_used, prompt_version, triggered_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        batchId,
        examType,
        domain,
        cognitiveLevel,
        count,
        rows.length,
        MODEL,
        PROMPT_VERSION,
        triggeredBy
      ),
      ...rows.map((item) =>
        env.DB.prepare(
          `INSERT INTO question_bank
             (exam_type, domain, subdomain, cognitive_level, question_text,
              option_a, option_b, option_c, option_d, correct_option, rationale,
              difficulty, status, generated_by, model_used, generation_batch_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_review', 'ai', ?, ?)`
        ).bind(
          examType,
          domain,
          item.subdomain || null,
          resolveCognitiveLevel(examType, item, cognitiveLevel),
          item.question_text.trim(),
          item.option_a.trim(),
          item.option_b.trim(),
          item.option_c.trim(),
          item.option_d.trim(),
          item.correct_option.trim().toUpperCase(),
          item.rationale.trim(),
          DIFFICULTIES.includes(item.difficulty) ? item.difficulty : 'medium',
          MODEL,
          batchId
        )
      ),
    ];
    await env.DB.batch(statements);
  } catch (err) {
    console.error('Question insert error:', err);
    return adminJson({ error: 'Failed to store generated questions' }, 500);
  }

  return adminJson({
    batch_id: batchId,
    exam_type: examType,
    domain,
    requested_count: count,
    inserted_count: rows.length,
    model_used: MODEL,
    prompt_version: PROMPT_VERSION,
    skipped,
  });
}

async function generateQuestions({ apiKey, systemPrompt, count }) {
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: TOKENS_PER_QUESTION * count + 1000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Generate ${count} question(s) now. Respond with the JSON array only.`,
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || `Anthropic API returned ${response.status}`);
  }

  const text = (data.content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const parsed = JSON.parse(stripFences(text));
  if (!Array.isArray(parsed)) {
    throw new Error('Model did not return a JSON array');
  }
  return parsed;
}

// The prompt forbids markdown fences, but models add them often enough that
// stripping them is cheaper than failing the whole batch.
function stripFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  return (fenced ? fenced[1] : trimmed).trim();
}

function validationError(item) {
  if (!item || typeof item !== 'object') return 'not an object';
  const required = [
    'question_text',
    'option_a',
    'option_b',
    'option_c',
    'option_d',
    'correct_option',
    'rationale',
  ];
  for (const field of required) {
    if (typeof item[field] !== 'string' || !item[field].trim()) return `missing ${field}`;
  }
  if (!['A', 'B', 'C', 'D'].includes(item.correct_option.trim().toUpperCase())) {
    return 'invalid correct_option';
  }
  const options = ['option_a', 'option_b', 'option_c', 'option_d'].map((f) => normalizeText(item[f]));
  if (new Set(options).size !== 4) return 'duplicate options';
  return null;
}

// BONENT items have no native cognitive level; the spec defaults them to
// 'application' unless the batch asked for something else.
function resolveCognitiveLevel(examType, item, requested) {
  if (COGNITIVE_LEVELS.includes(item.cognitive_level)) return item.cognitive_level;
  if (requested) return requested;
  return 'application';
}

function normalizeText(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

async function existingQuestionTexts(db, examType) {
  const { results } = await db
    .prepare('SELECT question_text FROM question_bank WHERE exam_type = ?')
    .bind(examType)
    .all();
  return new Set((results || []).map((row) => normalizeText(row.question_text)));
}
