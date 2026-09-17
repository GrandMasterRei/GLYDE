export function orderSelect({ withRoute = false } = {}) {
  return `
    SELECT o.id, o.order_no, o.customer_id, c.name AS customer, o.warehouse, o.status, o.note,
           o.created_at, o.status_changed_at,
           o.vehicle_id, v.plate, v.model AS vehicle_model, o.driver_id, dr.name AS driver_name,
           o.destination_id, d.name AS destination_name, d.city AS destination_city,
           d.lat AS destination_lat, d.lng AS destination_lng,
           o.distance_km, o.route_minutes, o.departed_at, o.transit_minutes,
           ${withRoute ? 'o.route,' : ''}
           EXTRACT(EPOCH FROM (now() - o.status_changed_at)) / 60 AS minutes_in_status
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    JOIN destinations d ON d.id = o.destination_id
    LEFT JOIN vehicles v ON v.id = o.vehicle_id
    LEFT JOIN users dr ON dr.id = o.driver_id
  `;
}

export function parseId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// Araç veya şoför başka bir aktif sevkiyatta mı?
export async function findBusyOrder(db, column, id, exceptOrderId = 0) {
  const { rows } = await db.query(
    `SELECT order_no FROM orders
     WHERE ${column === 'driver' ? 'driver_id' : 'vehicle_id'} = $1 AND id <> $2
       AND status IN ('YUKLENDI', 'SEVKIYATTA')
     LIMIT 1`,
    [id, exceptOrderId]
  );
  return rows[0]?.order_no || null;
}
