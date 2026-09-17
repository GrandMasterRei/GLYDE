// Sipariş işlemleri. API rotaları ve asistan aynı kuralları buradan kullanır.
import { pool } from '../db.js';
import { HttpError } from '../lib/errors.js';
import { formatDuration } from '../lib/format.js';
import { orderSelect, parseId, findBusyOrder } from '../queries.js';
import { SIMULATION_SPEED } from '../config/env.js';
import { WAREHOUSE_NAMES } from '../config/locations.js';
import {
  ALL_STATUSES, STATUS_FLOW, STATUS_LABELS, VEHICLE_ASSIGNABLE, CANCELLABLE,
  enrichOrder, canAdvance, nextStatus, isMyTask,
} from '../config/statuses.js';
import { ensureRoute } from './tracking.js';
import { WAREHOUSES } from '../config/locations.js';

const text = (v) => String(v ?? '').trim();

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listOrders(user, { status, warehouse, q } = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (user.role === 'SOFOR') add('o.driver_id = ?', user.id);
  if (status && ALL_STATUSES.includes(status)) add('o.status = ?', status);
  if (warehouse && WAREHOUSE_NAMES.includes(warehouse)) add('o.warehouse = ?', warehouse);
  if (q) {
    params.push(`%${text(q)}%`);
    const p = `$${params.length}`;
    where.push(`(o.order_no ILIKE ${p} OR c.name ILIKE ${p} OR d.name ILIKE ${p} OR v.plate ILIKE ${p})`);
  }

  const { rows } = await pool.query(
    `${orderSelect()} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.created_at DESC`,
    params
  );
  return rows.map((r) => enrichOrder(r, user));
}

// Canlı takip: yüklenmiş ve yoldaki araçlar, rotalarıyla
export async function listShipments(user) {
  const { rows } = await pool.query(`
    ${orderSelect({ withRoute: true })}
    WHERE o.status IN ('YUKLENDI', 'SEVKIYATTA')
    ORDER BY o.status DESC, o.departed_at NULLS LAST, o.status_changed_at
  `);

  // Rotası olmayanları sırayla hazırla (dış servise aynı anda çok istek atmamak için)
  const shipments = [];
  for (const row of rows) shipments.push(enrichOrder(await ensureRoute(row), user));

  return { serverTime: new Date().toISOString(), warehouses: WAREHOUSES, shipments };
}

// Şu an ilerletilebilecek işler (araç bekleyenler ve yolda olanlar hariç)
export async function pendingTasks(user) {
  const orders = await listOrders(user);
  return orders.filter((o) => o.can_advance && o.next_status
    && !(o.next_status === 'YUKLENDI' && (!o.vehicle_id || !o.driver_id))
    && !(o.next_status === 'TESLIM_EDILDI' && !o.arrived));
}

// Bekleyen tüm işleri sırayla ilerletir
export async function advancePending(user) {
  const tasks = await pendingTasks(user);
  const done = [];
  const failed = [];
  for (const task of tasks) {
    try {
      const r = await advanceOrder(user, task.id);
      done.push({ order_no: r.order_no, durum: r.status_label });
    } catch (err) {
      failed.push({ order_no: task.order_no, hata: err.message });
    }
  }
  return { islenen: done, atlanan: failed };
}

export async function findOrderId(orderNo) {
  const m = text(orderNo).toUpperCase().match(/(\d{1,4})/);
  if (!m) throw new HttpError(400, 'Sipariş numarası anlaşılamadı');
  const no = `GL-${m[1].padStart(3, '0')}`;
  const { rows } = await pool.query('SELECT id FROM orders WHERE order_no = $1', [no]);
  if (!rows[0]) throw new HttpError(404, `${no} bulunamadı`);
  return rows[0].id;
}

