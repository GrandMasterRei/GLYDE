import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Loader2, Check, AlertTriangle, Truck, Warehouse, User, MapPin,
  CalendarClock, ArrowRight, CheckCircle2, Info, PackageX, Route, Navigation, XCircle, StickyNote, X,
} from 'lucide-react';
import { api, notifyDataChanged } from '../api';
import {
  FLOW, ROLE_LABELS, STATUS_STYLES, formatClock, formatDateTime, formatDuration, formatKm, formatRemaining,
} from '../constants';
import { liveProgress, liveRemaining, serverOffset } from '../lib/route';
import useDataRefresh from '../hooks/useDataRefresh';
import useNow from '../hooks/useNow';
import StatusBadge from '../components/StatusBadge';
import Toast, { useToast } from '../components/Toast';
import TrackingMap from '../components/map/TrackingMap';

const ACTION_LABELS = {
  HAZIRLANIYOR: 'Hazırlığı Başlat',
  DEPODA_BEKLIYOR: 'Hazırlığı Tamamla',
  YUKLENDI: 'Yüklemeyi Tamamla',
  SEVKIYATTA: 'Sevkiyata Çıkar',
  TESLIM_EDILDI: 'Teslim Alındı',
};

const DONE_MESSAGES = {
  HAZIRLANIYOR: 'Hazırlık başlatıldı',
  DEPODA_BEKLIYOR: 'Hazırlık tamamlandı',
  YUKLENDI: 'Yükleme tamamlandı',
  SEVKIYATTA: 'Araç sevkiyata çıktı',
  TESLIM_EDILDI: 'Sipariş teslim edildi',
};


function formatEventTime(value) {
  const d = new Date(value);
  return d.toDateString() === new Date().toDateString() ? formatClock(d) : formatDateTime(d);
}

const minutesBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000));

function CancelDialog({ onClose, onConfirm, busy, error }) {
  const [reason, setReason] = useState('');
  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Siparişi iptal et" className="w-full max-w-md rounded-2xl bg-white shadow-xl" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">Siparişi iptal et</h2>
          <button onClick={onClose} aria-label="Kapat" className="rounded p-1 text-slate-400 hover:text-slate-700"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); onConfirm(reason); }} className="space-y-4 p-5">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={200}
            required
            autoFocus
            placeholder="İptal gerekçesi"
            className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          />
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <div className="flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">Vazgeç</button>
            <button type="submit" disabled={busy || !reason.trim()} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              İptal Et
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const selectClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';

