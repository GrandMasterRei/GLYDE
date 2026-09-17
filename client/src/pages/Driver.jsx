import { useCallback, useEffect, useState } from 'react';
import { Loader2, Truck, StickyNote, Check, PackageCheck } from 'lucide-react';
import { api, notifyDataChanged } from '../api';
import { useAuth } from '../context/AuthContext';
import { formatKm, formatRemaining } from '../constants';
import { liveProgress, liveRemaining, serverOffset } from '../lib/route';
import useNow from '../hooks/useNow';
import useDataRefresh from '../hooks/useDataRefresh';
import StatusBadge from '../components/StatusBadge';
import Toast, { useToast } from '../components/Toast';
import TrackingMap from '../components/map/TrackingMap';

const ACTIVE = ['YUKLENDI', 'SEVKIYATTA'];
const PREPARING = ['ALINDI', 'HAZIRLANIYOR', 'DEPODA_BEKLIYOR'];
const panel = 'rounded-2xl bg-white/95 shadow-lg ring-1 ring-slate-200 backdrop-blur';
const bigButton = 'flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-teal-500 py-3.5 text-base font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50';

export default function Driver() {
  const { user } = useAuth();
  const now = useNow(1000);
  const [orders, setOrders] = useState(null);
  const [task, setTask] = useState(null);
  const [offset, setOffset] = useState(0);
  const [recipient, setRecipient] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { toast, showToast } = useToast();

  const load = useCallback(async () => {
    try {
      const list = await api('/orders');
      setOrders(list);
      const current = list.find((o) => ACTIVE.includes(o.status)) || list.find((o) => PREPARING.includes(o.status));
      if (current) {
        const detail = await api(`/orders/${current.id}`);
        setTask(detail);
        setOffset(serverOffset(detail.server_time));
      } else {
        setTask(null);
      }
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [load]);
  useDataRefresh(load);

  async function advance() {
    setBusy(true);
    setError('');
    try {
      const r = await api(`/orders/${task.id}/advance`, {
        method: 'PATCH',
        body: { note: recipient.trim() ? `Teslim alan: ${recipient.trim()}` : undefined },
      });
      showToast(r.status === 'TESLIM_EDILDI' ? `${r.order_no} teslim edildi` : 'İyi yolculuklar');
      setRecipient('');
      notifyDataChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!orders && !error) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>;
  }

  const vehicle = task?.plate ? { plate: task.plate, model: task.vehicle_model } : null;
  const progress = task ? liveProgress(task, now, offset) : 0;
  const inTransit = task?.status === 'SEVKIYATTA';
  const arrived = inTransit && progress >= 1;
  const deliveredToday = (orders || []).filter((o) =>
    o.status === 'TESLIM_EDILDI' && new Date(o.status_changed_at).toDateString() === new Date().toDateString()).length;

  return (
    <div className="relative -m-6 h-[calc(100vh-4rem)] lg:-m-8">
      {/* Harita */}
      <div className="absolute inset-0 isolate">
        {task ? (
          <TrackingMap shipments={[task]} selectedId={task.id} now={now} offset={offset} compact scrollZoom zoomPosition="topright" />
        ) : (
          <TrackingMap shipments={[]} compact scrollZoom zoomPosition="topright" />
        )}
      </div>

      {/* Görev bilgisi */}
      <div className={`absolute left-4 top-4 z-[600] w-[min(360px,calc(100%-5rem))] p-4 ${panel}`}>
        {vehicle && (
          <p className="mb-3 flex items-center gap-2 text-sm">
            <Truck className="h-4 w-4 text-teal-600" />
            <span className="font-semibold text-slate-900">{vehicle.plate}</span>
            <span className="truncate text-slate-500">{vehicle.model}</span>
          </p>
        )}

        {task ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-lg font-semibold text-slate-900">{task.order_no}</p>
                <p className="truncate text-sm text-slate-500">{task.customer}</p>
              </div>
              <StatusBadge status={task.status} />
            </div>
            <p className="mt-2 text-sm text-slate-600">
              {task.origin?.district} → <strong className="text-slate-900">{task.destination.name}</strong>
              <span className="text-slate-400"> · {task.destination.city}{task.distance_km !== null && ` · ${formatKm(task.distance_km)}`}</span>
            </p>
            {task.note && (
              <p className="mt-3 flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0" />
                {task.note}
              </p>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3">
            <PackageCheck className="h-8 w-8 text-slate-300" />
            <p className="font-medium text-slate-900">Atanmış göreviniz yok</p>
          </div>
        )}

        {deliveredToday > 0 && (
          <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">Bugün {deliveredToday} teslimat tamamlandı</p>
        )}
      </div>

      {/* İşlem paneli */}
      {task && (
        <div className={`absolute bottom-6 left-4 right-24 z-[600] mx-auto max-w-md space-y-3 p-4 sm:left-1/2 sm:right-auto sm:w-full sm:-translate-x-1/2 ${panel}`}>
          {PREPARING.includes(task.status) && (
            <p className="text-center text-sm text-slate-600">Sipariş depoda hazırlanıyor</p>
          )}

          {task.status === 'YUKLENDI' && (
            <button onClick={advance} disabled={busy || !task.can_advance} className={bigButton}>
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Truck className="h-5 w-5" />}
              Yola Çık
            </button>
          )}

          {inTransit && (
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-slate-900">{arrived ? 'Teslimat noktasındasınız' : formatRemaining(liveRemaining(task, now, offset))}</span>
                <span className="font-semibold text-teal-700">%{Math.round(progress * 100)}</span>
              </div>
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-teal-500 transition-all duration-1000" style={{ width: `${progress * 100}%` }} />
              </div>
            </div>
          )}

          {arrived && (
            <>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="Teslim alan kişi"
                aria-label="Teslim alan kişi"
                maxLength={80}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-base outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
              />
              <button onClick={advance} disabled={busy} className={bigButton}>
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                Teslim Ettim
              </button>
            </>
          )}

          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        </div>
      )}

      <Toast message={toast} />
    </div>
  );
}
