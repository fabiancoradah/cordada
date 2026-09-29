import { state, save, saveLocal, hooks, uid, longId, normalize, getTrip, newTrip, deleteTrip, encodeTrip, decodeTrip, importTrip } from './store.js';
import { CATEGORIES, MODULES, makeItem, addModules, gearProgress, weightByMember, ropesOf, ropeKey } from './gear.js';
import { MODELS, fetchWeather, series, hourlyTimes, wmo, assess, externalLinks, lineChart, wireCharts } from './weather.js';
import { createMap, parseGPX, drawTrack, profileChart, wireProfile, toDMS, geocode } from './map.js';
import * as drive from './drive.js';
import { TripSync } from './sync.js';
import { FIREBASE_CONFIG } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const ui = { day: null, filter: 'all', mapCtrl: null, localPhotos: [] };

// ---------- Fechas ----------
const parseDay = (s) => {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
};
const fmtDate = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => (s ? parseDay(s).toLocaleDateString('es-CL', opts) : '');
const fmtDayShort = (t) => fmtDate(t, { weekday: 'short', day: 'numeric' });
const fmtHour = (t) => t.slice(11, 16);
const fmtTime = (t) => `${fmtDayShort(t)} ${fmtHour(t)}`;
const todayStr = () => new Date().toLocaleDateString('sv-SE');
function tripDates(trip) {
  if (!trip.date) return [];
  const out = [];
  const end = trip.endDate && trip.endDate >= trip.date ? parseDay(trip.endDate) : parseDay(trip.date);
  for (let d = parseDay(trip.date); d <= end && out.length < 21; d.setDate(d.getDate() + 1)) out.push(d.toLocaleDateString('sv-SE'));
  return out;
}
function countdown(trip) {
  if (!trip.date) return '';
  const days = Math.round((parseDay(trip.date) - parseDay(todayStr())) / 86400000);
  if (days > 1) return `en ${days} días`;
  if (days === 1) return 'mañana';
  if (days === 0) return '¡hoy!';
  const end = trip.endDate || trip.date;
  return parseDay(end) >= parseDay(todayStr()) ? 'en curso' : 'realizada';
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
}

function download(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().replace(/^-|-$/g, '');
const initials = (name) => name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
const kg = (g) => `${(g / 1000).toLocaleString('es-CL', { maximumFractionDigits: 1 })} kg`;
const me = (trip) => state.settings.me?.[trip.id] || '';
const ropeLabel = (r) => (/^cordada\s*(\d+)$/i.test(r.name.trim()) ? `C${r.name.trim().match(/\d+/)[0]}` : initials(r.name));

// ---------- Router ----------
const TABS = [
  ['resumen', 'Resumen'],
  ['grupo', 'Grupo'],
  ['equipo', 'Equipo'],
  ['clima', 'Clima'],
  ['mapa', 'Mapa'],
  ['fotos', 'Fotos'],
  ['plan', 'Plan y seguridad'],
];

function destroyMap() {
  if (!ui.mapCtrl) return;
  ui.mapCtrl.map.stop();
  ui.mapCtrl.map.remove();
  ui.mapCtrl = null;
}

function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  destroyMap();
  window.scrollTo(0, 0);
  const [r, id, tab] = parts;
  if (r === 'nueva') return renderForm(null);
  if (r === 'ajustes') return renderSettings();
  if (r === 'importar') return renderImport(parts.slice(1).join('/'));
  if (r === 'unirse') return renderJoin(id);
  if (r === 'salida') {
    const trip = getTrip(id);
    if (!trip) return go('#/');
    if (tab === 'editar') return renderForm(trip);
    if (tab === 'cordada') return go(`#/salida/${trip.id}/grupo`);
    return renderTrip(trip, TABS.some(([t]) => t === tab) ? tab : 'resumen');
  }
  return renderHome();
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
window.addEventListener('hashchange', route);

function header(title, { back = null, actions = '' } = {}) {
  return `<header class="topbar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Volver">←</a>` : '<span class="brand-mark">⛰️</span>'}
    <h1>${esc(title)}</h1>
    <div class="actions">${actions}</div>
  </header>`;
}

// ---------- Inicio ----------
function renderHome() {
  const trips = [...state.trips].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const upcoming = trips.filter((t) => (t.endDate || t.date || '9999') >= todayStr()).reverse();
  const past = trips.filter((t) => !upcoming.includes(t));
  const card = (t) => {
    const p = gearProgress(t);
    return `<a class="trip-card" href="#/salida/${t.id}/resumen">
      <div class="trip-card-top"><h3>${esc(t.name)}</h3><span class="pill">${esc(countdown(t))}</span></div>
      <p class="muted">${esc(t.peak || 'Sin objetivo')}${t.altitude ? ` · ${t.altitude} m` : ''}${t.date ? ` · ${fmtDate(t.date)}` : ''}</p>
      <p class="mods">${t.modules.map((m) => MODULES[m]?.icon || '').join(' ')} · ${t.members.length} integrantes${t.syncId ? ' · 🔄' : ''}</p>
      <div class="progress" title="Equipo listo"><i style="width:${p.pct}%"></i></div>
      <p class="small muted">Equipo: ${p.done}/${p.total} (${p.pct}%)</p>
    </a>`;
  };
  view.innerHTML = `${header('Cordada', { actions: '<a class="icon-btn" href="#/ajustes" aria-label="Ajustes">⚙️</a>' })}
  <main class="wrap">
    <div class="row gap">
      <a class="btn primary grow" href="#/nueva">＋ Nueva salida</a>
      <label class="btn">Importar<input type="file" accept=".json,application/json" id="import-file" hidden></label>
    </div>
    ${trips.length ? '' : `<section class="card empty">
      <h2>Organiza tu próxima salida</h2>
      <ul class="features">
        <li>✅ Checklist de equipo por actividad, personal y grupal, con quién lleva qué</li>
        <li>🌦️ Pronóstico en la cota de cumbre comparando ECMWF, GFS e ICON, con isoterma 0°</li>
        <li>🗺️ Mapa topográfico, track GPX, desnivel y tiempo estimado</li>
        <li>📖 Links a la ruta en Andeshandbook</li>
        <li>📷 Fotos de la salida a una carpeta compartida de Google Drive</li>
        <li>🆘 Plan de salida y aviso a tu contacto de emergencia por WhatsApp</li>
      </ul>
    </section>`}
    ${upcoming.length ? `<h2 class="section-title">Próximas</h2><div class="grid">${upcoming.map(card).join('')}</div>` : ''}
    ${past.length ? `<h2 class="section-title">Realizadas</h2><div class="grid">${past.map(card).join('')}</div>` : ''}
  </main>`;
  $('#import-file').addEventListener('change', importFromFile);
}

async function importFromFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (Array.isArray(data.trips)) {
      data.trips.forEach(importTrip);
      toast(`${data.trips.length} salidas importadas`);
      go('#/');
    } else {
      const t = importTrip(data);
      go(`#/salida/${t.id}/resumen`);
    }
  } catch (err) {
    alert(`No se pudo importar: ${err.message}`);
  }
}

// ---------- Formulario de salida ----------
function renderForm(trip) {
  const t = trip || { name: '', peak: '', date: '', endDate: '', lat: null, lon: null, altitude: null, andesUrl: '', notes: '', modules: ['base'] };
  view.innerHTML = `${header(trip ? 'Editar salida' : 'Nueva salida', { back: trip ? `#/salida/${trip.id}/resumen` : '#/' })}
  <main class="wrap narrow">
    <form id="trip-form" class="card form">
      <label>Nombre de la salida<input name="name" required value="${esc(t.name)}" placeholder="Ej: Cerro Plomo por Refugio Federación"></label>
      <label>Objetivo / cerro<input name="peak" value="${esc(t.peak)}" placeholder="Ej: Cerro Plomo"></label>
      <div class="search-box">
        <label>Buscar ubicación<span class="row gap"><input id="geo-q" placeholder="Nombre del cerro o lugar" value="${esc(t.peak)}"><button type="button" class="btn" id="geo-btn">Buscar</button></span></label>
        <ul id="geo-results" class="results"></ul>
      </div>
      <div class="cols3">
        <label>Latitud<input name="lat" inputmode="decimal" value="${t.lat ?? ''}" placeholder="-33.235"></label>
        <label>Longitud<input name="lon" inputmode="decimal" value="${t.lon ?? ''}" placeholder="-70.215"></label>
        <label>Altitud (m)<input name="altitude" type="number" value="${t.altitude ?? ''}" placeholder="5424"></label>
      </div>
      <p class="small muted">También puedes fijar el punto en el mapa o tomarlo del track GPX.</p>
      <div class="cols2">
        <label>Fecha de inicio<input type="date" name="date" value="${esc(t.date)}"></label>
        <label>Fecha de término<input type="date" name="endDate" value="${esc(t.endDate)}"></label>
      </div>
      <fieldset>
        <legend>Tipo de actividad (define el equipo sugerido)</legend>
        <div class="chips">
          ${Object.entries(MODULES).map(([id, m]) => `<label class="chip"><input type="checkbox" name="modules" value="${id}" ${t.modules.includes(id) ? 'checked' : ''} ${trip && t.modules.includes(id) ? 'disabled' : ''}>${m.icon} ${m.label}</label>`).join('')}
        </div>
      </fieldset>
      <label>Ruta en Andeshandbook (URL, opcional)<input name="andesUrl" type="url" value="${esc(t.andesUrl)}" placeholder="https://www.andeshandbook.org/montanismo/cerro/..."></label>
      <p class="small"><a href="#" id="ah-search">Buscar el cerro en Andeshandbook ↗</a></p>
      <label>Notas<textarea name="notes" rows="3">${esc(t.notes)}</textarea></label>
      <button class="btn primary" type="submit">${trip ? 'Guardar cambios' : 'Crear salida'}</button>
    </form>
  </main>`;

  const form = $('#trip-form');
  const doSearch = async () => {
    const q = $('#geo-q').value.trim();
    if (!q) return;
    const ul = $('#geo-results');
    ul.innerHTML = '<li class="muted">Buscando…</li>';
    try {
      const res = await geocode(q);
      ul.innerHTML = res.length
        ? res.map((r, i) => `<li><button type="button" data-i="${i}">${esc(r.name)}<span class="muted"> · ${esc([r.admin1, r.country].filter(Boolean).join(', '))}${r.elevation ? ` · ${Math.round(r.elevation)} m` : ''}</span></button></li>`).join('')
        : '<li class="muted">Sin resultados. Prueba otro nombre o fija el punto en el mapa.</li>';
      $$('button[data-i]', ul).forEach((b) => b.addEventListener('click', () => {
        const r = res[b.dataset.i];
        form.lat.value = r.latitude.toFixed(5);
        form.lon.value = r.longitude.toFixed(5);
        if (r.elevation) form.altitude.value = Math.round(r.elevation);
        if (!form.peak.value) form.peak.value = r.name;
        ul.innerHTML = '';
      }));
    } catch (err) {
      ul.innerHTML = `<li class="muted">${esc(err.message)}</li>`;
    }
  };
  $('#geo-btn').addEventListener('click', doSearch);
  $('#geo-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSearch(); } });
  $('#ah-search').addEventListener('click', (e) => {
    e.preventDefault();
    window.open(andesSearch(form.peak.value || form.name.value), '_blank', 'noopener');
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const num = (k) => (f.get(k) === '' || f.get(k) == null ? null : Number(String(f.get(k)).replace(',', '.')));
    const fields = {
      name: f.get('name').trim(),
      peak: f.get('peak').trim(),
      lat: num('lat'),
      lon: num('lon'),
      altitude: num('altitude'),
      date: f.get('date'),
      endDate: f.get('endDate'),
      andesUrl: f.get('andesUrl').trim(),
      notes: f.get('notes'),
    };
    if ((fields.lat == null) !== (fields.lon == null) || (fields.lat != null && (Math.abs(fields.lat) > 90 || Math.abs(fields.lon) > 180))) {
      alert('Revisa latitud y longitud.');
      return;
    }
    const mods = f.getAll('modules');
    let target = trip;
    if (trip) {
      const moved = trip.lat !== fields.lat || trip.lon !== fields.lon || trip.altitude !== fields.altitude;
      Object.assign(trip, fields);
      if (moved) delete trip.weather;
    } else {
      target = newTrip({ ...fields, modules: [] });
      if (!mods.length) mods.push('base');
    }
    addModules(target, mods);
    save();
    go(`#/salida/${target.id}/resumen`);
  });
}

