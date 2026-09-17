import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, AlertTriangle, Clock, Truck, Volume2, VolumeX, ClipboardList } from 'lucide-react';
import { api } from '../api';
import { playAlert } from '../lib/sound';
import useDataRefresh from '../hooks/useDataRefresh';

const POLL_MS = 15000;
const SOUND_KEY = 'glyde_sound';

const LEVELS = {
  danger: { icon: AlertTriangle, cls: 'bg-red-50 text-red-600' },
  warning: { icon: Clock, cls: 'bg-amber-50 text-amber-600' },
  task: { icon: ClipboardList, cls: 'bg-sky-50 text-sky-600' },
  info: { icon: Truck, cls: 'bg-teal-50 text-teal-600' },
};
const PRIORITY = ['danger', 'task', 'warning', 'info'];

const readSound = () => {
  try { return localStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; }
};

export default function NotificationBell() {
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [unread, setUnread] = useState(() => new Set());
  const [open, setOpen] = useState(false);
  const [sound, setSound] = useState(readSound);
  const seen = useRef(null);
  const soundRef = useRef(sound);
  const ref = useRef(null);
  soundRef.current = sound;

  const load = useCallback(async () => {
    let list;
    try { list = await api('/alerts'); } catch { return; }
    setAlerts(list);

    const ids = new Set(list.map((a) => a.id));
    if (seen.current) {
      const fresh = list.filter((a) => !seen.current.has(a.id));
      if (fresh.length) {
        setUnread((u) => new Set([...u, ...fresh.map((a) => a.id)]));
        if (soundRef.current) playAlert(PRIORITY.find((l) => fresh.some((a) => a.level === l)));
      }
    } else {
      setUnread(new Set(list.map((a) => a.id)));
    }
    setUnread((u) => new Set([...u].filter((id) => ids.has(id))));
    seen.current = ids;
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);
  useDataRefresh(load);

  useEffect(() => {
    if (!open) return;
    setUnread(new Set());
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try { localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* yoksay */ }
    if (next) playAlert('task');
  }

  const count = alerts.filter((a) => unread.has(a.id)).length;
  const hasDanger = alerts.some((a) => a.level === 'danger' && unread.has(a.id));

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Bildirimler${count ? `, ${count} yeni` : ''}`}
        className="relative rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
      >
        <Bell className="h-5 w-5" />
        {count > 0 && (
          <span className={`absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold text-white ${hasDanger ? 'animate-pulse bg-red-500' : 'bg-amber-500'}`}>
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-[1100] mt-2 w-80 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <p className="font-semibold text-slate-900">Bildirimler</p>
            <button
              onClick={toggleSound}
              title={sound ? 'Sesli uyarıyı kapat' : 'Sesli uyarıyı aç'}
              className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
            >
              {sound ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
              {sound ? 'Sesli' : 'Sessiz'}
            </button>
          </div>

          {alerts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">Bildirim yok</p>
          ) : (
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {alerts.map((a) => {
                const { icon: Icon, cls } = LEVELS[a.level];
                return (
                  <li key={a.id}>
                    <button
                      onClick={() => { setOpen(false); navigate(`/orders/${a.order_id}`); }}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
                    >
                      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${cls}`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-medium text-slate-900">{a.title}</span>
                        <span className="block truncate text-xs text-slate-500">{a.order_no} · {a.customer}</span>
                        <span className="block text-xs text-slate-500">{a.detail}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
