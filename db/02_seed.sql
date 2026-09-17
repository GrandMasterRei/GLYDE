-- Kullanıcılar (şifre: 123456)
INSERT INTO users (name, email, password_hash, role) VALUES
('Selin Aydın',  'admin@glyde.app',    crypt('123456', gen_salt('bf')), 'ADMIN'),
('Ayşe Kaya',    'satis@glyde.app',    crypt('123456', gen_salt('bf')), 'SATIS'),
('Kemal Arslan', 'depo@glyde.app',     crypt('123456', gen_salt('bf')), 'DEPO'),
('Murat Şahin',  'lojistik@glyde.app', crypt('123456', gen_salt('bf')), 'LOJISTIK');

-- Şoförler (şifre: 123456). sofor1 … sofor8
INSERT INTO users (name, email, password_hash, role)
SELECT name, email, crypt('123456', gen_salt('bf')), 'SOFOR'
FROM (VALUES
  ('Mehmet Yılmaz', 'sofor1@glyde.app'),
  ('Ali Demir',     'sofor2@glyde.app'),
  ('Hasan Kaya',    'sofor3@glyde.app'),
  ('Emre Çelik',    'sofor4@glyde.app'),
  ('Burak Öztürk',  'sofor5@glyde.app'),
  ('Serkan Aydın',  'sofor6@glyde.app'),
  ('Okan Yıldız',   'sofor7@glyde.app'),
  ('Kerem Aksoy',   'sofor8@glyde.app')
) AS d(name, email);

INSERT INTO vehicles (plate, model) VALUES
('34 GLY 101', 'Mercedes-Benz Actros'),
('34 GLY 102', 'Ford Trucks F-MAX'),
('35 GLY 201', 'Iveco S-Way'),
('34 GLY 103', 'Volvo FH'),
('41 GLY 301', 'Scania R450'),
('34 GLY 104', 'MAN TGX'),
('35 GLY 202', 'Isuzu NPR'),
('41 GLY 302', 'Renault Trucks T');

INSERT INTO destinations (name, city, lat, lng) VALUES
('İkitelli OSB',     'İstanbul',  41.0705, 28.7905),   -- 1
('Tuzla OSB',        'İstanbul',  40.8616, 29.3505),   -- 2
('Gebze OSB',        'Kocaeli',   40.8530, 29.4670),   -- 3
('Çerkezköy OSB',    'Tekirdağ',  41.2980, 27.9800),   -- 4
('Nilüfer OSB',      'Bursa',     40.2265, 28.9390),   -- 5
('Eskişehir OSB',    'Eskişehir', 39.7700, 30.6400),   -- 6
('OSTİM OSB',        'Ankara',    39.9700, 32.7450),   -- 7
('Manisa OSB',       'Manisa',    38.6250, 27.3700),   -- 8
('Torbalı Sanayi',   'İzmir',     38.1560, 27.3610),   -- 9
('Aliağa Kimya OSB', 'İzmir',     38.8250, 26.9950);   -- 10

INSERT INTO customers (name, destination_id) VALUES
('Anadolu Otomotiv', 1),
('Atlas Mobilya', 1),
('Başak Otomotiv', 3),
('Boğaz Denizcilik', 5),
('Delta Elektrik', 7),
('Ege Gıda', 9),
('Kaya Metal', 5),
('Kuzey Tekstil', 2),
('Marmara Yapı', 3),
('Mavi Ambalaj', 8),
('Nova Plastik', 8),
('Orion Medikal', 7),
('Pera Kozmetik', 4),
('Toros Kimya', 6),
('Yıldız Makine', 10);

-- Bugün sabahtan beri gelen siparişler.
-- Dakikalar kurulum anına göre geriye dönüktür. Sevkiyattakiler için tahmini gerçek yol
-- süresi (trip) ve kat edilen oran (done) verilir; süre simülasyon hızına bölünür.
WITH speed AS (
  SELECT GREATEST(COALESCE(NULLIF(current_setting('glyde.speed', true), '')::numeric, 1), 1) AS k
)
INSERT INTO orders (order_no, customer_id, destination_id, warehouse, vehicle_id, driver_id, status, note, created_at, status_changed_at, transit_minutes, route_minutes, created_by)
SELECT v.order_no, c.id, c.destination_id, v.warehouse, v.vehicle_id, dr.id, v.status::order_status, v.note,
       now() - make_interval(mins => v.created_ago),
       now() - make_interval(secs => (CASE WHEN v.status = 'SEVKIYATTA'
                                           THEN v.trip / speed.k * v.done
                                           ELSE v.changed_ago END * 60)::float8),
       CASE WHEN v.status = 'SEVKIYATTA' THEN round(v.trip / speed.k, 2) END,
       v.trip,
       2