const andesSearch = (q) => `https://www.google.com/search?q=${encodeURIComponent(`site:andeshandbook.org ${q}`)}`;

// ---------- Vista de salida ----------
function renderTrip(trip, tab) {
  view.innerHTML = `${header(trip.name, {
    back: '#/',
    actions: `${trip.syncId ? `<span class="icon-btn sync-dot" id="sync-dot" data-sync="${trip.syncId}"></span>` : ''}<a class="icon-btn" href="#/salida/${trip.id}/editar" aria-label="Editar">✏️</a>`,
  })}
  <nav class="tabs" role="tablist">
    ${TABS.map(([id, label]) => `<a role="tab" href="#/salida/${trip.id}/${id}" class="${id === tab ? 'active' : ''}" aria-selected="${id === tab}">${label}</a>`).join('')}
  </nav>
  <main class="wrap" id="tab"></main>`;
  const el = $('#tab');
  if (trip.syncId) setDot($('#sync-dot'), syncStatus[trip.syncId]);
  ({ resumen: tabSummary, grupo: tabGroup, equipo: tabGear, clima: tabWeather, mapa: tabMap, fotos: tabPhotos, plan: tabPlan })[tab](trip, el);
  $('.tabs .active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
}

// --- Resumen ---
function tabSummary(trip, el) {
  const p = gearProgress(trip);
  const w = weightByMember(trip);
  const alerts = trip.weather ? assess(trip.weather, tripDates(trip)) : null;
  const hasPos = trip.lat != null;
  el.innerHTML = `
  <section class="card hero">
    <div>
      <p class="eyebrow">${esc(countdown(trip))}</p>
      <h2>${esc(trip.peak || trip.name)}</h2>
      <p class="muted">${trip.date ? fmtDate(trip.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : 'Sin fecha'}${trip.endDate && trip.endDate !== trip.date ? ` → ${fmtDate(trip.endDate)}` : ''}</p>
      <p class="mods">${trip.modules.map((m) => `${MODULES[m]?.icon || ''} ${MODULES[m]?.label || m}`).join(' · ')}</p>
    </div>
    <dl class="stats">
      <div><dt>Altitud</dt><dd>${trip.altitude ? `${trip.altitude} m` : '—'}</dd></div>
      <div><dt>Equipo listo</dt><dd>${p.pct}%</dd></div>
      <div><dt>Integrantes</dt><dd>${trip.members.length}</dd></div>
      ${trip.gpx ? `<div><dt>Distancia</dt><dd>${trip.gpx.stats.distKm.toFixed(1)} km</dd></div><div><dt>Desnivel +</dt><dd>${trip.gpx.stats.up} m</dd></div>` : ''}
    </dl>
  </section>

  <section class="card">
    <h3>Ruta</h3>
    <div class="link-list">
      ${trip.andesUrl ? `<a class="btn" href="${esc(trip.andesUrl)}" target="_blank" rel="noopener">📖 Ruta en Andeshandbook ↗</a>` : ''}
      <a class="btn" href="${andesSearch(trip.peak || trip.name)}" target="_blank" rel="noopener">🔎 Buscar en Andeshandbook ↗</a>
      <a class="btn" href="https://www.google.com/search?q=${encodeURIComponent(`wikiloc ${trip.peak || trip.name}`)}" target="_blank" rel="noopener">🥾 Tracks en Wikiloc ↗</a>
      ${hasPos ? `<a class="btn" href="https://www.google.com/maps/search/?api=1&query=${trip.lat},${trip.lon}" target="_blank" rel="noopener">📍 Google Maps ↗</a>` : ''}
    </div>
    ${trip.notes ? `<p class="notes">${esc(trip.notes)}</p>` : ''}
  </section>

  <section class="card">
    <div class="row between"><h3>Clima</h3><a href="#/salida/${trip.id}/clima">Ver pronóstico →</a></div>
    ${alerts ? alertList(alerts) + `<p class="small muted">Actualizado ${new Date(trip.weather.fetchedAt).toLocaleString('es-CL')}</p>` : `<p class="muted">${hasPos ? 'Abre la pestaña Clima para descargar el pronóstico.' : 'Define la ubicación del objetivo para ver el pronóstico.'}</p>`}
  </section>

  <section class="card">
    <div class="row between"><h3>Equipo por persona</h3><a href="#/salida/${trip.id}/equipo">Checklist →</a></div>
    ${trip.members.length ? `<ul class="member-progress">${trip.members.map((m) => {
      const mp = gearProgress(trip, m.id);
      return `<li><span class="avatar">${esc(initials(m.name))}</span><span class="grow">${esc(m.name)}<span class="small muted"> · ${kg(w[m.id] || 0)}</span><div class="progress"><i style="width:${mp.pct}%"></i></div></span><b>${mp.pct}%</b></li>`;
    }).join('')}</ul>` : `<p class="muted">Agrega a los integrantes en <a href="#/salida/${trip.id}/grupo">Grupo</a>.</p>`}
  </section>

  ${trip.members.length ? `<section class="card">
    <div class="row between"><h3>Revisión de seguridad</h3><a href="#/salida/${trip.id}/grupo">Grupo →</a></div>
    ${alertList(safetyChecks(trip))}
  </section>` : ''}

  <section class="card">
    <h3>Compartir con el grupo</h3>
    ${trip.syncId ? `<p class="small">🟢 <b>Sincronizada en tiempo real.</b> Cada integrante que se una ve los mismos checks, cordadas, autos y plan al instante, y puede trabajar sin señal: los cambios se envían al volver la conexión.</p>
    <div class="link-list"><button class="btn primary" id="invite">👥 Invitar al grupo</button></div>`
    : syncConfig() ? `<p class="small muted">Activa la sincronización para que todos vean los cambios al instante (checks, cordadas, autos, plan).</p>
    <div class="link-list"><button class="btn primary" id="enable-sync">🔄 Activar sincronización</button></div>`
    : '<p class="small muted">Sincronización en tiempo real: configúrala en <a href="#/ajustes">Ajustes</a>. Mientras tanto, comparte una copia con el link: quien lo abra la importa en su teléfono.</p>'}
    <div class="link-list top-gap">
      <button class="btn ${trip.syncId || syncConfig() ? '' : 'primary'}" id="share-link">🔗 Compartir copia</button>
      <button class="btn" id="export">⬇️ Descargar JSON</button>
      <button class="btn" id="print">🖨️ Imprimir checklist</button>
      <button class="btn danger" id="delete">Eliminar salida</button>
    </div>
  </section>`;

  $('#invite', el)?.addEventListener('click', () => shareOrCopy({ title: `Salida: ${trip.name}`, text: `Únete a la salida "${trip.name}" en Cordada:`, url: inviteUrl(trip) }));
  $('#enable-sync', el)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Activando…';
    try {
      await enableSync(trip);
      toast('Sincronización activada');
      renderTrip(trip, 'resumen');
    } catch (err) {
      alert(`No se pudo activar: ${err.message}`);
      e.target.disabled = false;
      e.target.textContent = '🔄 Activar sincronización';
    }
  });
  $('#share-link', el).addEventListener('click', async () => {
    const code = await encodeTrip(trip);
    const url = `${location.origin}${location.pathname}#/importar/${code}`;
    if (url.length > 60000) toast('La salida es muy grande para un link: usa "Descargar JSON".');
    await shareOrCopy({ title: `Salida: ${trip.name}`, text: `Salida "${trip.name}" en Cordada`, url });
  });
  $('#export', el).addEventListener('click', () => download(`cordada-${slug(trip.name)}.json`, JSON.stringify(trip, null, 2)));
  $('#print', el).addEventListener('click', () => { go(`#/salida/${trip.id}/equipo`); setTimeout(() => window.print(), 300); });
  $('#delete', el).addEventListener('click', () => {
    if (confirm(`¿Eliminar "${trip.name}" de este dispositivo?${trip.syncId ? ' (El resto del grupo la conserva.)' : ''}`)) {
      if (trip.syncId) syncer?.unwatch(trip.syncId);
      deleteTrip(trip.id);
      go('#/');
    }
  });
}

async function shareOrCopy({ title, text, url }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try {
    await navigator.clipboard.writeText(url ? `${text}\n${url}` : text);
    toast('Copiado al portapapeles');
  } catch {
    prompt('Copia este texto:', url || text);
  }
}

function alertList(alerts) {
  const icon = { danger: '⛔', warn: '⚠️', info: 'ℹ️', good: '✅' };
  return `<ul class="alerts">${alerts.map((a) => `<li class="alert ${a.level}"><span>${icon[a.level]}</span>${esc(a.text)}</li>`).join('')}</ul>`;
}

// --- Grupo: integrantes, cordadas y autos ---
const ROLES = ['', 'Jefe/a de salida', 'Primeros auxilios', 'Navegación', 'Comunicaciones', 'Cocina', 'Fotografía', 'Logística / transporte'];
const FIRST_AID = ['', 'WFR', 'WAFA', 'Primeros auxilios básicos', 'Profesional de salud'];
const memberName = (trip, id) => trip.members.find((m) => m.id === id)?.name || '—';
const firstName = (name) => name.split(/\s+/)[0];

