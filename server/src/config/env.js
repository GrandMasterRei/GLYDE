import 'dotenv/config';

export const PORT = Number(process.env.PORT) || 4000;
export const JWT_SECRET = process.env.JWT_SECRET || 'glyde-gizli-anahtar';
export const SIMULATION_SPEED = Math.max(1, Number(process.env.SIMULATION_SPEED) || 1);
export const OSRM_URL = process.env.OSRM_URL || 'https://router.project-osrm.org';
// true: her açılışta örnek veriler güncel saatle yeniden yüklenir
export const RESET_DATA_ON_START = process.env.RESET_DATA_ON_START === 'true';
