import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { listShipments } from '../services/orders.js';

const router = Router();

router.get('/', requireAuth, requireRole('ADMIN', 'SATIS', 'LOJISTIK'), async (req, res) => {
  res.json(await listShipments(req.user));
});

export default router;