export async function getOrder(user, rawId) {
  const id = parseId(rawId);
  if (!id) throw new HttpError(404, 'Sipariş bulunamadı');

  const { rows: [row] } = await pool.query(`${orderSelect({ withRoute: true })} WHERE o.id = $1`, [id]);
  if (!row || (user.role === 'SOFOR' && row.driver_id !== user.id)) {
    throw new HttpError(404, 'Sipariş bulunamadı');
  }

  const order = await ensureRoute(row);
  const { rows: events } = await pool.query(
    `SELECT e.id, e.status, e.note, e.created_at, u.name AS changed_by_name
     FROM order_events e LEFT JOIN users u ON u.id = e.changed_by
     WHERE e.order_id = $1 ORDER BY e.created_at, e.id`,
    [id]
  );
  return { ...enrichOrder(order, user), events, server_time: new Date().toISOString() };
}

export async function createOrder(user, body) {
  if (!['SATIS', 'ADMIN'].includes(user.role)) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
  const customerId = parseId(body?.customer_id);
  const warehouse = text(body?.warehouse);
  const note = text(body?.note).slice(0, 300) || null;
  if (!customerId) throw new HttpError(400, 'Müşteri seçin');
  if (!WAREHOUSE_NAMES.includes(warehouse)) throw new HttpError(400, 'Depo seçin');

  const { rows: [customer] } = await pool.query(
    'SELECT id, destination_id FROM customers WHERE id = $1 AND active', [customerId]
  );
  if (!customer) throw new HttpError(400, 'Müşteri bulunamadı');
  const destinationId = parseId(body?.destination_id) ?? customer.destination_id;

  return withTransaction(async (client) => {
    await client.query('LOCK TABLE orders IN EXCLUSIVE MODE');
    const { rows: [{ n }] } = await client.query(
      'SELECT COALESCE(MAX(SUBSTRING(order_no FROM 4)::int), 0) + 1 AS n FROM orders'
    );
    const orderNo = `GL-${String(n).padStart(3, '0')}`;
    const { rows: [order] } = await client.query(
      `INSERT INTO orders (order_no, customer_id, warehouse, destination_id, note, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [orderNo, customerId, warehouse, destinationId, note, user.id]
    );
    await client.query(
      "INSERT INTO order_events (order_id, status, changed_by) VALUES ($1, 'ALINDI', $2)",
      [order.id, user.id]
    );
    return { id: order.id, order_no: orderNo };
  });
}

export async function advanceOrder(user, rawId, { note } = {}) {
  const id = parseId(rawId);
  if (!id) throw new HttpError(404, 'Sipariş bulunamadı');

  // Sevkiyata çıkacaksa rotayı transaction dışında hazırla (dış servis çağrısı)
  const { rows: [current] } = await pool.query(`${orderSelect({ withRoute: true })} WHERE o.id = $1`, [id]);
  if (!current) throw new HttpError(404, 'Sipariş bulunamadı');
  const planned = current.status === 'YUKLENDI' ? await ensureRoute(current) : null;

  return withTransaction(async (client) => {
    const { rows: [order] } = await client.query(
      `SELECT o.id, o.order_no, o.status, o.vehicle_id, o.driver_id,
              o.departed_at IS NOT NULL
                AND now() >= o.departed_at + make_interval(secs => (o.transit_minutes * 60)::float8) AS arrived
       FROM orders o WHERE o.id = $1 FOR UPDATE`,
      [id]
    );
    if (!order) throw new HttpError(404, 'Sipariş bulunamadı');

    const next = nextStatus(order.status);
    if (!next) throw new HttpError(400, order.status === 'IPTAL' ? 'Sipariş iptal edilmiş' : 'Sipariş zaten teslim edildi');
    if (!canAdvance(user, order)) throw new HttpError(403, 'Bu adımı gerçekleştirme yetkiniz yok');

    if (next === 'YUKLENDI') {
      if (!order.vehicle_id || !order.driver_id) {
        throw new HttpError(400, 'Yükleme için önce araç ve şoför atanmalı');
      }
      const busyVehicle = await findBusyOrder(client, 'vehicle', order.vehicle_id, id);
      if (busyVehicle) throw new HttpError(409, `Araç şu an ${busyVehicle} siparişinde`);
      const busyDriver = await findBusyOrder(client, 'driver', order.driver_id, id);
      if (busyDriver) throw new HttpError(409, `Şoför şu an ${busyDriver} siparişinde`);
    }
    if (next === 'TESLIM_EDILDI' && !order.arrived) {
      throw new HttpError(409, 'Araç henüz teslimat noktasına ulaşmadı');
    }

    if (next === 'SEVKIYATTA') {
      if (!planned) throw new HttpError(409, 'Sipariş durumu değişti, sayfayı yenileyin');
      // Simülasyon: yol süresi hız çarpanına bölünür, en az 30 sn
      const transit = Math.max(0.5, Math.round((planned.route_minutes / SIMULATION_SPEED) * 100) / 100);
      await client.query(
        `UPDATE orders
         SET status = $1, status_changed_at = now(), departed_at = now(),
             transit_minutes = $2, distance_km = $3, route_minutes = $4,
             route = COALESCE($5::jsonb, route)
         WHERE id = $6`,
        [next, transit, planned.distance_km, planned.route_minutes,
          planned.route_estimated ? null : JSON.stringify(planned.route), id]
      );
    } else {
      await client.query('UPDATE orders SET status = $1, status_changed_at = now() WHERE id = $2', [next, id]);
    }

    await client.query(
      'INSERT INTO order_events (order_id, status, changed_by, note) VALUES ($1, $2, $3, $4)',
      [id, next, user.id, text(note).slice(0, 200) || null]
    );
    return { ok: true, order_no: order.order_no, status: next, status_label: STATUS_LABELS[next] };
  });
}

// Araç ve şoför ataması. Şoför verilmezse müsait olanlardan biri atanır.
export async function assignVehicle(user, rawId, rawVehicleId, rawDriverId) {
  if (!['LOJISTIK', 'ADMIN'].includes(user.role)) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
  const id = parseId(rawId);
  const vehicleId = parseId(rawVehicleId);
  if (!id) throw new HttpError(404, 'Sipariş bulunamadı');
  if (!vehicleId) throw new HttpError(400, 'Araç seçin');

  const { rows: [vehicle] } = await pool.query(
    'SELECT id, plate FROM vehicles WHERE id = $1 AND active', [vehicleId]
  );
  if (!vehicle) throw new HttpError(400, 'Araç bulunamadı');
  const busyVehicle = await findBusyOrder(pool, 'vehicle', vehicleId, id);
  if (busyVehicle) throw new HttpError(409, `Bu araç şu an ${busyVehicle} siparişinde`);

  let driverId = parseId(rawDriverId);
  if (driverId) {
    const { rows: [driver] } = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'SOFOR' AND active", [driverId]
    );
    if (!driver) throw new HttpError(400, 'Şoför bulunamadı');
    const busyDriver = await findBusyOrder(pool, 'driver', driverId, id);
    if (busyDriver) throw new HttpError(409, `Bu şoför şu an ${busyDriver} siparişinde`);
  } else {
    const [free] = await availableDrivers();
    if (!free) throw new HttpError(409, 'Şu an müsait şoför yok');
    driverId = free.id;
  }

  const { rows: [order] } = await pool.query(
    `UPDATE orders SET vehicle_id = $1, driver_id = $2
     WHERE id = $3 AND status = ANY($4::order_status[])
     RETURNING order_no, (SELECT name FROM users WHERE id = $2) AS driver_name`,
    [vehicleId, driverId, id, VEHICLE_ASSIGNABLE]
  );
  if (!order) throw new HttpError(400, 'Araç yalnızca yükleme öncesinde atanabilir');
  return { ok: true, order_no: order.order_no, plate: vehicle.plate, driver_name: order.driver_name };
}

// Aktif sevkiyatta olmayan şoförler
export async function availableDrivers() {
  const { rows } = await pool.query(`
    SELECT u.id, u.name FROM users u
    WHERE u.role = 'SOFOR' AND u.active AND NOT EXISTS (
      SELECT 1 FROM orders o WHERE o.driver_id = u.id AND o.status IN ('YUKLENDI', 'SEVKIYATTA')
    )
    ORDER BY u.name
  `);
  return rows;
}

export async function findDriverId(name) {
  const { rows } = await pool.query("SELECT id, name FROM users WHERE role = 'SOFOR' AND active");
  const q = text(name).toLocaleLowerCase('tr-TR');
  const hit = rows.find((u) => u.name.toLocaleLowerCase('tr-TR') === q)
    || rows.find((u) => u.name.toLocaleLowerCase('tr-TR').includes(q));
  if (!hit) throw new HttpError(404, `"${name}" adlı şoför bulunamadı`);
  return hit.id;
}

// Plaka ya da model adıyla araç bulur
export async function findVehicleId(query) {
  const raw = text(query);
  const plate = raw.toLocaleUpperCase('tr-TR').replace(/\s+/g, '');
  const { rows } = await pool.query('SELECT id, plate, model FROM vehicles WHERE active');
  const hit = rows.find((v) => v.plate.replace(/\s+/g, '') === plate)
    || rows.find((v) => v.model.toLocaleLowerCase('tr-TR') === raw.toLocaleLowerCase('tr-TR'));
  if (!hit) throw new HttpError(404, `"${raw}" plakalı araç bulunamadı`);
  return hit.id;
}

export async function availableVehicles() {
  const { rows } = await pool.query(`
    SELECT v.id, v.plate, v.model FROM vehicles v
    WHERE v.active AND NOT EXISTS (
      SELECT 1 FROM orders o WHERE o.vehicle_id = v.id AND o.status IN ('YUKLENDI', 'SEVKIYATTA')
    )
    ORDER BY v.plate
  `);
  return rows;
}

export async function cancelOrder(user, rawId, reason) {
  if (!['SATIS', 'ADMIN'].includes(user.role)) throw new HttpError(403, 'Bu işlem için yetkiniz yok');
  const id = parseId(rawId);
  const why = text(reason).slice(0, 200);
  if (!id) throw new HttpError(404, 'Sipariş bulunamadı');
  if (!why) throw new HttpError(400, 'İptal gerekçesi girin');

  return withTransaction(async (client) => {
    const { rows: [order] } = await client.query(
      "UPDATE orders SET status = 'IPTAL', status_changed_at = now() WHERE id = $1 AND status = ANY($2::order_status[]) RETURNING order_no",
      [id, CANCELLABLE]
    );
    if (!order) throw new HttpError(400, 'Sipariş yalnızca yükleme öncesinde iptal edilebilir');
    await client.query(
      "INSERT INTO order_events (order_id, status, changed_by, note) VALUES ($1, 'IPTAL', $2, $3)",
      [id, user.id, why]
    );
    return { ok: true, order_no: order.order_no, status: 'IPTAL' };
  });
}

export async function dashboardSummary(user) {
  if (user.role === 'SOFOR') throw new HttpError(403, 'Bu işlem için yetkiniz yok');
  const all = await listOrders(user);
  const orders = all.filter((o) => o.status !== 'IPTAL');

  const byStatus = STATUS_FLOW.map((status) => ({
    status, label: STATUS_LABELS[status], count: orders.filter((o) => o.status === status).length,
  }));
  const byWarehouse = WAREHOUSE_NAMES.map((warehouse) => {
    const active = orders.filter((o) => o.warehouse === warehouse && o.status !== 'TESLIM_EDILDI');
    const inStage = (...statuses) => active.filter((o) => statuses.includes(o.status)).length;
    return {
      warehouse,
      count: active.length,
      preparing: inStage('ALINDI', 'HAZIRLANIYOR'),
      waiting: inStage('DEPODA_BEKLIYOR', 'YUKLENDI'),
      transit: inStage('SEVKIYATTA'),
    };
  });
  const delayed = orders
    .filter((o) => o.is_delayed)
    .sort((a, b) => b.delay_minutes - a.delay_minutes)
    .map(({ id, order_no, customer, status, status_label, minutes_in_status, delay_minutes, arrived }) => ({
      id, order_no, customer, status, status_label, minutes_in_status, delay_minutes, arrived,
    }));

  const { rows: [{ count: deliveredToday }] } = await pool.query(
    `SELECT count(*)::int AS count FROM order_events
     WHERE status = 'TESLIM_EDILDI'
       AND created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'`
  );
  const delivered = byStatus.at(-1).count;

  return {
    total: orders.length,
    active: orders.length - delivered,
    delivered,
    cancelled: all.length - orders.length,
    deliveredToday,
    inTransit: orders.filter((o) => o.status === 'SEVKIYATTA').length,
    awaitingDelivery: orders.filter((o) => o.arrived).length,
    delayedCount: delayed.length,
    myActionCount: orders.filter((o) => o.is_my_task).length,
    byStatus,
    byWarehouse,
    delayed,
  };
}

// Sıradaki işin kısa açıklaması
function taskText(o) {
  if (o.status === 'ALINDI') return 'Hazırlık bekliyor';
  if (o.status === 'HAZIRLANIYOR') return 'Hazırlığın tamamlanması bekleniyor';
  if (o.status === 'DEPODA_BEKLIYOR') return o.vehicle_id ? 'Yükleme bekliyor' : 'Araç ataması bekliyor';
  if (o.status === 'YUKLENDI') return 'Yük hazır, sevkiyata çıkış bekliyor';
  return 'Teslim bekleniyor';
}

// Rolün ilgilenmesi gereken bildirimler: gecikme, süre uyarısı, yeni görev, varış
export async function listAlerts(user) {
  const orders = (await listOrders(user)).filter((o) => !['TESLIM_EDILDI', 'IPTAL'].includes(o.status));
  const alerts = [];

  for (const o of orders) {
    const mine = isMyTask(user, o);
    const relevant = user.role === 'ADMIN' || mine;
    const base = { order_id: o.id, order_no: o.order_no, customer: o.customer, status: o.status };

    if (o.is_delayed && (relevant || user.role === 'SATIS' || o.arrived)) {
      alerts.push({
        ...base, id: `${o.id}-${o.status}-delayed`, level: 'danger',
        title: o.arrived ? 'Teslim onayı gecikti' : `${o.status_label} gecikti`,
        detail: `Süre ${formatDuration(o.delay_minutes)} aşıldı`,
      });
    } else if (o.arrived && (relevant || user.role === 'SATIS')) {
      alerts.push({
        ...base, id: `${o.id}-arrived`, level: 'info',
        title: 'Araç teslimat noktasında', detail: `${o.destination.name} · teslim bekleniyor`,
      });
    } else if (o.is_warning && relevant) {
      alerts.push({
        ...base, id: `${o.id}-${o.status}-warning`, level: 'warning',
        title: `${o.status_label} süresi dolmak üzere`,
        detail: `${formatDuration(o.minutes_to_limit)} kaldı`,
      });
    } else if (user.role === 'SOFOR' && o.status !== 'SEVKIYATTA') {
      // Şoföre araç atandığında ve yük hazır olduğunda
      const ready = o.status === 'YUKLENDI';
      alerts.push({
        ...base, id: `${o.id}-driver-${ready ? 'ready' : o.vehicle_id}`, level: 'task',
        title: ready ? 'Yük hazır' : 'Yeni görev',
        detail: ready ? `${o.destination.name} için yola çıkabilirsiniz` : `${o.destination.name}, ${o.destination.city}`,
      });
    } else if (mine && user.role !== 'SOFOR') {
      alerts.push({
        ...base, id: `${o.id}-${o.status}-${o.vehicle_id ?? 0}-task`, level: 'task',
        title: 'Yeni görev', detail: taskText(o),
      });
    }
  }

  const rank = { danger: 0, warning: 1, task: 2, info: 3 };
  return alerts.sort((x, y) => rank[x.level] - rank[y.level]);
}
