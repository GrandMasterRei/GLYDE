import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../db.js';
import { SIMULATION_SPEED } from '../config/env.js';

const DB_DIR = process.env.DB_DIR
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../db');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForDatabase(retries = 30) {
  for (let i = 1; i <= retries; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === retries) throw err;
      console.log(`Veritabanı bekleniyor (${i}/${retries})...`);
      await sleep(2000);
    }
  }
}

// Tablolar yoksa (veya reset istenmişse) şemayı ve örnek verileri yükler
export async function bootstrapDatabase({ reset }) {
  await waitForDatabase();

  const { rows: [{ ready }] } = await pool.query(
    "SELECT to_regclass('public.orders') IS NOT NULL AS ready"
  );
  if (ready && !reset) {
    console.log('Veritabanı hazır, mevcut veriler kullanılıyor');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    // Örnek sevkiyatlar da aynı simülasyon hızında ilerlesin
    await client.query("SELECT set_config('glyde.speed', $1, true)", [String(SIMULATION_SPEED)]);
    for (const file of ['01_schema.sql', '02_seed.sql']) {
      await client.query(await readFile(path.join(DB_DIR, file), 'utf8'));
    }
    await client.query('COMMIT');
    console.log('Örnek veriler güncel saate göre yüklendi');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
