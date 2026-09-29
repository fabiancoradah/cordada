import { state, save, saveLocal, hooks, uid, longId, normalize, getTrip, newTrip, deleteTrip, encodeTrip, decodeTrip, importTrip } from './store.js';
import { CATEGORIES, MODULES, SCOPES, gearProgress, weightByMember, ropesOf, ropeKey, ropeOfMember } from './gear.js';
import { MODELS, fetchWeather, series, hourlyTimes, wmo, assess, externalLinks, lineChart, wireCharts } from './weather.js';
import { createMap, parseGPX, drawTrack, profileChart, wireProfile, toDMS } from './map.js';
import { searchPlaces, placeDetails, surroundings, hikingRoute } from './places.js';
import { AUTO_MODULES, MANUAL_MODULES, detect, activeModules, syncGear, autoOrganize, recommend } from './auto.js';
import * as drive from './drive.js';
import { TripSync } from './sync.js';
import { FIREBASE_CONFIG, DRIVE_CLIENT_ID } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const view = $('#view');
const ui = { day: null, mapCtrl: null, draft: null };

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

// ---------- Identidad: mi ficha, encargado ----------
const profile = () => state.settings.profile || null;
const isOwner = (trip) => !!trip.ownerId && me(trip) === trip.ownerId;
const myMember = (trip) => trip.members.find((m) => m.id === me(trip));
const ownerOf = (trip) => trip.members.find((m) => m.id === trip.ownerId);
// Quién puede recalcular datos compartidos (evita que todos los teléfonos escriban a la vez).
const canAuto = (trip) => isOwner(trip) || !trip.syncId;
const setMe = (trip, id) => { state.settings.me = { ...(state.settings.me || {}), [trip.id]: id }; };

const FICHA_FIELDS = [
  ['name', 'Nombre y apellido', 'text', '', true],
  ['phone', 'Teléfono (WhatsApp)', 'tel', '+56 9 ...', true],
  ['emergencyName', 'Contacto de emergencia', 'text', 'Nombre', true],
  ['emergencyPhone', 'Teléfono del contacto', 'tel', '', true],
  ['rut', 'RUT', 'text', '12.345.678-9'],
  ['age', 'Edad', 'number', ''],
  ['health', 'Salud (alergias, medicamentos, grupo sanguíneo)', 'text', ''],
  ['carFrom', 'Comuna o punto desde donde sales', 'text', 'Ej: Ñuñoa'],
];
const FIRST_AID = ['', 'WFR', 'WAFA', 'Primeros auxilios básicos', 'Profesional de salud'];

function fichaForm(p = {}, { compact = false } = {}) {
  const fields = compact ? FICHA_FIELDS.filter((f) => f[4]) : FICHA_FIELDS;
  return `<div class="cols2">${fields.map(([k, label, type, ph, req]) => `<label>${label}<input name="f_${k}" type="${type}" value="${esc(p[k] ?? '')}" placeholder="${esc(ph)}" ${req ? 'required' : ''}></label>`).join('')}
    ${compact ? '' : `<label>Primeros auxilios<select name="f_firstAid">${FIRST_AID.map((x) => `<option value="${esc(x)}" ${p.firstAid === x ? 'selected' : ''}>${esc(x || 'Sin certificación')}</option>`).join('')}</select></label>
    <label>¿Llevas auto? Cupos para pasajeros<input name="f_carSeats" type="number" min="0" max="8" value="${esc(p.carSeats ?? 0)}"></label>`}
  </div>`;
}
function readFicha(form) {
  const out = { ...(profile() || {}) };
  for (const el of form.querySelectorAll('[name^="f_"]')) out[el.name.slice(2)] = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value.trim();
  return out;
}
const memberFromProfile = (p) => ({ id: uid(), name: p.name, phone: p.phone, emergencyName: p.emergencyName, emergencyPhone: p.emergencyPhone, rut: p.rut || '', age: p.age || '', health: p.health || '', firstAid: p.firstAid || '', carSeats: p.carSeats || 0, carFrom: p.carFrom || '' });

// ---------- Router ----------
const TABS = [
  ['salida', 'Salida'],
  ['equipo', 'Mi equipo'],
  ['grupo', 'Grupo'],
  ['clima', 'Clima'],
  ['mapa', 'Mapa'],
  ['aviso', 'Aviso', 'owner'],
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
  if (r === 'nueva') return renderCreate();
  if (r === 'ajustes' || r === 'ficha') return renderSettings();
  if (r === 'importar') return renderImport(parts.slice(1).join('/'));
  if (r === 'unirse') return renderJoin(id);
  if (r === 'respuesta') return renderReply(parts.slice(1).join('/'));
  if (r === 'salida') {
    const trip = getTrip(id);
    if (!trip) return go('#/');
    if (tab === 'fotos') return renderTrip(trip, 'fotos');
    return renderTrip(trip, TABS.some(([t]) => t === tab) ? tab : 'salida');
  }
  return renderHome();
}
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
window.addEventListener('hashchange', route);

