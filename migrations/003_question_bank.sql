-- Migration: AI-generated question bank for CCHT Prep (BONENT CHT + NNCC CCHT)
-- Run this against your existing D1 database:
--   wrangler d1 execute rci-tutoring-db --file=migrations/003_question_bank.sql

CREATE TABLE IF NOT EXISTS question_bank (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_type           TEXT NOT NULL CHECK (exam_type IN ('BONENT_CHT', 'NNCC_CCHT')),

  domain              TEXT NOT NULL,
  subdomain           TEXT,
  cognitive_level     TEXT CHECK (cognitive_level IN ('knowledge', 'comprehension', 'application')),

  question_text       TEXT NOT NULL,
  option_a            TEXT NOT NULL,
  option_b            TEXT NOT NULL,
  option_c            TEXT NOT NULL,
  option_d            TEXT NOT NULL,
  correct_option      TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D')),
  rationale           TEXT NOT NULL,

  difficulty          TEXT DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),

  status              TEXT NOT NULL DEFAULT 'pending_review'
                        CHECK (status IN ('pending_review', 'approved', 'rejected', 'needs_edit')),

  generated_by        TEXT DEFAULT 'ai',
  model_used          TEXT,
  generation_batch_id TEXT REFERENCES generation_batch(id),

  reviewer_notes      TEXT,
  reviewed_by         TEXT,
  reviewed_at         TEXT,

  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS generation_batch (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  exam_type       TEXT NOT NULL CHECK (exam_type IN ('BONENT_CHT', 'NNCC_CCHT')),
  domain          TEXT NOT NULL,
  cognitive_level TEXT,
  requested_count INTEGER NOT NULL,
  generated_count INTEGER,
  model_used      TEXT,
  prompt_version  TEXT,
  triggered_by    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_question_bank_exam_status ON question_bank(exam_type, status);
CREATE INDEX IF NOT EXISTS idx_question_bank_domain ON question_bank(exam_type, domain);
CREATE INDEX IF NOT EXISTS idx_question_bank_batch ON question_bank(generation_batch_id);
