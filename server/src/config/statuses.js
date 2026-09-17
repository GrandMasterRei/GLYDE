import { findWarehouse } from './locations.js';

export const STATUS_FLOW = [
  'ALINDI', 'HAZIRLANIYOR', 'DEPODA_BEKLIYOR', 'YUKLENDI', 'SEVKIYATTA', 'TESLIM_EDILDI',
];
export const ALL_STATUSES = [...STATUS_FLOW, 'IPTAL'];

export const STATUS_LABELS = {
  ALINDI: 'Sipariş Alındı',
  HAZIRLANIYOR: 'Hazırlanıyor',
  DEPODA_BEKLIYOR: 'Depoda Bekliyor',
  YUKLENDI: 'Yüklendi',
  SEVKIYATTA: 'Sevkiyatta',
  TESLIM_EDILDI: 'Teslim Edildi',
  IPTAL: 'İptal Edildi',
};

export const ROLE_LABELS = {
  ADMIN: 'Yönetici', SATIS: 'Satış', DEPO: 'Depo', LOJISTIK: 'Lojistik', SOFOR: 'Şoför',
};

/*
 * Süre kuralları
 * - Aşama limitleri gerçek dakikadır.
 * - Sevkiyat süresi = rota süresi (OSRM × 1,3 kamyon katsayısı).
 *   Simülasyonda araç bu süreyi SIMULATION_SPEED kat hızlı tamamlar; ekranda
 *   gösterilen süreler yine rota ölçeğindedir (ör. "51 dk kaldı").
 * - Sevkiyat limiti = rota süresi + teslim toleransı.
 * - Limitin %80'i geçilince uyarı, limit aşılınca gecikme bildirimi oluşur.
 */
export const STATUS_LIMITS = {
  ALINDI: 30,
  HAZIRLANIYOR: 120,
  DEPODA_BEKLIYOR: 60,
  YUKLENDI: 60,
};
export const DELIVERY_TOLERANCE = 30;
export const WARNING_RATIO = 0.8;
const FALLBACK_TRANSIT_LIMIT = 180;

// Siparişi bu duruma kim geçirebilir (ADMIN her zaman)
export const TRANSITION_ROLES = {
  HAZIRLANIYOR: ['DEPO'],
  DEPODA_BEKLIYOR: ['DEPO'],
  YUKLENDI: ['DEPO'],
  SEVKIYATTA: ['LOJISTIK', 'SOFOR'],
  TESLIM_EDILDI: ['LOJISTIK', 'SOFOR'],
};

export const VEHICLE_ASSIGNABLE = ['ALINDI', 'HAZIRLANIYOR', 'DEPODA_BEKLIYOR'];
export const CANCELLABLE = ['ALINDI', 'HAZIRLANIYOR', 'DEPODA_BEKLIYOR'];

export function nextStatus(status) {
  const i = STATUS_FLOW.indexOf(status);
  return i >= 0 && i < STATUS_FLOW.length - 1 ? STATUS_FLOW[i + 1] : null;
}

// Sipariş şu an hangi rolün işlemini bekliyor
export function actionOwners(order) {
  const next = nextStatus(order.status);
  if (!next) return [];
  if (next === 'YUKLENDI' && (!order.vehicle_id || !order.driver_id)) return ['LOJISTIK'];   // önce araç ve şoför
  if (next === 'TESLIM_EDILDI' && !order.arrived) return [];           // araç yolda
  return TRANSITION_ROLES[next];
}

export function canAdvance(user, order) {
  const next = nextStatus(order.status);
  if (!next) return false;
  if (user.role === 'ADMIN') return true;
  if (!TRANSITION_ROLES[next].includes(user.role)) return false;
  return user.role !== 'SOFOR' || order.driver_id === user.id;
}

export function isMyTask(user, order) {
  if (user.role === 'ADMIN') return false;
  if (!actionOwners(order).includes(user.role)) return false;
  return user.role !== 'SOFOR' || order.driver_id === user.id;
}

const toNum = (v) => (v === null || v === undefined ? null : Number(v));

// DB satırını API'nin döndüğü sipariş nesnesine çevirir
export function enrichOrder(row, user) {
  const {
    destination_id, destination_name, destination_city, destination_lat, destination_lng,
    ...order
  } = row;

  const realMinutes = Number(order.minutes_in_status);
  const transit = toNum(order.transit_minutes);
  const routeMinutes = toNum(order.route_minutes);
  const inTransit = Boolean(order.status === 'SEVKIYATTA' && order.departed_at && transit > 0);
  const rawProgress = inTransit ? realMinutes / transit : 0;
  const arrived = inTransit && rawProgress >= 1;

  // Sevkiyatta süreler rota ölçeğinde
  const tripMinutes = routeMinutes ?? transit;
  const stageMinutes = inTransit ? rawProgress * tripMinutes : realMinutes;
  const limit = order.status === 'SEVKIYATTA'
    ? (inTransit ? tripMinutes + DELIVERY_TOLERANCE : FALLBACK_TRANSIT_LIMIT)
    : STATUS_LIMITS[order.status] ?? null;

  const isDelayed = limit !== null && stageMinutes > limit;
  const next = nextStatus(order.status);
  const base = { ...order, arrived };

  return {
    ...order,
    distance_km: toNum(order.distance_km),
    route_minutes: routeMinutes,
    transit_minutes: transit,
    trip_minutes: tripMinutes,
    minutes_in_status: Math.floor(stageMinutes),
    status_label: STATUS_LABELS[order.status],
    status_limit: limit,
    is_delayed: isDelayed,
    is_warning: !isDelayed && limit !== null && order.status !== 'SEVKIYATTA'
      && stageMinutes >= limit * WARNING_RATIO,
    delay_minutes: isDelayed ? Math.floor(stageMinutes - limit) : 0,
    minutes_to_limit: limit !== null ? Math.max(0, Math.ceil(limit - stageMinutes)) : null,
    next_status: next,
    next_status_label: next ? STATUS_LABELS[next] : null,
    action_owners: actionOwners(base),
    can_advance: canAdvance(user, base),
    is_my_task: isMyTask(user, base),
    can_assign_vehicle: ['LOJISTIK', 'ADMIN'].includes(user.role) && VEHICLE_ASSIGNABLE.includes(order.status),
    can_cancel: ['SATIS', 'ADMIN'].includes(user.role) && CANCELLABLE.includes(order.status),
    origin: findWarehouse(order.warehouse),
    destination: {
      id: destination_id, name: destination_name, city: destination_city,
      lat: destination_lat, lng: destination_lng,
    },
    progress: order.status === 'TESLIM_EDILDI' ? 1 : Math.min(1, rawProgress),
    arrived,
    remaining_minutes: inTransit ? Math.max(0, (1 - rawProgress) * tripMinutes) : null,
    eta: inTransit
      ? new Date(new Date(order.departed_at).getTime() + transit * 60000).toISOString()
      : null,
  };
}