function header(title, { back = null, actions = '' } = {}) {
  return `<header class="topbar">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="Volver">←</a>` : '<img class="brand-mark" src="icons/icon.svg" alt="">'}
    <h1>${esc(title)}</h1>
    <div class="actions">${actions}</div>
  </header>`;
}

// ---------- Instalar la app / abrir invitaciones ----------
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
let installEvent = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e;
  $$('.install-card').forEach((el) => { el.outerHTML = installCard(); wireInstall(); });
});
window.addEventListener('appinstalled', () => { installEvent = null; $$('.install-card').forEach((el) => el.remove()); });

const dismissedInstall = () => {
  try { return Date.now() - Number(localStorage.getItem('cordada.installDismissed') || 0) < 7 * 864e5; } catch { return false; }
};


// Android: botón para instalar. En iPhone no se muestra nada (se usa desde Safari).
function installCard() {
  if (isIOS || isStandalone() || dismissedInstall() || !installEvent) return '';
  return `<section class="card install-card">
    <div class="row between"><h3>📲 Instala Cordada en tu teléfono</h3><button class="icon-btn small" id="dismiss-install" aria-label="Cerrar">×</button></div>
    <p>Queda con su ícono, se abre en pantalla completa y funciona sin señal en la montaña.</p>
    <button class="btn primary" id="do-install">Instalar</button>
  </section>`;
}

function wireInstall() {
  $('#do-install')?.addEventListener('click', async () => {
    if (!installEvent) return;
    installEvent.prompt();
    await installEvent.userChoice.catch(() => {});
    installEvent = null;
    $$('.install-card').forEach((el) => el.remove());
  });
  $('#dismiss-install')?.addEventListener('click', () => {
    try { localStorage.setItem('cordada.installDismissed', String(Date.now())); } catch { /* sin almacenamiento */ }
    $$('.install-card').forEach((el) => el.remove());
  });
}

// ---------- Inicio ----------
function renderHome() {
  const p = profile();
  const trips = [...state.trips].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const upcoming = trips.filter((t) => (t.endDate || t.date || '9999') >= todayStr());
  const past = trips.filter((t) => !upcoming.includes(t)).reverse();
  const card = (t) => {
    const mine = gearProgress(t, me(t) || null);
    return `<a class="trip-card" href="#/salida/${t.id}/salida">
      <div class="trip-thumb" ${t.info?.photo ? `style="background-image:url('${esc(t.info.photo)}')"` : ''}>${t.info?.photo ? '' : '⛰️'}</div>
      <div class="trip-body">
        <div class="trip-card-top"><h3>${esc(t.name)}</h3><span class="pill">${esc(countdown(t))}</span></div>
        <p class="muted small">${t.altitude ? `${t.altitude.toLocaleString('es-CL')} m · ` : ''}${t.date ? fmtDate(t.date) : 'Sin fecha'} · ${isOwner(t) ? 'Organizas tú' : `Organiza ${esc(firstName(ownerOf(t)?.name || '—'))}`}</p>
        <div class="progress" title="Mi equipo"><i style="width:${mine.pct}%"></i></div>
        <p class="small muted">Mi equipo: ${mine.pct}% · ${t.members.filter((m) => m.rsvp !== 'no').length} van</p>
      </div>
    </a>`;
  };
  view.innerHTML = `${header('Cordada', { actions: `<a class="icon-btn" href="#/ajustes" aria-label="Mi ficha y ajustes">${p ? esc(initials(p.name)) : '👤'}</a>` })}
  <main class="wrap">
    ${p ? '' : `<section class="card callout">
      <h2>Primero, tu ficha</h2>
      <p>Tu nombre, teléfono y contacto de emergencia se guardan una vez en este teléfono y se usan en todas tus salidas. Así nadie tiene que llenar planillas.</p>
      <a class="btn primary" href="#/ajustes">Completar mi ficha</a>
    </section>`}
    ${installCard()}
    <a class="btn primary big" href="#/nueva">＋ Organizar una salida</a>
    ${upcoming.length ? `<h2 class="section-title">Próximas salidas</h2><div class="grid">${upcoming.map(card).join('')}</div>` : `<section class="card empty">
      <h2>¿Cómo funciona?</h2>
      <ol class="steps">
        <li><b>El encargado elige el cerro y la fecha.</b> La app completa sola la altura, la ruta, el desnivel, el clima y el tipo de salida.</li>
        <li><b>Invita al grupo</b> con un link por WhatsApp.</li>
        <li><b>Cada invitado toca "Voy"</b> y recibe su lista de equipo según la salida y el pronóstico.</li>
        <li><b>El encargado organiza con un toque</b> las cordadas, los autos y quién lleva el equipo común, y envía el aviso de salida.</li>
      </ol>
    </section>`}
    ${past.length ? `<h2 class="section-title">Realizadas</h2><div class="grid">${past.map(card).join('')}</div>` : ''}
  </main>`;
  wireInstall();
}

// ---------- Organizar salida ----------
const KIND_ICON = { peak: '⛰️', volcano: '🌋', hill: '⛰️', glacier: '🧊', place: '📍' };

function renderCreate() {
  const draft = ui.draft || (ui.draft = { place: null, date: '', endDate: '', overrides: {} });
  const p = profile();
  view.innerHTML = `${header('Organizar salida', { back: '#/' })}
  <main class="wrap narrow">
    <section class="card">
      <h2>¿A qué cerro van?</h2>
      <form id="search" class="row gap">
        <input id="q" class="grow" placeholder="Ej: Cerro El Plomo, Volcán Lonquimay…" autocomplete="off" value="${esc(draft.q || '')}">
        <button class="btn primary" type="submit">Buscar</button>
      </form>
      <ul id="results" class="results"></ul>
      <div id="picked"></div>
    </section>
    <section class="card">
      <h2>¿Cuándo?</h2>
      <div class="cols2">
        <label>Desde<input type="date" id="d1" value="${esc(draft.date)}" min="${todayStr()}"></label>
        <label>Hasta (si es más de un día)<input type="date" id="d2" value="${esc(draft.endDate)}"></label>
      </div>
    </section>
    <section class="card">
      <h2>Tipo de salida</h2>
      <p class="small muted">Se detecta solo con la altura, la fecha y (al crearla) el pronóstico y los glaciares. Puedes corregirlo.</p>
      <div id="kinds" class="chips"></div>
    </section>
    ${p ? '' : `<section class="card">
      <h2>Tus datos como encargado</h2>
      <form id="ficha-mini" class="form">${fichaForm({}, { compact: true })}</form>
    </section>`}
    <button class="btn primary big" id="create">Crear salida e invitar</button>
  </main>`;

  const renderPicked = () => {
    const pl = draft.place;
    $('#picked').innerHTML = pl ? `<div class="picked">
      <span class="kind">${KIND_ICON[pl.kind] || '📍'}</span>
      <div class="grow"><b>${esc(pl.name)}</b><div class="small muted">${pl.altitude ? `${Math.round(pl.altitude).toLocaleString('es-CL')} m · ` : ''}${esc(pl.region)}</div>
      <div class="small muted">${pl.lat.toFixed(4)}, ${pl.lon.toFixed(4)} · ${esc(pl.sources.join(' + '))}</div></div>
      <button class="btn small" id="unpick">Cambiar</button></div>` : '';
    $('#unpick')?.addEventListener('click', () => { draft.place = null; renderPicked(); renderKinds(); });
  };
  const renderKinds = () => {
    const fake = { altitude: draft.place?.altitude, lat: draft.place?.lat, date: draft.date, endDate: draft.endDate, overrides: draft.overrides, info: {} };
    const det = detect(fake);
    const ids = [...AUTO_MODULES, ...MANUAL_MODULES];
    $('#kinds').innerHTML = ids.map((id) => {
      const on = draft.overrides[id] ?? !!det[id];
      return `<button type="button" class="chip toggle ${on ? 'on' : ''}" data-mod="${id}" aria-pressed="${on}" title="${esc(det[id] || '')}">${MODULES[id].icon} ${MODULES[id].label}${det[id] && draft.overrides[id] === undefined ? '<span class="auto">auto</span>' : ''}</button>`;
    }).join('');
    $$('[data-mod]').forEach((b) => b.addEventListener('click', () => {
      const id = b.dataset.mod;
      const cur = draft.overrides[id] ?? !!det[id];
      draft.overrides[id] = !cur;
      renderKinds();
    }));
  };
  $('#search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#q').value.trim();
    draft.q = q;
    if (!q) return;
    const ul = $('#results');
    ul.innerHTML = '<li class="muted small">Buscando en OpenStreetMap, Wikidata y GeoNames…</li>';
    try {
      const res = await searchPlaces(q);
      ul.innerHTML = res.length ? res.map((r, i) => `<li><button type="button" data-i="${i}"><span class="kind">${KIND_ICON[r.kind] || '📍'}</span><span class="grow"><b>${esc(r.name)}</b>${r.altitude ? ` · ${Math.round(r.altitude).toLocaleString('es-CL')} m` : ''}<span class="small muted"> ${esc(r.region)}</span></span></button></li>`).join('')
        : '<li class="muted small">Sin resultados. Prueba con otro nombre (ej. sin "cerro").</li>';
      $$('button[data-i]', ul).forEach((b) => b.addEventListener('click', () => {
        draft.place = res[b.dataset.i];
        ul.innerHTML = '';
        renderPicked();
        renderKinds();
      }));
    } catch (err) {
      ul.innerHTML = `<li class="alert warn">${esc(err.message)}. Revisa tu conexión.</li>`;
    }
  });
  $('#d1').addEventListener('change', (e) => { draft.date = e.target.value; if (draft.endDate && draft.endDate < draft.date) draft.endDate = ''; $('#d2').min = draft.date; renderKinds(); });
  $('#d2').addEventListener('change', (e) => { draft.endDate = e.target.value; renderKinds(); });
  $('#create').addEventListener('click', async () => {
    if (!draft.place) return toast('Elige el cerro o lugar');
    if (!draft.date) return toast('Elige la fecha');
    let prof = profile();
    if (!prof) {
      const f = $('#ficha-mini');
      if (!f.reportValidity()) return;
      prof = readFicha(f);
      state.settings.profile = prof;
    }
    const pl = draft.place;
    const owner = { ...memberFromProfile(prof), rsvp: 'si' };
    const trip = newTrip({
      name: pl.name,
      peak: pl.name,
      lat: +pl.lat.toFixed(6),
      lon: +pl.lon.toFixed(6),
      altitude: pl.altitude ? Math.round(pl.altitude) : null,
      date: draft.date,
      endDate: draft.endDate && draft.endDate > draft.date ? draft.endDate : '',
      overrides: { ...draft.overrides },
      info: { region: pl.region, kind: pl.kind, wikidata: pl.wikidata || null, wikipedia: pl.wikipedia || null, sources: pl.sources },
      ownerId: owner.id,
      members: [owner],
      modules: [],
    });
    trip.org.leaderId = owner.id;
    setMe(trip, owner.id);
    syncGear(trip);
    save();
    ui.draft = null;
    if (getSyncer()) enableSync(trip).catch((e) => console.warn('Sync', e));
    go(`#/salida/${trip.id}/salida`);
    enrich(trip);
  });
  renderPicked();
  renderKinds();
}

