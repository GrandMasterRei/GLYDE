import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Loader2, Truck, AlertTriangle, Check, ChevronRight, MapPinned } from 'lucide-react';
import { api } from '../api';
import { formatDuration, formatKm, formatRemaining } from '../constants';
import { liveProgress, liveRemaining, serverOffset } from '../lib/route';
import useDataRefresh from '../hooks/useDataRefresh';
import { notifyDataChanged } from '../api';
import useNow from '../hooks/useNow';
import Toast, { useToast } from '../components/Toast';
import TrackingMap, { TRUCK_TONES, truckTone } from '../components/map/TrackingMap';

const REFRESH_MS = 15000;

const CHIP = {
  moving:  'bg-teal-50 text-teal-700 ring-teal-200',
  waiting: 'bg-amber-50 text-amber-700 ring-amber-200',
  delayed: 'bg-red-50 text-red-700 ring-red-200',
  loading: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export default function Tracking() {
  const [params, setParams] = useSearchParams();
  const now = useNow(1000);
  const [data, setData] = useState(null);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [busyId, setBusyId] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const { toast, showToast } = useToast();

  const selectedId = Number(params.get('order')) || null;
  const select = (id) => setParams(id && id !== selectedId ? { order: String(id) } : {}, { replace: true });

  const load = useCallback(async () => {
    try {
      const d = await api('/tracking');
      setOffset(serverOffset(d.serverTime));
      setData(d);
      setError('');
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);
  useDataRefresh(load);

  const shipments = useMemo(() => data?.shipments ?? [], [data]);

  const items = shipments.map((s) => {
    const progress = liveProgress(s, now, offset);
    const state = s.status === 'YUKLENDI' ? 'loading' : progress >= 1 ? 'waiting' : 'moving';
    return { ...s, progress, state, tone: truckTone(s, progress), remaining: liveRemaining(s, now, offset) };
  });

  const counts = {
    all: items.length,
    moving: items.filter((i) => i.state === 'moving').length,
    loading: items.filter((i) => i.state === 'loading').length,
    waiting: items.filter((i) => i.state === 'waiting').length,
  };

  // Yeni varan araç için bildirim
  const arrivedIds = items.filter((i) => i.state === 'waiting').map((i) => i.id);
  const arrivedKey = arrivedIds.join(',');
  const seenArrivals = useRef(null);
  useEffect(() => {
    if (!data) return;
    if (seenArrivals.current) {
      items
        .filter((i) => i.state === 'waiting' && !seenArrivals.current.has(i.id))
        .forEach((i) => showToast(`${i.order_no} teslimat noktasına ulaştı`));
    }
    seenArrivals.current = new Set(arrivedIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivedKey, data]);
  const visible = tab === 'all' ? items : items.filter((i) => i.state === tab);

  // Haritadan seçilen kartı listede görünür yap
  useEffect(() => {
    if (selectedId) document.getElementById(`ship-${selectedId}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  async function advance(item) {
    setBusyId(item.id);
    try {
      const r = await api(`/orders/${item.id}/advance`, { method: 'PATCH' });
      showToast(r.status === 'TESLIM_EDILDI' ? `${item.order_no} teslim edildi` : `${item.order_no} yola çıktı`);
      if (r.status === 'TESLIM_EDILDI' && item.id === selectedId) select(null);
      notifyDataChanged();
    } catch (err) {
      showToast(err.message);
    } finally {
      setBusyId(null);
    }
  }

  const tabs = [
    { key: 'all', label: 'Tümü' },
    { key: 'moving', label: 'Yolda' },
    { key: 'loading', label: 'Depoda' },
    { key: 'waiting', label: 'Teslim bekliyor' },
  ];

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100vh-8rem)]">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-900">Canlı Takip</h1>
        {updatedAt && (
          <span className="inline-flex items-center gap-2 text-xs text-slate-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Canlı · {updatedAt.toLocaleTimeString('tr-TR')}
          </span>
        )}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</p>}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[400px_1fr] lg:grid-rows-[minmax(0,1fr)]">
        {/* Liste */}
        <section className="flex min-h-0 flex-col rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
          <div className="border-b border-slate-100 p-3">
            <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`flex-auto whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium transition ${
                    tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                  }`}
                >
                  {t.label} <span className="text-slate-400">{counts[t.key]}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3 max-lg:max-h-[32rem]">
            {!data && !error ? (
              <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <MapPinned className="h-10 w-10 text-slate-300" />
                <p className="mt-3 font-medium text-slate-900">Araç yok</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {visible.map((s) => {
                  const selected = s.id === selectedId;
                  const color = TRUCK_TONES[s.tone].color;
                  const action = s.can_advance && (s.state === 'loading' || s.state === 'waiting');
                  return (
                    <li key={s.id} id={`ship-${s.id}`}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => select(s.id)}
                        onKeyDown={(e) => { if (e.key === 'Enter') select(s.id); }}
                        className={`cursor-pointer rounded-xl p-4 ring-1 transition ${
                          selected ? 'bg-teal-50/60 ring-2 ring-teal-400' : 'bg-white ring-slate-200 hover:ring-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900">{s.order_no}</p>
                            <p className="truncate text-sm text-slate-500">{s.customer}</p>
                          </div>
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${CHIP[s.tone]}`}>{TRUCK_TONES[s.tone].label}</span>
                        </div>

                        <p className="mt-3 text-xs text-slate-500">
                          {s.origin?.district} → <span className="text-slate-700">{s.destination.name}, {s.destination.city}</span>
                        </p>

                        <div className="mt-3 flex items-center gap-2 text-xs text-slate-600">
                          <Truck className="h-3.5 w-3.5 text-slate-400" />
                          <span className="font-medium">{s.plate}</span>
                          <span className="truncate text-slate-400">{s.vehicle_model} · {s.driver_name}</span>
                        </div>

                        <div className="mt-3 flex items-center gap-2">
                          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${s.progress * 100}%`, background: color }} />
                          </div>
                          <span className="w-9 text-right text-xs font-medium text-slate-600">%{Math.round(s.progress * 100)}</span>
                        </div>

                        <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                          <span className="text-slate-500">
                            {s.state === 'moving' && formatRemaining(s.remaining)}
                            {s.state === 'waiting' && 'Teslimat noktasında'}
                            {s.state === 'loading' && `Depoda ${formatDuration(s.minutes_in_status)}`}
                          </span>
                          <span className="text-slate-400">{formatKm(s.distance_km)}</span>
                        </div>

                        {s.is_delayed && (
                          <p className="mt-2 flex items-center gap-1 text-xs font-medium text-red-600">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            +{formatDuration(s.delay_minutes)} gecikme
                          </p>
                        )}

                        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
                          <Link
                            to={`/orders/${s.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-900"
                          >
                            Detay <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                          {action && (
                            <button
                              onClick={(e) => { e.stopPropagation(); advance(s); }}
                              disabled={busyId === s.id}
                              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-sky-500 to-teal-500 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
                            >
                              {busyId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : s.state === 'waiting' ? <Check className="h-3.5 w-3.5" /> : <Truck className="h-3.5 w-3.5" />}
                              {s.state === 'waiting' ? 'Teslim Alındı' : 'Sevkiyata Çıkar'}
                            </button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Harita */}
        <section className="isolate h-[420px] overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 max-lg:order-first lg:h-full">
          <TrackingMap
            shipments={shipments}
            warehouses={data?.warehouses}
            selectedId={selectedId}
            onSelect={select}
            now={now}
            offset={offset}
          />
        </section>
      </div>

      <Toast message={toast} />
    </div>
  );
}
