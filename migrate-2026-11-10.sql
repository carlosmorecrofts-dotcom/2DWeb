-- Email sign-in. The table was empty when this ran, so a nullable column is safe.
ALTER TABLE clients ADD COLUMN email TEXT;
ALTER TABLE clients ADD COLUMN plan TEXT;
ALTER TABLE clients ADD COLUMN paid_until TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS clients_email ON clients(email);
