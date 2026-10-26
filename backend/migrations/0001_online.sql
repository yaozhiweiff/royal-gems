PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  device_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL CHECK(mode IN ('easy','hard','challenge')),
  character TEXT NOT NULL CHECK(character IN ('beth','lance','chris','ian')),
  seed INTEGER NOT NULL,
  actions TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0,
  last_nonce TEXT,
  finished INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_player_created ON runs(player_id, created_at);
CREATE TABLE IF NOT EXISTS records (
  player_id TEXT NOT NULL REFERENCES players(id),
  mode TEXT NOT NULL CHECK(mode IN ('easy','hard','challenge')),
  character TEXT NOT NULL,
  value INTEGER NOT NULL CHECK(value > 0),
  achieved_at INTEGER NOT NULL,
  PRIMARY KEY(player_id, mode)
);
CREATE INDEX IF NOT EXISTS records_mode_value ON records(mode, value, achieved_at, player_id);
