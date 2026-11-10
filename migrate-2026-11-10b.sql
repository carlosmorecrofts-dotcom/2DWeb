-- forgot password: one-hour, one-use reset links (stored hashed)
CREATE TABLE IF NOT EXISTS resets (
  hash TEXT PRIMARY KEY, client_id INTEGER NOT NULL, expires TEXT NOT NULL
);
