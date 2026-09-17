import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth.js';
import * as admin from '../services/admin.js';

const router = Router();
router.use(requireAuth, requireRole('ADMIN'));

router.get('/users/suggest-email', async (req, res) => {
  res.json({ email: await admin.suggestEmail(req.query.role) });
});

router.get('/users', async (req, res) => res.json(await admin.listUsers(req.user)));
router.post('/users', async (req, res) => res.status(201).json(await admin.createUser(req.user, req.body || {})));
router.patch('/users/:id', async (req, res) => res.json(await admin.updateUser(req.user, req.params.id, req.body || {})));

router.get('/vehicles', async (req, res) => res.json(await admin.listVehicles(req.user)));
router.post('/vehicles', async (req, res) => res.status(201).json(await admin.createVehicle(req.user, req.body || {})));
router.patch('/vehicles/:id', async (req, res) => res.json(await admin.updateVehicle(req.user, req.params.id, req.body || {})));

router.get('/customers', async (req, res) => res.json(await admin.listCustomers(req.user)));
router.post('/customers', async (req, res) => res.status(201).json(await admin.createCustomer(req.user, req.body || {})));
router.patch('/customers/:id', async (req, res) => res.json(await admin.updateCustomer(req.user, req.params.id, req.body || {})));

router.patch('/:entity/:id/active', async (req, res) => {
  res.json(await admin.setActive(req.user, req.params.entity, req.params.id, req.body?.active === true));
});

router.delete('/:entity/:id', async (req, res) => {
  res.json(await admin.removeRecord(req.user, req.params.entity, req.params.id));
});

export default router;