FROM (VALUES
  ('GL-001', 'Anadolu Otomotiv', 'İstanbul Depo', 1,    'sofor1@glyde.app'::text, 'TESLIM_EDILDI',   540, 60,  NULL::numeric, NULL::numeric, NULL),
  ('GL-002', 'Marmara Yapı',     'Kocaeli Depo',  2,    'sofor2@glyde.app', 'TESLIM_EDILDI',   480, 120, NULL, NULL, NULL),
  ('GL-003', 'Ege Gıda',         'İzmir Depo',    3,    'sofor3@glyde.app', 'YUKLENDI',        360, 100, NULL, NULL, 'Soğuk zincir, 4°C altında taşınmalı'),
  ('GL-004', 'Kuzey Tekstil',    'Kocaeli Depo',  5,    'sofor5@glyde.app', 'SEVKIYATTA',      330, 0,   40,   1.1,  NULL),
  ('GL-005', 'Delta Elektrik',   'İstanbul Depo', 4,    'sofor4@glyde.app', 'SEVKIYATTA',      300, 0,   330,  0.15, NULL),
  ('GL-006', 'Boğaz Denizcilik', 'Kocaeli Depo',  NULL, NULL,               'DEPODA_BEKLIYOR', 270, 165, NULL, NULL, NULL),
  ('GL-007', 'Pera Kozmetik',    'İstanbul Depo', NULL, NULL,               'HAZIRLANIYOR',    240, 180, NULL, NULL, 'Kırılabilir ürün, dikkatli yükleyin'),
  ('GL-008', 'Başak Otomotiv',   'İstanbul Depo', 1,    'sofor1@glyde.app', 'YUKLENDI',        180, 20,  NULL, NULL, NULL),
  ('GL-009', 'Nova Plastik',     'İzmir Depo',    7,    'sofor7@glyde.app', 'SEVKIYATTA',      165, 0,   55,   0.2,  NULL),
  ('GL-010', 'Yıldız Makine',    'İzmir Depo',    NULL, NULL,               'DEPODA_BEKLIYOR', 120, 30,  NULL, NULL, NULL),
  ('GL-011', 'Toros Kimya',      'Kocaeli Depo',  NULL, NULL,               'HAZIRLANIYOR',    90,  45,  NULL, NULL, NULL),
  ('GL-012', 'Atlas Mobilya',    'İstanbul Depo', NULL, NULL,               'ALINDI',          70,  70,  NULL, NULL, NULL),
  ('GL-013', 'Mavi Ambalaj',     'İzmir Depo',    NULL, NULL,               'ALINDI',          25,  25,  NULL, NULL, 'Teslimatta irsaliye imzalatılacak')
) AS v(order_no, customer, warehouse, vehicle_id, driver, status, created_ago, changed_ago, trip, done, note)
JOIN customers c ON c.name = v.customer
LEFT JOIN users dr ON dr.email = v.driver
CROSS JOIN speed
ORDER BY v.order_no;

-- Geçmiş kayıtları: her aşamaya farklı ağırlıkta süre dağıtılır
WITH steps AS (
  SELECT o.id AS order_id, o.created_at, o.status_changed_at, s.status, s.idx,
         CASE WHEN s.idx = 1 THEN 0
              ELSE (ARRAY[0, 3, 8, 5, 4, 6])[s.idx] * (0.6 + ((o.id * 7 + s.idx * 13) % 9) / 10.0)
         END AS w
  FROM orders o
  CROSS JOIN LATERAL unnest(enum_range(NULL::order_status)) WITH ORDINALITY AS s(status, idx)
  WHERE s.status <= o.status
), cum AS (
  SELECT *,
         sum(w) OVER (PARTITION BY order_id ORDER BY idx) AS c,
         sum(w) OVER (PARTITION BY order_id) AS total
  FROM steps
)
INSERT INTO order_events (order_id, status, changed_by, note, created_at)
SELECT order_id,
       status,
       CASE
         WHEN status IN ('HAZIRLANIYOR','DEPODA_BEKLIYOR','YUKLENDI') THEN 3
         WHEN status IN ('SEVKIYATTA','TESLIM_EDILDI') THEN 4
         ELSE 2
       END,
       CASE WHEN status = 'TESLIM_EDILDI' THEN 'Teslim alan: Depo sorumlusu' END,
       created_at + (status_changed_at - created_at) * (CASE WHEN total = 0 THEN 0 ELSE c / total END)::float8
FROM cum
ORDER BY order_id, idx;

-- Yola çıkış zamanı = "Sevkiyatta" kaydının zamanı
UPDATE orders o
SET departed_at = e.created_at
FROM order_events e
WHERE e.order_id = o.id AND e.status = 'SEVKIYATTA';

-- Teslim edilenlerde yol süresi = sevkiyat ile teslim arasındaki süre
UPDATE orders o
SET transit_minutes = ROUND((EXTRACT(EPOCH FROM (t.created_at - s.created_at)) / 60)::numeric, 2)
FROM order_events s, order_events t
WHERE o.status = 'TESLIM_EDILDI'
  AND s.order_id = o.id AND s.status = 'SEVKIYATTA'
  AND t.order_id = o.id AND t.status = 'TESLIM_EDILDI';
