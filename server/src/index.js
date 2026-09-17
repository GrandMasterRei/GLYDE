import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db.js';
import { PORT, SIMULATION_SPEED, RESET_DATA_ON_START } from './config/env.js';
import { bootstrapDatabase } from './services/bootstrap.js';
import { warmRoutes } from './services/tracking.js';
import authRoutes from './routes/auth.js';
import orderRoutes from './routes/orders.js';
import dashboardRoutes from './routes/dashboard.js';
import assistantRoutes from './routes/assistant.js';
import { HttpError } from './lib/errors.js';
import metaRoutes from './routes/meta.js';
import trackingRoutes from './routes/tracking.js';
import adminRoutes from './routes/admin.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '200kb' }));

app.get('/api/health', async (req, res) => {
  const { rows } = await pool.query('SELECT now()');
  res.json({ ok: true, dbTime: rows[0].now });
});

app.use('/api/auth', authRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api', dashboardRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/tracking', trackingRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api', (req, res) => {
  res.status(404).json({ error: 'Kaynak bulunamadı' });
});

// Beklenmeyen hatalar
app.use((err, req, res, next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'Bu bilgilerle kayıtlı bir kayıt zaten var' });
  if (err.code === '23503') return res.status(400).json({ error: 'Seçilen kayıt bulunamadı' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Geçersiz istek' });
  console.error(err);
  res.status(500).json({ error: 'Sunucu hatası' });
});

await bootstrapDatabase({ reset: RESET_DATA_ON_START });

app.listen(PORT, () => {
  console.log(`GLYDE API çalışıyor: http://localhost:${PORT}`);
  if (SIMULATION_SPEED > 1) {
    console.log(`Sunum modu açık: yeni sevkiyatlar ${SIMULATION_SPEED}x hızlı ilerler`);
  }
  warmRoutes();
});
