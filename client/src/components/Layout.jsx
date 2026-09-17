import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, PlusCircle, Navigation, LogOut, ChevronDown, Settings, Sun, Moon, Truck,
} from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import Assistant from './Assistant';
import { useAuth } from '../context/AuthContext';
import { ROLE_LABELS, initials } from '../constants';
import Logo from './Logo';

function Avatar({ name, large = false }) {
  return (
    <div className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 to-teal-500 font-semibold text-white ${large ? 'h-11 w-11 text-base' : 'h-9 w-9 text-sm'}`}>
      {initials(name)}
    </div>
  );
}

const THEMES = [
  { key: 'light', label: 'Açık tema', icon: Sun },
  { key: 'dark', label: 'Koyu tema', icon: Moon },
];

// Tek butonla açık/koyu tema
function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const index = THEMES.findIndex((t) => t.key === mode);
  const current = THEMES[index] ?? THEMES[0];
  const next = THEMES[(index + 1) % THEMES.length];
  const Icon = next.icon;
  return (
    <button
      onClick={() => setMode(next.key)}
      title={next.label}
      aria-label={`${next.label}ya geç`}
      className="rounded-xl p-2.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
    >
      <Icon className="h-5 w-5" />
    </button>
  );
}

function UserMenu({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex items-center gap-3 rounded-xl py-1.5 pl-1.5 pr-2 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-teal-500"
      >
        <Avatar name={user.name} />
        <div className="hidden text-left sm:block">
          <p className="text-sm font-medium leading-tight text-slate-900">{user.name}</p>
          <p className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</p>
        </div>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-[1100] mt-2 w-64 overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200">
          <div className="flex items-center gap-3 p-4">
            <Avatar name={user.name} large />
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-900">{user.name}</p>
              <p className="truncate text-xs text-slate-500">{user.email}</p>
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm">
            <span className="text-slate-500">Rol</span>
            <span className="rounded-full bg-teal-50 px-2.5 py-0.5 text-xs font-medium text-teal-700 ring-1 ring-teal-200">
              {ROLE_LABELS[user.role]}
            </span>
          </div>
          <button
            role="menuitem"
            onClick={onLogout}
            className="flex w-full items-center gap-2 border-t border-slate-100 px-4 py-3 text-sm font-medium text-red-600 transition hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            Çıkış Yap
          </button>
        </div>
      )}
    </div>
  );
}

export default function Layout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const role = user.role;
  const allLinks = [
    { to: '/', label: role === 'SOFOR' ? 'Görevlerim' : 'Dashboard', icon: role === 'SOFOR' ? Truck : LayoutDashboard, match: (p) => p === '/' },
    { to: '/orders', label: 'Siparişler', icon: Package, roles: ['ADMIN', 'SATIS', 'DEPO', 'LOJISTIK'], match: (p) => p.startsWith('/orders') && p !== '/orders/new' },
    { to: '/tracking', label: 'Canlı Takip', icon: Navigation, roles: ['ADMIN', 'SATIS', 'LOJISTIK'], match: (p) => p.startsWith('/tracking') },
    { to: '/orders/new', label: 'Yeni Sipariş', icon: PlusCircle, roles: ['ADMIN', 'SATIS'], match: (p) => p === '/orders/new' },
    { to: '/admin', label: 'Yönetim', icon: Settings, roles: ['ADMIN'], match: (p) => p.startsWith('/admin') },
  ];
  const links = allLinks.filter((l) => !l.roles || l.roles.includes(role));

  const today = new Date().toLocaleDateString('tr-TR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-100 px-6 py-5">
          <Logo />
        </div>

        <nav className="flex-1 space-y-1 p-4">
          {links.map(({ to, label, icon: Icon, match }) => {
            const active = match(pathname);
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? 'bg-gradient-to-r from-sky-500 to-teal-500 text-white shadow-sm'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-[1000] flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-6 backdrop-blur">
          <nav className="flex gap-1 md:hidden">
            {links.map(({ to, label, icon: Icon, match }) => (
              <Link
                key={to}
                to={to}
                aria-label={label}
                className={`rounded-lg p-2 ${match(pathname) ? 'bg-teal-500 text-white' : 'text-slate-500'}`}
              >
                <Icon className="h-5 w-5" />
              </Link>
            ))}
          </nav>
          <p className="hidden text-sm capitalize text-slate-500 md:block">{today}</p>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <NotificationBell />
            <UserMenu user={user} onLogout={logout} />
          </div>
        </header>

        <main className="flex-1 p-6 lg:p-8">
          <Outlet />
        </main>
        <Assistant />
      </div>
    </div>
  );
}
