import jwt from 'jsonwebtoken';
import { JWT_SECRET } from '../config/env.js';
import { pool } from '../db.js';

// Token geçerli olsa bile kullanıcı pasife alındıysa veya rolü değiştiyse oturum kapanır
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Giriş yapmanız gerekiyor' });

  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Oturumun süresi doldu, tekrar giriş yapın' });
  }

  const { rows: [user] } = await pool.query(
    'SELECT id, name, email, role FROM users WHERE id = $1 AND active',
    [payload.id]
  );
  if (!user || user.role !== payload.role) {
    return res.status(401).json({ error: 'Oturum geçersiz, tekrar giriş yapın' });
  }

  req.user = user;
  next();
}

export function requireRole(...roles) {
  return (req, res, next) =>
    roles.includes(req.user.role)
      ? next()
      : res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
}
