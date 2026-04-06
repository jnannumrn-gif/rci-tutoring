-- Migration: Add magic link token columns to users table
-- Run this against your existing D1 database:
--   wrangler d1 execute rci-tutoring-db --file=migrations/002_add_magic_token_columns.sql

ALTER TABLE users ADD COLUMN magic_token TEXT;
ALTER TABLE users ADD COLUMN magic_token_expires TEXT;

CREATE INDEX IF NOT EXISTS idx_users_magic_token ON users(magic_token);
