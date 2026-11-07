-- 2DWeb: one database for every client site.
-- Every row belongs to one client; every query in the API carries the client id.
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,          -- the site's short name, e.g. take
  name TEXT NOT NULL,
  tz_hours INTEGER NOT NULL DEFAULT 0, -- hours from UTC, so a promotion ends at the client's midnight
  pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS items (      -- products, menu dishes, services: whatever the site sells
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  ref TEXT NOT NULL,                  -- stable id the website uses, e.g. nasi-goreng
  cat TEXT, name TEXT NOT NULL,
  price INTEGER,                      -- null = no price shown
  desc TEXT, img TEXT,
  soldout INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,  -- 0 = hidden from the site
  sort INTEGER NOT NULL DEFAULT 0,
  updated TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (client_id, ref)
);
CREATE INDEX IF NOT EXISTS items_c ON items(client_id, active, sort);
CREATE TABLE IF NOT EXISTS promos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  title TEXT NOT NULL, text TEXT,
  discount_pct INTEGER,               -- 0-100, optional
  code TEXT,                          -- optional promo code shown to visitors
  starts TEXT, ends TEXT,             -- YYYY-MM-DD, both optional, ends is the last day
  active INTEGER NOT NULL DEFAULT 1,
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS promos_c ON promos(client_id, active);
CREATE TABLE IF NOT EXISTS sessions (   -- signed-in browsers, stored hashed
  hash TEXT PRIMARY KEY, client_id INTEGER NOT NULL, expires TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_fails (key TEXT NOT NULL, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS login_fails_k ON login_fails(key, at);
CREATE TABLE IF NOT EXISTS changes (    -- who changed what, so nothing is ever lost
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  what TEXT NOT NULL, ref TEXT,
  before TEXT, after TEXT,
  at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS changes_c ON changes(client_id, id);
