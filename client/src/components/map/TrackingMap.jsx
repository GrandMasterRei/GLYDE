import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import { CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip, ZoomControl, useMap } from 'react-leaflet';
import { buildRoute, liveProgress, splitAt, pointAt } from '../../lib/route';
import { useTheme } from '../../context/ThemeContext';

const TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = '&copy; OpenStreetMap katkıcıları';

// Araç durum renkleri (liste ve lejant ile aynı)
export const TRUCK_TONES = {
  moving:  { label: 'Yolda',           color: '#0d9488' },
  waiting: { label: 'Teslim bekliyor', color: '#f59e0b' },
  delayed: { label: 'Gecikmeli',       color: '#ef4444' },
  loading: { label: 'Depoda',          color: '#64748b' },
};

// Rota çizgileri: beyaz kenar + dolu çizgi (navigasyon uygulamalarındaki gibi)
const ROUTE = {
  idle: { color: '#64748b', weight: 3, opacity: 0.45, lineCap: 'round' },
  casing: { color: '#ffffff', weight: 10, opacity: 1, lineCap: 'round', lineJoin: 'round' },
  rest: { color: '#99d8d1', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' },
  done: { color: '#0d9488', weight: 6, opacity: 1, lineCap: 'round', lineJoin: 'round' },
};
const DEPOT_SLOT = 30; // depodaki araçların depo ikonunun yanındaki aralığı (px)

const ICON_PATHS = {
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  warehouse: '<path d="M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z"/><path d="M6 18h12"/><path d="M6 14h12"/><rect width="12" height="12" x="6" y="10"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
};

const svg = (name, size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;

const iconCache = new Map();
const cached = (key, build) => {
  if (!iconCache.has(key)) iconCache.set(key, build());
  return iconCache.get(key);
};

// slot > 0: araç depo ikonunun sağına dizilir (üst üste binmesin)
function truckIcon(tone, selected, slot = 0) {
  return cached(`truck-${tone}-${selected}-${slot}`, () => {
    const size = selected ? 36 : 26;
    const shiftX = slot ? 16 + (slot - 1) * DEPOT_SLOT : 0;
    const color = TRUCK_TONES[tone].color;
    const halo = selected
      ? `<span class="absolute -inset-2 animate-ping rounded-full opacity-30" style="background:${color}"></span>`
      : '';
    return L.divIcon({
      className: 'truck-marker',
      iconSize: [size, size],
      iconAnchor: [size / 2 - shiftX, size / 2],
      tooltipAnchor: [shiftX, 0],
      html: `<div class="relative" style="width:${size}px;height:${size}px">${halo}
        <span class="relative flex items-center justify-center rounded-full text-white shadow-md ring-2 ring-white" style="width:${size}px;height:${size}px;background:${color}">${svg('truck', Math.round(size * 0.55))}</span></div>`,
    });
  });
}

const depotIcon = () => cached('depot', () => L.divIcon({
  className: '',
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html: `<span class="flex h-6 w-6 items-center justify-center rounded-md text-white shadow ring-2 ring-white" style="background:#1e293b">${svg('warehouse', 13)}</span>`,
}));

const destinationIcon = () => cached('dest', () => L.divIcon({
  className: '',
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  html: `<span class="flex h-[26px] w-[26px] items-center justify-center rounded-full text-white shadow ring-2 ring-white" style="background:#0d9488">${svg('flag', 13)}</span>`,
}));

export function truckTone(s, progress) {
  if (s.status === 'YUKLENDI') return 'loading';
  if (s.is_delayed) return 'delayed';
  return progress >= 1 ? 'waiting' : 'moving';
}

function MapController({ bounds, focusKey, ready, getFocusBounds, onBackgroundClick }) {
  const map = useMap();
  const fitted = useRef(false);
  const hadFocus = useRef(false);

  useEffect(() => {
    const el = map.getContainer();
    const on = () => el.classList.add('map-moving');
    const off = () => el.classList.remove('map-moving');
    const click = () => onBackgroundClick?.();
    map.on('zoomstart', on);
    map.on('zoomend', off);
    map.on('click', click);
    return () => {
      map.off('zoomstart', on);
      map.off('zoomend', off);
      map.off('click', click);
    };
  }, [map, onBackgroundClick]);

  useEffect(() => {
    if (!fitted.current && bounds?.isValid()) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 11 });
      fitted.current = true;
    }
  }, [map, bounds]);

  // Seçim değişince o rotaya, seçim kalkınca tüm görünüme dön
  useEffect(() => {
    if (!ready) return;
    if (focusKey) {
      const b = getFocusBounds();
      if (b?.isValid()) map.flyToBounds(b, { padding: [60, 60], maxZoom: 12, duration: 0.8 });
      hadFocus.current = true;
    } else if (hadFocus.current && bounds?.isValid()) {
      map.flyToBounds(bounds, { padding: [40, 40], maxZoom: 11, duration: 0.8 });
      hadFocus.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focusKey, ready]);

  return null;
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-3 z-[500] flex flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/95 px-3 py-2 text-xs text-slate-600 shadow ring-1 ring-slate-200">
      {Object.entries(TRUCK_TONES).map(([key, t]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: t.color }} />
          {t.label}
        </span>
      ))}
    </div>
  );
}

