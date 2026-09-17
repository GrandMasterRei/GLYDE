CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_role AS ENUM ('ADMIN','SATIS','DEPO','LOJISTIK','SOFOR');
CREATE TYPE order_status AS ENUM (
  'ALINDI','HAZIRLANIYOR','DEPODA_BEKLIYOR','YUKLENDI','SEVKIYATTA','TESLIM_EDILDI','IPTAL'
);

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  plate TEXT UNIQUE NOT NULL,
  model TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true
);

-- Müşterilere teslimat yapılan noktalar (harita için koordinatlı)
CREATE TABLE destinations (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL
);

CREATE TABLE customers (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  destination_id INT NOT NULL REFERENCES destinations(id),  -- varsayılan teslimat noktası
  active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  order_no TEXT UNIQUE NOT NULL,
  customer_id INT NOT NULL REFERENCES customers(id),
  warehouse TEXT NOT NULL,
  destination_id INT NOT NULL REFERENCES destinations(id),
  vehicle_id INT REFERENCES vehicles(id),
  driver_id INT REFERENCES users(id),      -- sevkiyatı yapacak şoför
  status order_status NOT NULL DEFAULT 'ALINDI',
  note TEXT,
  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INT REFERENCES users(id),

  -- Rota ve sevkiyat bilgileri
  route JSONB,                    -- [[lat, lng], ...]
  distance_km NUMERIC(8,1),
  route_minutes NUMERIC(8,1),     -- tahmini gerçek yol süresi
  departed_at TIMESTAMPTZ,        -- araç yola çıkış zamanı
  transit_minutes NUMERIC(8,2)    -- bu sevkiyat için planlanan yol süresi
);

CREATE TABLE order_events (
  id SERIAL PRIMARY KEY,
  order_id INT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status order_status NOT NULL,
  changed_by INT REFERENCES users(id),
  note TEXT,                      -- iptal gerekçesi, teslim alan kişi vb.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_vehicle ON orders(vehicle_id);
CREATE INDEX idx_orders_driver ON orders(driver_id);
CREATE INDEX idx_events_order ON order_events(order_id);
