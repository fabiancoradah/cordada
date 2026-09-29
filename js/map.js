// Mapa (Leaflet) + lectura de tracks GPX.
/* global L */

export const LAYERS = {
  'Topográfico (OpenTopoMap)': ['https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: '© OpenStreetMap, SRTM | © OpenTopoMap (CC-BY-SA)' }],
  'Calles (OSM)': ['https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap' }],
  'Satélite (Esri)': ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Tiles © Esri' }],
};

export function createMap(el, { lat, lon, onPick }) {
  if (typeof L === 'undefined') {
    el.innerHTML = '<p class="muted pad">No se pudo cargar el mapa.</p>';
    return null;
  }
  const center = lat != null ? [lat, lon] : [-33.45, -70.3];
  const map = L.map(el, { zoomControl: true }).setView(center, lat != null ? 12 : 8);
  const base = {};
  Object.entries(LAYERS).forEach(([name, [url, opts]]) => { base[name] = L.tileLayer(url, opts); });
  base['Topográfico (OpenTopoMap)'].addTo(map);
  L.control.layers(base).addTo(map);
  L.control.scale({ imperial: false }).addTo(map);

  let marker = null;
  const setMarker = (la, lo) => {
    if (!marker) {
      marker = L.marker([la, lo], { draggable: true, title: 'Objetivo' }).addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLatLng();
        onPick?.(p.lat, p.lng);
      });
    } else marker.setLatLng([la, lo]);
  };
  if (lat != null) setMarker(lat, lon);

  return {
    map,
    setMarker,
    pickMode(on) {
      el.classList.toggle('picking', on);
      if (on) {
        map.once('click', (e) => {
          el.classList.remove('picking');
          setMarker(e.latlng.lat, e.latlng.lng);
          onPick?.(e.latlng.lat, e.latlng.lng);
        });
      }
    },
  };
}

// ---------- GPX ----------

export function parseGPX(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('El archivo no es un GPX válido');
  const toPt = (n) => ({
    lat: parseFloat(n.getAttribute('lat')),
    lon: parseFloat(n.getAttribute('lon')),
    ele: n.querySelector('ele') ? parseFloat(n.querySelector('ele').textContent) : null,
    name: n.querySelector('name')?.textContent || '',
  });
  let pts = [...doc.querySelectorAll('trkpt')].map(toPt);
  if (!pts.length) pts = [...doc.querySelectorAll('rtept')].map(toPt);
  const wpts = [...doc.querySelectorAll('wpt')].map(toPt);
  if (!pts.length && !wpts.length) throw new Error('El GPX no tiene tracks ni waypoints');
  const name = doc.querySelector('trk > name, rte > name, metadata > name')?.textContent || '';
  return { name, pts, wpts, stats: trackStats(pts) };
}

