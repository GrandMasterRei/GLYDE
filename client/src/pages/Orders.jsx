import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Search, X, Loader2, PlusCircle, ChevronRight, AlertTriangle, PackageSearch, Download } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { FLOW, STATUS_STYLES, formatDateTime, formatDuration } from '../constants';
import StatusBadge from '../components/StatusBadge';
import useDataRefresh from '../hooks/useDataRefresh';

// Görünen listeyi Excel'de açılabilen CSV olarak indirir
function exportCsv(rows) {
  const head = ['Sipariş No', 'Müşteri', 'Teslimat', 'Depo', 'Araç', 'Şoför', 'Durum', 'Aşamada (dk)', 'Gecikme (dk)', 'Oluşturulma'];
  const body = rows.map((o) => [
    o.order_no, o.customer, `${o.destination.name}, ${o.destination.city}`, o.warehouse,
    o.plate || '', o.driver_name || '', o.status_label, o.minutes_in_status, o.delay_minutes,
    new Date(o.created_at).toLocaleString('tr-TR'),
  ]);
  const csv = [head, ...body]
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    .join('\n');
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `siparisler-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function Toggle({ active, onClick, label, count, tone = 'teal' }) {
  const on = tone === 'red'
    ? 'bg-red-50 text-red-700 ring-red-200'
    : 'bg-teal-50 text-teal-700 ring-teal-200';
  const dot = tone === 'red' ? 'bg-red-500' : 'bg-teal-500';
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium ring-1 transition ${
        active ? on : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'
      }`}
    >
      <span className={`h-2 w-2 rounded-full ${active ? dot : 'bg-slate-300'}`} />
      {label}
      <span className="text-xs opacity-70">{count}</span>
    </button>
  );
}

