import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity, AlertTriangle, CheckCircle2, ChevronRight, RefreshCw, Loader2,
  Warehouse, ArrowRight, ClipboardList, Truck,
} from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { STATUS_STYLES, formatDuration } from '../constants';
import StatusBadge from '../components/StatusBadge';
import useDataRefresh from '../hooks/useDataRefresh';

const REFRESH_MS = 30000;

// Depo panelindeki aşama kırılımı
const WAREHOUSE_PARTS = [
  { key: 'preparing', label: 'Hazırlanıyor', color: 'bg-amber-400' },
  { key: 'waiting', label: 'Depoda Bekliyor', color: 'bg-orange-400' },
  { key: 'transit', label: 'Sevkiyatta', color: 'bg-sky-400' },
];

const TONES = {
  sky: 'bg-sky-50 text-sky-600',
  teal: 'bg-teal-50 text-teal-600',
  red: 'bg-red-50 text-red-600',
  emerald: 'bg-emerald-50 text-emerald-600',
};

function StatCard({ icon: Icon, label, value, hint, tone, highlight = false, to }) {
  const body = (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${TONES[tone]}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className={`mt-3 text-3xl font-semibold ${highlight ? 'text-red-600' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </>
  );
  const cls = `block rounded-2xl bg-white p-5 shadow-sm ring-1 transition ${highlight ? 'ring-red-200' : 'ring-slate-200'} ${to ? 'hover:ring-teal-300' : ''}`;
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const started = Date.now();
    try {
      setData(await api('/dashboard'));
      setError('');
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err.message);
    } finally {
      // Kullanıcı yenilendiğini görsün diye en az 600 ms
      setTimeout(() => setRefreshing(false), Math.max(0, 600 - (Date.now() - started)));
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, [load]);
  useDataRefresh(load);

  if (!data && !error) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>;
  }

  if (!data) {
    return (
      <div className="rounded-2xl bg-red-50 p-6 text-center ring-1 ring-red-200">
        <p className="text-sm text-red-700">{error}</p>
        <button onClick={load} className="mt-3 text-sm font-medium text-red-700 underline">Tekrar dene</button>
      </div>
    );
  }

  const firstName = user.name.split(' ')[0];
  const showActions = ['DEPO', 'LOJISTIK'].includes(user.role) && data.myActionCount > 0;
  const maxStage = Math.max(...data.byStatus.map((s) => s.count), 1);
  const maxWarehouse = Math.max(...data.byWarehouse.map((w) => w.count), 1);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Bugünkü Operasyon</h1>
          <p className="mt-1 text-sm text-slate-500">Hoş geldin, {firstName}</p>
        </div>
        <div className="flex items-center gap-3">
          {updatedAt && (
            <span className="text-xs text-slate-400">{updatedAt.toLocaleTimeString('tr-TR')}</span>
          )}
          <button
            onClick={load}
            disabled={refreshing}
            className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Yenileniyor' : 'Yenile'}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700 ring-1 ring-amber-200">
          Veriler güncellenemedi: {error}. Son alınan veriler gösteriliyor.
        </p>
      )}

      {showActions && (
        <Link
          to="/orders?mine=1"
          className="flex items-center justify-between rounded-2xl bg-gradient-to-r from-sky-500 to-teal-500 px-5 py-4 text-white shadow-sm transition hover:opacity-95"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20">
              <ClipboardList className="h-5 w-5" />
            </div>
            <p className="font-semibold">Sizi bekleyen {data.myActionCount} işlem var</p>
          </div>
          <ArrowRight className="h-5 w-5" />
        </Link>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Activity} tone="sky" label="Aktif Sipariş" value={data.active} hint={`Toplam ${data.total}`} to="/orders" />
        <StatCard
          icon={Truck}
          tone="teal"
          label="Yoldaki Araç"
          value={data.inTransit}
          hint={data.awaitingDelivery > 0 ? `${data.awaitingDelivery} araç teslim bekliyor` : null}
          to="/tracking"
        />
        <StatCard
          icon={AlertTriangle}
          tone="red"
          label="Geciken İşlem"
          value={data.delayedCount}
          highlight={data.delayedCount > 0}
          to="/orders?delayed=1"
        />
        <StatCard icon={CheckCircle2} tone="emerald" label="Bugün Teslim" value={data.deliveredToday}  />
      </div>

      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="mb-4 font-semibold text-slate-900">Sipariş Akışı</h2>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {data.byStatus.map((s, i) => (
            <Link
              key={s.status}
              to={`/orders?status=${s.status}`}
              className="relative rounded-xl border border-slate-200 p-4 transition hover:border-teal-300 hover:shadow-sm"
            >
              <div className="flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[s.status].dot}`} />
                <p className="truncate text-sm text-slate-500">{s.label}</p>
              </div>
              <p className="mt-1 text-3xl font-semibold text-slate-900">{s.count}</p>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
                <div className={`h-full rounded-full ${STATUS_STYLES[s.status].dot}`} style={{ width: `${(s.count / maxStage) * 100}%` }} />
              </div>
              {i < data.byStatus.length - 1 && (
                <ChevronRight className="absolute -right-3.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 text-slate-300 xl:block" />
              )}
            </Link>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200 lg:col-span-2">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              <h2 className="font-semibold text-slate-900">Geciken İşlemler</h2>
            </div>
            {data.delayedCount > 0 && (
              <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200">
                {data.delayedCount} sipariş
              </span>
            )}
          </div>

          {data.delayed.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <CheckCircle2 className="h-10 w-10 text-emerald-500" />
              <p className="mt-3 font-medium text-slate-900">Geciken işlem yok</p>
            </div>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {data.delayed.map((o) => (
                <li key={o.id}>
                  <Link to={`/orders/${o.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 transition hover:bg-slate-50">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                        {o.arrived ? <Truck className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {o.order_no}<span className="font-normal text-slate-500"> · {o.customer}</span>
                        </p>
                        <p className="text-xs text-slate-500">
                          {o.arrived
                            ? 'Teslimat noktasında, teslim bekleniyor'
                            : `${o.status_label} · ${formatDuration(o.minutes_in_status)}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="hidden sm:block"><StatusBadge status={o.status} /></span>
                      <span className="rounded-md bg-red-50 px-2 py-1 text-xs font-semibold text-red-700">
                        +{formatDuration(o.delay_minutes)}
                      </span>
                      <ChevronRight className="h-4 w-4 text-slate-300" />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
          <div className="mb-5 flex items-center gap-2">
            <Warehouse className="h-5 w-5 text-teal-600" />
            <h2 className="font-semibold text-slate-900">Depo Durumu</h2>
          </div>

          <div className="space-y-5">
            {data.byWarehouse.map((w) => (
              <Link key={w.warehouse} to={`/orders?warehouse=${encodeURIComponent(w.warehouse)}`} className="group block">
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-700 group-hover:text-teal-700">{w.warehouse}</span>
                  <span className="font-semibold text-slate-900">{w.count}</span>
                </div>
                <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-slate-100">
                  {WAREHOUSE_PARTS.map(({ key, color }) => w[key] > 0 && (
                    <div key={key} className={color} style={{ width: `${(w[key] / maxWarehouse) * 100}%` }} />
                  ))}
                </div>
                <div className="mt-1.5 flex gap-3 text-xs text-slate-400">
                  {WAREHOUSE_PARTS.map(({ key, label }) => (
                    <span key={key}>{label} {w[key]}</span>
                  ))}
                </div>
              </Link>
            ))}
          </div>

        </section>
      </div>
    </div>
  );
}
