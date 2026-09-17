// Yönetim işlemleri (personel, araç, müşteri). API ve Pilot aynı kuralları kullanır.
import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { parseId, findBusyOrder } from '../queries.js';

export const ROLES = ['ADMIN', 'SATIS', 'DEPO', 'LOJISTIK', 'SOFOR'];
export const DEFAULT_PASSWORD = '123456';
const EMAIL_PREFIX = { ADMIN: 'yonetici', SATIS: 'satis', DEPO: 'depo', LOJISTIK: 'lojistik', SOFOR: 'sofor' };
const TABLES = { users: 'users', vehicles: 'vehicles', customers: 'customers' };

const text = (v) => String(v ?? '').trim();
const required = (value, message) => {
  if (!value) throw new HttpError(400, message);
  return value;
};

function assertAdmin(user) {
  if (user.role !== 'ADMIN') throw new HttpError(403, 'Bu işlem için yetkiniz yok');
}

function idOf(raw) {
  const id = parseId(raw);
  if (!id) throw new HttpError(404, 'Kayıt bulunamadı');
  return id;
}

async function guard(entity, id, user) {
  if (entity === 'users' && id === user.id) {
    throw new HttpError(400, 'Kendi hesabınızı pasife alamaz veya silemezsiniz');
  }
  if (entity === 'vehicles') {
    const busy = await findBusyOrder(pool, 'vehicle', id);
    if (busy) throw new HttpError(409, `Araç şu an ${busy} siparişinde`);
  }
  if (entity === 'users') {
    const busy = await findBusyOrder(pool, 'driver', id);
    if (busy) throw new HttpError(409, `Şoför şu an ${busy} siparişinde`);
  }
}

/* ---------- Personel ---------- */

// Rolün sıradaki e-postası: sofor1, sofor2 ... (admin@glyde.app gibi eski adresler de sayılır)
export async function suggestEmail(role) {
  const prefix = EMAIL_PREFIX[role];
  if (!prefix) throw new HttpError(400, 'Rol seçin');
  const { rows } = await pool.query(
    "SELECT substring(email from $1) AS n FROM users WHERE email ~ $2",
    [`^${prefix}(\\d*)@`, `^${prefix}\\d*@glyde\\.app$`]
  );
  const max = rows.reduce((m, r) => Math.max(m, r.n === '' ? 1 : Number(r.n)), 0);
  return `${prefix}${max + 1}@glyde.app`;
}

async function userInput(body, isNew) {
  const role = text(body.role);
  if (!ROLES.includes(role)) throw new HttpError(400, 'Rol seçin');
  let email = text(body.email).toLowerCase();
  if (!email && isNew) email = await suggestEmail(role);
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Geçerli bir e-posta girin');
  let password = String(body.password ?? '');
  if (!password && isNew) password = DEFAULT_PASSWORD;
  if (password && password.length < 6) throw new HttpError(400, 'Şifre en az 6 karakter olmalı');
  return { name: required(text(body.name), 'Ad soyad girin'), email, role, password };
}

export async function listUsers(user) {
  assertAdmin(user);
  const { rows } = await pool.query(`
    SELECT u.id, u.name, u.email, u.role, u.active, b.order_no AS busy_order_no
    FROM users u
    LEFT JOIN LATERAL (
      SELECT o.order_no FROM orders o
      WHERE o.driver_id = u.id AND o.status IN ('YUKLENDI', 'SEVKIYATTA')
      LIMIT 1
    ) b ON true
    ORDER BY u.active DESC, u.role, u.name
  `);
  return rows;
}

export async function createUser(user, body) {
  assertAdmin(user);
  const u = await userInput(body, true);
  const hash = await bcrypt.hash(u.password, 10);
  const { rows: [row] } = await pool.query(
    'INSERT INTO users (name, email, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [u.name, u.email, u.role, hash]
  );
  return { id: row.id, email: u.email, default_password: u.password === DEFAULT_PASSWORD };
}

export async function updateUser(user, rawId, body) {
  assertAdmin(user);
  const id = idOf(rawId);
  const u = await userInput(body, false);
  if (id === user.id && u.role !== user.role) throw new HttpError(400, 'Kendi rolünüzü değiştiremezsiniz');
  const hash = u.password ? await bcrypt.hash(u.password, 10) : null;
  const { rowCount } = await pool.query(
    `UPDATE users SET name = $1, email = $2, role = $3, password_hash = COALESCE($4, password_hash)
     WHERE id = $5`,
    [u.name, u.email, u.role, hash, id]
  );
  if (!rowCount) throw new HttpError(404, 'Kayıt bulunamadı');
  return { ok: true };
}

/* ---------- Araçlar ---------- */

function vehicleInput(body) {
  return {
    plate: required(text(body.plate).toLocaleUpperCase('tr-TR').replace(/\s+/g, ' '), 'Plaka girin'),
    model: required(text(body.model), 'Model girin'),
  };
}

