import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import {
  listOrders, getOrder, createOrder, advanceOrder, assignVehicle, cancelOrder,
} from '../services/orders.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  res.json(await listOrders(req.user, req.query));
});

router.get('/:id', async (req, res) => {
  res.json(await getOrder(req.user, req.params.id));
});

router.post('/', requireRole('SATIS', 'ADMIN'), async (req, res) => {
  res.status(201).json(await createOrder(req.user, req.body));
});

router.patch('/:id/advance', async (req, res) => {
  res.json(await advanceOrder(req.user, req.params.id, { note: req.body?.note }));
});

router.patch('/:id/vehicle', requireRole('LOJISTIK', 'ADMIN'), async (req, res) => {
  res.json(await assignVehicle(req.user, req.params.id, req.body?.vehicle_id, req.body?.driver_id));
});

router.patch('/:id/cancel', requireRole('SATIS', 'ADMIN'), async (req, res) => {
  res.json(await cancelOrder(req.user, req.params.id, req.body?.reason));
});

export default router;