function tabGroup(trip, el) {
  const w = weightByMember(trip);
  const leader = trip.org?.leaderId;
  const inRope = new Set(trip.ropes.flatMap((r) => r.memberIds));
  const inCar = new Set(trip.cars.flatMap((c) => [c.driverId, ...c.passengerIds]));
  const memberOpts = (sel, exclude = []) => trip.members.filter((m) => !exclude.includes(m.id)).map((m) => `<option value="${m.id}" ${sel === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('');

  el.innerHTML = `
  <section class="card">
    <h3>Integrantes (${trip.members.length})</h3>
    ${trip.members.length ? `<ul class="members">${trip.members.map((m) => `
      <li>
        <span class="avatar">${esc(initials(m.name))}</span>
        <div class="grow">
          <b>${esc(m.name)}</b>${me(trip) === m.id ? ' <span class="pill">yo</span>' : ''}${leader === m.id ? ' <span class="pill accent">jefe/a de salida</span>' : ''}
          <div class="small muted">${esc([m.role, m.age && `${m.age} años`, m.rut && `RUT ${m.rut}`].filter(Boolean).join(' · ') || 'Sin rol')} · carga ≈ ${kg(w[m.id] || 0)}</div>
          <div class="tags">${m.firstAid ? `<span class="tag good">🩹 ${esc(m.firstAid)}</span>` : ''}${m.knowsRoute ? '<span class="tag good">🧭 conoce la ruta</span>' : ''}${m.emergencyName || m.emergency ? '' : '<span class="tag warn">sin contacto de emergencia</span>'}</div>
          ${m.phone ? `<div class="small"><a href="tel:${esc(m.phone)}">📞 ${esc(m.phone)}</a> · <a href="https://wa.me/${esc(waNumber(m.phone))}" target="_blank" rel="noopener">WhatsApp</a></div>` : ''}
          ${m.emergencyName || m.emergency ? `<div class="small">🆘 ${esc(emergencyOf(m))}</div>` : ''}
          ${m.health ? `<div class="small">🩺 ${esc(m.health)}</div>` : ''}
        </div>
        <div class="col">
          <button class="btn small" data-me="${m.id}">${me(trip) === m.id ? 'Soy yo ✓' : 'Soy yo'}</button>
          <button class="btn small" data-edit="${m.id}">Editar</button>
        </div>
      </li>`).join('')}</ul>` : '<p class="muted">Aún no hay integrantes.</p>'}
  </section>

  <section class="card">
    <h3 id="member-form-title">Agregar integrante</h3>
    <form id="member-form" class="form">
      <input type="hidden" name="id">
      <div class="cols2">
        <label>Nombre<input name="name" required></label>
        <label>Teléfono<input name="phone" type="tel" placeholder="+56 9 ..."></label>
        <label>RUT<input name="rut" placeholder="12.345.678-9"></label>
        <label>Edad<input name="age" type="number" min="0" max="120"></label>
        <label>Contacto de emergencia<input name="emergencyName" placeholder="Nombre"></label>
        <label>Teléfono del contacto<input name="emergencyPhone" type="tel"></label>
        <label>Rol<select name="role">${ROLES.map((r) => `<option>${esc(r)}</option>`).join('')}</select></label>
        <label>Certificación primeros auxilios<select name="firstAid">${FIRST_AID.map((r) => `<option value="${esc(r)}">${esc(r || 'Ninguna')}</option>`).join('')}</select></label>
      </div>
      <label class="check"><input type="checkbox" name="knowsRoute"> Conoce el sector y la ruta</label>
      <label>Salud relevante (alergias, medicamentos, grupo sanguíneo)<input name="health"></label>
      <div class="row gap">
        <button class="btn primary" type="submit">Guardar</button>
        <button class="btn danger" type="button" id="del-member" hidden>Quitar de la salida</button>
      </div>
    </form>
  </section>

  <section class="card">
    <h3>Cordadas</h3>
    <p class="small muted">Divide al grupo en cordadas (por carpa o por cuerda). El equipo "por cordada" (carpa, cocinilla, cena…) se marca una vez por cada una.</p>
    ${trip.ropes.length ? `<ul class="ropes">${trip.ropes.map((r) => `<li>
      <div class="grow"><b>${esc(r.name)}</b><div class="small">${r.memberIds.map((id) => esc(memberName(trip, id))).join(', ') || '<span class="muted">sin integrantes</span>'}</div></div>
      <button class="btn small" data-rope="${r.id}">Editar</button></li>`).join('')}</ul>` : ''}
    ${trip.ropes.length && trip.members.some((m) => !inRope.has(m.id)) ? `<p class="alert warn">Sin cordada: ${trip.members.filter((m) => !inRope.has(m.id)).map((m) => esc(firstName(m.name))).join(', ')}</p>` : ''}
    <form id="rope-form" class="form top-gap">
      <input type="hidden" name="id">
      <label>Nombre<input name="name" required placeholder="Cordada ${trip.ropes.length + 1}"></label>
      <fieldset><legend>Integrantes</legend><div class="chips">${trip.members.map((m) => `<label class="chip"><input type="checkbox" name="memberIds" value="${m.id}">${esc(m.name)}</label>`).join('') || '<span class="muted small">Agrega integrantes primero</span>'}</div></fieldset>
      <div class="row gap"><button class="btn" type="submit">Guardar cordada</button><button class="btn danger" type="button" id="del-rope" hidden>Eliminar</button></div>
    </form>
  </section>

  <section class="card">
    <h3>Autos</h3>
    ${trip.cars.length ? `<ul class="cars">${trip.cars.map((c, i) => {
      const used = c.passengerIds.length;
      return `<li>
        <div class="row between"><b>🚗 Auto ${i + 1} · ${esc(memberName(trip, c.driverId))}</b><span class="pill ${used > c.seats ? 'bad' : ''}">${used}/${c.seats} cupos</span></div>
        <div class="small muted">${esc([c.from && `Sale desde ${c.from}`, c.time && `a las ${c.time}`, c.plate && `patente ${c.plate}`].filter(Boolean).join(' · '))}</div>
        <div class="small">Pasajeros: ${c.passengerIds.map((id) => esc(memberName(trip, id))).join(', ') || '—'}</div>
        <button class="btn small top-gap" data-car="${c.id}">Editar</button>
      </li>`;
    }).join('')}</ul>` : '<p class="small muted">Organiza quién maneja, desde dónde sale y quién va en cada auto.</p>'}
    ${trip.cars.length && trip.members.some((m) => !inCar.has(m.id)) ? `<p class="alert warn">Sin auto: ${trip.members.filter((m) => !inCar.has(m.id)).map((m) => esc(firstName(m.name))).join(', ')}</p>` : ''}
    <form id="car-form" class="form top-gap">
      <input type="hidden" name="id">
      <div class="cols2">
        <label>Conductor/a<select name="driverId" required><option value="">Elegir…</option>${memberOpts()}</select></label>
        <label>Cupos para pasajeros<input name="seats" type="number" min="0" max="12" value="4"></label>
        <label>Sale desde<input name="from" placeholder="Ej: Metro Irarrázaval"></label>
        <label>Hora<input name="time" type="time"></label>
      </div>
      <label>Patente / modelo (para el aviso)<input name="plate"></label>
      <fieldset><legend>Pasajeros</legend><div class="chips">${trip.members.map((m) => `<label class="chip"><input type="checkbox" name="passengerIds" value="${m.id}">${esc(m.name)}</label>`).join('')}</div></fieldset>
      <div class="row gap"><button class="btn" type="submit">Guardar auto</button><button class="btn danger" type="button" id="del-car" hidden>Eliminar</button></div>
    </form>
  </section>`;

  const again = () => tabGroup(trip, el);
  const form = $('#member-form', el);
  $$('[data-me]', el).forEach((b) => b.addEventListener('click', () => {
    state.settings.me = { ...(state.settings.me || {}), [trip.id]: b.dataset.me };
    save();
    again();
  }));
  $$('[data-edit]', el).forEach((b) => b.addEventListener('click', () => {
    const m = trip.members.find((x) => x.id === b.dataset.edit);
    ['id', 'name', 'phone', 'rut', 'age', 'role', 'firstAid', 'emergencyName', 'emergencyPhone', 'health'].forEach((k) => { form[k].value = m[k] || ''; });
    if (!m.emergencyName && m.emergency) form.emergencyName.value = m.emergency;
    form.knowsRoute.checked = !!m.knowsRoute;
    $('#member-form-title', el).textContent = `Editar a ${m.name}`;
    $('#del-member', el).hidden = false;
    form.scrollIntoView({ behavior: 'smooth' });
  }));
  $('#del-member', el).addEventListener('click', () => {
    const id = form.id.value;
    if (!confirm('¿Quitar a este integrante?')) return;
    trip.members = trip.members.filter((m) => m.id !== id);
    trip.gear.forEach((g) => { if (g.assignee === id) g.assignee = ''; if (g.checks) delete g.checks[id]; });
    trip.ropes.forEach((r) => { r.memberIds = r.memberIds.filter((x) => x !== id); });
    trip.cars = trip.cars.filter((c) => c.driverId !== id);
    trip.cars.forEach((c) => { c.passengerIds = c.passengerIds.filter((x) => x !== id); });
    save();
    again();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    data.knowsRoute = form.knowsRoute.checked;
    delete data.emergency;
    if (data.id) {
      const m = trip.members.find((x) => x.id === data.id);
      delete m.emergency;
      Object.assign(m, data);
    } else trip.members.push({ ...data, id: uid() });
    save();
    again();
  });

  // Cordadas
  const rf = $('#rope-form', el);
  $$('[data-rope]', el).forEach((b) => b.addEventListener('click', () => {
    const r = trip.ropes.find((x) => x.id === b.dataset.rope);
    rf.id.value = r.id;
    rf.name.value = r.name;
    $$('input[name=memberIds]', rf).forEach((c) => { c.checked = r.memberIds.includes(c.value); });
    $('#del-rope', el).hidden = false;
    rf.scrollIntoView({ behavior: 'smooth' });
  }));
  rf.addEventListener('submit', (e) => {
    e.preventDefault();
    const memberIds = $$('input[name=memberIds]:checked', rf).map((c) => c.value);
    // Cada integrante queda en una sola cordada.
    trip.ropes.forEach((r) => { if (r.id !== rf.id.value) r.memberIds = r.memberIds.filter((id) => !memberIds.includes(id)); });
    const existing = trip.ropes.find((r) => r.id === rf.id.value);
    if (existing) Object.assign(existing, { name: rf.name.value.trim(), memberIds });
    else trip.ropes.push({ id: uid(), name: rf.name.value.trim(), memberIds });
    save();
    again();
  });
  $('#del-rope', el).addEventListener('click', () => {
    trip.ropes = trip.ropes.filter((r) => r.id !== rf.id.value);
    save();
    again();
  });

  // Autos
  const cf = $('#car-form', el);
  $$('[data-car]', el).forEach((b) => b.addEventListener('click', () => {
    const c = trip.cars.find((x) => x.id === b.dataset.car);
    ['id', 'driverId', 'seats', 'from', 'time', 'plate'].forEach((k) => { cf[k].value = c[k] ?? ''; });
    $$('input[name=passengerIds]', cf).forEach((x) => { x.checked = c.passengerIds.includes(x.value); });
    $('#del-car', el).hidden = false;
    cf.scrollIntoView({ behavior: 'smooth' });
  }));
  cf.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(cf));
    const passengerIds = $$('input[name=passengerIds]:checked', cf).map((c) => c.value).filter((id) => id !== f.driverId);
    trip.cars.forEach((c) => { if (c.id !== f.id) c.passengerIds = c.passengerIds.filter((id) => !passengerIds.includes(id)); });
    const car = { driverId: f.driverId, seats: Number(f.seats) || 0, from: f.from.trim(), time: f.time, plate: f.plate.trim(), passengerIds };
    const existing = trip.cars.find((c) => c.id === f.id);
    if (existing) Object.assign(existing, car);
    else trip.cars.push({ id: uid(), ...car });
    save();
    again();
  });
  $('#del-car', el).addEventListener('click', () => {
    trip.cars = trip.cars.filter((c) => c.id !== cf.id.value);
    save();
    again();
  });
}

const waNumber = (phone) => {
  let d = String(phone).replace(/\D/g, '');
  if (d.length === 9 && d.startsWith('9')) d = `56${d}`; // celular chileno sin código de país
  return d;
};
const emergencyOf = (m) => [m.emergencyName || m.emergency, m.emergencyPhone].filter(Boolean).join(' · ');

// Revisión de seguridad a partir de los datos del grupo.
function safetyChecks(trip) {
  const out = [];
  const ms = trip.members;
  if (!ms.length) return out;
  if (!trip.org?.leaderId) out.push({ level: 'warn', text: 'No hay jefe/a de salida definido (Plan y seguridad).' });
  if (!ms.some((m) => m.knowsRoute)) out.push({ level: 'warn', text: 'Nadie conoce el sector ni la ruta: lleven track GPX y reseña, y estudien la ruta antes.' });
  if (!ms.some((m) => m.firstAid)) out.push({ level: 'warn', text: 'Nadie tiene certificación de primeros auxilios en terreno (WFR/WAFA).' });
  const noEm = ms.filter((m) => !m.emergencyName && !m.emergency);
  if (noEm.length) out.push({ level: 'warn', text: `Sin contacto de emergencia: ${noEm.map((m) => firstName(m.name)).join(', ')}.` });
  if (trip.cars.length) {
    const inCar = new Set(trip.cars.flatMap((c) => [c.driverId, ...c.passengerIds]));
    const noCar = ms.filter((m) => !inCar.has(m.id));
    if (noCar.length) out.push({ level: 'warn', text: `Sin auto asignado: ${noCar.map((m) => firstName(m.name)).join(', ')}.` });
    trip.cars.filter((c) => c.passengerIds.length > c.seats).forEach((c) => out.push({ level: 'danger', text: `El auto de ${firstName(memberName(trip, c.driverId))} lleva más pasajeros que cupos.` }));
  }
  if (!trip.plan?.return && !trip.plan?.alarm) out.push({ level: 'info', text: 'Define la hora de regreso y la hora de alarma en Plan y seguridad.' });
  if (!out.length) out.push({ level: 'good', text: 'Grupo completo: jefe/a de salida, contactos de emergencia, primeros auxilios y ruta conocida.' });
  return out;
}

// --- Equipo ---
function tabGear(trip, el) {
  const myId = me(trip);
  const filter = ui.filter === 'me' && !myId ? 'all' : ui.filter;
  const members = trip.members;
  const p = gearProgress(trip, filter === 'me' ? myId : null);
  const byCat = {};
  trip.gear.forEach((g) => { (byCat[g.cat] ||= []).push(g); });
  const cats = [...CATEGORIES, ...Object.keys(byCat).filter((c) => !CATEGORIES.includes(c))].filter((c) => byCat[c]);
  const personalFor = filter === 'me' ? members.filter((m) => m.id === myId) : members;
  const ropesFor = filter === 'me' ? ropesOf(trip).filter((r) => r.memberIds.includes(myId)) : ropesOf(trip);
  const multiRope = trip.ropes.length > 0;

  const row = (g) => {
    if (filter === 'me' && g.scope === 'g' && g.assignee !== myId) return '';
    if (g.scope === 'c') {
      const done = ropesFor.length > 0 && ropesFor.every((r) => g.checks?.[ropeKey(r)]);
      const controls = multiRope
        ? `<div class="checks">${ropesFor.map((r) => `<button class="mchk rope ${g.checks?.[ropeKey(r)] ? 'on' : ''}" data-chk="${g.id}" data-m="${ropeKey(r)}" title="${esc(r.name)}" aria-pressed="${!!g.checks?.[ropeKey(r)]}">${esc(ropeLabel(r))}</button>`).join('')}</div>`
        : `<input type="checkbox" data-chk="${g.id}" data-m="${ropeKey(ropesFor[0] || { id: 'all' })}" ${g.checks?.r_all ? 'checked' : ''} aria-label="Listo">`;
      return `<li class="gear ${done ? 'done' : ''}">
      <div class="grow"><span class="gname">${esc(g.name)}</span>
        <span class="small muted"> · por cordada${g.weight ? ` · ${g.weight} g` : ''}</span></div>
      ${controls}
      <button class="icon-btn small no-print" data-del="${g.id}" aria-label="Eliminar ítem">×</button>
    </li>`;
    }
    const done = g.scope === 'p'
      ? (personalFor.length ? personalFor.every((m) => g.checks?.[m.id]) : !!g.checks?._)
      : g.checked;
    const controls = g.scope === 'p'
      ? (personalFor.length
        ? `<div class="checks">${personalFor.map((m) => `<button class="mchk ${g.checks?.[m.id] ? 'on' : ''}" data-chk="${g.id}" data-m="${m.id}" title="${esc(m.name)}" aria-pressed="${!!g.checks?.[m.id]}">${esc(initials(m.name))}</button>`).join('')}</div>`
        : `<input type="checkbox" data-chk="${g.id}" data-m="_" ${g.checks?._ ? 'checked' : ''} aria-label="Listo">`)
      : `<div class="row gap-s"><select data-assign="${g.id}" aria-label="Quién lo lleva"><option value="">¿Quién lo lleva?</option>${members.map((m) => `<option value="${m.id}" ${g.assignee === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select><input type="checkbox" data-gchk="${g.id}" ${g.checked ? 'checked' : ''} aria-label="Listo"></div>`;
    return `<li class="gear ${done ? 'done' : ''}">
      <div class="grow"><span class="gname">${esc(g.name)}</span>
        <span class="small muted"> ${g.scope === 'g' ? '· grupal' : '· personal'}${g.weight ? ` · ${g.weight} g` : ''}</span></div>
      ${controls}
      <button class="icon-btn small no-print" data-del="${g.id}" aria-label="Eliminar ítem">×</button>
    </li>`;
  };

  el.innerHTML = `
  <section class="card sticky-summary">
    <div class="row between wrap-row">
      <div class="seg" role="group">
        <button class="${filter === 'all' ? 'on' : ''}" data-filter="all">Todo el grupo</button>
        <button class="${filter === 'me' ? 'on' : ''}" data-filter="me" ${myId ? '' : 'disabled title="Elige quién eres en Cordada"'}>Lo mío</button>
      </div>
      <b>${p.done}/${p.total} · ${p.pct}%</b>
    </div>
    <div class="progress big"><i style="width:${p.pct}%"></i></div>
  </section>
  ${members.length ? '' : '<p class="small muted">Tip: agrega integrantes en Grupo para marcar el equipo personal de cada uno y repartir el grupal.</p>'}
  ${multiRope ? '<p class="small muted">Personal: iniciales de cada integrante · Por cordada: C1, C2… · Grupal: se asigna quién lo lleva.</p>' : ''}
  ${cats.map((c) => {
    const rows = byCat[c].map(row).join('');
    return rows ? `<section class="card"><h3>${esc(c)}</h3><ul class="gear-list">${rows}</ul></section>` : '';
  }).join('')}
  <section class="card no-print">
    <h3>Agregar ítem</h3>
    <form id="gear-form" class="form">
      <label>Ítem<input name="name" required placeholder="Ej: Radio portátil"></label>
      <div class="cols3">
        <label>Categoría<select name="cat">${CATEGORIES.map((c) => `<option>${esc(c)}</option>`).join('')}</select></label>
        <label>Tipo<select name="scope"><option value="p">Personal (cada uno)</option><option value="c">Por cordada (uno por cordada)</option><option value="g">Grupal (uno para todos)</option></select></label>
        <label>Peso (g)<input name="weight" type="number" min="0"></label>
      </div>
      <button class="btn primary" type="submit">Agregar</button>
    </form>
    <div class="row gap wrap-row top-gap">
      <select id="add-mod"><option value="">＋ Agregar equipo de otra actividad…</option>${Object.entries(MODULES).filter(([id]) => !trip.modules.includes(id)).map(([id, m]) => `<option value="${id}">${m.icon} ${m.label}</option>`).join('')}</select>
      <button class="btn" id="reset-checks">Desmarcar todo</button>
      <button class="btn" id="print-gear">🖨️ Imprimir</button>
    </div>
  </section>`;

  const rerender = () => { const y = window.scrollY; tabGear(trip, el); window.scrollTo(0, y); };
  el.onclick = (e) => {
    const t = e.target.closest('[data-filter],[data-del],button[data-chk]');
    if (!t) return;
    if (t.dataset.filter) { ui.filter = t.dataset.filter; return rerender(); }
    if (t.dataset.del) {
      const g = trip.gear.find((x) => x.id === t.dataset.del);
      if (confirm(`¿Quitar "${g.name}" de la lista?`)) { trip.gear = trip.gear.filter((x) => x !== g); save(); rerender(); }
      return;
    }
    const g = trip.gear.find((x) => x.id === t.dataset.chk);
    g.checks = { ...(g.checks || {}), [t.dataset.m]: !g.checks?.[t.dataset.m] };
    save();
    rerender();
  };
  el.onchange = (e) => {
    const t = e.target;
    if (t.dataset.chk) {
      const g = trip.gear.find((x) => x.id === t.dataset.chk);
      g.checks = { ...(g.checks || {}), _: t.checked };
    } else if (t.dataset.gchk) {
      trip.gear.find((x) => x.id === t.dataset.gchk).checked = t.checked;
    } else if (t.dataset.assign) {
      trip.gear.find((x) => x.id === t.dataset.assign).assignee = t.value;
    } else if (t.id === 'add-mod' && t.value) {
      addModules(trip, [t.value]);
      toast(`Agregado: ${MODULES[t.value].label}`);
    } else return;
    save();
    rerender();
  };
  $('#gear-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    trip.gear.push(makeItem(f.name.trim(), f.cat, f.scope, Number(f.weight) || 0));
    save();
    rerender();
  });
  $('#reset-checks', el).addEventListener('click', () => {
    if (!confirm('¿Desmarcar todo el equipo?')) return;
    trip.gear.forEach((g) => { g.checked = false; g.checks = {}; });
    save();
    rerender();
  });
  $('#print-gear', el).addEventListener('click', () => window.print());
}

// --- Clima ---
function tabWeather(trip, el) {
  if (trip.lat == null) {
    el.innerHTML = `<section class="card"><p>Para ver el pronóstico, define la ubicación del objetivo en <a href="#/salida/${trip.id}/editar">Editar</a> o en el <a href="#/salida/${trip.id}/mapa">Mapa</a>.</p></section>`;
    return;
  }
  const w = trip.weather;
  const stale = !w || Date.now() - new Date(w.fetchedAt) > 3 * 3600 * 1000;
  el.innerHTML = `
  <section class="card">
    <div class="row between wrap-row">
      <div>
        <h3>Pronóstico en ${esc(trip.peak || 'el objetivo')}${trip.altitude ? ` (${trip.altitude} m)` : ''}</h3>
        <p class="small muted">${w ? `Actualizado ${new Date(w.fetchedAt).toLocaleString('es-CL')}` : 'Sin datos todavía'} · Modelos: ${MODELS.map((m) => m.label).join(', ')} vía Open-Meteo</p>
      </div>
      <button class="btn primary" id="refresh">↻ Actualizar</button>
    </div>
    <div id="wx-status"></div>
  </section>
  <div id="wx-body"></div>
  <section class="card">
    <h3>Otros pronósticos</h3>
    <div class="link-list">${externalLinks(trip).map(([n, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${n} ↗</a>`).join('')}</div>
    <p class="small muted">Los modelos globales no resuelven bien el relieve andino: úsalos como tendencia y contrasta con fuentes locales. Revisa también el boletín de avalanchas si hay nieve.</p>
  </section>`;

  const load = async () => {
    const st = $('#wx-status', el);
    st.innerHTML = '<p class="muted">Descargando pronóstico…</p>';
    try {
      trip.weather = await fetchWeather(trip);
      save();
      tabWeather(trip, el);
    } catch (err) {
      st.innerHTML = `<p class="alert warn">No se pudo actualizar (${esc(err.message)}). ${trip.weather ? 'Mostrando el último pronóstico guardado.' : ''}</p>`;
    }
  };
  $('#refresh', el).addEventListener('click', load);
  if (w) renderWeatherBody(trip, $('#wx-body', el));
  if (stale && navigator.onLine !== false) load();
}

function renderWeatherBody(trip, el) {
  const w = trip.weather;
  const d = w.daily.daily;
  const dates = tripDates(trip);
  if (!ui.day || !d.time.includes(ui.day)) ui.day = d.time.find((t) => dates.includes(t)) || d.time[0];
  const times = hourlyTimes(w);
  const alt = trip.altitude || w.altitude;

  const days = d.time.map((t, i) => {
    const [ic, desc] = wmo(d.weather_code[i]);
    return `<button class="day ${t === ui.day ? 'on' : ''} ${dates.includes(t) ? 'trip' : ''}" data-day="${t}" title="${esc(desc)}">
      <span class="small">${fmtDayShort(t)}</span><span class="wx-icon">${ic}</span>
      <b>${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</b>
      <span class="small">💨 ${Math.round(d.wind_gusts_10m_max[i])}</span>
      <span class="small">${d.precipitation_sum[i] ? `💧 ${d.precipitation_sum[i].toFixed(1)}` : '&nbsp;'}</span>
    </button>`;
  }).join('');

  const di = d.time.indexOf(ui.day);
  const hoursIdx = times.map((t, i) => (t.startsWith(ui.day) && Number(t.slice(11, 13)) % 3 === 0 ? i : -1)).filter((i) => i >= 0);
  const vars = [
    ['temperature_2m', 'Temperatura (°C)', (v) => Math.round(v)],
    ['apparent_temperature', 'Sensación térmica (°C)', (v) => Math.round(v)],
    ['wind_gusts_10m', 'Ráfagas (km/h)', (v) => Math.round(v)],
    ['precipitation', 'Precipitación (mm)', (v) => (v ? v.toFixed(1) : '·')],
    ['snowfall', 'Nieve (cm)', (v) => (v ? v.toFixed(1) : '·')],
    ['cloud_cover', 'Nubosidad (%)', (v) => Math.round(v)],
    ['freezing_level_height', 'Isoterma 0° (m)', (v) => Math.round(v / 50) * 50],
  ];
  if (alt > 3500) vars.push(['wind_speed_500hPa', 'Viento 500 hPa ≈5.500 m (km/h)', (v) => Math.round(v)]);
  const table = `<div class="table-scroll"><table class="wx-table">
    <thead><tr><th></th>${hoursIdx.map((i) => `<th>${fmtHour(times[i])}</th>`).join('')}</tr></thead>
    <tbody>${vars.map(([v, label, f]) => `<tr class="group"><th colspan="${hoursIdx.length + 1}">${label}</th></tr>${MODELS.map((m) => {
      const s = series(w, m.id, v);
      return `<tr><th><i class="sw s${m.slot}"></i>${m.label}</th>${hoursIdx.map((i) => `<td class="${cellClass(v, s[i], alt)}">${s[i] == null ? '—' : f(s[i])}</td>`).join('')}</tr>`;
    }).join('')}`).join('')}</tbody></table></div>`;

  el.innerHTML = '<section class="card"><div id="wx-measure"></div></section>';
  const W = $('#wx-measure', el).clientWidth || 720;
  const fz = lineChart({
    W,
    times,
    lines: MODELS.map((m) => ({ label: m.label, slot: m.slot, values: series(w, m.id, 'freezing_level_height') })),
    refLine: alt ? { value: alt, label: `Cumbre ${alt} m` } : null,
    unit: 'm',
    fmtX: fmtDayShort,
  });
  const gust = lineChart({
    W,
    times,
    lines: MODELS.map((m) => ({ label: m.label, slot: m.slot, values: series(w, m.id, 'wind_gusts_10m') })),
    unit: 'km/h',
    fmtX: fmtDayShort,
  });
  const temp = lineChart({
    W,
    times,
    lines: MODELS.map((m) => ({ label: m.label, slot: m.slot, values: series(w, m.id, 'temperature_2m') })),
    refLine: { value: 0, label: '0 °C' },
    unit: '°C',
    fmtX: fmtDayShort,
  });

  el.innerHTML = `
  <section class="card"><h3>Alertas para la salida</h3>${alertList(assess(w, dates))}</section>
  <section class="card">
    <h3>Próximos días</h3>
    <div class="days">${days}</div>
    ${di >= 0 ? `<p class="small muted">☀️ Sale ${fmtHour(d.sunrise[di])} · se pone ${fmtHour(d.sunset[di])} · UV máx ${Math.round(d.uv_index_max[di] ?? 0)} · días marcados = fechas de la salida</p>` : ''}
  </section>
  <section class="card">
    <h3>Comparación de modelos · ${fmtDate(ui.day, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
    ${table}
  </section>
  <section class="card"><h3>Isoterma 0° (m)</h3>${fz}<p class="small muted">Sobre la línea de cumbre: la nieve se ablanda y hay más riesgo de caída de rocas. Bajo ella: nieve dura/hielo.</p></section>
  <section class="card"><h3>Ráfagas de viento en la cota (km/h)</h3>${gust}</section>
  <section class="card"><h3>Temperatura en la cota (°C)</h3>${temp}</section>`;

  $$('[data-day]', el).forEach((b) => b.addEventListener('click', () => { ui.day = b.dataset.day; renderWeatherBody(trip, el); }));
  wireCharts(el, fmtTime);
}

function cellClass(v, x, alt) {
  if (x == null) return '';
  if (v === 'wind_gusts_10m' || v === 'wind_speed_500hPa') return x >= 70 ? 'bad' : x >= 45 ? 'meh' : '';
  if (v === 'precipitation') return x >= 2 ? 'bad' : x > 0.2 ? 'meh' : '';
  if (v === 'snowfall') return x >= 2 ? 'bad' : x > 0 ? 'meh' : '';
  if (v === 'apparent_temperature') return x <= -20 ? 'bad' : x <= -8 ? 'meh' : '';
  if (v === 'freezing_level_height' && alt) return x < alt ? 'cold' : '';
  return '';
}

// --- Mapa ---
function tabMap(trip, el) {
  destroyMap();
  const s = trip.gpx?.stats;
  el.innerHTML = `
  <section class="card map-card">
    <div id="map" class="map"></div>
    <div class="row gap wrap-row top-gap">
      <button class="btn" id="pick">📍 Fijar objetivo en el mapa</button>
      <button class="btn" id="locate">🎯 Mi ubicación</button>
      <label class="btn">🗂️ Cargar GPX<input type="file" id="gpx-file" accept=".gpx,application/gpx+xml" hidden></label>
      ${trip.gpx ? '<button class="btn" id="gpx-dl">⬇️ Descargar GPX</button><button class="btn danger" id="gpx-del">Quitar track</button>' : ''}
    </div>
    <p class="small muted" id="coords">${trip.lat != null ? `Objetivo: ${trip.lat.toFixed(5)}, ${trip.lon.toFixed(5)} · ${toDMS(trip.lat, 'N', 'S')} ${toDMS(trip.lon, 'E', 'O')}` : 'Sin objetivo fijado.'}</p>
  </section>
  ${s ? `<section class="card">
    <h3>Track: ${esc(trip.gpx.name || 'sin nombre')}</h3>
    <dl class="stats">
      <div><dt>Distancia</dt><dd>${s.distKm.toFixed(1)} km</dd></div>
      <div><dt>Desnivel +</dt><dd>${s.up} m</dd></div>
      <div><dt>Desnivel −</dt><dd>${s.down} m</dd></div>
      <div><dt>Altura máx.</dt><dd>${s.maxEle ?? '—'} m</dd></div>
      <div><dt>Tiempo estimado</dt><dd>${Math.floor(s.hours)} h ${Math.round((s.hours % 1) * 60)} min</dd></div>
    </dl>
    <p class="small muted">Tiempo según regla de Naismith (4 km/h + 1 h cada 600 m de subida), sin descansos. En altura y con nieve, suma bastante más.</p>
    <div id="profile"></div>
    ${s.high ? '<button class="btn small top-gap" id="use-high">Usar el punto más alto como objetivo</button>' : ''}
  </section>` : `<section class="card"><p class="muted">Carga el track GPX de la ruta (Andeshandbook, Wikiloc, tu GPS) para verlo en el mapa con su perfil de elevación. Se guarda en la salida y se comparte con la cordada.</p></section>`}`;

  const setTarget = (lat, lon, altitude) => {
    trip.lat = +lat.toFixed(6);
    trip.lon = +lon.toFixed(6);
    if (altitude != null) trip.altitude = Math.round(altitude);
    delete trip.weather;
    save();
    $('#coords', el).textContent = `Objetivo: ${trip.lat.toFixed(5)}, ${trip.lon.toFixed(5)} · ${toDMS(trip.lat, 'N', 'S')} ${toDMS(trip.lon, 'E', 'O')}`;
    toast('Objetivo actualizado');
  };
  const ctrl = createMap($('#map', el), { lat: trip.lat, lon: trip.lon, onPick: (la, lo) => setTarget(la, lo) });
  ui.mapCtrl = ctrl;
  let hoverMarker = null;
  if (ctrl && trip.gpx) drawTrack(ctrl, trip.gpx);

  $('#pick', el).addEventListener('click', () => { ctrl?.pickMode(true); toast('Toca el mapa para fijar el objetivo'); });
  $('#locate', el).addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Tu navegador no entrega ubicación');
    navigator.geolocation.getCurrentPosition((pos) => {
      const { latitude, longitude, accuracy, altitude } = pos.coords;
      if (ctrl) {
        L.circle([latitude, longitude], { radius: accuracy, color: '#2a78d6', weight: 1 }).addTo(ctrl.map);
        L.circleMarker([latitude, longitude], { radius: 7, color: '#fff', weight: 2, fillColor: '#2a78d6', fillOpacity: 1 }).bindTooltip('Estás aquí').addTo(ctrl.map);
        ctrl.map.setView([latitude, longitude], 14);
      }
      toast(`Tu posición: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}${altitude ? ` · ${Math.round(altitude)} m` : ''}`);
    }, (err) => toast(`Sin ubicación: ${err.message}`), { enableHighAccuracy: true, timeout: 15000 });
  });
  $('#gpx-file', el).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const g = parseGPX(await file.text());
      trip.gpx = { name: g.name || file.name.replace(/\.gpx$/i, ''), pts: g.pts, wpts: g.wpts, stats: g.stats, raw: null };
      // Se guarda una versión liviana de los puntos (máx. ~3000) para no llenar el almacenamiento.
      const step = Math.ceil(g.pts.length / 3000);
      trip.gpx.pts = g.pts.filter((_, i) => i % step === 0 || i === g.pts.length - 1).map((p) => ({ lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6), ele: p.ele == null ? null : Math.round(p.ele) }));
      trip.gpx.stats = { ...g.stats, profile: g.stats.profile.filter((_, i) => i % step === 0) };
      if (trip.lat == null && g.stats.high) setTarget(g.stats.high.lat, g.stats.high.lon, g.stats.high.ele);
      save();
      tabMap(trip, el);
    } catch (err) {
      alert(err.message);
    }
  });
  $('#gpx-del', el)?.addEventListener('click', () => {
    if (confirm('¿Quitar el track de la salida?')) { trip.gpx = null; save(); tabMap(trip, el); }
  });
  $('#gpx-dl', el)?.addEventListener('click', () => download(`${slug(trip.gpx.name || trip.name)}.gpx`, toGPX(trip.gpx), 'application/gpx+xml'));
  $('#use-high', el)?.addEventListener('click', () => {
    const h = s.high;
    setTarget(h.lat, h.lon, h.ele);
    ctrl?.setMarker(h.lat, h.lon);
  });
  if (s) {
    const box = $('#profile', el);
    box.innerHTML = profileChart(s.profile, box.clientWidth);
  }
  wireProfile(el, (pt) => {
    if (!ctrl || !trip.gpx) return;
    const km = pt[0];
    // Busca el punto del track más cercano a esa distancia.
    const idx = Math.round((km / s.distKm) * (trip.gpx.pts.length - 1));
    const p = trip.gpx.pts[Math.max(0, Math.min(trip.gpx.pts.length - 1, idx))];
    if (!hoverMarker) hoverMarker = L.circleMarker([p.lat, p.lon], { radius: 6, color: '#fff', weight: 2, fillColor: '#eb6834', fillOpacity: 1 }).addTo(ctrl.map);
    else hoverMarker.setLatLng([p.lat, p.lon]);
  });
  setTimeout(() => { if (ctrl && ui.mapCtrl === ctrl) ctrl.map.invalidateSize(); }, 100);
}

function toGPX(g) {
  const pt = (p, tag) => `<${tag} lat="${p.lat}" lon="${p.lon}">${p.ele != null ? `<ele>${p.ele}</ele>` : ''}${p.name ? `<name>${esc(p.name)}</name>` : ''}</${tag}>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Cordada" xmlns="http://www.topografix.com/GPX/1/1">
${g.wpts.map((w) => pt(w, 'wpt')).join('\n')}
<trk><name>${esc(g.name)}</name><trkseg>
${g.pts.map((p) => pt(p, 'trkpt')).join('\n')}
</trkseg></trk>
</gpx>`;
}

// --- Fotos ---
function tabPhotos(trip, el) {
  const clientId = state.settings.googleClientId;
  const folder = trip.drive?.folderId;
  const folderUrl = trip.drive?.folderUrl;
  el.innerHTML = `
  <section class="card">
    <h3>Carpeta de Google Drive</h3>
    ${folderUrl ? `<p><a class="btn primary" href="${esc(folderUrl)}" target="_blank" rel="noopener">📁 Abrir carpeta en Drive ↗</a></p>` : ''}
    ${clientId ? `
      <p class="small muted">${drive.isConnected() ? '✅ Conectado a Google Drive.' : 'Conéctate con tu cuenta de Google para crear la carpeta de la salida y subir fotos.'}</p>
      <div class="row gap wrap-row">
        ${drive.isConnected() ? '' : '<button class="btn primary" id="connect">Conectar Google Drive</button>'}
        ${drive.isConnected() && !folder ? '<button class="btn primary" id="mkfolder">Crear carpeta de la salida</button>' : ''}
        ${drive.isConnected() && folder ? '<button class="btn" id="share-folder">Permitir que la cordada suba fotos</button><button class="btn" id="list">↻ Ver fotos</button>' : ''}
      </div>` : `
      <p class="small muted">Para subir directo desde la app, configura un Client ID de Google en <a href="#/ajustes">Ajustes</a>. Mientras tanto, pega el link de una carpeta compartida de Drive y usa "Enviar a Drive" desde el teléfono.</p>`}
    <form id="folder-form" class="row gap top-gap">
      <input name="url" type="url" placeholder="https://drive.google.com/drive/folders/..." value="${esc(folderUrl || '')}" class="grow">
      <button class="btn" type="submit">Guardar link</button>
    </form>
  </section>

  <section class="card">
    <h3>Subir fotos</h3>
    <label class="dropzone" id="drop">
      <input type="file" id="photos" accept="image/*,video/*" multiple hidden>
      <span>📷 Toca para elegir o tomar fotos<br><span class="small muted">o arrástralas aquí</span></span>
    </label>
    <ul id="queue" class="queue"></ul>
    <p class="small muted">${clientId && folder ? 'Se suben en calidad original a la carpeta de la salida.' : 'Sin conexión a Drive, las fotos se envían con el menú "Compartir" del teléfono (elige Drive, Google Fotos o WhatsApp).'}</p>
  </section>
  <section class="card"><h3>Galería</h3><div id="gallery" class="gallery"><p class="muted small">${folder && drive.isConnected() ? 'Cargando…' : 'Conéctate a Drive para ver las fotos de la carpeta.'}</p></div></section>`;

  const refreshGallery = async () => {
    const g = $('#gallery', el);
    try {
      const files = await drive.listFolder(folder);
      g.innerHTML = files.length ? files.map((f) => `<a href="${esc(f.webViewLink)}" target="_blank" rel="noopener" title="${esc(f.name)}">${f.thumbnailLink ? `<img src="${esc(f.thumbnailLink)}" alt="${esc(f.name)}" loading="lazy" referrerpolicy="no-referrer">` : `<span>${esc(f.name)}</span>`}</a>`).join('') : '<p class="muted small">Aún no hay fotos.</p>';
    } catch (err) {
      g.innerHTML = `<p class="muted small">${esc(err.message)}</p>`;
    }
  };

  $('#connect', el)?.addEventListener('click', async () => {
    try { await drive.connect(clientId); tabPhotos(trip, el); } catch (err) { alert(err.message); }
  });
  $('#mkfolder', el)?.addEventListener('click', async () => {
    try {
      const f = await drive.createFolder(`Cordada · ${trip.name}${trip.date ? ` · ${trip.date}` : ''}`, state.settings.driveParent || undefined);
      trip.drive = { folderId: f.id, folderUrl: f.webViewLink };
      save();
      toast('Carpeta creada en tu Drive');
      tabPhotos(trip, el);
    } catch (err) { alert(err.message); }
  });
  $('#share-folder', el)?.addEventListener('click', async () => {
    if (!confirm('Cualquiera con el link de la carpeta podrá ver y subir fotos. ¿Continuar?')) return;
    try {
      await drive.shareFolder(folder, 'writer');
      await shareOrCopy({ title: `Fotos: ${trip.name}`, text: `Suban sus fotos de "${trip.name}" aquí:`, url: folderUrl });
    } catch (err) { alert(err.message); }
  });
  $('#list', el)?.addEventListener('click', refreshGallery);
  if (folder && drive.isConnected()) refreshGallery();

  $('#folder-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    const m = url.match(/folders\/([\w-]+)/);
    trip.drive = { ...(trip.drive || {}), folderUrl: url, folderId: m ? m[1] : trip.drive?.folderId };
    save();
    toast('Link guardado');
    tabPhotos(trip, el);
  });

  const handle = async (files) => {
    files = [...files];
    if (!files.length) return;
    const q = $('#queue', el);
    if (clientId && folder) {
      try { await drive.connect(clientId); } catch (err) { return alert(err.message); }
      for (const f of files) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="grow">${esc(f.name)}</span><progress max="1" value="0"></progress>`;
        q.appendChild(li);
        try {
          await drive.upload(f, folder, (p) => { li.querySelector('progress').value = p; });
          li.classList.add('ok');
        } catch (err) {
          li.classList.add('err');
          li.title = err.message;
        }
      }
      refreshGallery();
    } else if (navigator.canShare?.({ files })) {
      try { await navigator.share({ files, title: `Fotos ${trip.name}` }); } catch { /* cancelado */ }
    } else {
      files.forEach((f) => {
        const li = document.createElement('li');
        li.innerHTML = `<img src="${URL.createObjectURL(f)}" alt=""><span class="grow">${esc(f.name)}</span>`;
        q.appendChild(li);
      });
      toast('Este navegador no permite compartir archivos: súbelas desde la carpeta de Drive.');
      if (folderUrl) window.open(folderUrl, '_blank', 'noopener');
    }
  };
  $('#photos', el).addEventListener('change', (e) => handle(e.target.files));
  const drop = $('#drop', el);
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handle(e.dataTransfer.files); });
}