// ---------- Datos automáticos (en segundo plano) ----------
const enriching = new Set();
async function enrich(trip, { force = false } = {}) {
  if (enriching.has(trip.id) || trip.lat == null) return;
  enriching.add(trip.id);
  const refresh = () => { saveLocal(); if (location.hash.startsWith(`#/salida/${trip.id}/`)) rerenderTab(trip); };
  try {
    const tasks = [];
    // Pronóstico: local en cada teléfono.
    if (force || !trip.weather || Date.now() - new Date(trip.weather.fetchedAt) > 3 * 3600e3) {
      tasks.push(fetchWeather(trip).then((w) => { trip.weather = w; }).catch(() => {}));
    }
    if (canAuto(trip)) {
      trip.info ||= {};
      if (force || !trip.info.detailsAt) {
        tasks.push(placeDetails({ ...trip.info, lat: trip.lat, lon: trip.lon, altitude: trip.altitude }).then((d) => {
          Object.assign(trip.info, { photo: d.photo || trip.info.photo || null, description: d.description || trip.info.description || null, wikipediaUrl: d.wikipediaUrl || null, detailsAt: Date.now() });
          if (!trip.altitude && d.altitude) { trip.altitude = d.altitude; trip.info.altitudeEstimated = !!d.altitudeEstimated; }
        }).catch(() => {}));
      }
      // v2: búsqueda más completa; reintenta si antes no encontró punto de partida.
      const retry = !trip.info.start && Date.now() - (trip.info.surroundAt || trip.info.surroundErr || 0) > 10 * 60e3;
      if (force || trip.info.surroundV !== 2 || retry) {
        tasks.push(surroundings(trip.lat, trip.lon).then(async (s) => {
          Object.assign(trip.info, { glacier: s.glacier, huts: s.huts.slice(0, 5), start: s.start, surroundAt: Date.now(), surroundV: 2, surroundErr: null });
          if (s.start && (!trip.gpx || trip.gpx.auto)) {
            const r = await hikingRoute(s.start, { lat: trip.lat, lon: trip.lon, altitude: trip.altitude });
            trip.gpx = {
              name: r.source === 'brouter' ? 'Ruta sugerida por senderos' : 'Ruta estimada (línea recta)',
              auto: true,
              source: r.source,
              pts: r.pts,
              wpts: [{ lat: s.start.lat, lon: s.start.lon, ele: r.pts[0]?.ele ?? null, name: s.start.name }, { lat: trip.lat, lon: trip.lon, ele: trip.altitude, name: trip.peak }],
              stats: r.stats,
              reachesSummit: r.reachesSummit,
            };
          }
        }).catch((e) => { console.warn('Punto de partida', e); trip.info.surroundErr = Date.now(); }));
      }
    }
    await Promise.all(tasks);
    if (canAuto(trip)) syncGear(trip);
    if (isOwner(trip)) autoOrganize(trip);
    if (canAuto(trip)) save(); else saveLocal();
    refresh();
  } finally {
    enriching.delete(trip.id);
  }
}

function rerenderTab(trip) {
  const typing = document.activeElement?.matches?.('input, textarea, select');
  const tab = location.hash.split('/')[3] || 'salida';
  const el = $('#tab');
  if (!el || typing || tab === 'mapa' || tab === 'aviso') return;
  const y = window.scrollY;
  renderTrip(trip, tab);
  window.scrollTo(0, y);
}

// ---------- Vista de salida ----------
function renderTrip(trip, tab) {
  const owner = isOwner(trip);
  const tabs = TABS.filter(([, , who]) => !who || owner);
  view.innerHTML = `${header(trip.name, {
    back: '#/',
    actions: `${trip.syncId ? `<span class="icon-btn sync-dot" id="sync-dot" data-sync="${trip.syncId}"></span>` : ''}`,
  })}
  <nav class="tabs" role="tablist">
    ${tabs.map(([id, label]) => `<a role="tab" href="#/salida/${trip.id}/${id}" class="${id === tab ? 'active' : ''}" aria-selected="${id === tab}">${label}</a>`).join('')}
  </nav>
  <main class="wrap" id="tab"></main>`;
  if (trip.syncId) setDot($('#sync-dot'), syncStatus[trip.syncId]);
  const el = $('#tab');
  ({ salida: tabInfo, equipo: tabMyGear, grupo: tabGroup, clima: tabWeather, mapa: tabMap, aviso: tabPlan, fotos: tabPhotos })[tab](trip, el);
  $('.tabs .active')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (!enriching.has(trip.id)) enrich(trip);
}

const hm = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')} min`;

