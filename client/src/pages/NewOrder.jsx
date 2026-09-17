import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, PlusCircle } from 'lucide-react';
import { api } from '../api';

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';

function Field({ id, label, children }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">{label}</label>
      {children}
    </div>
  );
}

export default function NewOrder() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState(null);
  const [customerId, setCustomerId] = useState('');
  const [warehouse, setWarehouse] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api('/meta')
      .then(setMeta)
      .catch((err) => setError(err.message));
  }, []);

  const groups = useMemo(() => {
    const g = {};
    (meta?.destinations ?? []).forEach((d) => { (g[d.city] ??= []).push(d); });
    return Object.entries(g);
  }, [meta]);

  // Müşteri seçilince kayıtlı teslimat noktası gelir
  function selectCustomer(id) {
    setCustomerId(id);
    const c = meta?.customers.find((x) => String(x.id) === id);
    if (c) setDestinationId(String(c.destination_id));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const created = await api('/orders', {
        method: 'POST',
        body: { customer_id: Number(customerId), warehouse, destination_id: Number(destinationId), note },
      });
      navigate(`/orders/${created.id}`, { state: { created: created.order_no } });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  const ready = customerId && warehouse && destinationId;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/orders" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />
        Siparişler
      </Link>

      <h1 className="text-2xl font-semibold text-slate-900">Yeni Sipariş</h1>

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
        <Field id="customer" label="Müşteri">
          <select id="customer" value={customerId} onChange={(e) => selectCustomer(e.target.value)} required className={inputClass}>
            <option value="">Seçin</option>
            {meta?.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="warehouse" label="Depo">
            <select id="warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} required className={inputClass}>
              <option value="">Seçin</option>
              {meta?.warehouseLocations.map((w) => (
                <option key={w.name} value={w.name}>{w.name}</option>
              ))}
            </select>
          </Field>
          <Field id="destination" label="Teslimat noktası">
            <select id="destination" value={destinationId} onChange={(e) => setDestinationId(e.target.value)} required className={inputClass}>
              <option value="">Seçin</option>
              {groups.map(([city, items]) => (
                <optgroup key={city} label={city}>
                  {items.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </optgroup>
              ))}
            </select>
          </Field>
        </div>

        <Field id="note" label="Not (isteğe bağlı)">
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            maxLength={300}
            className={inputClass}
          />
        </Field>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
          <Link to="/orders" className="rounded-lg px-4 py-2.5 text-sm font-medium text-slate-600 ring-1 ring-slate-200 transition hover:bg-slate-50">
            Vazgeç
          </Link>
          <button
            type="submit"
            disabled={submitting || !ready}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-500 to-teal-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            Siparişi Oluştur
          </button>
        </div>
      </form>
    </div>
  );
}