export async function listVehicles(user) {
  assertAdmin(user);
  const { rows } = await pool.query(`
    SELECT v.id, v.plate, v.model, v.active, b.order_no AS busy_order_no
    FROM vehicles v
    LEFT JOIN LATERAL (
      SELECT o.order_no FROM orders o
      WHERE o.vehicle_id = v.id AND o.status IN ('YUKLENDI', 'SEVKIYATTA')
      LIMIT 1
    ) b ON true
    ORDER BY v.active DESC, v.plate
  `);
  return rows;
}

export async function createVehicle(user, body) {
  assertAdmin(user);
  const v = vehicleInput(body);
  const { rows: [row] } = await pool.query(
    'INSERT INTO vehicles (plate, model) VALUES ($1, $2) RETURNING id',
    [v.plate, v.model]
  );
  return { id: row.id, plate: v.plate };
}

export async function updateVehicle(user, rawId, body) {
  assertAdmin(user);
  const id = idOf(rawId);
  const v = vehicleInput(body);
  const { rowCount } = await pool.query(
    'UPDATE vehicles SET plate = $1, model = $2 WHERE id = $3',
    [v.plate, v.model, id]
  );
  if (!rowCount) throw new HttpError(404, 'Kayıt bulunamadı');
  return { ok: true };
}

/* ---------- Müşteriler ---------- */

function customerInput(body) {
  return {
    name: required(text(body.name), 'Müşteri adı girin'),
    destinationId: required(parseId(body.destination_id), 'Teslimat noktası seçin'),
  };
}

export async function listCustomers(user) {
  assertAdmin(user);
  const { rows } = await pool.query(`
    SELECT c.id, c.name, c.destination_id, c.active,
           d.name AS destination_name, d.city AS destination_city,
           (SELECT count(*)::int FROM orders o WHERE o.customer_id = c.id) AS order_count
    FROM customers c
    JOIN destinations d ON d.id = c.destination_id
    ORDER BY c.active DESC, c.name
  `);
  return rows;
}

export async function createCustomer(user, body) {
  assertAdmin(user);
  const c = customerInput(body);
  const { rows: [row] } = await pool.query(
    'INSERT INTO customers (name, destination_id) VALUES ($1, $2) RETURNING id',
    [c.name, c.destinationId]
  );
  return { id: row.id, name: c.name };
}

export async function updateCustomer(user, rawId, body) {
  assertAdmin(user);
  const id = idOf(rawId);
  const c = customerInput(body);
  const { rowCount } = await pool.query(
    'UPDATE customers SET name = $1, destination_id = $2 WHERE id = $3',
    [c.name, c.destinationId, id]
  );
  if (!rowCount) throw new HttpError(404, 'Kayıt bulunamadı');
  return { ok: true };
}

/* ---------- Ortak ---------- */

export async function setActive(user, entity, rawId, active) {
  assertAdmin(user);
  const table = TABLES[entity];
  if (!table) throw new HttpError(404, 'Kaynak bulunamadı');
  const id = idOf(rawId);
  if (!active) await guard(entity, id, user);
  const { rowCount } = await pool.query(`UPDATE ${table} SET active = $1 WHERE id = $2`, [active, id]);
  if (!rowCount) throw new HttpError(404, 'Kayıt bulunamadı');
  return { ok: true, active };
}

// Geçmiş siparişlerde kullanılan kayıt silinmez, pasife alınır
export async function removeRecord(user, entity, rawId) {
  assertAdmin(user);
  const table = TABLES[entity];
  if (!table) throw new HttpError(404, 'Kaynak bulunamadı');
  const id = idOf(rawId);
  await guard(entity, id, user);
  try {
    const { rowCount } = await pool.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    if (!rowCount) throw new HttpError(404, 'Kayıt bulunamadı');
    return { deleted: true };
  } catch (err) {
    if (err.code !== '23503') throw err;
    await pool.query(`UPDATE ${table} SET active = false WHERE id = $1`, [id]);
    return { archived: true };
  }
}

// Pilot için: ada veya plakaya göre kayıt bul
export async function findRecord(query) {
  const q = text(query).toLocaleLowerCase('tr-TR');
  const plate = q.replace(/\s+/g, '').toLocaleUpperCase('tr-TR');
  const [users, vehicles, customers] = await Promise.all([
    pool.query('SELECT id, name FROM users'),
    pool.query('SELECT id, plate FROM vehicles'),
    pool.query('SELECT id, name FROM customers'),
  ]);
  const match = (name) => name.toLocaleLowerCase('tr-TR') === q;
  const v = vehicles.rows.find((r) => r.plate.replace(/\s+/g, '') === plate);
  if (v) return { entity: 'vehicles', id: v.id, label: v.plate };
  const c = customers.rows.find((r) => match(r.name));
  if (c) return { entity: 'customers', id: c.id, label: c.name };
  const u = users.rows.find((r) => match(r.name));
  if (u) return { entity: 'users', id: u.id, label: u.name };
  throw new HttpError(404, `"${query}" bulunamadı`);
}