function InfoRow({ icon: Icon, label, children }) {
  return (
    <div className="flex items-start gap-3 py-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="text-sm font-medium text-slate-900">{children}</div>
      </div>
    </div>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const now = useNow(1000);

  const [order, setOrder] = useState(null);
  const [offset, setOffset] = useState(0);
  const [meta, setMeta] = useState({ vehicles: [], drivers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [recipient, setRecipient] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelState, setCancelState] = useState({ busy: false, error: '' });
  const [busy, setBusy] = useState(false);
  const [selectedVehicle, setSelectedVehicle] = useState('');
  const [selectedDriver, setSelectedDriver] = useState('');
  const { toast, showToast } = useToast(
    location.state?.created ? `${location.state.created} oluşturuldu` : ''
  );

  const load = useCallback(async () => {
    try {
      const d = await api(`/orders/${id}`);
      setOrder(d);
      setOffset(serverOffset(d.server_time));
      setError('');
      setSelectedVehicle(d.vehicle_id ? String(d.vehicle_id) : '');
      setSelectedDriver(d.driver_id ? String(d.driver_id) : '');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadVehicles = useCallback(() => {
    api('/meta').then(setMeta).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    load();
    loadVehicles();
  }, [load, loadVehicles]);
  useDataRefresh(load);

  // Yoldaki siparişi periyodik yenile
  useEffect(() => {
    if (order?.status !== 'SEVKIYATTA') return;
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [order?.status, load]);

  // "Oluşturuldu" bilgisini temizle, yenilemede tekrar çıkmasın
  useEffect(() => {
    if (location.state?.created) navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function advance() {
    setBusy(true);
    setActionError('');
    try {
      const r = await api(`/orders/${id}/advance`, {
        method: 'PATCH',
        body: { note: recipient.trim() ? `Teslim alan: ${recipient.trim()}` : undefined },
      });
      showToast(DONE_MESSAGES[r.status]);
      setRecipient('');
      notifyDataChanged();
      loadVehicles();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function assignVehicle() {
    setBusy(true);
    setActionError('');
    try {
      const r = await api(`/orders/${id}/vehicle`, {
        method: 'PATCH',
        body: { vehicle_id: Number(selectedVehicle), driver_id: selectedDriver ? Number(selectedDriver) : undefined },
      });
      showToast(`${r.plate} · ${r.driver_name} atandı`);
      notifyDataChanged();
      loadVehicles();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(reason) {
    setCancelState({ busy: true, error: '' });
    try {
      await api(`/orders/${id}/cancel`, { method: 'PATCH', body: { reason } });
      setCancelOpen(false);
      setCancelState({ busy: false, error: '' });
      showToast('Sipariş iptal edildi');
      notifyDataChanged();
    } catch (err) {
      setCancelState({ busy: false, error: err.message });
    }
  }

  if (loading && !order) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>;
  }

  if (!order) {
    return (
      <div className="mx-auto max-w-md rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
        <PackageX className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 font-medium text-slate-900">{error || 'Sipariş bulunamadı'}</p>
        <Link to="/orders" className="mt-4 inline-block text-sm font-medium text-teal-700 hover:underline">Siparişlere dön</Link>
      </div>
    );
  }

  const cancelled = order.status === 'IPTAL';
  const lastFlowStatus = [...order.events].reverse().find((e) => FLOW.includes(e.status))?.status ?? 'ALINDI';
  const currentIndex = FLOW.indexOf(cancelled ? lastFlowStatus : order.status);
  const steps = cancelled ? [...FLOW.slice(0, currentIndex + 1), 'IPTAL'] : FLOW;
  const isDone = order.status === 'TESLIM_EDILDI';
  const inTransit = order.status === 'SEVKIYATTA';
  const trip = liveProgress(order, now, offset);
  const arrived = inTransit && trip >= 1;
  const remaining = liveRemaining(order, now, offset);
  // Sevkiyat aşamasının süresi rota ölçeğinde gösterilir
  const tripScale = order.transit_minutes && order.route_minutes ? order.route_minutes / order.transit_minutes : 1;
  const owners = order.action_owners.map((r) => ROLE_LABELS[r]).join(' / ');
  const needsVehicle = order.next_status === 'YUKLENDI' && !order.vehicle_id;
  const notArrived = inTransit && !arrived;
  const trackable = ['YUKLENDI', 'SEVKIYATTA'].includes(order.status);

  const eventMap = {};
  order.events.forEach((e) => { eventMap[e.status] = e; });
  const createdBy = eventMap.ALINDI?.changed_by_name;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />
        Siparişler
      </Link>

      {/* Başlık */}
      <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-slate-900">{order.order_no}</h1>
              <StatusBadge status={order.status} />
            </div>
            <p className="mt-1 text-slate-500">{order.customer}</p>
          </div>
          {!cancelled && <p className="text-sm font-medium text-slate-500">{currentIndex + 1} / {FLOW.length}</p>}
        </div>

        <div className={`mt-5 h-2 overflow-hidden rounded-full bg-slate-100 ${cancelled ? 'hidden' : ''}`}>
          <div
            className={`h-full rounded-full transition-all duration-500 ${isDone ? 'bg-emerald-500' : 'bg-gradient-to-r from-sky-500 to-teal-500'}`}
            style={{ width: `${Math.max((currentIndex / (FLOW.length - 1)) * 100, 4)}%` }}
          />
        </div>

        {order.is_delayed && (
          <div className="mt-5 flex items-start gap-3 rounded-xl bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
            <p>
              {arrived
                ? <>Teslim onayı <strong>{formatDuration(order.delay_minutes)}</strong> gecikti</>
                : <>{order.status_label} aşaması süre limitini <strong>{formatDuration(order.delay_minutes)}</strong> aştı</>}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {/* Rota */}
          <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
            <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
              <div className="flex items-center gap-2">
                <Route className="h-5 w-5 text-teal-600" />
                <h2 className="font-semibold text-slate-900">Rota</h2>
                <span className="hidden text-sm text-slate-500 sm:inline">
                  {order.origin?.district} → {order.destination.name}
                </span>
              </div>
              {trackable && (
                <Link to={`/tracking?order=${order.id}`} className="flex items-center gap-1.5 text-sm font-medium text-teal-700 hover:underline">
                  <Navigation className="h-4 w-4" />
                  Canlı takip
                </Link>
              )}
            </div>
            <div className="isolate h-72 border-t border-slate-100">
              <TrackingMap shipments={[order]} selectedId={order.id} now={now} offset={offset} compact />
            </div>
          </section>

          {/* Timeline */}
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-6 font-semibold text-slate-900">Geçmiş</h2>
            <ol>
              {steps.map((s, i) => {
                const ev = eventMap[s];
                const nextEv = eventMap[steps[i + 1]];
                const cancelStep = s === 'IPTAL';
                const done = cancelled ? !cancelStep : (i < currentIndex || (isDone && i === currentIndex));
                const current = !cancelled && i === currentIndex && !isDone;
                const isLast = i === steps.length - 1;
                const red = (current && order.is_delayed) || cancelStep;

                return (
                  <li key={s} className={`relative flex gap-4 ${isLast ? '' : 'pb-8'}`}>
                    {!isLast && (
                      <span className={`absolute bottom-0 left-[15px] top-8 w-0.5 ${i < currentIndex ? 'bg-teal-500' : 'bg-slate-200'}`} />
                    )}
                    <div className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      cancelStep ? 'bg-rose-500 text-white'
                        : done ? 'bg-teal-500 text-white'
                        : current ? `bg-white ring-2 ${red ? 'ring-red-400' : 'ring-teal-400'}`
                          : 'bg-white ring-2 ring-slate-200'
                    }`}>
                      {done && <Check className="h-4 w-4" />}
                      {cancelStep && <X className="h-4 w-4" />}
                      {current && (
                        <span className="relative flex h-3 w-3">
                          <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${red ? 'bg-red-400' : 'bg-teal-400'}`} />
                          <span className={`relative inline-flex h-3 w-3 rounded-full ${red ? 'bg-red-500' : 'bg-teal-500'}`} />
                        </span>
                      )}
                    </div>

                    <div className="min-w-0 flex-1 pt-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className={`font-medium ${cancelStep ? 'text-rose-700' : done || current ? 'text-slate-900' : 'text-slate-400'}`}>{STATUS_STYLES[s].label}</p>
                        <span className={`text-sm ${ev ? 'text-slate-600' : 'text-slate-300'}`}>
                          {ev ? formatEventTime(ev.created_at) : '--:--'}
                        </span>
                      </div>
                      {ev && (
                        <p className="mt-1 text-xs text-slate-400">
                          {ev.changed_by_name}
                          {nextEv && ` · ${formatDuration(minutesBetween(ev.created_at, nextEv.created_at) * (s === 'SEVKIYATTA' ? tripScale : 1))}`}
                        </p>
                      )}
                      {ev?.note && <p className="mt-1 text-sm text-slate-600">{ev.note}</p>}
                      {current && (
                        <span className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ${red ? 'bg-red-50 text-red-700' : 'bg-teal-50 text-teal-700'}`}>
                          {red && <AlertTriangle className="h-3.5 w-3.5" />}
                          Bu aşamada: {formatDuration(order.minutes_in_status)}
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <div className="space-y-6">
          {/* Sonraki adım */}
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {cancelled ? (
              <div className="flex flex-col items-center py-4 text-center">
                <XCircle className="h-10 w-10 text-rose-500" />
                <p className="mt-3 font-semibold text-slate-900">Sipariş iptal edildi</p>
                {eventMap.IPTAL?.note && <p className="text-sm text-slate-500">{eventMap.IPTAL.note}</p>}
              </div>
            ) : isDone ? (
              <div className="flex flex-col items-center py-4 text-center">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="mt-3 font-semibold text-slate-900">Sipariş tamamlandı</p>
                <p className="text-sm text-slate-500">
                  Toplam süre: {formatDuration(minutesBetween(order.created_at, eventMap.TESLIM_EDILDI?.created_at ?? order.status_changed_at))}
                </p>
              </div>
            ) : (
              <>
                {inTransit && (
                  <div className="mb-5 rounded-xl bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium text-slate-900">{arrived ? 'Teslimat noktasında' : 'Yolda'}</span>
                      <span className="font-semibold text-teal-700">%{Math.round(trip * 100)}</span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className={`h-full rounded-full transition-all duration-1000 ${arrived ? 'bg-amber-500' : 'bg-teal-500'}`} style={{ width: `${trip * 100}%` }} />
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {arrived
                        ? 'Teslim onayı bekleniyor'
                        : formatRemaining(remaining)}
                    </p>
                  </div>
                )}

                <p className="text-xs text-slate-400">Sonraki adım</p>
                <div className="mt-1 flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-teal-600" />
                  <p className="font-semibold text-slate-900">{order.next_status_label}</p>
                  {owners && <span className="ml-auto text-xs text-slate-500">{owners}</span>}
                </div>

                {order.can_advance ? (
                  <>
                    {notArrived && (
                      <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Araç varınca teslim alınabilir</p>
                    )}
                    {order.next_status === 'TESLIM_EDILDI' && arrived && (
                      <input
                        value={recipient}
                        onChange={(e) => setRecipient(e.target.value)}
                        placeholder="Teslim alan kişi"
                        aria-label="Teslim alan kişi"
                        maxLength={80}
                        className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
                      />
                    )}
                    {needsVehicle && (
                      <div className="mt-4 flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-amber-200">
                        <Info className="mt-0.5 h-4 w-4 shrink-0" />
                        <p>{order.can_assign_vehicle ? 'Önce araç atayın' : 'Araç ataması bekleniyor'}</p>
                      </div>
                    )}
                    <button
                      onClick={advance}
                      disabled={busy || needsVehicle || notArrived}
                      className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-sky-500 to-teal-500 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {ACTION_LABELS[order.next_status]}
                    </button>
                  </>
                ) : (
                  <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
                    {owners ? `${owners} işlemi bekleniyor` : 'Araç yolda'}
                  </p>
                )}
              </>
            )}
            {order.can_cancel && (
              <button
                onClick={() => setCancelOpen(true)}
                className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-red-600 transition hover:bg-red-50"
              >
                Siparişi İptal Et
              </button>
            )}
            {actionError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{actionError}</p>}
          </section>

          {/* Bilgiler */}
          <section className="rounded-2xl bg-white px-5 py-2 shadow-sm ring-1 ring-slate-200">
            <div className="divide-y divide-slate-100">
              <InfoRow icon={User} label="Müşteri">{order.customer}</InfoRow>
              <InfoRow icon={Warehouse} label="Depo">
                {order.warehouse}
                <span className="block text-xs font-normal text-slate-500">{order.origin?.district}</span>
              </InfoRow>
              <InfoRow icon={MapPin} label="Teslimat noktası">
                {order.destination.name}
                <span className="block text-xs font-normal text-slate-500">{order.destination.city}</span>
              </InfoRow>
              {order.distance_km !== null && (
                <InfoRow icon={Route} label="Mesafe">
                  {formatKm(order.distance_km)} · {formatDuration(order.route_minutes)}
                </InfoRow>
              )}
              {order.note && (
                <InfoRow icon={StickyNote} label="Not">
                  <span className="font-normal">{order.note}</span>
                </InfoRow>
              )}
              <InfoRow icon={CalendarClock} label="Oluşturulma">
                {formatDateTime(order.created_at, { year: true })}
                {createdBy && <span className="block text-xs font-normal text-slate-500">{createdBy}</span>}
              </InfoRow>
            </div>
          </section>

          {/* Araç */}
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center gap-2">
              <Truck className="h-5 w-5 text-teal-600" />
              <h2 className="font-semibold text-slate-900">Araç ve Şoför</h2>
            </div>

            {order.plate ? (
              <div className="mt-4 rounded-xl bg-slate-50 p-4">
                <p className="text-lg font-semibold tracking-wide text-slate-900">{order.plate}</p>
                <p className="text-sm text-slate-500">{order.vehicle_model}</p>
                <p className="mt-1 text-sm text-slate-700">{order.driver_name || 'Şoför atanmadı'}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Atanmadı</p>
            )}

            {order.can_assign_vehicle && (
              <div className="mt-4 space-y-2">
                <select
                  value={selectedVehicle}
                  onChange={(e) => setSelectedVehicle(e.target.value)}
                  aria-label="Araç"
                  className={selectClass}
                >
                  <option value="">Araç seçin</option>
                  {meta.vehicles.map((v) => {
                    const busyElsewhere = v.busy_order_no && v.busy_order_no !== order.order_no;
                    return (
                      <option key={v.id} value={v.id} disabled={busyElsewhere}>
                        {v.plate} · {v.model}{busyElsewhere ? ` (${v.busy_order_no})` : ''}
                      </option>
                    );
                  })}
                </select>
                <select
                  value={selectedDriver}
                  onChange={(e) => setSelectedDriver(e.target.value)}
                  aria-label="Şoför"
                  className={selectClass}
                >
                  <option value="">Şoför: müsait olan atansın</option>
                  {meta.drivers.map((d) => {
                    const busyElsewhere = d.busy_order_no && d.busy_order_no !== order.order_no;
                    return (
                      <option key={d.id} value={d.id} disabled={busyElsewhere}>
                        {d.name}{busyElsewhere ? ` (${d.busy_order_no})` : ''}
                      </option>
                    );
                  })}
                </select>
                <button
                  onClick={assignVehicle}
                  disabled={busy || !selectedVehicle
                    || (selectedVehicle === String(order.vehicle_id ?? '') && selectedDriver === String(order.driver_id ?? ''))}
                  className="w-full rounded-lg bg-[#1e293b] py-2 text-sm font-medium text-white ring-1 ring-white/10 transition hover:opacity-90 disabled:opacity-40"
                >
                  {order.plate ? 'Güncelle' : 'Ata'}
                </button>
              </div>
            )}
          </section>
        </div>
      </div>

      {cancelOpen && (
        <CancelDialog
          busy={cancelState.busy}
          error={cancelState.error}
          onConfirm={cancelOrder}
          onClose={() => { setCancelOpen(false); setCancelState({ busy: false, error: '' }); }}
        />
      )}
      <Toast message={toast} />
    </div>
  );
}
