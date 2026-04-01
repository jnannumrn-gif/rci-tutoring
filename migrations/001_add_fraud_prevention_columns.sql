-- Migration: Add fraud prevention columns to users table
-- Run this against your existing D1 database:
--   wrangler d1 execute rci-tutoring-db --file=migrations/001_add_fraud_prevention_columns.sql

ALTER TABLE users ADD COLUMN registration_ip TEXT;
ALTER TABLE users ADD COLUMN ip_country TEXT;
ALTER TABLE users ADD COLUMN geo_flag INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN billing_country TEXT;
ALTER TABLE users ADD COLUMN billing_flag INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_users_geo_flag ON users(geo_flag);
CREATE INDEX IF NOT EXISTS idx_users_billing_flag ON users(billing_flag);
