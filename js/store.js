// Persistencia local (localStorage). Todo vive en el dispositivo;
// para compartir con la cordada se usa el link de importación o el JSON.
const KEY = 'cordada.v1';

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (data && Array.isArray(data.trips)) {
      data.trips.forEach(normalize);
      return { settings: {}, ...data };
    }
  } catch { /* datos corruptos o storage bloqueado */ }
  return { trips: [], settings: {} };
}

// Completa campos agregados en versiones posteriores.
export function normalize(t) {
  ['members', 'gear', 'ropes', 'cars', 'itinerary', 'modules'].forEach((k) => { if (!Array.isArray(t[k])) t[k] = []; });
  ['plan', 'org', 'drive', 'overrides', 'info'].forEach((k) => { if (!t[k] || typeof t[k] !== 'object') t[k] = {}; });
  return t;
}

export const state = load();

// Se llama después de cada guardado (la app lo usa para sincronizar).
export const hooks = { afterSave: null };

export function saveLocal() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('No se pudo guardar', e);
    alert('No se pudo guardar en el dispositivo (¿almacenamiento lleno?). Exporta tus salidas.');
  }
}

export function save() {
  saveLocal();
  hooks.afterSave?.();
}

export const uid = () => Math.random().toString(36).slice(2, 10);

// Id largo y aleatorio para salidas sincronizadas (funciona como "llave" de acceso).
export function longId() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return [...crypto.getRandomValues(new Uint8Array(22))].map((b) => abc[b % abc.length]).join('');
}

export const getTrip = (id) => state.trips.find((t) => t.id === id);

export function newTrip(fields) {
  const trip = {
    id: uid(),
    name: '',
    date: '',
    endDate: '',
    modules: ['base'],
    peak: '',
    lat: null,
    lon: null,
    altitude: null,
    andesUrl: '',
    members: [],
    gear: [],
    ropes: [],
    cars: [],
    itinerary: [],
    overrides: {},
    info: {},
    ownerId: null,
    plan: {},
    org: { ...(state.settings.club || {}) },
    gpx: null,
    drive: {},
    notes: '',
    createdAt: new Date().toISOString(),
    ...fields,
  };
  state.trips.unshift(trip);
  save();
  return trip;
}

export function deleteTrip(id) {
  state.trips = state.trips.filter((t) => t.id !== id);
  save();
}

// --- Compartir salida por link (comprimido si el navegador lo soporta) ---

const toB64u = (bytes) => {
  let s = '';
  bytes.forEach((b) => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64u = (str) => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export function shareableTrip(trip) {
  // Sin clima cacheado (se vuelve a pedir) ni fotos.
  const { weather, ...rest } = trip;
  return rest;
}

export async function encodeTrip(trip) {
  const json = new TextEncoder().encode(JSON.stringify(shareableTrip(trip)));
  if ('CompressionStream' in window) {
    return 'z' + toB64u(await pipe(json, new CompressionStream('deflate-raw')));
  }
  return 'j' + toB64u(json);
}

export async function decodeTrip(code) {
  const kind = code[0];
  let bytes = fromB64u(code.slice(1));
  if (kind === 'z') bytes = await pipe(bytes, new DecompressionStream('deflate-raw'));
  return JSON.parse(new TextDecoder().decode(bytes));
}

export function importTrip(data) {
  if (!data || typeof data !== 'object' || !data.name) throw new Error('Archivo de salida no válido');
  const existing = getTrip(data.id);
  if (existing) {
    // Actualiza la salida conservando el clima local.
    Object.assign(existing, normalize({ ...data }), { weather: existing.weather });
    save();
    return existing;
  }
  const trip = normalize({ ...data, id: data.id || uid() });
  state.trips.unshift(trip);
  save();
  return trip;
}
