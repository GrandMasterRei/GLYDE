import 'dotenv/config';
import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

// Veritabanı yeniden başlatılırsa sunucu çökmesin
pool.on('error', (err) => {
  console.error('Veritabanı bağlantı hatası:', err.message);
});
