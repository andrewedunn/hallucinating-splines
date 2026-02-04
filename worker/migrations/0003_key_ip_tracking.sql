-- Add IP tracking for rate limiting key creation
ALTER TABLE api_keys ADD COLUMN created_from_ip TEXT;
ALTER TABLE api_keys ADD COLUMN active INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_api_keys_ip_created ON api_keys(created_from_ip, created_at);

-- Add ended_reason to cities for retire vs bankruptcy vs inactivity
ALTER TABLE cities ADD COLUMN ended_reason TEXT;
