-- API keys for authentication
CREATE TABLE api_keys (
  id           TEXT PRIMARY KEY,
  key_hash     TEXT NOT NULL,
  prefix       TEXT NOT NULL,
  mayor_name   TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used    TEXT
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

-- City directory
CREATE TABLE cities (
  id          TEXT PRIMARY KEY,
  api_key_id  TEXT NOT NULL REFERENCES api_keys(id),
  name        TEXT NOT NULL,
  seed        INTEGER NOT NULL,
  game_year   INTEGER NOT NULL DEFAULT 1900,
  population  INTEGER NOT NULL DEFAULT 0,
  funds       INTEGER NOT NULL DEFAULT 20000,
  score       INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cities_api_key ON cities(api_key_id);
CREATE INDEX idx_cities_population ON cities(population DESC);
CREATE INDEX idx_cities_score ON cities(score DESC);
CREATE INDEX idx_cities_status ON cities(status);