// --- Salida: toda la información, automática ---
function tabInfo(trip, el) {
  const owner = isOwner(trip);
  const mine = myMember(trip);
  const org = ownerOf(trip);
  const s = trip.gpx?.stats;
  const start = trip.info?.start;
  const d = trip.weather?.daily?.daily;
  const dates = tripDates(trip);
  const going = trip.members.filter((m) => m.rsvp !== 'no');
  const { ids, detected } = activeModules(trip);
  const alerts = trip.weather ? assess(trip.weather, dates) : null;
  const up = s?.up || (trip.altitude && s?.minEle != null ? trip.altitude - s.minEle : null);

  el.innerHTML = `
  <section class="hero-card" ${trip.info?.photo ? `style="--photo:url('${esc(trip.info.photo)}')"` : ''}>
    <div class="hero-inner">
      <p class="eyebrow">${esc(countdown(trip))}</p>
      <h2>${esc(trip.peak || trip.name)}</h2>
      <p>${trip.altitude ? `<b>${trip.altitude.toLocaleString('es-CL')} m s.n.m.</b>${trip.info?.altitudeEstimated ? ' (aprox.)' : ''} · ` : ''}${esc(trip.info?.region || '')}</p>
      <p>${fmtDate(trip.date, { weekday: 'long', day: 'numeric', month: 'long' })}${trip.endDate ? ` → ${fmtDate(trip.endDate, { weekday: 'long', day: 'numeric', month: 'long' })}` : ''}</p>
      <p class="small">Organiza ${esc(org?.name || '—')}${org?.phone ? ` · <a href="https://wa.me/${esc(waNumber(org.phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p>
    </div>
  </section>

  ${!owner && mine ? installCard() : ''}
  ${owner ? `<section class="card invite">
    <div class="row between wrap-row"><div><h3>Invitar al grupo</h3><p class="small muted">${going.length} van · ${trip.members.filter((m) => m.rsvp === 'no').length} no pueden</p></div>
    <button class="btn primary" id="invite">📲 Invitar por WhatsApp</button></div>
  </section>` : mine ? `<section class="card rsvp-card">
    <div class="row between wrap-row"><p>${mine.rsvp === 'no' ? '❌ Marcaste que <b>no vas</b>.' : '✅ <b>Vas a esta salida.</b>'}</p>
    <button class="btn small" id="rsvp-toggle">${mine.rsvp === 'no' ? 'Ahora sí voy' : 'Ya no puedo ir'}</button></div>
    ${!trip.syncId && org?.phone ? `<a class="btn small top-gap" id="notify-owner" target="_blank" rel="noopener">Avisar a ${esc(firstName(org.name))} por WhatsApp</a>` : ''}
  </section>` : `<section class="card rsvp-card callout">
    <h3>¿Vas a esta salida?</h3>
    ${profile() ? '' : `<form id="ficha-mini" class="form">${fichaForm({}, { compact: true })}</form>`}
    <div class="row gap top-gap"><button class="btn primary grow" id="rsvp-yes">Voy</button><button class="btn" id="rsvp-no">No puedo</button></div>
  </section>`}

  <section class="card">
    <h3>La ruta</h3>
    <dl class="stats">
      <div><dt>Cumbre</dt><dd>${trip.altitude ? `${trip.altitude.toLocaleString('es-CL')} m` : '—'}</dd></div>
      <div><dt>Desnivel</dt><dd>${up ? `${Math.round(up).toLocaleString('es-CL')} m` : '…'}</dd></div>
      <div><dt>Distancia (ida)</dt><dd>${s ? `${s.distKm.toFixed(1)} km` : '…'}</dd></div>
      <div><dt>Tiempo (ida)</dt><dd>${s ? hm(s.hours) : '…'}</dd></div>
      ${d && dates[0] && d.time.includes(dates[0]) ? `<div><dt>Luz del día</dt><dd>${fmtHour(d.sunrise[d.time.indexOf(dates[0])])}–${fmtHour(d.sunset[d.time.indexOf(dates[0])])}</dd></div>` : ''}
    </dl>
    <p class="small muted">${!trip.info?.surroundAt && trip.info?.surroundErr ? 'No se pudo consultar OpenStreetMap en este momento. Se vuelve a intentar solo al abrir la salida.'
      : !trip.info?.surroundAt || trip.info?.surroundV !== 2 ? 'Buscando punto de partida y calculando la ruta…'
      : trip.gpx?.auto ? (trip.gpx.source === 'brouter' ? `Ruta calculada sobre senderos de OpenStreetMap desde ${esc(start?.name || 'el punto de partida más cercano')}${trip.gpx.reachesSummit === false ? ' (el último tramo a la cumbre, en línea recta)' : ''}. Revísala en el Mapa: puede no ser la ruta normal.` : 'Distancia y desnivel estimados en línea recta desde el punto de partida más cercano.')
      : trip.gpx ? `Track cargado: ${esc(trip.gpx.name || '')}.` : 'No se encontró un camino cercano: carga el track GPX en el Mapa.'}
      Tiempo según Naismith (4 km/h + 1 h cada 600 m de subida), sin descansos.</p>
    <div class="link-list top-gap">
      ${start ? `<a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${start.lat},${start.lon}" target="_blank" rel="noopener">🚗 Cómo llegar a ${esc(start.name)}</a>` : ''}
      ${trip.andesUrl ? `<a class="btn" href="${esc(trip.andesUrl)}" target="_blank" rel="noopener">📖 Ruta en Andeshandbook</a>` : `<a class="btn" href="${andesSearch(trip.peak)}" target="_blank" rel="noopener">📖 Buscar en Andeshandbook</a>`}
      <a class="btn" href="https://www.google.com/search?q=${encodeURIComponent(`wikiloc ${trip.peak}`)}" target="_blank" rel="noopener">🥾 Tracks en Wikiloc</a>
      <a class="btn" href="#/salida/${trip.id}/mapa">🗺️ Ver mapa</a>
    </div>
    ${trip.info?.huts?.length ? `<p class="small top-gap">🛖 Refugios cerca: ${trip.info.huts.map((h) => esc(h.name)).join(', ')}</p>` : ''}
    ${owner ? `<form id="ah-form" class="row gap top-gap"><input name="url" type="url" class="grow" placeholder="Pega el link de la ruta en Andeshandbook (opcional)" value="${esc(trip.andesUrl || '')}"><button class="btn small" type="submit">Guardar</button></form>` : ''}
  </section>

  ${recoCard(trip, owner)}

  <section class="card">
    <div class="row between"><h3>Clima en la cumbre</h3><a href="#/salida/${trip.id}/clima">Detalle →</a></div>
    ${d ? `<div class="days compact">${dates.filter((t) => d.time.includes(t)).map((t) => {
      const i = d.time.indexOf(t);
      const [ic, desc] = wmo(d.weather_code[i]);
      return `<div class="day trip" title="${esc(desc)}"><span class="small">${fmtDayShort(t)}</span><span class="wx-icon">${ic}</span><b>${Math.round(d.temperature_2m_max[i])}° / ${Math.round(d.temperature_2m_min[i])}°</b><span class="small">💨 ${Math.round(d.wind_gusts_10m_max[i])} km/h</span><span class="small">${d.precipitation_sum[i] ? `💧 ${d.precipitation_sum[i].toFixed(1)} mm` : 'sin precipitación'}</span></div>`;
    }).join('') || '<p class="small muted">La fecha aún está fuera del pronóstico (14 días). Se completa solo cuando se acerque.</p>'}</div>` : '<p class="small muted">Descargando pronóstico…</p>'}
    ${alerts ? alertList(alerts) : ''}
  </section>

  <section class="card">
    <h3>Tipo de salida</h3>
    <div class="chips">${[...AUTO_MODULES, ...MANUAL_MODULES].filter((id) => owner || ids.includes(id)).map((id) => {
      const on = ids.includes(id);
      return owner ? `<button type="button" class="chip toggle ${on ? 'on' : ''}" data-mod="${id}" aria-pressed="${on}">${MODULES[id].icon} ${MODULES[id].label}</button>`
        : `<span class="chip on">${MODULES[id].icon} ${MODULES[id].label}</span>`;
    }).join('') || '<span class="muted small">Trekking de día</span>'}</div>
    <ul class="reasons small muted">${Object.entries(detected).filter(([id]) => id !== 'base' && ids.includes(id)).map(([id, why]) => `<li>${MODULES[id].icon} ${esc(why)}</li>`).join('')}</ul>
    <p class="small"><a href="#/salida/${trip.id}/equipo">Ver mi equipo según esta salida →</a></p>
  </section>

  ${trip.info?.description ? `<section class="card"><h3>Sobre el lugar</h3><p class="desc">${esc(trip.info.description)}</p>${trip.info.wikipediaUrl ? `<p class="small"><a href="${esc(trip.info.wikipediaUrl)}" target="_blank" rel="noopener">Wikipedia ↗</a></p>` : ''}</section>` : ''}

  <section class="card">
    <h3>Fotos de la salida</h3>
    ${trip.drive?.folderUrl ? `<a class="btn primary" href="${esc(trip.drive.folderUrl)}" target="_blank" rel="noopener">📁 Ver y subir fotos</a>` : `<p class="small muted">${owner ? 'Pega el link de una carpeta compartida de Google Drive o un álbum de Google Fotos para que todos suban sus fotos.' : 'El encargado aún no comparte una carpeta de fotos.'}</p>`}
    ${owner ? `<form id="photos-form" class="row gap top-gap"><input name="url" type="url" class="grow" placeholder="https://drive.google.com/…" value="${esc(trip.drive?.folderUrl || '')}"><button class="btn small" type="submit">Guardar</button></form>` : ''}
    ${DRIVE_CLIENT_ID ? `<p class="small top-gap"><a href="#/salida/${trip.id}/fotos">Subir directo desde la app →</a></p>` : ''}
  </section>

  <section class="card quiet">
    <div class="link-list">
      ${owner ? '<button class="btn small" id="edit-date">Cambiar fecha</button>' : ''}
      <button class="btn small" id="share-copy">Compartir copia</button>
      <button class="btn small danger" id="delete">${owner ? 'Eliminar salida' : 'Salir de esta salida'}</button>
    </div>
    <form id="date-form" class="cols2 top-gap" hidden>
      <label>Desde<input type="date" name="date" value="${esc(trip.date)}"></label>
      <label>Hasta<input type="date" name="endDate" value="${esc(trip.endDate)}"></label>
      <button class="btn primary" type="submit">Guardar fecha</button>
    </form>
  </section>`;

  $('#invite', el)?.addEventListener('click', () => invite(trip));
  wireInstall();
  $('#fit-days', el)?.addEventListener('click', () => {
    const rec = recommend(trip);
    const [y, m, dd] = trip.date.split('-').map(Number);
    trip.endDate = new Date(y, m - 1, dd + rec.days - 1).toLocaleDateString('sv-SE');
    delete trip.weather;
    syncGear(trip);
    save();
    renderTrip(trip, 'salida');
    toast(`Salida de ${rec.days} días`);
  });
  $('#rsvp-yes', el)?.addEventListener('click', () => joinTrip(trip, 'si', el));
  $('#rsvp-no', el)?.addEventListener('click', () => joinTrip(trip, 'no', el));
  $('#rsvp-toggle', el)?.addEventListener('click', () => {
    mine.rsvp = mine.rsvp === 'no' ? 'si' : 'no';
    if (isOwner(trip)) autoOrganize(trip);
    save();
    tabInfo(trip, el);
  });
  const notify = $('#notify-owner', el);
  if (notify) notify.href = replyLink(trip, mine);
  $$('[data-mod]', el).forEach((b) => b.addEventListener('click', () => {
    const id = b.dataset.mod;
    const on = !ids.includes(id);
    trip.overrides = { ...(trip.overrides || {}), [id]: on };
    syncGear(trip);
    save();
    tabInfo(trip, el);
    toast(on ? `Agregado: ${MODULES[id].label}` : `Quitado: ${MODULES[id].label}`);
  }));
  $('#ah-form', el)?.addEventListener('submit', (e) => { e.preventDefault(); trip.andesUrl = e.target.url.value.trim(); save(); toast('Link guardado'); tabInfo(trip, el); });
  $('#photos-form', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const url = e.target.url.value.trim();
    const m = url.match(/folders\/([\w-]+)/);
    trip.drive = { ...(trip.drive || {}), folderUrl: url, folderId: m ? m[1] : trip.drive?.folderId };
    save();
    toast('Carpeta guardada');
    tabInfo(trip, el);
  });
  $('#edit-date', el)?.addEventListener('click', () => { $('#date-form', el).hidden = false; });
  $('#date-form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    trip.date = e.target.date.value || trip.date;
    trip.endDate = e.target.endDate.value > trip.date ? e.target.endDate.value : '';
    delete trip.weather;
    syncGear(trip);
    save();
    renderTrip(trip, 'salida');
  });
  $('#share-copy', el).addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#/importar/${await encodeTrip(trip)}`;
    shareOrCopy({ title: trip.name, text: `Salida "${trip.name}" (copia)`, url });
  });
  $('#delete', el).addEventListener('click', () => {
    if (!confirm(owner ? `¿Eliminar "${trip.name}" de este teléfono?` : '¿Salir de esta salida? Se borra de este teléfono.')) return;
    if (!owner && mine && trip.syncId) { mine.rsvp = 'no'; save(); }
    if (trip.syncId) syncer?.unwatch(trip.syncId);
    deleteTrip(trip.id);
    go('#/');
  });
}

