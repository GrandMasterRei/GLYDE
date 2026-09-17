export const WAREHOUSES = [
  { name: 'İstanbul Depo', district: 'Hadımköy, İstanbul', lat: 41.1030, lng: 28.6200 },
  { name: 'Kocaeli Depo',  district: 'Dilovası, Kocaeli',  lat: 40.7870, lng: 29.5450 },
  { name: 'İzmir Depo',    district: 'Kemalpaşa, İzmir',   lat: 38.4270, lng: 27.4170 },
];

export const WAREHOUSE_NAMES = WAREHOUSES.map((w) => w.name);

export const findWarehouse = (name) => WAREHOUSES.find((w) => w.name === name) || null;
