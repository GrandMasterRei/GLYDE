import { pool } from '../db.js';
import { orderSelect } from '../queries.js';
import { findWarehouse } from '../config/locations.js';
import { getRoute } from './routing.js';

// Siparişin rotası yoksa hesaplar. Gerçek rota bulunduysa veritabanına kaydeder.
export async function ensureRoute(order) {
  if (order.route) return order;

  const from = findWarehouse(order.warehouse);
  if (!from) return order;
  const to = { lat: order.destination_lat, lng: order.destination_lng };

  const r = await getRoute(from, to);
  if (r.source === 'osrm') {
    await pool.query(
      `UPDATE orders SET route = $1, distance_km = $2, route_minutes = COALESCE(route_minutes, $3)
       WHERE id = $4 AND route IS NULL`,
      [JSON.stringify(r.points), r.distanceKm, r.minutes, order.id]
    );
  }

  return {
    ...order,
    route: r.points,
    distance_km: r.distanceKm,
    route_minutes: order.route_minutes ?? r.minutes,
    route_estimated: r.source !== 'osrm',
  };
}

// Sunucu açılırken rotası olmayan siparişleri sırayla hazırla
export async function warmRoutes() {
  try {
    const { rows } = await pool.query(
      `${orderSelect({ withRoute: true })} WHERE o.route IS NULL ORDER BY o.status DESC`
    );
    if (!rows.length) return;

    for (const row of rows) await ensureRoute(row);

    const { rows: [{ missing }] } = await pool.query(
      'SELECT count(*)::int AS missing FROM orders WHERE route IS NULL'
    );
    const saved = rows.length - missing;
    console.log(`Rotalar: ${saved} kaydedildi${missing ? `, ${missing} için yedek rota kullanılıyor` : ''}`);
  } catch (err) {
    console.warn('Rotalar hazırlanamadı:', err.message);
  }
}