function recoCard(trip, owner) {
  const r = recommend(trip);
  const dates = tripDates(trip);
  const rows = [
    ['Días sugeridos', `${r.days} ${r.days === 1 ? 'día' : 'días'}${r.daysWhy.length ? ` · ${r.daysWhy.join('; ')}` : ''}`],
    r.camps?.length && ['Campamentos', r.camps.map((c) => (c.name ? `${esc(c.name)} (~${c.ele.toLocaleString('es-CL')} m)` : `~${c.ele.toLocaleString('es-CL')} m`)).join(' → ')],
    r.start && ['Día de cumbre', `salir ${r.start} · cumbre aprox. ${r.summitEta} · <b>hora límite ${r.turnaround}</b>`],
    r.effort && ['Exigencia física', r.effort],
    ['Agua por persona', `${String(r.water).replace('.', ',')} L por día de marcha · ${r.kcal} kcal/día`],
    r.keyGear.length && ['Equipo clave', r.keyGear.join(', ')],
  ].filter(Boolean);
  return `<section class="card">
    <h3>Recomendaciones</h3>
    ${!r.daysOk ? `<p class="alert warn">⚠️ La salida dura ${dates.length} ${dates.length === 1 ? 'día' : 'días'} y se recomiendan ${r.days}.${owner ? ' <button class="btn small" id="fit-days">Ajustar a ' + r.days + ' días</button>' : ''}</p>` : ''}
    ${r.late ? '<p class="alert warn">⚠️ Con el tiempo estimado se llegaría a la cumbre después de la hora límite: consideren un campamento más alto o partir antes.</p>' : ''}
    <dl class="reco">${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
    ${r.tips.length ? `<ul class="reasons small">${r.tips.map((t) => `<li>💡 ${esc(t)}</li>`).join('')}</ul>` : ''}
    <p class="small muted">Sugerencias calculadas con la altura, la ruta y la luz del día. Ajusten según la experiencia del grupo y la reseña de la ruta.</p>
  </section>`;
}

const andesSearch = (q) => `https://www.google.com/search?q=${encodeURIComponent(`site:andeshandbook.org ${q}`)}`;

// Unirse a la salida con la ficha guardada.
function joinTrip(trip, rsvp, el) {
  let prof = profile();
  if (!prof) {
    const f = $('#ficha-mini', el);
    if (f && !f.reportValidity()) return;
    prof = readFicha(f);
    state.settings.profile = prof;
  }
  let m = trip.members.find((x) => x.phone && waNumber(x.phone) === waNumber(prof.phone));
  if (m) Object.assign(m, memberFromProfile(prof), { id: m.id });
  else { m = memberFromProfile(prof); trip.members.push(m); }
  m.rsvp = rsvp;
  setMe(trip, m.id);
  save();
  toast(rsvp === 'si' ? '¡Listo! Ya tienes tu lista de equipo.' : 'Avisado: no vas.');
  if (rsvp === 'si') go(`#/salida/${trip.id}/equipo`);
  else tabInfo(trip, el);
}

