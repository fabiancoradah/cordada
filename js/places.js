// Búsqueda y datos automáticos del cerro / lugar.
// Fuentes abiertas, sin API key y con CORS:
//  - OpenStreetMap (Nominatim): cerros de Chile y Argentina con altura
//  - Wikidata + Wikipedia: altura, foto y descripción
//  - Open-Meteo: geocoding (GeoNames) y modelo de elevación
//  - Overpass (OSM): punto de partida (estacionamientos, caminos) y glaciares cercanos
//  - BRouter: ruta a pie sobre senderos de OSM (distancia, desnivel, track)
import { haversine, trackStats } from './map.js';

const COUNTRIES = 'cl,ar,pe,bo';
const PEAK_TYPES = new Set(['peak', 'volcano', 'hill', 'mountain_range', 'ridge', 'saddle', 'glacier']);

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${new URL(url).hostname}: ${res.status}`);
  return res.json();
}

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

// ---------- Búsqueda ----------

async function nominatim(q) {
  const u = new URL('https://nominatim.openstreetmap.org/search');
  Object.entries({ q, format: 'jsonv2', limit: 10, extratags: 1, 'accept-language': 'es', countrycodes: COUNTRIES })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  const data = await getJSON(u);
  return data.map((r) => ({
    name: r.name || r.display_name.split(',')[0],
    lat: +r.lat,
    lon: +r.lon,
    altitude: num(r.extratags?.ele),
    region: r.display_name.split(',').slice(1, 4).join(',').trim(),
    kind: PEAK_TYPES.has(r.type) ? r.type : 'place',
    wikidata: r.extratags?.wikidata || null,
    wikipedia: r.extratags?.wikipedia || null,
    source: 'OpenStreetMap',
  }));
}

async function openMeteoGeo(q) {
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  Object.entries({ name: q, count: 10, language: 'es' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const data = await getJSON(u);
  return (data.results || [])
    .filter((r) => ['CL', 'AR', 'PE', 'BO'].includes(r.country_code))
    .map((r) => ({
      name: r.name,
      lat: r.latitude,
      lon: r.longitude,
      altitude: r.elevation ?? null,
      region: [r.admin2, r.admin1, r.country].filter(Boolean).join(', '),
      kind: ['MT', 'PK', 'VLC', 'HLL', 'MTS'].includes(r.feature_code) ? (r.feature_code === 'VLC' ? 'volcano' : 'peak') : 'place',
      source: 'GeoNames',
    }));
}

async function wikidataSearch(q) {
  const s = new URL('https://www.wikidata.org/w/api.php');
  Object.entries({ action: 'wbsearchentities', search: q, language: 'es', uselang: 'es', type: 'item', limit: 10, format: 'json', origin: '*' })
    .forEach(([k, v]) => s.searchParams.set(k, v));
  const hits = (await getJSON(s)).search || [];
  if (!hits.length) return [];
  const ents = await wikidataEntities(hits.map((h) => h.id));
  return hits.map((h) => {
    const e = ents[h.id];
    const c = e && coords(e);
    if (!c) return null;
    return {
      name: h.label,
      lat: c.lat,
      lon: c.lon,
      altitude: elevation(e),
      region: h.description || '',
      kind: isMountain(e) ? 'peak' : 'place',
      wikidata: h.id,
      wikipedia: e.sitelinks?.eswiki ? `es:${e.sitelinks.eswiki.title}` : null,
      source: 'Wikidata',
    };
  }).filter(Boolean)
    // Solo Sudamérica andina (aprox.)
    .filter((r) => r.lat < 0 && r.lat > -56 && r.lon < -60 && r.lon > -80);
}

async function wikidataEntities(ids) {
  const u = new URL('https://www.wikidata.org/w/api.php');
  Object.entries({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|sitelinks', format: 'json', origin: '*' })
    .forEach(([k, v]) => u.searchParams.set(k, v));
  return (await getJSON(u)).entities || {};
}
const claim = (e, p) => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;
const coords = (e) => { const v = claim(e, 'P625'); return v ? { lat: v.latitude, lon: v.longitude } : null; };
const elevation = (e) => { const v = claim(e, 'P2044'); return v ? Math.round(+v.amount) : null; };
const MOUNTAIN_CLASSES = new Set(['Q8502', 'Q8072', 'Q54050', 'Q169358', 'Q1595289', 'Q35666', 'Q212057']);
const isMountain = (e) => (e.claims?.P31 || []).some((c) => MOUNTAIN_CLASSES.has(c.mainsnak?.datavalue?.value?.id));

// Busca en todas las fuentes y junta los resultados del mismo lugar.
export async function searchPlaces(q) {
  const results = await Promise.allSettled([nominatim(q), wikidataSearch(q), openMeteoGeo(q)]);
  const all = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!all.length && results.every((r) => r.status === 'rejected')) throw new Error('Sin conexión con los buscadores');
  const merged = [];
  for (const p of all) {
    const twin = merged.find((m) => haversine(m, p) < 2500 && similar(m.name, p.name));
    if (twin) {
      twin.altitude ??= p.altitude;
      twin.wikidata ||= p.wikidata;
      twin.wikipedia ||= p.wikipedia;
      if (twin.kind === 'place' && p.kind !== 'place') twin.kind = p.kind;
      twin.sources.push(p.source);
    } else merged.push({ ...p, sources: [p.source] });
  }
  const score = (p) => (p.kind !== 'place' ? 0 : 10) - p.sources.length - (p.altitude ? 1 : 0);
  return merged.sort((a, b) => score(a) - score(b)).slice(0, 10);
}

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/^(cerro|volcan|monte|nevado)\s+/, '').trim();
const similar = (a, b) => { const x = norm(a); const y = norm(b); return x === y || x.includes(y) || y.includes(x); };

// ---------- Datos del lugar elegido ----------

// Foto, descripción y altura (si faltaba).
export async function placeDetails(place) {
  const out = {};
  let wikiTitle = place.wikipedia?.startsWith('es:') ? place.wikipedia.slice(3) : null;
  if (place.wikidata) {
    try {
      const e = (await wikidataEntities([place.wikidata]))[place.wikidata];
      if (e) {
        const img = claim(e, 'P18');
        if (img) out.photo = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(img)}?width=900`;
        out.altitude = elevation(e) ?? null;
        wikiTitle ||= e.sitelinks?.eswiki?.title || null;
      }
    } catch { /* sin Wikidata */ }
  }
  if (wikiTitle) {
    try {
      const s = await getJSON(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(wikiTitle.replace(/ /g, '_'))}`);
      out.description = s.extract;
      out.wikipediaUrl = s.content_urls?.desktop?.page;
      out.photo ||= s.originalimage?.source || s.thumbnail?.source;
    } catch { /* sin Wikipedia */ }
  }
  if (!place.altitude && !out.altitude) {
    out.altitude = await elevationAt(place.lat, place.lon).catch(() => null);
    out.altitudeEstimated = !!out.altitude;
  }
  return out;
}

// Modelo digital de elevación (~90 m). Subestima un poco las cumbres agudas.
export async function elevationAt(lat, lon) {
  const d = await getJSON(`https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lon}`);
  return d.elevation?.[0] != null ? Math.round(d.elevation[0]) : null;
}

// ---------- Punto de partida, glaciares y ruta ----------

async function overpass(query) {
  return getJSON('https://overpass-api.de/api/interpreter', { method: 'POST', body: `data=${encodeURIComponent(query)}` });
}

// Busca dónde se deja el auto: trailheads y estacionamientos, o el camino más cercano.
export async function surroundings(lat, lon) {
  for (const r of [7000, 20000]) {
    const q = `[out:json][timeout:25];
      node(around:${r},${lat},${lon})[highway=trailhead]->.th;
      node(around:${r},${lat},${lon})[amenity=parking]->.pk;
      node(around:${r},${lat},${lon})[tourism~"^(alpine_hut|wilderness_hut)$"]->.hut;
      way(around:${r},${lat},${lon})[highway~"^(primary|secondary|tertiary|unclassified)$"]->.rd;
      node(w.rd)->.rn;
      (way(around:3000,${lat},${lon})[natural=glacier];relation(around:3000,${lat},${lon})[natural=glacier];)->.gl;
      .th out; .pk out; .hut out; .rn out skel; .gl out ids;`;
    const data = await overpass(q);
    const els = data.elements || [];
    const glacier = els.some((e) => e.type !== 'node');
    const huts = els.filter((e) => e.type === 'node' && e.tags?.tourism).map((e) => ({ lat: e.lat, lon: e.lon, name: e.tags.name || 'Refugio' }));
    const summit = { lat, lon };
    const cands = els.filter((e) => e.type === 'node' && !e.tags?.tourism).map((e) => {
      const d = haversine(summit, e);
      const w = e.tags?.highway === 'trailhead' ? 0.7 : e.tags?.amenity === 'parking' ? 0.85 : 1;
      return { lat: e.lat, lon: e.lon, name: e.tags?.name || (e.tags?.highway === 'trailhead' ? 'Inicio de sendero' : e.tags?.amenity === 'parking' ? 'Estacionamiento' : 'Fin del camino'), score: d * w };
    }).sort((a, b) => a.score - b.score);
    if (cands.length) return { start: cands[0], glacier, huts };
    if (r === 20000) return { start: null, glacier, huts };
  }
  return { start: null, glacier: false, huts: [] };
}

// Ruta a pie por senderos de OSM. Si no hay servicio, estima.
export async function hikingRoute(start, summit) {
  try {
    const u = `https://brouter.de/brouter?lonlats=${start.lon},${start.lat}|${summit.lon},${summit.lat}&profile=hiking-mountain&alternativeidx=0&format=geojson`;
    const gj = await getJSON(u);
    const f = gj.features?.[0];
    const pts = f.geometry.coordinates.map(([lo, la, ele]) => ({ lat: +la.toFixed(6), lon: +lo.toFixed(6), ele: ele == null ? null : Math.round(ele) }));
    // Si la ruta termina lejos de la cumbre, el sendero no llega: igual sirve como aproximación.
    const stats = trackStats(pts);
    return { source: 'brouter', pts, stats };
  } catch {
    const [e1, e2] = await Promise.all([elevationAt(start.lat, start.lon).catch(() => null), summit.altitude ?? elevationAt(summit.lat, summit.lon).catch(() => null)]);
    const dist = haversine(start, summit) * 1.4;
    const up = e1 != null && e2 != null ? Math.max(0, e2 - e1) : null;
    return {
      source: 'estimate',
      pts: [{ ...start, ele: e1 }, { lat: summit.lat, lon: summit.lon, ele: e2 }],
      stats: { distKm: dist / 1000, up: up ?? 0, down: 0, maxEle: e2, minEle: e1, hours: dist / 1000 / 4 + (up || 0) / 600, profile: [] },
    };
  }
}