// --- Plan y seguridad ---
const ORG_FIELDS = [
  ['club', 'Club / organización', 'text', 'Ej: Club de Montaña RAMUCH'],
  ['clubContact', 'Contacto del club (quien recibe el aviso)', 'text'],
  ['clubPhone', 'Teléfono del contacto', 'tel'],
  ['clubEmail', 'Correo del contacto', 'email'],
  ['inreach', 'Comunicador satelital (IMEI / correo InReach)', 'text'],
];

const PLAN_FIELDS = [
  ['start', 'Punto de partida / acceso', 'text', 'Ej: Estacionamiento Baños Morales'],
  ['route', 'Ruta escogida', 'textarea', 'Ej: Cara norte, vía Laguna El Morado'],
  ['activityType', 'Tipo de actividad', 'text', 'Ej: Montaña, trekking, escalada'],
  ['departure', 'Salida (fecha y hora)', 'datetime-local'],
  ['turnaround', 'Hora límite de cumbre (si no llegamos, bajamos)', 'time'],
  ['return', 'Regreso acordado (fecha y hora)', 'datetime-local'],
  ['alarm', 'Si no hay noticias a esta hora, dar aviso', 'datetime-local'],
  ['contactName', 'Contacto en la ciudad (si no es el del club)', 'text'],
  ['contactPhone', 'Teléfono de ese contacto', 'tel'],
  ['comms', 'Comunicaciones (señal, radio, frecuencia)', 'text', 'Ej: sin señal desde Baños Morales'],
  ['planB', 'Plan B / rutas de escape', 'textarea'],
];

