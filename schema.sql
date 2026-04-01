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

-- Indices para performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_pais ON users(pais);
CREATE INDEX IF NOT EXISTS idx_email_seq_user ON email_sequences(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_users_geo_flag ON users(geo_flag);
CREATE INDEX IF NOT EXISTS idx_users_billing_flag ON users(billing_flag);
