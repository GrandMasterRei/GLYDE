import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { JWT_SECRET } from '../config/env.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'E-posta ve şifre gerekli' });
  }

  const { rows } = await pool.query(
    'SELECT id, name, email, role, password_hash FROM users WHERE email = $1 AND active',
    [String(email).toLowerCase().trim()]
  );
  const user = rows[0];

  if (!user || !(await bcrypt.compare(String(password), user.password_hash))) {
    return res.status(401).json({ error: 'E-posta veya şifre hatalı' });
  }

  const payload = { id: user.id, name: user.name, role: user.role, email: user.email };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '8h' });

  res.json({ token, user: payload });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