const EMERGENCY = [
  ['133', 'Carabineros (Chile)', '🚓'],
  ['136', 'Socorro Andino (Chile)', '⛑️'],
  ['+56229222145', 'Central GOPE Carabineros', '🚁'],
  ['+56226994764', 'Socorro Andino Santiago', '⛑️'],
  ['131', 'SAMU (Chile)', '🚑'],
  ['132', 'Bomberos (Chile)', '🚒'],
  ['911', 'Emergencias (Argentina)', '🆘'],
  ['112', 'Emergencias desde celular', '📡'],
];

function planText(trip) {
  const p = trip.plan || {};
  const o = trip.org || {};
  const dt = (v) => (v ? new Date(v).toLocaleString('es-CL', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const byId = (id) => trip.members.find((m) => m.id === id);
  const itinerary = [...trip.itinerary].sort((a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`));
  const lines = [
    `🏔️ AVISO DE SALIDA DEPORTIVA — ${trip.name}`,
    o.club && `Club: ${o.club}`,
    o.clubContact && `Contacto club: ${o.clubContact}${o.clubPhone ? ` ${o.clubPhone}` : ''}${o.clubEmail ? ` · ${o.clubEmail}` : ''}`,
    o.leaderId && byId(o.leaderId) && `Jefe/a de salida: ${byId(o.leaderId).name}${byId(o.leaderId).phone ? ` ${byId(o.leaderId).phone}` : ''}`,
    trip.date && `Fechas: ${fmtDate(trip.date)}${trip.endDate && trip.endDate !== trip.date ? ` al ${fmtDate(trip.endDate)}` : ''}`,
    trip.peak && `Cerro / sector: ${trip.peak}${trip.altitude ? ` (${trip.altitude} m)` : ''}`,
    p.activityType && `Actividad: ${p.activityType}`,
    trip.lat != null && `Coordenadas: ${trip.lat.toFixed(5)}, ${trip.lon.toFixed(5)} https://www.google.com/maps?q=${trip.lat},${trip.lon}`,
    p.start && `Acceso: ${p.start}`,
    p.route && `Ruta: ${p.route}`,
    trip.andesUrl && `Reseña: ${trip.andesUrl}`,
    p.departure && `Salida: ${dt(p.departure)}`,
    p.turnaround && `Hora límite de cumbre: ${p.turnaround}`,
    p.return && `Regreso acordado: ${dt(p.return)}`,
    itinerary.length && `Itinerario:\n${itinerary.map((i) => `• ${i.day ? `${fmtDate(i.day, { weekday: 'short', day: 'numeric' })} ` : ''}${i.time || ''} ${i.place}`).join('\n')}`,
    p.alarm && `⚠️ Si no hay noticias el ${dt(p.alarm)}, llamar a Carabineros (133) / GOPE (22 922 2145) y Socorro Andino (136) con esta información.`,
    trip.members.length && `Integrantes (${trip.members.length}):\n${trip.members.map((m) => `• ${m.name}${m.rut ? ` · RUT ${m.rut}` : ''}${m.age ? ` · ${m.age} años` : ''}${m.phone ? ` · ${m.phone}` : ''}${m.firstAid ? ` · ${m.firstAid}` : ''}${m.knowsRoute ? ' · conoce la ruta' : ''}${emergencyOf(m) ? `\n   Emergencia: ${emergencyOf(m)}` : ''}`).join('\n')}`,
    trip.ropes.length && `Cordadas:\n${trip.ropes.map((r) => `• ${r.name}: ${r.memberIds.map((id) => byId(id)?.name).filter(Boolean).join(', ')}`).join('\n')}`,
    trip.cars.length && `Autos:\n${trip.cars.map((c) => `• ${byId(c.driverId)?.name || '—'}${c.plate ? ` (${c.plate})` : ''}${c.from ? `, sale desde ${c.from}` : ''}${c.time ? ` ${c.time}` : ''}: ${c.passengerIds.map((id) => byId(id)?.name).filter(Boolean).join(', ') || 'sin pasajeros'}`).join('\n')}`,
    p.comms && `Comunicaciones: ${p.comms}`,
    o.inreach && `InReach: ${o.inreach}`,
    p.planB && `Plan B: ${p.planB}`,
  ];
  return lines.filter(Boolean).join('\n');
}

function tabPlan(trip, el) {
  const p = trip.plan;
  const o = trip.org;
  const field = (obj, group) => ([k, label, type, ph]) => (type === 'textarea'
    ? `<label>${label}<textarea data-group="${group}" name="${k}" rows="2" placeholder="${esc(ph || '')}">${esc(obj[k])}</textarea></label>`
    : `<label>${label}<input data-group="${group}" name="${k}" type="${type}" value="${esc(obj[k])}" placeholder="${esc(ph || '')}"></label>`);
  const days = tripDates(trip);
  const itinerary = [...trip.itinerary].sort((a, b) => `${a.day}${a.time}`.localeCompare(`${b.day}${b.time}`));

  el.innerHTML = `
  <section class="card">
    <h3>Club y responsables</h3>
    <form class="form plan-form">
      ${ORG_FIELDS.map(field(o, 'org')).join('')}
      <label>Jefe/a de salida<select data-group="org" name="leaderId"><option value="">Elegir…</option>${trip.members.map((m) => `<option value="${m.id}" ${o.leaderId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
    </form>
  </section>
  <section class="card">
    <h3>Plan de salida</h3>
    <form class="form plan-form">${PLAN_FIELDS.map(field(p, 'plan')).join('')}</form>
  </section>
  <section class="card">
    <h3>Itinerario</h3>
    ${itinerary.length ? `<ul class="itinerary">${itinerary.map((i) => `<li>
      <span class="it-time">${i.day ? `${fmtDate(i.day, { weekday: 'short', day: 'numeric' })} · ` : ''}${esc(i.time || '')}</span>
      <span class="grow">${esc(i.place)}</span>
      <button class="icon-btn small" data-del-it="${i.id}" aria-label="Quitar">×</button></li>`).join('')}</ul>` : '<p class="small muted">Agrega los hitos: punto de encuentro, retén, inicio de marcha, campamento, cumbre, regreso…</p>'}
    <form id="it-form" class="row gap wrap-row top-gap">
      ${days.length > 1 ? `<select name="day">${days.map((d) => `<option value="${d}">${fmtDate(d, { weekday: 'short', day: 'numeric' })}</option>`).join('')}</select>` : `<input type="hidden" name="day" value="${days[0] || ''}">`}
      <input name="time" type="time" required style="max-width:130px">
      <input name="place" required placeholder="Ej: Retén San Gabriel" class="grow">
      <button class="btn" type="submit">Agregar</button>
    </form>
  </section>
  <section class="card">
    <h3>Aviso de salida</h3>
    <pre id="plan-text" class="plan-text"></pre>
    <div class="link-list">
      <a class="btn primary" id="wa" target="_blank" rel="noopener">Enviar por WhatsApp</a>
      <button class="btn" id="share-plan">Compartir…</button>
      <button class="btn" id="copy-plan">Copiar</button>
    </div>
  </section>
  <section class="card">
    <h3>Emergencias</h3>
    <div class="sos">${EMERGENCY.map(([n, label, icon]) => `<a href="tel:${n}" class="sos-btn">${icon} <b>${n.startsWith('+56') ? `${n.slice(3, 5)} ${n.slice(5, 8)} ${n.slice(8)}` : n}</b><span>${label}</span></a>`).join('')}</div>
    ${o.inreach ? `<p class="small">📡 InReach: <b>${esc(o.inreach)}</b></p>` : ''}
    <p class="small muted">Sin señal: intenta desde un punto alto; los SMS suelen salir cuando una llamada no puede. Envía tus coordenadas (pestaña Mapa → Mi ubicación).</p>
  </section>
  <section class="card">
    <h3>Antes de salir</h3>
    <ul class="checklist-static">
      <li>Revisar el pronóstico y las alertas la noche anterior y en la mañana</li>
      <li>Enviar el aviso de salida al club y a una persona que no vaya</li>
      <li>Descargar mapas y track offline (y cargar batería externa)</li>
      <li>Permisos: <a href="https://www.difrol.gob.cl/" target="_blank" rel="noopener">DIFROL</a> (cerros fronterizos) · <a href="https://www.conaf.cl/parques-nacionales/" target="_blank" rel="noopener">CONAF</a> (áreas protegidas) · registro en el retén si corresponde</li>
      <li>Acordar hora límite de cumbre y respetarla: la cumbre es opcional, volver es obligatorio</li>
      <li>Revisar el estado de caminos y pasos (<a href="https://www.pasosfronterizos.gob.cl/" target="_blank" rel="noopener">pasos fronterizos</a>)</li>
    </ul>
  </section>`;

  const update = () => {
    const text = planText(trip);
    $('#plan-text', el).textContent = text;
    $('#wa', el).href = `https://wa.me/${waNumber(o.clubPhone || p.contactPhone || '')}?text=${encodeURIComponent(text)}`;
  };
  $$('.plan-form', el).forEach((f) => f.addEventListener('input', (e) => {
    const t = e.target;
    trip[t.dataset.group][t.name] = t.value;
    save();
    update();
  }));
  $('#it-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    trip.itinerary.push({ id: uid(), day: f.day || '', time: f.time, place: f.place.trim() });
    save();
    tabPlan(trip, el);
  });
  $$('[data-del-it]', el).forEach((b) => b.addEventListener('click', () => {
    trip.itinerary = trip.itinerary.filter((i) => i.id !== b.dataset.delIt);
    save();
    tabPlan(trip, el);
  }));
  $('#share-plan', el).addEventListener('click', () => shareOrCopy({ title: `Aviso de salida: ${trip.name}`, text: planText(trip) }));
  $('#copy-plan', el).addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(planText(trip)); toast('Aviso copiado'); } catch { prompt('Copia el aviso:', planText(trip)); }
  });
  update();
}