// Invitación: salida sincronizada (link corto) o copia en el link.
async function invite(trip) {
  let url;
  if (getSyncer()) {
    try {
      if (!trip.syncId) await enableSync(trip);
      url = `${location.origin}${location.pathname}#/unirse/${trip.syncId}`;
    } catch (e) { console.warn(e); }
  }
  url ||= `${location.origin}${location.pathname}#/importar/${await encodeTrip(trip)}`;
  const d = trip.date ? fmtDate(trip.date, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  const text = `⛰️ ${trip.peak}${trip.altitude ? ` (${trip.altitude.toLocaleString('es-CL')} m)` : ''}${d ? `, ${d}` : ''}.\nConfirma si vas y revisa tu equipo aquí:`;
  shareOrCopy({ title: `Salida: ${trip.name}`, text, url, whatsapp: true });
}

// Sin sincronización: el invitado le manda su confirmación al encargado con un link.
function replyLink(trip, m) {
  const org = ownerOf(trip);
  const payload = btoa(unescape(encodeURIComponent(JSON.stringify({ t: trip.id, m })))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const url = `${location.origin}${location.pathname}#/respuesta/${payload}`;
  const text = `${m.rsvp === 'no' ? '❌ No puedo ir' : '✅ Voy'} a ${trip.peak}. Toca para sumarme a la lista: ${url}`;
  return `https://wa.me/${waNumber(org?.phone || '')}?text=${encodeURIComponent(text)}`;
}

function renderReply(code) {
  view.innerHTML = `${header('Confirmación', { back: '#/' })}<main class="wrap narrow"><section class="card" id="box"></section></main>`;
  const box = $('#box');
  try {
    const { t, m } = JSON.parse(decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/')))));
    const trip = getTrip(t);
    if (!trip) throw new Error('No tienes esa salida en este teléfono');
    const existing = trip.members.find((x) => x.id === m.id || (x.phone && waNumber(x.phone) === waNumber(m.phone)));
    if (existing) Object.assign(existing, m, { id: existing.id }); else trip.members.push(m);
    if (canAuto(trip)) { syncGear(trip); if (isOwner(trip)) autoOrganize(trip); }
    save();
    box.innerHTML = `<p class="alert good">✅ ${esc(m.name)} ${m.rsvp === 'no' ? 'no va' : 'va'} a ${esc(trip.name)}. Sus datos quedaron en la salida.</p><a class="btn primary top-gap" href="#/salida/${trip.id}/grupo">Ver el grupo</a>`;
  } catch (err) {
    box.innerHTML = `<p class="alert warn">${esc(err.message)}</p>`;
  }
}

// --- Mi equipo: la lista personal, automática ---
function tabMyGear(trip, el) {
  const myId = me(trip);
  const mine = myMember(trip);
  if (!mine) {
    el.innerHTML = `<section class="card"><p>Confirma que vas en la pestaña <a href="#/salida/${trip.id}/salida">Salida</a> y aquí aparecerá tu lista de equipo.</p></section>`;
    return;
  }
  const { ids, detected } = activeModules(trip);
  const myRope = ropeOfMember(trip, myId);
  const personal = trip.gear.filter((g) => g.scope === 'p' && (!g.owner || g.owner === myId));
  const wx = personal.filter((g) => g.mod === 'wx');
  const rest = personal.filter((g) => g.mod !== 'wx');
  const carry = trip.gear.filter((g) => (g.scope === 'g' && g.assignee === myId) || (g.scope === 'c' && myRope && g.carriers?.[myRope.id] === myId));
  const isDone = (g) => (g.scope === 'p' ? !!g.checks?.[myId] : g.scope === 'c' ? !!g.checks?.[ropeKey(myRope)] : !!g.checked);
  const all = [...personal, ...carry];
  const done = all.filter(isDone).length;
  const pct = all.length ? Math.round((done / all.length) * 100) : 0;
  const weight = all.reduce((a, g) => a + (Number(g.weight) || 0), 0);
  const byCat = {};
  rest.forEach((g) => { (byCat[g.cat] ||= []).push(g); });
  const row = (g) => `<li class="gear ${isDone(g) ? 'done' : ''}">
    <label class="gear-check"><input type="checkbox" data-id="${g.id}" ${isDone(g) ? 'checked' : ''}>
    <span class="grow"><span class="gname">${esc(g.name)}</span>${g.reason ? `<span class="small muted"> · ${esc(g.reason)}</span>` : ''}</span></label>
    ${g.owner === myId ? `<button class="icon-btn small" data-del="${g.id}" aria-label="Quitar">×</button>` : ''}
  </li>`;

  el.innerHTML = `
  <section class="card sticky-summary">
    <div class="row between"><b>Mi equipo · ${done}/${all.length}</b><b>${pct}%</b></div>
    <div class="progress big"><i style="width:${pct}%"></i></div>
    <p class="small muted">Armado para: ${ids.filter((i) => i !== 'base').map((i) => `${MODULES[i].icon} ${MODULES[i].label}`).join(' · ') || '🥾 Trekking de día'} · peso aprox. ${kg(weight)}</p>
  </section>
  ${carry.length ? `<section class="card highlight"><h3>Te toca llevar para el grupo</h3><ul class="gear-list">${carry.map((g) => row({ ...g, reason: g.scope === 'c' ? `para ${myRope?.name || 'tu cordada'}` : 'para todos' })).join('')}</ul></section>` : ''}
  ${wx.length ? `<section class="card"><h3>🌦️ Por el pronóstico</h3><ul class="gear-list">${wx.map(row).join('')}</ul></section>` : ''}
  ${CATEGORIES.filter((c) => byCat[c]).map((c) => `<section class="card"><h3>${esc(c)}</h3><ul class="gear-list">${byCat[c].map(row).join('')}</ul></section>`).join('')}
  <section class="card">
    <h3>Agregar algo mío</h3>
    <form id="add-mine" class="row gap"><input name="name" class="grow" required placeholder="Ej: Cargador solar"><button class="btn" type="submit">Agregar</button></form>
    ${Object.keys(detected).length ? '' : ''}
  </section>`;

  el.onchange = (e) => {
    const id = e.target.dataset.id;
    if (!id) return;
    const g = trip.gear.find((x) => x.id === id);
    if (g.scope === 'p') g.checks = { ...(g.checks || {}), [myId]: e.target.checked };
    else if (g.scope === 'c') g.checks = { ...(g.checks || {}), [ropeKey(myRope)]: e.target.checked };
    else g.checked = e.target.checked;
    save();
    const y = window.scrollY;
    tabMyGear(trip, el);
    window.scrollTo(0, y);
  };
  el.onclick = (e) => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    trip.gear = trip.gear.filter((g) => g.id !== b.dataset.del);
    save();
    tabMyGear(trip, el);
  };
  $('#add-mine', el).addEventListener('submit', (e) => {
    e.preventDefault();
    trip.gear.push({ id: uid(), name: e.target.name.value.trim(), cat: 'Otros', scope: 'p', weight: 0, checks: {}, mod: 'custom', owner: myId });
    save();
    tabMyGear(trip, el);
  });
}

// --- Grupo: quién va, cordadas, autos y reparto (automático) ---
function tabGroup(trip, el) {
  const owner = isOwner(trip);
  const going = trip.members.filter((m) => m.rsvp !== 'no');
  const notGoing = trip.members.filter((m) => m.rsvp === 'no');
  const name = (id) => trip.members.find((m) => m.id === id)?.name || '—';
  const groupGear = trip.gear.filter((g) => g.scope === 'g');
  const ropeGear = trip.gear.filter((g) => g.scope === 'c');
  const ropes = ropesOf(trip);

  el.innerHTML = `
  ${owner ? `<section class="card callout">
    <div class="row between wrap-row"><div><h3>${trip.manualOrg ? 'Organización manual' : 'Se organiza solo'}</h3>
    <p class="small muted">${trip.manualOrg ? 'Cambiaste asignaciones a mano, así que la app ya no reorganiza sola.' : 'Cada vez que alguien confirma, la app arma las cordadas, reparte el equipo común equilibrando el peso y asigna los autos según los cupos de cada ficha.'}</p></div>
    <button class="btn ${trip.manualOrg ? 'primary' : ''}" id="auto-org">⚡ ${trip.manualOrg ? 'Volver a automático' : 'Reorganizar ahora'}</button></div>
  </section>
  <section class="card"><h3>Revisión de seguridad</h3>${alertList(safetyChecks(trip))}</section>` : ''}

  <section class="card">
    <h3>Van (${going.length})</h3>
    <ul class="members">${going.map((m) => {
      const p = gearProgress(trip, m.id);
      return `<li>
        <span class="avatar">${esc(initials(m.name))}</span>
        <div class="grow">
          <b>${esc(m.name)}</b>${m.id === trip.ownerId ? ' <span class="pill accent">encargado/a</span>' : ''}${m.id === me(trip) ? ' <span class="pill">tú</span>' : ''}
          <div class="tags">${m.firstAid ? `<span class="tag good">🩹 ${esc(m.firstAid)}</span>` : ''}${m.knowsRoute ? '<span class="tag good">🧭 conoce la ruta</span>' : ''}${Number(m.carSeats) > 0 ? `<span class="tag">🚗 ${m.carSeats} cupos</span>` : ''}${m.emergencyName || m.emergency ? '' : '<span class="tag warn">sin contacto de emergencia</span>'}</div>
          <div class="progress"><i style="width:${p.pct}%"></i></div>
          <div class="small muted">Equipo ${p.pct}%${m.phone ? ` · <a href="https://wa.me/${esc(waNumber(m.phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</div>
        </div>
        ${owner ? `<label class="small check"><input type="checkbox" data-knows="${m.id}" ${m.knowsRoute ? 'checked' : ''}>conoce ruta</label>` : ''}
      </li>`;
    }).join('')}</ul>
    ${notGoing.length ? `<p class="small muted top-gap">No van: ${notGoing.map((m) => esc(m.name)).join(', ')}</p>` : ''}
    ${owner ? `<details class="top-gap"><summary>Agregar a alguien sin la app</summary>
      <form id="add-member" class="form top-gap">${FICHA_FIELDS.filter((f) => f[4]).map(([k, label, type]) => `<label>${label}<input name="${k}" type="${type}"></label>`).join('')}<button class="btn" type="submit">Agregar</button></form>
    </details>` : ''}
  </section>

  ${trip.ropes.length ? `<section class="card"><h3>Cordadas</h3><ul class="ropes">${trip.ropes.map((r) => `<li><b>${esc(r.name)}</b><span class="grow small">${r.memberIds.map((id) => esc(name(id))).join(', ')}</span></li>`).join('')}</ul></section>` : ''}

  ${trip.cars.length ? `<section class="card"><h3>Autos</h3><ul class="cars">${trip.cars.map((c) => `<li>
    <div class="row between"><b>🚗 ${esc(name(c.driverId))}</b><span class="pill ${c.passengerIds.length > c.seats ? 'bad' : ''}">${c.passengerIds.length}/${c.seats}</span></div>
    <div class="small muted">${c.from ? `Sale desde ${esc(c.from)}` : ''}</div>
    <div class="small">${c.passengerIds.map((id) => esc(name(id))).join(', ') || 'Sin pasajeros'}</div></li>`).join('')}</ul></section>` : ''}

  ${groupGear.length || ropeGear.length ? `<section class="card"><h3>Equipo común</h3>
    <ul class="gear-list">${groupGear.map((g) => `<li class="gear ${g.checked ? 'done' : ''}"><span class="grow"><span class="gname">${esc(g.name)}</span></span>
      ${owner ? `<select data-assign="${g.id}"><option value="">Sin asignar</option>${going.map((m) => `<option value="${m.id}" ${g.assignee === m.id ? 'selected' : ''}>${esc(firstName(m.name))}</option>`).join('')}</select>` : `<span class="small">${g.assignee ? esc(firstName(name(g.assignee))) : '<span class="muted">sin asignar</span>'}</span>`}</li>`).join('')}
    ${ropeGear.map((g) => `<li class="gear"><span class="grow"><span class="gname">${esc(g.name)}</span><span class="small muted"> · una por cordada</span></span>
      <span class="small">${ropes.map((r) => `${trip.ropes.length ? `${esc(ropeLabel(r))}: ` : ''}${g.carriers?.[r.id] ? esc(firstName(name(g.carriers[r.id]))) : '—'}${g.checks?.[ropeKey(r)] ? ' ✓' : ''}`).join(' · ')}</span></li>`).join('')}</ul>
  </section>` : ''}`;

  $('#auto-org', el)?.addEventListener('click', () => {
    autoOrganize(trip, { force: true });
    save();
    tabGroup(trip, el);
    toast('Grupo organizado');
  });
  $$('[data-knows]', el).forEach((c) => c.addEventListener('change', () => {
    trip.members.find((m) => m.id === c.dataset.knows).knowsRoute = c.checked;
    autoOrganize(trip);
    save();
    tabGroup(trip, el);
  }));
  $$('[data-assign]', el).forEach((s) => s.addEventListener('change', () => {
    trip.gear.find((g) => g.id === s.dataset.assign).assignee = s.value;
    trip.manualOrg = true;
    save();
  }));
  $('#add-member', el)?.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    trip.members.push({ ...memberFromProfile(f), rsvp: 'si' });
    autoOrganize(trip);
    save();
    tabGroup(trip, el);
  });
}

async function shareOrCopy({ title, text, url, whatsapp = false }) {
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  if (whatsapp) {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url || ''}`)}`, '_blank', 'noopener');
    return;
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

const firstName = (n) => String(n || '').split(/\s+/)[0];

const memberName = (trip, id) => trip.members.find((m) => m.id === id)?.name || '—';

const waNumber = (phone) => {
  let d = String(phone).replace(/\D/g, '');
  if (d.length === 9 && d.startsWith('9')) d = `56${d}`; // celular chileno sin código de país
  return d;
};
const emergencyOf = (m) => [m.emergencyName || m.emergency, m.emergencyPhone].filter(Boolean).join(' · ');

// Revisión de seguridad a partir de los datos del grupo.
function safetyChecks(trip) {
  const out = [];
  const ms = trip.members.filter((m) => m.rsvp !== 'no');
  if (!ms.length) return out;
  if (!ms.some((m) => m.knowsRoute)) out.push({ level: 'warn', text: 'Nadie conoce el sector ni la ruta: lleven track GPX y reseña, y estudien la ruta antes.' });
  if (!ms.some((m) => m.firstAid)) out.push({ level: 'warn', text: 'Nadie tiene certificación de primeros auxilios en terreno (WFR/WAFA).' });
  const noEm = ms.filter((m) => !m.emergencyName && !m.emergency);
  if (noEm.length) out.push({ level: 'warn', text: `Sin contacto de emergencia: ${noEm.map((m) => firstName(m.name)).join(', ')}.` });
  if (trip.cars.length) {
    const inCar = new Set(trip.cars.flatMap((c) => [c.driverId, ...c.passengerIds]));
    const noCar = ms.filter((m) => m.rsvp !== 'no').filter((m) => !inCar.has(m.id));
    if (noCar.length) out.push({ level: 'warn', text: `Sin auto asignado: ${noCar.map((m) => firstName(m.name)).join(', ')}.` });
    trip.cars.filter((c) => c.passengerIds.length > c.seats).forEach((c) => out.push({ level: 'danger', text: `El auto de ${firstName(memberName(trip, c.driverId))} lleva más pasajeros que cupos.` }));
  }
  if (!trip.plan?.return && !trip.plan?.alarm) out.push({ level: 'info', text: 'Define la hora de regreso y la hora de alarma en la pestaña Aviso.' });
  if (!out.length) out.push({ level: 'good', text: 'Grupo completo: jefe/a de salida, contactos de emergencia, primeros auxilios y ruta conocida.' });
  return out;
}

// --- Clima ---
function tabWeather(trip, el) {
  if (trip.lat == null) {
    el.innerHTML = '<section class="card"><p>La salida no tiene ubicación.</p></section>';
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
      if (canAuto(trip)) { syncGear(trip); save(); } else saveLocal();
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
      ${isOwner(trip) ? '<button class="btn" id="pick">📍 Corregir cumbre</button>' : ''}
      <button class="btn" id="locate">🎯 Mi ubicación</button>
      ${isOwner(trip) || !trip.syncId ? '<label class="btn">🗂️ Cargar mi GPX<input type="file" id="gpx-file" accept=".gpx,application/gpx+xml" hidden></label>' : ''}
      ${trip.gpx ? '<button class="btn" id="gpx-dl">⬇️ Descargar GPX</button>' : ''}
    </div>
    <p class="small muted" id="coords">${trip.lat != null ? `Objetivo: ${trip.lat.toFixed(5)}, ${trip.lon.toFixed(5)} · ${toDMS(trip.lat, 'N', 'S')} ${toDMS(trip.lon, 'E', 'O')}` : 'Sin objetivo fijado.'}</p>
  </section>
  ${s ? `<section class="card">
    <h3>${esc(trip.gpx.name || 'Track')}</h3>
    ${trip.gpx.auto ? '<p class="small muted">Calculada automáticamente. Si tienes el track real (Andeshandbook, Wikiloc), cárgalo y reemplaza este.</p>' : ''}
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
  </section>` : `<section class="card"><p class="muted">${trip.info?.surroundAt ? 'No se encontró un camino cercano para calcular la ruta. Carga el track GPX (Andeshandbook, Wikiloc, tu GPS).' : 'Calculando la ruta…'}</p></section>`}`;

  const setTarget = (lat, lon, altitude) => {
    trip.lat = +lat.toFixed(6);
    trip.lon = +lon.toFixed(6);
    if (altitude != null) trip.altitude = Math.round(altitude);
    delete trip.weather;
    if (trip.info) delete trip.info.surroundAt;
    if (trip.gpx?.auto) trip.gpx = null;
    save();
    enrich(trip);
    $('#coords', el).textContent = `Objetivo: ${trip.lat.toFixed(5)}, ${trip.lon.toFixed(5)} · ${toDMS(trip.lat, 'N', 'S')} ${toDMS(trip.lon, 'E', 'O')}`;
    toast('Objetivo actualizado');
  };
  const ctrl = createMap($('#map', el), { lat: trip.lat, lon: trip.lon, onPick: (la, lo) => setTarget(la, lo) });
  ui.mapCtrl = ctrl;
  let hoverMarker = null;
  if (ctrl && trip.gpx) drawTrack(ctrl, trip.gpx);

  $('#pick', el)?.addEventListener('click', () => { ctrl?.pickMode(true); toast('Toca el mapa para fijar el objetivo'); });
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
  $('#gpx-file', el)?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const g = parseGPX(await file.text());
      trip.gpx = { name: g.name || file.name.replace(/\.gpx$/i, ''), pts: g.pts, wpts: g.wpts, stats: g.stats };
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
  const clientId = DRIVE_CLIENT_ID;
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
      <p class="small muted">Pega el link de una carpeta compartida de Drive y usa "Enviar a Drive" desde el teléfono.</p>`}
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
      const f = await drive.createFolder(`Cordada · ${trip.name}${trip.date ? ` · ${trip.date}` : ''}`, undefined);
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
    (p.start || trip.info?.start?.name) && `Acceso: ${p.start || trip.info.start.name}${trip.info?.start ? ` (https://www.google.com/maps?q=${trip.info.start.lat},${trip.info.start.lon})` : ''}`,
    trip.gpx?.stats && `Ruta: ${trip.gpx.stats.distKm.toFixed(1)} km ida, ${trip.gpx.stats.up} m de desnivel`,
    p.route && `Ruta escogida: ${p.route}`,
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
  const rec = recommend(trip);
  if (!p.turnaround && rec.turnaround) p.turnaround = rec.turnaround;
  // Datos del club por defecto (Mi ficha → Club).
  Object.entries(state.settings.club || {}).forEach(([k, v]) => { if (!o[k] && v) o[k] = v; });
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
  // El encargado reorganiza cuando alguien se suma o cambia su respuesta.
  if (isOwner(trip) && autoOrganize(trip)) save(); else saveLocal();
  if (location.hash.startsWith(`#/salida/${trip.id}/`)) rerenderTab(trip);
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
    box.innerHTML = '<p class="alert warn">Esta versión de la app no tiene la sincronización activa. Pide a quien te invitó que te reenvíe el link.</p>';
    return;
  }
  try {
    const data = await s.exists(syncId);
    if (!data) throw new Error('La salida no existe o fue eliminada');
    box.innerHTML = `<h2>${esc(data.name)}</h2>
      <p class="muted">${esc(data.peak || '')}${data.date ? ` · ${fmtDate(data.date)}` : ''} · ${data.members.length} integrantes</p>
      <button class="btn primary" id="do-join">Ver la salida</button>`;
    $('#do-join').addEventListener('click', async () => {
      const trip = normalize({ ...data, id: uid(), syncId, createdAt: new Date().toISOString() });
      state.trips.unshift(trip);
      saveLocal();
      await s.watch(syncId);
      history.replaceState(null, '', `#/salida/${trip.id}/salida`);
      route();
    });
  } catch (err) {
    box.innerHTML = `<p class="alert warn">No se pudo abrir la salida (${esc(err.message)}).</p>`;
  }
}