const R = 6371000;
export function haversine(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function trackStats(pts) {
  let dist = 0;
  let up = 0;
  let down = 0;
  let maxEle = -Infinity;
  let minEle = Infinity;
  let high = null;
  const profile = [];
  // Suavizado simple de elevación para no inflar el desnivel con ruido del GPS.
  let lastEle = null;
  pts.forEach((p, i) => {
    if (i) dist += haversine(pts[i - 1], p);
    if (p.ele != null) {
      if (p.ele > maxEle) { maxEle = p.ele; high = p; }
      minEle = Math.min(minEle, p.ele);
      if (lastEle == null) lastEle = p.ele;
      const diff = p.ele - lastEle;
      if (Math.abs(diff) >= 5) {
        if (diff > 0) up += diff; else down -= diff;
        lastEle = p.ele;
      }
      profile.push([dist / 1000, p.ele]);
    }
  });
  // Tiempo estimado (regla de Naismith modificada): 4 km/h + 1 h por cada 600 m de subida.
  const hours = dist / 1000 / 4 + up / 600;
  return {
    distKm: dist / 1000,
    up: Math.round(up),
    down: Math.round(down),
    maxEle: isFinite(maxEle) ? Math.round(maxEle) : null,
    minEle: isFinite(minEle) ? Math.round(minEle) : null,
    high,
    hours,
    profile,
  };
}

export function drawTrack(ctrl, gpx) {
  if (!ctrl || typeof L === 'undefined') return null;
  const group = L.featureGroup().addTo(ctrl.map);
  if (gpx.pts.length) {
    L.polyline(gpx.pts.map((p) => [p.lat, p.lon]), { color: '#eb6834', weight: 4, opacity: 0.9 }).addTo(group);
    const s = gpx.pts[0];
    L.circleMarker([s.lat, s.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#1baf7a', fillOpacity: 1 })
      .bindTooltip('Inicio').addTo(group);
  }
  gpx.wpts.forEach((w) => {
    L.circleMarker([w.lat, w.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#2a78d6', fillOpacity: 1 })
      .bindTooltip(w.name || 'Waypoint').addTo(group);
  });
  ctrl.map.fitBounds(group.getBounds(), { padding: [24, 24], animate: false });
  return group;
}

// Perfil de elevación (serie única, crosshair + tooltip).
export function profileChart(profile, W = 720) {
  if (profile.length < 2) return '';
  W = W || 720;
  const H = 180;
  const m = { l: 48, r: 12, t: 12, b: 26 };
  const xs = profile.map((p) => p[0]);
  const ys = profile.map((p) => p[1]);
  const x0 = 0;
  const x1 = xs[xs.length - 1] || 1;
  let lo = Math.min(...ys);
  let hi = Math.max(...ys);
  const pad = (hi - lo) * 0.1 || 10;
  lo -= pad;
  hi += pad;
  const X = (v) => m.l + ((v - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const step = Math.max(1, Math.floor(profile.length / 400));
  const pts = profile.filter((_, i) => i % step === 0 || i === profile.length - 1);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const area = `${line}L${X(pts[pts.length - 1][0])},${H - m.b}L${X(pts[0][0])},${H - m.b}Z`;
  const yt = [lo + pad, (lo + hi) / 2, hi - pad];
  const grid = yt.map((t) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text class="axis" x="${m.l - 6}" y="${Y(t) + 4}" text-anchor="end">${Math.round(t)}</text>`).join('');
  const xt = (W < 500 ? [0, 0.5, 1] : [0, 0.25, 0.5, 0.75, 1]).map((f) => x1 * f);
  const xl = xt.map((t) => `<text class="axis" x="${X(t)}" y="${H - 8}" text-anchor="middle">${t.toFixed(1)} km</text>`).join('');
  const data = encodeURIComponent(JSON.stringify(pts));
  return `<div class="chart profile" data-profile="${data}" data-w="${W}" data-ml="${m.l}" data-mr="${m.r}" data-x1="${x1}">
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Perfil de elevación">
      ${grid}${xl}<path class="area s1" d="${area}"/><path class="line s1" d="${line}"/>
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
    </svg><div class="tooltip" hidden></div></div>`;
}

export function wireProfile(root, onHover) {
  const el = root.querySelector('.chart.profile');
  if (!el) return;
  const pts = JSON.parse(decodeURIComponent(el.dataset.profile));
  const W = +el.dataset.w;
  const ml = +el.dataset.ml;
  const mr = +el.dataset.mr;
  const x1 = +el.dataset.x1;
  const svg = el.querySelector('svg');
  const cross = el.querySelector('.cross');
  const tip = el.querySelector('.tooltip');
  const hit = el.querySelector('.hit');
  hit.addEventListener('pointermove', (ev) => {
    const r = svg.getBoundingClientRect();
    const km = (((ev.clientX - r.left) / r.width) * W - ml) / (W - ml - mr) * x1;
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - km) < Math.abs(best[0] - km)) best = p;
    const cx = ml + (best[0] / x1) * (W - ml - mr);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    cross.style.display = '';
    tip.hidden = false;
    tip.innerHTML = `<b>${best[0].toFixed(2)} km</b><div>${Math.round(best[1])} m s.n.m.</div>`;
    tip.style.left = `${Math.min(r.width - 120, (cx / W) * r.width + 10)}px`;
    onHover?.(best);
  });
  hit.addEventListener('pointerleave', () => { cross.style.display = 'none'; tip.hidden = true; });
}

export function toDMS(v, pos, neg) {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mf = (a - d) * 60;
  const mi = Math.floor(mf);
  const s = ((mf - mi) * 60).toFixed(1);
  return `${d}°${mi}'${s}"${v < 0 ? neg : pos}`;
}

// Búsqueda de lugares/cerros (Open-Meteo Geocoding, datos GeoNames).
export async function geocode(q) {
  const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
  u.searchParams.set('name', q);
  u.searchParams.set('count', '8');
  u.searchParams.set('language', 'es');
  const res = await fetch(u);
  if (!res.ok) throw new Error('Búsqueda no disponible');
  const data = await res.json();
  return data.results || [];
}