// ---------- Sincronización en tiempo real ----------
function parseConfig(text) {
  if (!text) return null;
  if (typeof text === 'object') return text;
  // Acepta el JSON o el bloque `const firebaseConfig = { apiKey: "..." }` que entrega Firebase.
  const body = String(text).slice(String(text).indexOf('{'), String(text).lastIndexOf('}') + 1);
  const json = body.replace(/([{,]\s*)([A-Za-z_]\w*)\s*:/g, '$1"$2":').replace(/'/g, '"').replace(/,\s*}/g, '}');
  try {
    const cfg = JSON.parse(json);
    return cfg.apiKey && cfg.projectId ? cfg : null;
  } catch {
    return null;
  }
}
const syncConfig = () => parseConfig(state.settings.firebaseConfig) || FIREBASE_CONFIG;
const syncStatus = {};
let syncer = null;

function getSyncer() {
  const cfg = syncConfig();
  if (!cfg) return null;
  if (!syncer) {
    syncer = new TripSync(cfg, {
      onRemote: applyRemote,
      onStatus: (id, status, err) => {
        syncStatus[id] = status;
        if (err) console.warn('Sync', err);
        const dot = $('#sync-dot');
        if (dot && dot.dataset.sync === id) setDot(dot, status);
      },
    });
  }
  return syncer;
}

const DOT = { synced: ['🟢', 'Sincronizada'], pending: ['🟡', 'Enviando cambios…'], offline: ['⚪', 'Sin conexión: los cambios se enviarán después'], error: ['🔴', 'Error de sincronización'] };
function setDot(dot, status) {
  const [icon, label] = DOT[status] || DOT.offline;
  dot.textContent = icon;
  dot.title = label;
  dot.setAttribute('aria-label', label);
}

// Llega una versión nueva desde otro teléfono.
function applyRemote(syncId, data) {
  const trip = state.trips.find((t) => t.syncId === syncId);
  if (!trip) return;
  const keep = { id: trip.id, syncId, weather: trip.weather, createdAt: trip.createdAt };
  Object.keys(trip).forEach((k) => { if (!(k in data) && !(k in keep)) delete trip[k]; });
  Object.assign(trip, normalize({ ...data }), keep);
  saveLocal();
  // Refresca la vista si se está mirando esta salida y nadie está escribiendo.
  const typing = document.activeElement?.matches?.('input, textarea, select');
  if (location.hash.startsWith(`#/salida/${trip.id}/`) && !location.hash.endsWith('/editar') && !location.hash.endsWith('/mapa') && !typing) {
    const y = window.scrollY;
    const tab = location.hash.split('/')[3];
    const el = $('#tab');
    if (el) {
      ({ resumen: tabSummary, grupo: tabGroup, equipo: tabGear, fotos: tabPhotos, plan: tabPlan })[tab]?.(trip, el);
      window.scrollTo(0, y);
    }
  }
}

hooks.afterSave = () => {
  const s = syncer;
  if (!s) return;
  state.trips.filter((t) => t.syncId).forEach((t) => s.push(t).catch((e) => console.warn('Sync push', e)));
};

async function enableSync(trip) {
  const s = getSyncer();
  if (!s) throw new Error('Configura Firebase en Ajustes');
  trip.syncId ||= longId();
  saveLocal();
  await s.publish(trip);
  await s.watch(trip.syncId);
}

const inviteUrl = (trip) => `${location.origin}${location.pathname}#/unirse/${trip.syncId}`;

async function renderJoin(syncId) {
  view.innerHTML = `${header('Unirse a la salida', { back: '#/' })}<main class="wrap narrow"><section class="card" id="imp"><p class="muted">Buscando salida…</p></section></main>`;
  const box = $('#imp');
  const existing = state.trips.find((t) => t.syncId === syncId);
  if (existing) return go(`#/salida/${existing.id}/resumen`);
  const s = getSyncer();
  if (!s) {
    box.innerHTML = '<p class="alert warn">Esta instalación de Cordada no tiene la sincronización configurada. Pide a quien te invitó el link de la app correcto, o usa "Compartir link" para importar una copia.</p>';
    return;
  }
  try {
    const data = await s.exists(syncId);
    if (!data) throw new Error('La salida no existe o fue eliminada');
    box.innerHTML = `<h2>${esc(data.name)}</h2>
      <p class="muted">${esc(data.peak || '')}${data.date ? ` · ${fmtDate(data.date)}` : ''} · ${data.members.length} integrantes</p>
      <p class="small">Los cambios de equipo, grupo y plan se verán en todos los teléfonos al instante.</p>
      <button class="btn primary" id="do-join">Unirme</button>`;
    $('#do-join').addEventListener('click', async () => {
      const trip = normalize({ ...data, id: uid(), syncId, createdAt: new Date().toISOString() });
      state.trips.unshift(trip);
      saveLocal();
      await s.watch(syncId);
      history.replaceState(null, '', `#/salida/${trip.id}/grupo`);
      route();
      toast('¡Listo! Marca "Soy yo" en tu nombre o agrégate.');
    });
  } catch (err) {
    box.innerHTML = `<p class="alert warn">No se pudo abrir la salida (${esc(err.message)}).</p>`;
  }
}

// ---------- Importar desde link ----------
async function renderImport(code) {
  view.innerHTML = `${header('Importar salida', { back: '#/' })}<main class="wrap narrow"><section class="card" id="imp"><p class="muted">Leyendo salida…</p></section></main>`;
  const box = $('#imp');
  try {
    const data = await decodeTrip(code);
    const exists = getTrip(data.id);
    box.innerHTML = `<h2>${esc(data.name)}</h2>
      <p class="muted">${esc(data.peak || '')}${data.date ? ` · ${fmtDate(data.date)}` : ''} · ${data.members?.length || 0} integrantes · ${data.gear?.length || 0} ítems de equipo</p>
      ${exists ? '<p class="alert warn">Ya tienes esta salida: se actualizará con la versión del link.</p>' : ''}
      <button class="btn primary" id="do-import">${exists ? 'Actualizar salida' : 'Agregar a mis salidas'}</button>`;
    $('#do-import').addEventListener('click', () => {
      const t = importTrip(data);
      if (t.syncId && getSyncer()) syncer.watch(t.syncId).catch(() => {});
      history.replaceState(null, '', `#/salida/${t.id}/grupo`);
      route();
      toast('Salida importada. Marca quién eres en el grupo.');
    });
  } catch (err) {
    box.innerHTML = `<p class="alert warn">El link no es válido o está incompleto (${esc(err.message)}).</p>`;
  }
}

// ---------- Ajustes ----------
function renderSettings() {
  const s = state.settings;
  const club = s.club || {};
  view.innerHTML = `${header('Ajustes', { back: '#/' })}
  <main class="wrap narrow">
    <section class="card">
      <h3>Datos del club</h3>
      <p class="small muted">Se copian a cada salida nueva (puedes cambiarlos en Plan y seguridad).</p>
      <form id="club-form" class="form">
        ${ORG_FIELDS.map(([k, label, type, ph]) => `<label>${label}<input name="${k}" type="${type}" value="${esc(club[k])}" placeholder="${esc(ph || '')}"></label>`).join('')}
        <button class="btn primary" type="submit">Guardar</button>
      </form>
    </section>
    <section class="card">
      <h3>Sincronización en tiempo real</h3>
      <p class="small">${FIREBASE_CONFIG ? '✅ Esta instalación ya trae Firebase configurado.' : syncConfig() ? '✅ Firebase configurado en este dispositivo.' : 'Sin configurar: las salidas se comparten como copia (link o JSON).'}</p>
      <form id="sync-form" class="form">
        <label>Configuración de Firebase (pega el bloque <code>firebaseConfig</code>)<textarea name="firebaseConfig" rows="5" placeholder='{ apiKey: "...", authDomain: "...", projectId: "...", appId: "..." }'>${esc(typeof s.firebaseConfig === 'string' ? s.firebaseConfig : '')}</textarea></label>
        <button class="btn primary" type="submit">Guardar</button>
      </form>
      <details class="top-gap"><summary>¿Cómo se configura? (una sola vez, gratis)</summary>
        <ol class="small">
          <li>Entra a <a href="https://console.firebase.google.com/" target="_blank" rel="noopener">Firebase Console</a> → Crear proyecto (plan gratuito Spark).</li>
          <li><b>Authentication</b> → Comenzar → habilita el proveedor <b>Anónimo</b>.</li>
          <li><b>Firestore Database</b> → Crear base de datos (región <code>southamerica-west1</code>, Santiago) → en <b>Reglas</b> pega el contenido de <code>firestore.rules</code> del repositorio.</li>
          <li>Configuración del proyecto → Tus apps → <b>Web</b> → registra la app y copia el bloque <code>firebaseConfig</code>.</li>
          <li>Lo ideal: pégalo en <code>js/config.js</code> antes de publicar, así toda la cordada lo tiene. Para probar, pégalo aquí.</li>
          <li>En Authentication → Configuración → Dominios autorizados, agrega el dominio donde publicaste la app.</li>
        </ol>
      </details>
    </section>
    <section class="card">
      <h3>Google Drive</h3>
      <form id="settings-form" class="form">
        <label>OAuth Client ID (aplicación web)<input name="googleClientId" value="${esc(s.googleClientId || '')}" placeholder="1234-abc.apps.googleusercontent.com"></label>
        <label>ID de carpeta madre en Drive (opcional)<input name="driveParent" value="${esc(s.driveParent || '')}" placeholder="Si lo dejas vacío, se crea en Mi unidad"></label>
        <button class="btn primary" type="submit">Guardar</button>
      </form>
      <details class="top-gap"><summary>¿Cómo obtengo el Client ID?</summary>
        <ol class="small">
          <li>Entra a <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console</a> (puede ser el mismo proyecto de Firebase).</li>
          <li>Habilita la <b>Google Drive API</b>.</li>
          <li>En "Pantalla de consentimiento OAuth" configura la app (tipo Externo) y agrega a tu cordada como usuarios de prueba.</li>
          <li>En Credenciales → Crear → ID de cliente OAuth → <b>Aplicación web</b>. En "Orígenes autorizados de JavaScript" agrega la URL donde publicaste la app (ej. <code>${esc(location.origin)}</code>).</li>
          <li>Copia el Client ID aquí. La app solo pide permiso <code>drive.file</code>: ve únicamente lo que ella misma crea.</li>
        </ol>
      </details>
    </section>
    <section class="card">
      <h3>Datos</h3>
      <p class="small muted">Las salidas se guardan en este dispositivo (y en Firebase las que sincronizas). Respalda de vez en cuando.</p>
      <div class="link-list">
        <button class="btn" id="export-all">⬇️ Exportar todas las salidas</button>
        <label class="btn">⬆️ Importar respaldo<input type="file" accept=".json" id="import-all" hidden></label>
        <button class="btn danger" id="wipe">Borrar todo</button>
      </div>
    </section>
    <section class="card small muted">
      <p>Cordada · pronóstico <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a> (CC BY 4.0) · mapas © OpenStreetMap, OpenTopoMap, Esri · búsqueda GeoNames.</p>
      <p>El pronóstico es una ayuda y no reemplaza tu criterio en montaña.</p>
    </section>
  </main>`;
  $('#club-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings.club = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, v.trim()]));
    save();
    toast('Datos del club guardados');
  });
  $('#sync-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = e.target.firebaseConfig.value.trim();
    if (text && !parseConfig(text)) return alert('No reconozco esa configuración. Debe incluir al menos apiKey y projectId.');
    state.settings.firebaseConfig = text;
    save();
    toast(text ? 'Firebase configurado' : 'Sincronización desactivada');
    setTimeout(() => location.reload(), 600);
  });
  $('#settings-form').addEventListener('submit', (e) => {
    e.preventDefault();
    Object.assign(state.settings, Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, v.trim()])));
    save();
    toast('Ajustes guardados');
  });
  $('#export-all').addEventListener('click', () => download(`cordada-respaldo-${todayStr()}.json`, JSON.stringify({ trips: state.trips }, null, 2)));
  $('#import-all').addEventListener('change', importFromFile);
  $('#wipe').addEventListener('click', () => {
    if (confirm('¿Borrar todas las salidas de este dispositivo? No se puede deshacer.')) {
      state.trips = [];
      save();
      go('#/');
    }
  });
}

// ---------- Inicio de la app ----------
route();
if (getSyncer()) {
  state.trips.filter((t) => t.syncId).forEach((t) => syncer.watch(t.syncId).catch((e) => console.warn('Sync', e)));
}
window.addEventListener('online', () => document.body.classList.remove('offline'));
window.addEventListener('offline', () => document.body.classList.add('offline'));
if (!navigator.onLine) document.body.classList.add('offline');
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
