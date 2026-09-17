// Rota üzerinde konum hesapları. Noktalar [lat, lng] biçimindedir.

function distanceKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

export function buildRoute(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + distanceKm(points[i - 1], points[i]));
  }
  return { points, cum, total: cum[cum.length - 1] || 0 };
}

// t: 0 ile 1 arası. Rota üzerindeki noktayı ve bulunduğu segmenti döner.
export function pointAt(route, t) {
  const { points, cum, total } = route;
  if (!points.length) return null;
  if (points.length === 1 || total === 0) return { latlng: points[0], index: 1 };

  const target = Math.min(1, Math.max(0, t)) * total;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < target) i++;

  const seg = cum[i] - cum[i - 1];
  const f = seg ? (target - cum[i - 1]) / seg : 0;
  const a = points[i - 1];
  const b = points[i];
  return { latlng: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], index: i };
}

// Rotayı gidilen ve kalan olarak ikiye böler
export function splitAt(route, t) {
  const p = pointAt(route, t);
  if (!p) return [[], []];
  return [
    [...route.points.slice(0, p.index), p.latlng],
    [p.latlng, ...route.points.slice(p.index)],
  ];
}

// Sunucu saatiyle düzeltilmiş anlık ilerleme (0-1)
export function liveProgress(order, now, offset = 0) {
  if (order.status === 'TESLIM_EDILDI') return 1;
  if (order.status !== 'SEVKIYATTA' || !order.departed_at || !order.transit_minutes) return 0;
  const elapsed = now + offset - new Date(order.departed_at).getTime();
  return Math.min(1, Math.max(0, elapsed / (order.transit_minutes * 60000)));
}

// Kalan yol süresi (rota ölçeğinde dakika)
export function liveRemaining(order, now, offset = 0) {
  if (order.status !== 'SEVKIYATTA') return null;
  const trip = order.trip_minutes ?? order.route_minutes ?? order.transit_minutes ?? 0;
  return (1 - liveProgress(order, now, offset)) * trip;
}

export const serverOffset = (serverTime) =>
  serverTime ? new Date(serverTime).getTime() - Date.now() : 0;
