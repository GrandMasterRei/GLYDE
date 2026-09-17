import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { dashboardSummary, listAlerts } from '../services/orders.js';

const router = Router();

router.get('/dashboard', requireAuth, async (req, res) => {
  res.json(await dashboardSummary(req.user));
});

router.get('/alerts', requireAuth, async (req, res) => {
  res.json(await listAlerts(req.user));
});

export default router;
