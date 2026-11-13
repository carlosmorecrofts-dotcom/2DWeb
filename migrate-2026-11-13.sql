-- Back of house: orders (kitchen + till) and bookings.
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL,
  number INTEGER NOT NULL,
  customer TEXT, phone TEXT, table_no TEXT,
  kind TEXT NOT NULL DEFAULT 'dine_in',
  status TEXT NOT NULL DEFAULT 'new',
  pay_status TEXT NOT NULL DEFAULT 'unpaid',
  pay_method TEXT,
  source TEXT NOT NULL DEFAULT 'staff',
  note TEXT,
  total INTEGER,
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
  date TEXT NOT NULL, time TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  source TEXT NOT NULL DEFAULT 'staff',
  note TEXT,
  created TEXT NOT NULL DEFAULT (datetime('now')),
  updated TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS bookings_c ON bookings(client_id, date, time);