export default function TrackingMap({
  shipments = [],
  warehouses = [],
  selectedId = null,
  onSelect,
  now,
  offset = 0,
  compact = false,
  scrollZoom = !compact,
  legend = !compact,
  zoomPosition = 'topleft',
}) {
  const { dark } = useTheme();
  const casing = dark ? { ...ROUTE.casing, color: '#0b1120' } : ROUTE.casing;
  const routes = useMemo(() => {
    const m = new Map();
    shipments.forEach((s) => { if (s.route?.length > 1) m.set(s.id, buildRoute(s.route)); });
    return m;
  }, [shipments]);

  const depots = useMemo(() => {
    const m = new Map();
    warehouses.forEach((w) => m.set(w.name, w));
    shipments.forEach((s) => { if (s.origin) m.set(s.origin.name, s.origin); });
    return [...m.values()];
  }, [shipments, warehouses]);

  const bounds = useMemo(() => {
    const pts = [
      ...depots.map((d) => [d.lat, d.lng]),
      ...shipments.map((s) => [s.destination.lat, s.destination.lng]),
    ];
    return pts.length ? L.latLngBounds(pts) : null;
  }, [depots, shipments]);

  const getFocusBounds = () => {
    const r = routes.get(selectedId);
    return r ? L.latLngBounds(r.points) : null;
  };

  const selected = shipments.find((s) => s.id === selectedId);
  const selectedRoute = selected && routes.get(selected.id);
  const selectedProgress = selected ? liveProgress(selected, now, offset) : 0;
  const [done, rest] = selectedRoute ? splitAt(selectedRoute, selectedProgress) : [[], []];

  // Depoda bekleyen araçlara depo başına sıra numarası ver
  const depotSlots = new Map();
  const slotCounter = {};
  shipments.forEach((s) => {
    if (s.status !== 'YUKLENDI') return;
    slotCounter[s.warehouse] = (slotCounter[s.warehouse] || 0) + 1;
    depotSlots.set(s.id, slotCounter[s.warehouse]);
  });

  const trucks = shipments.filter((s) => ['YUKLENDI', 'SEVKIYATTA'].includes(s.status) && routes.has(s.id));

  return (
    <div className="relative h-full w-full">
      <MapContainer center={[40.2, 29.5]} zoom={7} scrollWheelZoom={scrollZoom} zoomControl={false} className="h-full w-full">
        <ZoomControl position={zoomPosition} />
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} maxZoom={19} className="map-tiles" />
        <MapController
          bounds={bounds}
          focusKey={compact ? null : selectedId}
          ready={routes.size > 0}
          getFocusBounds={getFocusBounds}
          onBackgroundClick={compact ? undefined : () => selectedId && onSelect?.(null)}
        />

        {/* Seçim yokken tüm rotalar ince ve gri; seçim varsa yalnızca seçili rota */}
        {!selected && shipments.map((s) => routes.has(s.id) && (
          <Polyline key={`idle-${s.id}`} positions={routes.get(s.id).points} pathOptions={ROUTE.idle} interactive={false} />
        ))}
        {selectedRoute && (
          <>
            <Polyline key={`casing-${selected.id}`} positions={selectedRoute.points} pathOptions={casing} interactive={false} />
            {selectedProgress < 1 && (
              <Polyline key={`rest-${selected.id}`} positions={rest} pathOptions={ROUTE.rest} interactive={false} />
            )}
            {selectedProgress > 0 && (
              <Polyline key={`done-${selected.id}`} positions={done} pathOptions={ROUTE.done} interactive={false} />
            )}
          </>
        )}

        {depots.map((d) => (
          <Marker key={`depot-${d.name}`} position={[d.lat, d.lng]} icon={depotIcon()} zIndexOffset={100}>
            <Tooltip direction="top" offset={[0, -12]}>
              <p className="font-semibold">{d.name}</p>
              <p className="text-slate-500">{d.district}</p>
            </Tooltip>
          </Marker>
        ))}

        {!selected && shipments.map((s) => (
          <CircleMarker
            key={`dest-${s.id}`}
            center={[s.destination.lat, s.destination.lng]}
            radius={4}
            interactive={false}
            pathOptions={{ color: '#fff', weight: 1.5, fillColor: '#64748b', fillOpacity: 1 }}
          />
        ))}
        {selected && (
          <Marker position={[selected.destination.lat, selected.destination.lng]} icon={destinationIcon()} zIndexOffset={200}>
            <Tooltip direction="top" offset={[0, -12]}>
              <p className="font-semibold">{selected.destination.name}</p>
              <p className="text-slate-500">{selected.destination.city}</p>
            </Tooltip>
          </Marker>
        )}

        {trucks.map((s) => {
          const p = liveProgress(s, now, offset);
          const isSelected = s.id === selectedId && !compact;
          const slot = depotSlots.get(s.id) || 0;
          return (
            <Marker
              key={`truck-${s.id}-${isSelected}`}
              position={pointAt(routes.get(s.id), p).latlng}
              icon={truckIcon(truckTone(s, p), isSelected, slot)}
              zIndexOffset={isSelected ? 2000 : 1000}
              eventHandlers={{ click: () => onSelect?.(s.id) }}
            >
              {isSelected ? (
                <Tooltip permanent direction="top" offset={[0, -20]}>
                  <span className="font-semibold">{s.plate}</span>
                </Tooltip>
              ) : (
                <Tooltip direction="top" offset={[0, -14]}>
                  <p className="font-semibold">{s.order_no} · {s.plate}</p>
                  <p className="text-slate-500">{s.customer} · {s.destination.city}</p>
                </Tooltip>
              )}
            </Marker>
          );
        })}
      </MapContainer>
      {legend && <Legend />}
    </div>
  );
}
