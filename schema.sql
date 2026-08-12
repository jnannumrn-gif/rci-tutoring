-- RCI Tutoring — Phase 1 Database Schema
-- Cloudflare D1: rci-tutoring-db

-- Tabla principal de usuarios
CREATE TABLE IF NOT EXISTS users (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  nombre              TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE,
  telefono            TEXT,
  codigo_pais         TEXT,
  pais                TEXT,
  rol                 TEXT,
  idioma              TEXT DEFAULT 'es',
  password_hash       TEXT NOT NULL,
  trial_start_date    TEXT NOT NULL,
  trial_end_date      TEXT NOT NULL,
  stripe_customer_id  TEXT,
  status              TEXT DEFAULT 'trial',
  email_verified      INTEGER DEFAULT 0,
  email_verify_token  TEXT,
  email_verify_expires TEXT,
  registration_ip     TEXT,
  ip_country          TEXT,
  geo_flag            INTEGER DEFAULT 0,
  billing_country     TEXT,
  billing_flag        INTEGER DEFAULT 0,
  magic_token         TEXT,
  magic_token_expires TEXT,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

-- Tabla de suscripciones (lista para Fase 2)
CREATE TABLE IF NOT EXISTS subscriptions (
  id                      TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id                 TEXT NOT NULL REFERENCES users(id),
  stripe_subscription_id  TEXT,
  tier                    TEXT,
  start_date              TEXT,
  end_date                TEXT,
  active                  INTEGER DEFAULT 0,
  created_at              TEXT DEFAULT (datetime('now'))
);

-- Tracking de emails enviados
CREATE TABLE IF NOT EXISTS email_sequences (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  user_id     TEXT NOT NULL REFERENCES users(id),
  step        INTEGER,
  sent_at     TEXT,
  opened      INTEGER DEFAULT 0
);

-- Banco de preguntas para CCHT Prep (generadas por IA, revisadas manualmente)
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

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_pais ON users(pais);
CREATE INDEX IF NOT EXISTS idx_email_seq_user ON email_sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_geo_flag ON users(geo_flag);
CREATE INDEX IF NOT EXISTS idx_users_billing_flag ON users(billing_flag);
CREATE INDEX IF NOT EXISTS idx_users_magic_token ON users(magic_token);
CREATE INDEX IF NOT EXISTS idx_question_bank_exam_status ON question_bank(exam_type, status);
CREATE INDEX IF NOT EXISTS idx_question_bank_domain ON question_bank(exam_type, domain);
CREATE INDEX IF NOT EXISTS idx_question_bank_batch ON question_bank(generation_batch_id);
