// Sincronización en tiempo real entre los teléfonos de la cordada (Firebase Firestore).
//
// Cada salida compartida es un documento `trips/{syncId}`. Las listas con id
// (equipo, integrantes, autos…) se guardan como mapas, y cada cambio se envía
// como una actualización de campo puntual (ej. `gear.abc.checks.m1 = true`):
// así dos personas pueden marcar su equipo al mismo tiempo sin pisarse.
// Firestore guarda los cambios hechos sin señal y los envía al volver la conexión.

export const LISTS = ['gear', 'members', 'ropes', 'cars', 'itinerary'];
const LOCAL_ONLY = ['weather', 'syncId', 'createdAt'];

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function toRemote(trip) {
  const out = {};
  for (const [k, v] of Object.entries(trip)) {
    if (LOCAL_ONLY.includes(k) || v === undefined) continue;
    if (LISTS.includes(k) && Array.isArray(v)) {
      out[k] = Object.fromEntries(v.map((item, i) => [item.id, { ...clean(item), _o: i }]));
    } else if (k === 'gpx' && v) {
      // Firestore no admite arreglos anidados: el perfil [km, m] pasa a objetos.
      out.gpx = clean({ ...v, stats: { ...v.stats, profile: (v.stats?.profile || []).map(([d, e]) => ({ d, e })) } });
    } else out[k] = clean(v);
  }
  return out;
}

export function fromRemote(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (LISTS.includes(k) && isObj(v)) {
      out[k] = Object.entries(v)
        .map(([id, item]) => ({ ...item, id }))
        .sort((a, b) => (a._o ?? 0) - (b._o ?? 0))
        .map(({ _o, ...item }) => item);
    } else if (k === 'gpx' && v?.stats) {
      out.gpx = { ...v, stats: { ...v.stats, profile: (v.stats.profile || []).map(({ d, e }) => [d, e]) } };
    } else out[k] = v;
  }
  LISTS.forEach((k) => { out[k] ||= []; });
  return out;
}

// Firestore no acepta `undefined`.
function clean(v) {
  if (Array.isArray(v)) return v.map(clean);
  if (isObj(v)) return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, clean(x)]));
  return v;
}

// Comparación independiente del orden de las claves.
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
  : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
    : JSON.stringify(v));
const same = (a, b) => canon(a) === canon(b);

// Diferencias entre dos versiones como { 'ruta.al.campo': valor | DELETE }.
export const DELETE = Symbol('delete');
export function diff(prev, next, base = '', out = {}) {
  const keys = new Set([...Object.keys(prev || {}), ...Object.keys(next || {})]);
  for (const k of keys) {
    const path = base ? `${base}.${k}` : k;
    const a = prev?.[k];
    const b = next?.[k];
    if (b === undefined) { if (a !== undefined) out[path] = DELETE; continue; }
    if (isObj(a) && isObj(b)) diff(a, b, path, out);
    else if (!same(a, b)) out[path] = b;
  }
  return out;
}

// ---------- Firestore ----------

let fb = null;

async function init(config) {
  if (fb) return fb;
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import('../vendor/firebase/firebase-app.js'),
    import('../vendor/firebase/firebase-auth.js'),
    import('../vendor/firebase/firebase-firestore.js'),
  ]);
  const app = initializeApp(config);
  let db;
  try {
    db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
  } catch {
    db = fs.getFirestore(app);
  }
  // Sesión anónima: no pide cuentas, pero permite reglas de seguridad.
  const a = auth.getAuth(app);
  if (!a.currentUser) await auth.signInAnonymously(a);
  fb = { db, fs };
  return fb;
}

export class TripSync {
  constructor(config, { onRemote, onStatus }) {
    this.config = config;
    this.onRemote = onRemote;
    this.onStatus = onStatus;
    this.subs = new Map(); // syncId -> { unsub, last }
  }

  async ready() {
    return init(this.config);
  }

  // Sube la salida por primera vez (crear o compartir).
  async publish(trip) {
    const { db, fs } = await this.ready();
    const data = toRemote(trip);
    await fs.setDoc(fs.doc(db, 'trips', trip.syncId), { ...data, _updated: fs.serverTimestamp() });
    this.subs.get(trip.syncId) && (this.subs.get(trip.syncId).last = data);
  }

  async exists(syncId) {
    const { db, fs } = await this.ready();
    const snap = await fs.getDoc(fs.doc(db, 'trips', syncId));
    return snap.exists() ? fromRemote(snap.data()) : null;
  }

  async watch(syncId) {
    if (this.subs.has(syncId)) return;
    const { db, fs } = await this.ready();
    const entry = { last: null, unsub: null };
    this.subs.set(syncId, entry);
    entry.unsub = fs.onSnapshot(fs.doc(db, 'trips', syncId), { includeMetadataChanges: true }, (snap) => {
      this.onStatus?.(syncId, snap.metadata.hasPendingWrites ? 'pending' : snap.metadata.fromCache ? 'offline' : 'synced');
      if (!snap.exists()) return;
      const { _updated, ...data } = snap.data();
      if (entry.last && same(entry.last, data)) return;
      entry.last = data;
      this.onRemote(syncId, fromRemote(data));
    }, (err) => this.onStatus?.(syncId, 'error', err));
  }

  // Envía solo lo que cambió desde la última versión conocida.
  async push(trip) {
    const entry = this.subs.get(trip.syncId);
    if (!entry?.last || !fb) return;
    // El diff se calcula antes de cualquier await para no mezclarse con cambios remotos.
    const next = toRemote(trip);
    const changes = diff(entry.last, next);
    const paths = Object.keys(changes);
    if (!paths.length) return;
    entry.last = next;
    const { db, fs } = fb;
    const update = Object.fromEntries(paths.map((p) => [p, changes[p] === DELETE ? fs.deleteField() : changes[p]]));
    update._updated = fs.serverTimestamp();
    await fs.updateDoc(fs.doc(db, 'trips', trip.syncId), update);
  }

  unwatch(syncId) {
    this.subs.get(syncId)?.unsub?.();
    this.subs.delete(syncId);
  }
}