export default function Orders() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const status = params.get('status') || '';
  const warehouse = params.get('warehouse') || '';
  const q = params.get('q') || '';
  const mine = params.get('mine') === '1';
  const delayed = params.get('delayed') === '1';

  const [warehouses, setWarehouses] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(q);

  const canCreate = ['SATIS', 'ADMIN'].includes(user.role);
  const showMine = ['DEPO', 'LOJISTIK'].includes(user.role);

  function update(changes) {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
      return next;
    }, { replace: true });
  }

  function clearAll() {
    setSearch('');
    setParams({}, { replace: true });
  }

  useEffect(() => {
    api('/meta').then((m) => setWarehouses(m.warehouses)).catch(() => {});
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== q) update({ q: search.trim() }); }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  useEffect(() => {
    setSearch((s) => (s.trim() === q ? s : q));
  }, [q]);

  // Durum filtresi istemcide uygulanır, böylece sekmelerdeki sayılar her zaman doğru kalır
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);
  useDataRefresh(reload);

  useEffect(() => {
    const qs = new URLSearchParams();
    if (warehouse) qs.set('warehouse', warehouse);
    if (q) qs.set('q', q);

    let cancelled = false;
    setLoading(true);
    api(`/orders?${qs}`)
      .then((d) => { if (!cancelled) { setOrders(d); setError(''); } })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [warehouse, q, reloadKey]);

  const { scoped, statusCounts, delayedCount, mineCount, visible } = useMemo(() => {
    const scoped = orders.filter((o) => (!mine || o.is_my_task) && (!delayed || o.is_delayed));
    const statusCounts = Object.fromEntries([...FLOW, 'IPTAL'].map((s) => [s, scoped.filter((o) => o.status === s).length]));
    const inStatus = status ? orders.filter((o) => o.status === status) : orders;
    return {
      scoped,
      statusCounts,
      delayedCount: inStatus.filter((o) => o.is_delayed && (!mine || o.is_my_task)).length,
      mineCount: inStatus.filter((o) => o.is_my_task && (!delayed || o.is_delayed)).length,
      visible: status ? scoped.filter((o) => o.status === status) : scoped,
    };
  }, [orders, status, mine, delayed]);

  const tabs = [
    { key: '', label: 'Tümü', count: scoped.length },
    ...[...FLOW, 'IPTAL'].map((s) => ({ key: s, label: STATUS_STYLES[s].label, count: statusCounts[s] })),
  ];

  const hasFilters = Boolean(status || warehouse || q || mine || delayed);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Siparişler</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => exportCsv(visible)}
            disabled={!visible.length}
            className="flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm font-medium text-slate-600 shadow-sm ring-1 ring-slate-200 transition hover:bg-slate-50 disabled:opacity-40"
          >
            <Download className="h-4 w-4" />
            Dışa aktar
          </button>
        {canCreate && (
          <Link
            to="/orders/new"
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-500 to-teal-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
          >
            <PlusCircle className="h-4 w-4" />
            Yeni Sipariş
          </Link>
        )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {/* Durum sekmeleri */}
        <div className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200 px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {tabs.map((t) => {
            const active = status === t.key;
            return (
              <button
                key={t.key || 'all'}
                onClick={() => update({ status: t.key })}
                className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-medium transition ${
                  active ? 'border-teal-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                {t.label}
                <span className={`rounded-full px-1.5 py-0.5 text-xs ${active ? 'bg-teal-50 text-teal-700' : 'bg-slate-100 text-slate-500'}`}>
                  {t.count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Arama ve filtreler */}
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-4">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Sipariş no, müşteri veya plaka"
              aria-label="Sipariş ara"
              className="w-full rounded-lg border border-slate-200 bg-slate-50/60 py-2 pl-9 pr-8 text-sm outline-none focus:border-teal-500 focus:bg-white focus:ring-2 focus:ring-teal-500/20"
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Aramayı temizle" className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <select
            value={warehouse}
            onChange={(e) => update({ warehouse: e.target.value })}
            aria-label="Depo"
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20"
          >
            <option value="">Tüm depolar</option>
            {warehouses.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>

          <Toggle tone="red" label="Geciken" count={delayedCount} active={delayed} onClick={() => update({ delayed: delayed ? '' : '1' })} />
          {showMine && (
            <Toggle label="Bende bekleyen" count={mineCount} active={mine} onClick={() => update({ mine: mine ? '' : '1' })} />
          )}

          {hasFilters && (
            <button onClick={clearAll} className="px-2 text-sm text-slate-500 hover:text-red-600">Temizle</button>
          )}
          {loading && orders.length > 0 && <Loader2 className="h-4 w-4 animate-spin text-teal-600" />}
        </div>

        {error && <p className="m-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {loading && orders.length === 0 ? (
          <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <PackageSearch className="h-10 w-10 text-slate-300" />
            <p className="mt-3 font-medium text-slate-900">Sipariş bulunamadı</p>
            {hasFilters && (
              <button onClick={clearAll} className="mt-2 text-sm font-medium text-teal-700 hover:underline">Filtreleri temizle</button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                  <th className="px-5 py-3">Sipariş No</th>
                  <th className="px-5 py-3">Müşteri</th>
                  <th className="px-5 py-3">Depo</th>
                  <th className="px-5 py-3">Araç</th>
                  <th className="px-5 py-3">Durum</th>
                  <th className="px-5 py-3">Aşamada</th>
                  <th className="px-5 py-3">Oluşturulma</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map((o) => (
                  <tr key={o.id} onClick={() => navigate(`/orders/${o.id}`)} className="cursor-pointer transition hover:bg-slate-50">
                    <td className="px-5 py-3.5 font-medium text-slate-900">{o.order_no}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-slate-800">{o.customer}</p>
                      <p className="text-xs text-slate-400">{o.destination.name}, {o.destination.city}</p>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{o.warehouse}</td>
                    <td className="px-5 py-3.5">
                      {o.plate ? (
                        <>
                          <p className="font-medium text-slate-700">{o.plate}</p>
                          <p className="text-xs text-slate-400">{o.driver_name}</p>
                        </>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-col items-start gap-1.5">
                        <StatusBadge status={o.status} />
                        {o.status === 'SEVKIYATTA' && (
                          o.arrived ? (
                            <span className="text-xs font-medium text-amber-600">Teslimat noktasında</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                                <div className="h-full rounded-full bg-teal-500" style={{ width: `${Math.round(o.progress * 100)}%` }} />
                              </div>
                              <span className="text-xs text-slate-500">%{Math.round(o.progress * 100)}</span>
                            </div>
                          )
                        )}
                        {o.is_my_task && (
                          <span className="text-xs font-medium text-teal-600">● Sizde</span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      {['TESLIM_EDILDI', 'IPTAL'].includes(o.status) ? (
                        <span className="text-slate-300">—</span>
                      ) : o.is_delayed ? (
                        <div className="flex items-center gap-1.5 text-red-600">
                          <AlertTriangle className="h-4 w-4 shrink-0" />
                          <div>
                            <p className="font-medium">{formatDuration(o.minutes_in_status)}</p>
                            <p className="text-xs">+{formatDuration(o.delay_minutes)}</p>
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-600">{formatDuration(o.minutes_in_status)}</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500">{formatDateTime(o.created_at)}</td>
                    <td className="px-5 py-3.5 text-right"><ChevronRight className="inline h-4 w-4 text-slate-300" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {!loading && visible.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">{visible.length} sipariş</div>
        )}
      </div>
    </div>
  );
}
