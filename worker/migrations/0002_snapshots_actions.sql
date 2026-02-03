-- Snapshot metadata (tile data stored in R2)
CREATE TABLE snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id    TEXT NOT NULL REFERENCES cities(id),
  game_year  INTEGER NOT NULL,
  r2_key     TEXT NOT NULL,
  population INTEGER,
  funds      INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_snapshots_city ON snapshots(city_id, game_year);

-- Action log
CREATE TABLE actions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  city_id     TEXT NOT NULL REFERENCES cities(id),
  game_year   INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  params      TEXT NOT NULL,
  result      TEXT NOT NULL,
  cost        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_actions_city ON actions(city_id, created_at DESC);
