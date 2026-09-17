import { OSRM_URL } from '../config/env.js';

const TRUCK_FACTOR = 1.3;        // kamyonlar binek araçtan yavaş
const FALLBACK_TTL = 60 * 1000;  // yedek rota 1 dk sonra tekrar denenir
const cache = new Map();
const pending = new Map();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// Rota servisine istekler sırayla gider (genel sunucu yoğun isteği reddedebilir)
let queue = Promise.resolve();
function enqueue(task) {
  const run = queue.then(task);
  queue = run.catch(() => {}).then(() => sleep(250));
  return run;
}

function haversineKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

function straightLine(from, to, steps = 30) {
  return Array.from({ length: steps + 1 }, (_, i) => [
    round(from.lat + ((to.lat - from.lat) * i) / steps, 5),
    round(from.lng + ((to.lng - from.lng) * i) / steps, 5),
  ]);
}

async function fromOsrm(from, to) {
  const url = `${OSRM_URL}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}`
    + '?overview=full&geometries=geojson';
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  const r = data.routes?.[0];
  if (!r) throw new Error('rota bulunamadı');

  return {
    points: r.geometry.coordinates.map(([lng, lat]) => [round(lat, 5), round(lng, 5)]),
    distanceKm: round(r.distance / 1000, 1),
    minutes: Math.max(5, Math.round((r.duration / 60) * TRUCK_FACTOR)),
    source: 'osrm',
  };
}

async function resolveRoute(from, to) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      return await fromOsrm(from, to);
    } catch (err) {
      lastError = err;
      await sleep(800);
    }
  }
  console.warn(`Rota servisine ulaşılamadı (${lastError.message}), düz çizgi kullanılıyor`);
  const km = haversineKm(from, to) * 1.25;
  return {
    points: straightLine(from, to),
    distanceKm: round(km, 1),
    minutes: Math.max(5, Math.round(km)),   // ~60 km/sa
    source: 'fallback',
  };
}

// Depodan teslimat noktasına karayolu rotası
export function getRoute(from, to) {
  const key = `${from.lat},${from.lng}|${to.lat},${to.lng}`;
  const hit = cache.get(key);
  if (hit && (hit.source === 'osrm' || Date.now() - hit.at < FALLBACK_TTL)) return Promise.resolve(hit);
  if (pending.has(key)) return pending.get(key);

  const job = enqueue(() => resolveRoute(from, to))
    .then((route) => {
      const entry = { ...route, at: Date.now() };
      cache.set(key, entry);
      return entry;
    })
    .finally(() => pending.delete(key));

  pending.set(key, job);
  return job;
}
