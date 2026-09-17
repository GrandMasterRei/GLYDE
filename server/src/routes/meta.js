import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { SIMULATION_SPEED } from '../config/env.js';
import { WAREHOUSES, WAREHOUSE_NAMES } from '../config/locations.js';
import {
  STATUS_FLOW, STATUS_LABELS, STATUS_LIMITS, DELIVERY_TOLERANCE,
} from '../config/statuses.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const [vehicles, drivers, destinations, customers] = await Promise.all([
    pool.query(`
      SELECT v.id, v.plate, v.model,
             b.order_no AS busy_order_no, b.status AS busy_status
      FROM vehicles v
      LEFT JOIN LATERAL (
        SELECT o.order_no, o.status FROM orders o
        WHERE o.vehicle_id = v.id AND o.status IN ('YUKLENDI', 'SEVKIYATTA')
        ORDER BY o.status DESC
        LIMIT 1
      ) b ON true
      WHERE v.active
      ORDER BY v.plate
    `),
    pool.query(`
      SELECT u.id, u.name, b.order_no AS busy_order_no
      FROM users u
      LEFT JOIN LATERAL (
        SELECT o.order_no FROM orders o
        WHERE o.driver_id = u.id AND o.status IN ('YUKLENDI', 'SEVKIYATTA')
        LIMIT 1
      ) b ON true
      WHERE u.role = 'SOFOR' AND u.active
      ORDER BY u.name
    `),
    pool.query('SELECT id, name, city FROM destinations ORDER BY city, name'),
    pool.query('SELECT id, name, destination_id FROM customers WHERE active ORDER BY name'),
  ]);

  res.json({
    statuses: STATUS_FLOW.map((s) => ({
      value: s,
      label: STATUS_LABELS[s],
      limit: STATUS_LIMITS[s] ?? null,
    })),
    deliveryTolerance: DELIVERY_TOLERANCE,
    simulationSpeed: SIMULATION_SPEED,
    warehouses: WAREHOUSE_NAMES,
    warehouseLocations: WAREHOUSES,
    customers: customers.rows,
    destinations: destinations.rows,
    vehicles: vehicles.rows,
    drivers: drivers.rows,
  });
});

export default router;
