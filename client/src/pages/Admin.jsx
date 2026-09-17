import { useCallback, useEffect, useState } from 'react';
import { Loader2, Plus, Pencil, Trash2, X, RotateCcw } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS } from '../constants';
import Toast, { useToast } from '../components/Toast';

const ROLE_OPTIONS = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }));

const ENTITIES = {
  users: {
    tab: 'Personel',
    addLabel: 'Personel Ekle',
    columns: [
      { label: 'Ad Soyad', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
      { label: 'E-posta', render: (r) => r.email },
      { label: 'Rol', render: (r) => ROLE_LABELS[r.role] },
      { label: 'Durum', render: (r) => (r.busy_order_no ? <span className="text-teal-700">{r.busy_order_no} görevinde</span> : <span className="text-slate-400">Müsait</span>) },
    ],
    fields: (_, editing) => [
      { name: 'name', label: 'Ad soyad', required: true },
      { name: 'role', label: 'Rol', type: 'select', options: ROLE_OPTIONS, required: true },
      { name: 'email', label: 'E-posta', type: 'email', required: editing, placeholder: 'Rol seçilince otomatik gelir' },
      {
        name: 'password',
        label: editing ? 'Yeni şifre' : 'Şifre',
        type: 'password',
        placeholder: editing ? 'Değiştirmek için doldurun' : 'Boş bırakılırsa 123456',
      },
    ],
    empty: { name: '', email: '', role: '', password: '' },
  },
  vehicles: {
    tab: 'Araçlar',
    addLabel: 'Araç Ekle',
    columns: [
      { label: 'Plaka', render: (r) => <span className="font-medium text-slate-900">{r.plate}</span> },
      { label: 'Model', render: (r) => r.model },

      {
        label: 'Durum',
        render: (r) => (r.busy_order_no
          ? <span className="text-teal-700">{r.busy_order_no} siparişinde</span>
          : <span className="text-slate-400">Boşta</span>),
      },
    ],
    fields: () => [
      { name: 'plate', label: 'Plaka', required: true, placeholder: '34 ABC 123' },
      { name: 'model', label: 'Model', required: true },
    ],
    empty: { plate: '', model: '' },
  },
  customers: {
    tab: 'Müşteriler',
    addLabel: 'Müşteri Ekle',
    columns: [
      { label: 'Müşteri', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
      { label: 'Teslimat noktası', render: (r) => `${r.destination_name}, ${r.destination_city}` },
      { label: 'Sipariş', render: (r) => r.order_count },
    ],
    fields: (destinations) => [
      { name: 'name', label: 'Müşteri adı', required: true },
      {
        name: 'destination_id',
        label: 'Teslimat noktası',
        type: 'select',
        required: true,
        options: destinations.map((d) => ({ value: String(d.id), label: `${d.name} (${d.city})` })),
      },
    ],
    empty: { name: '', destination_id: '' },
  },
};

const inputClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-teal-500 focus:ring-2 focus:ring-teal-500/20';

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/50 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-2xl bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} aria-label="Kapat" className="rounded p-1 text-slate-400 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function RecordForm({ entity, record, destinations, onClose, onSaved }) {
  const config = ENTITIES[entity];
  const editing = Boolean(record);
  const [values, setValues] = useState(() => {
    if (!record) return config.empty;
    const v = { ...config.empty };
    Object.keys(v).forEach((k) => { v[k] = record[k] == null ? '' : String(record[k]); });
    if ('password' in v) v.password = '';
    return v;
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [autoEmail, setAutoEmail] = useState('');

  // Yeni personelde rol seçilince sıradaki e-posta önerilir (sofor9@glyde.app gibi)
  async function onRoleChange(role) {
    if (editing || entity !== 'users' || !role) return;
    try {
      const { email } = await api(`/admin/users/suggest-email?role=${role}`);
      setValues((v) => (!v.email || v.email === autoEmail ? { ...v, role, email } : v));
      setAutoEmail(email);
    } catch { /* öneri alınamazsa kullanıcı yazar */ }
  }

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const result = await api(editing ? `/admin/${entity}/${record.id}` : `/admin/${entity}`, {
        method: editing ? 'PATCH' : 'POST',
        body: values,
      });
      const created = !editing ? result : null;
      onSaved(created?.email
        ? `${created.email} oluşturuldu${created.default_password ? ' · şifre 123456' : ''}`
        : editing ? 'Değişiklikler kaydedildi' : 'Kayıt eklendi');
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <Modal title={editing ? 'Düzenle' : config.addLabel} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        {config.fields(destinations, editing).map((f) => (
          <div key={f.name}>
            <label htmlFor={f.name} className="mb-1.5 block text-sm font-medium text-slate-700">{f.label}</label>
            {f.type === 'select' ? (
              <select
                id={f.name}
                value={values[f.name]}
                onChange={(e) => {
                  setValues({ ...values, [f.name]: e.target.value });
                  if (f.name === 'role') onRoleChange(e.target.value);
                }}
                required={f.required}
                className={inputClass}
              >
                <option value="">{f.emptyLabel || 'Seçin'}</option>
                {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            ) : (
              <input
                id={f.name}
                type={f.type || 'text'}
                value={values[f.name]}
                onChange={(e) => setValues({ ...values, [f.name]: e.target.value })}
                required={f.required}
                minLength={f.type === 'password' && values[f.name] ? 6 : undefined}
                placeholder={f.placeholder}
                autoComplete={f.type === 'password' ? 'new-password' : 'off'}
                className={inputClass}
              />
            )}
          </div>
        ))}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            Vazgeç
          </button>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-500 to-teal-500 px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-90 disabled:opacity-50"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Kaydet
          </button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDelete({ onConfirm, onClose, busy, error }) {
  return (
    <Modal title="Kaydı sil" onClose={onClose}>
      <div className="space-y-4 p-5">
        <p className="text-sm text-slate-600">
          Bu kayıt silinecek. Geçmiş siparişlerde kullanılıyorsa silinmez, pasife alınır.
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50">
            Vazgeç
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Sil
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function Admin() {
  const { user } = useAuth();
  const [entity, setEntity] = useState('users');
  const [rows, setRows] = useState([]);
  const [destinations, setDestinations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);        // { record } | null
  const [deleting, setDeleting] = useState(null); // kayıt
  const [deleteState, setDeleteState] = useState({ busy: false, error: '' });
  const { toast, showToast } = useToast();
  const config = ENTITIES[entity];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await api(`/admin/${entity}`));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [entity]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api('/meta').then((m) => setDestinations(m.destinations)).catch(() => {});
  }, []);

  async function setActive(row, active) {
    try {
      await api(`/admin/${entity}/${row.id}/active`, { method: 'PATCH', body: { active } });
      showToast(active ? 'Kayıt aktif edildi' : 'Kayıt pasife alındı');
      load();
    } catch (err) {
      showToast(err.message);
    }
  }

  async function confirmDelete() {
    setDeleteState({ busy: true, error: '' });
    try {
      const r = await api(`/admin/${entity}/${deleting.id}`, { method: 'DELETE' });
      showToast(r.archived ? 'Kayıt geçmişte kullanıldığı için pasife alındı' : 'Kayıt silindi');
      setDeleting(null);
      setDeleteState({ busy: false, error: '' });
      load();
    } catch (err) {
      setDeleteState({ busy: false, error: err.message });
    }
  }

  const isSelf = (row) => entity === 'users' && row.id === user.id;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Yönetim</h1>
        <button
          onClick={() => setForm({ record: null })}
          className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-sky-500 to-teal-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-90"
        >
          <Plus className="h-4 w-4" />
          {config.addLabel}
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        <div className="flex gap-1 border-b border-slate-200 px-3">
          {Object.entries(ENTITIES).map(([key, e]) => (
            <button
              key={key}
              onClick={() => setEntity(key)}
              className={`border-b-2 px-3 py-3 text-sm font-medium transition ${
                entity === key ? 'border-teal-500 text-slate-900' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {e.tab}
            </button>
          ))}
        </div>

        {error && <p className="m-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

        {loading && rows.length === 0 ? (
          <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-teal-600" /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-slate-50/80 text-left text-xs font-medium text-slate-500">
                  {config.columns.map((c) => <th key={c.label} className="px-5 py-3">{c.label}</th>)}
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((row) => (
                  <tr key={row.id} className={row.active ? '' : 'bg-slate-50/60 text-slate-400'}>
                    {config.columns.map((c, i) => (
                      <td key={c.label} className={`px-5 py-3 ${row.active ? 'text-slate-600' : ''}`}>
                        <div className="flex items-center gap-2">
                          {c.render(row)}
                          {i === 0 && !row.active && (
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">Pasif</span>
                          )}
                          {i === 0 && isSelf(row) && (
                            <span className="rounded-full bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">Siz</span>
                          )}
                        </div>
                      </td>
                    ))}
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1">
                        {row.active ? (
                          <>
                            <button onClick={() => setForm({ record: row })} title="Düzenle" aria-label="Düzenle" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                              <Pencil className="h-4 w-4" />
                            </button>
                            {!isSelf(row) && (
                              <button onClick={() => setDeleting(row)} title="Sil" aria-label="Sil" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </>
                        ) : (
                          <button onClick={() => setActive(row, true)} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-teal-700 hover:bg-teal-50">
                            <RotateCcw className="h-3.5 w-3.5" />
                            Aktif et
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {form && (
        <RecordForm
          key={`${entity}-${form.record?.id ?? 'new'}`}
          entity={entity}
          record={form.record}
          destinations={destinations}
          onClose={() => setForm(null)}
          onSaved={(msg) => { setForm(null); showToast(msg); load(); }}
        />
      )}

      {deleting && (
        <ConfirmDelete
          busy={deleteState.busy}
          error={deleteState.error}
          onConfirm={confirmDelete}
          onClose={() => { setDeleting(null); setDeleteState({ busy: false, error: '' }); }}
        />
      )}

      <Toast message={toast} />
    </div>
  );
}
