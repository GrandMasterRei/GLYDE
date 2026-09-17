export const BRAND = 'GLYDE';
export const BRAND_LONG = 'GoLive Logistics, Yard & Dispatch Engine';

export const ROLE_LABELS = {
  ADMIN: 'Yönetici',
  SATIS: 'Satış',
  DEPO: 'Depo',
  LOJISTIK: 'Lojistik',
  SOFOR: 'Şoför',
};

export const STATUS_STYLES = {
  ALINDI:          { label: 'Sipariş Alındı',  badge: 'bg-slate-100 text-slate-700 ring-slate-200',     dot: 'bg-slate-400' },
  HAZIRLANIYOR:    { label: 'Hazırlanıyor',    badge: 'bg-amber-50 text-amber-700 ring-amber-200',       dot: 'bg-amber-400' },
  DEPODA_BEKLIYOR: { label: 'Depoda Bekliyor', badge: 'bg-orange-50 text-orange-700 ring-orange-200',    dot: 'bg-orange-400' },
  YUKLENDI:        { label: 'Yüklendi',        badge: 'bg-violet-50 text-violet-700 ring-violet-200',    dot: 'bg-violet-400' },
  SEVKIYATTA:      { label: 'Sevkiyatta',      badge: 'bg-sky-50 text-sky-700 ring-sky-200',             dot: 'bg-sky-400' },
  TESLIM_EDILDI:   { label: 'Teslim Edildi',   badge: 'bg-emerald-50 text-emerald-700 ring-emerald-200', dot: 'bg-emerald-500' },
  IPTAL:           { label: 'İptal Edildi',    badge: 'bg-rose-50 text-rose-700 ring-rose-200',          dot: 'bg-rose-400' },
};

export const FLOW = ['ALINDI', 'HAZIRLANIYOR', 'DEPODA_BEKLIYOR', 'YUKLENDI', 'SEVKIYATTA', 'TESLIM_EDILDI'];

export function formatDuration(minutes) {
  const total = Math.max(0, Math.floor(minutes));
  if (total < 1) return "1 dk'dan kısa";
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} dk`;
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}

// Kalan yol süresi (rota ölçeğinde dakika)
export function formatRemaining(minutes) {
  if (minutes <= 0) return 'Varmak üzere';
  return minutes < 1 ? "1 dk'dan az kaldı" : `${formatDuration(Math.ceil(minutes))} kaldı`;
}

export const formatClock = (value) =>
  new Date(value).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });

export function formatDateTime(value, { year = false } = {}) {
  return new Date(value).toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', ...(year && { year: 'numeric' }),
    hour: '2-digit', minute: '2-digit',
  });
}

export const formatKm = (km) =>
  km === null || km === undefined ? '—' : `${Math.round(km).toLocaleString('tr-TR')} km`;

export const initials = (name = '') =>
  name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toLocaleUpperCase('tr-TR');