// ---------- Abrir una invitación (copia en el link) ----------
async function renderImport(code) {
  view.innerHTML = `${header('Invitación', { back: '#/' })}<main class="wrap narrow"><section class="card" id="imp"><p class="muted">Abriendo la salida…</p></section></main>`;
  const box = $('#imp');
  try {
    const data = await decodeTrip(code);
    const trip = importTrip(data);
    history.replaceState(null, '', `#/salida/${trip.id}/salida`);
    route();
  } catch (err) {
    box.innerHTML = `<p class="alert warn">El link no es válido o está incompleto (${esc(err.message)}). Pide que te lo reenvíen.</p>`;
  }
}

// ---------- Mi ficha y ajustes ----------
function renderSettings() {
  const p = profile() || {};
  const club = state.settings.club || {};
  view.innerHTML = `${header('Mi ficha', { back: '#/' })}
  <main class="wrap narrow">
    <section class="card">
      <h2>Mi ficha</h2>
      <p class="small muted">Se guarda solo en este teléfono y se comparte con el grupo de cada salida a la que vas (para el aviso de salida y emergencias).</p>
      <form id="ficha" class="form">
        ${fichaForm(p)}
        <button class="btn primary" type="submit">Guardar mi ficha</button>
      </form>
    </section>
    <section class="card">
      <h2>Club (para el aviso de salida)</h2>
      <p class="small muted">Si organizas salidas de un club, estos datos se agregan solos al aviso.</p>
      <form id="club-form" class="form">
        ${ORG_FIELDS.map(([k, label, type, ph]) => `<label>${label}<input name="${k}" type="${type}" value="${esc(club[k])}" placeholder="${esc(ph || '')}"></label>`).join('')}
        <button class="btn" type="submit">Guardar club</button>
      </form>
    </section>
    <section class="card">
      <h2>Respaldo</h2>
      <div class="link-list">
        <button class="btn" id="export-all">Exportar mis salidas</button>
        <label class="btn">Importar respaldo<input type="file" accept=".json" id="import-all" hidden></label>
      </div>
      <p class="small muted top-gap">${getSyncer() ? '🟢 Sincronización en tiempo real activa.' : 'Sin sincronización: cada teléfono guarda su copia y las confirmaciones llegan por WhatsApp.'}</p>
    </section>
    <p class="small muted center">Datos: OpenStreetMap, Wikidata, Wikipedia, Open-Meteo (CC BY 4.0), BRouter. El pronóstico y las rutas calculadas son una ayuda y no reemplazan tu criterio en montaña.</p>
  </main>`;
  $('#ficha').addEventListener('submit', (e) => {
    e.preventDefault();
    const prof = readFicha(e.target);
    state.settings.profile = prof;
    // Actualiza mis datos en las salidas donde participo.
    state.trips.forEach((t) => {
      const m = t.members.find((x) => x.id === me(t));
      if (m) Object.assign(m, memberFromProfile(prof), { id: m.id, rsvp: m.rsvp, knowsRoute: m.knowsRoute });
    });
    save();
    toast('Ficha guardada');
    go('#/');
  });
  $('#club-form').addEventListener('submit', (e) => {
    e.preventDefault();
    state.settings.club = Object.fromEntries([...new FormData(e.target)].map(([k, v]) => [k, v.trim()]));
    save();
    toast('Datos del club guardados');
  });
  $('#export-all').addEventListener('click', () => download(`cordada-respaldo-${todayStr()}.json`, JSON.stringify({ trips: state.trips, profile: state.settings.profile }, null, 2)));
  $('#import-all').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      (data.trips || [data]).forEach(importTrip);
      if (data.profile && !profile()) state.settings.profile = data.profile;
      save();
      toast('Respaldo importado');
      go('#/');
    } catch (err) {
      alert(`No se pudo importar: ${err.message}`);
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
