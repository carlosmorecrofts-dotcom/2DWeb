-- 2DWeb: one database for every client site.
-- Every row belongs to one client; every query in the API carries the client id.
CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,          -- the site's short name, e.g. take
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,          -- the owner's sign-in, same as their Djinja-C account (lowercase)
  plan TEXT, paid_until TEXT,          -- filled from the Djinja-C payment, YYYY-MM-DD
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
CREATE TABLE IF NOT EXISTS resets (     -- forgot-password links, stored hashed, one hour, one use
  hash TEXT PRIMARY KEY, client_id INTEGER NOT NULL, expires TEXT NOT NULL
);

-- The back of house: orders (kitchen + till) and bookings. A guest can place
-- an order or ask for a booking from the client's own website (POST
-- /api/public/:slug/order or /booking); the owner manages both signed in here.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  number INTEGER NOT NULL,            -- shown to staff as "Order #12", counts up per client
  customer TEXT, phone TEXT, table_no TEXT,
  kind TEXT NOT NULL DEFAULT 'dine_in',       -- dine_in, takeaway, delivery
  status TEXT NOT NULL DEFAULT 'new',         -- new, preparing, ready, served, cancelled
  pay_status TEXT NOT NULL DEFAULT 'unpaid',  -- unpaid, paid
  pay_method TEXT,                            -- cash, card, transfer, qris, other: set when marked paid
  source TEXT NOT NULL DEFAULT 'staff',       -- staff (added here) or website (the guest endpoint)
  note TEXT,
  total INTEGER,                              -- sum of its items' price * qty, kept so a later price change never rewrites an old order
  created TEXT NOT NULL DEFAULT (datetime('now')),
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS orders_c ON orders(client_id, status, id);
CREATE TABLE IF NOT EXISTS order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  name TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1, price INTEGER
);
CREATE INDEX IF NOT EXISTS order_items_o ON order_items(order_id);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  name TEXT NOT NULL, phone TEXT, party INTEGER,
  date TEXT NOT NULL, time TEXT NOT NULL,     -- YYYY-MM-DD, HH:MM, the client's own local time (tz_hours)
  status TEXT NOT NULL DEFAULT 'pending',     -- pending, confirmed, seated, cancelled, no_show
  source TEXT NOT NULL DEFAULT 'staff',
  note TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bookings_c ON bookings(client_id, date, time);
