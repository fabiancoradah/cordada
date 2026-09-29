// Automatización: tipo de salida, equipo según el pronóstico y reparto del grupo.
import { MODULES, makeItem } from './gear.js';
import { MODELS, series, hourlyTimes } from './weather.js';
import { uid } from './store.js';

// Módulos que la app puede decidir sola; el resto lo marca el encargado.
export const AUTO_MODULES = ['camp', 'winter', 'alpine', 'glacier'];
export const MANUAL_MODULES = ['rock', 'ice', 'ski', 'photo'];

const month = (d) => Number(d.slice(5, 7));

// Resumen del pronóstico para las fechas de la salida (peor caso entre modelos).
export function weatherFacts(trip) {
  const w = trip.weather;
  if (!w) return null;
  const dates = tripDateList(trip);
  const times = hourlyTimes(w);
  const idx = times.map((t, i) => (dates.includes(t.slice(0, 10)) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return null;
  const pick = (v) => MODELS.flatMap((m) => idx.map((i) => series(w, m.id, v)[i])).filter((x) => x != null);
  const sum = (v) => Math.max(0, ...MODELS.map((m) => idx.reduce((a, i) => a + (series(w, m.id, v)[i] || 0), 0)));
  return {
    tmin: Math.min(...pick('temperature_2m')),
    tmax: Math.max(...pick('temperature_2m')),
    feels: Math.min(...pick('apparent_temperature')),
    gust: Math.max(0, ...pick('wind_gusts_10m')),
    precip: sum('precipitation'),
    snow: sum('snowfall'),
    fzMin: Math.min(...pick('freezing_level_height')),
  };
}

export function tripDateList(trip) {
  if (!trip.date) return [];
  const out = [];
  const [y, m, d] = trip.date.split('-').map(Number);
  const cur = new Date(y, m - 1, d);
  const end = trip.endDate && trip.endDate > trip.date ? trip.endDate : trip.date;
  while (out.length < 21) {
    const s = cur.toLocaleDateString('sv-SE');
    out.push(s);
    if (s >= end) break;
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

// Decide el tipo de salida con los datos disponibles. Devuelve {moduleId: motivo}.
export function detect(trip) {
  const out = { base: 'Siempre' };
  const days = tripDateList(trip).length;
  if (days > 1) out.camp = `Salida de ${days} días`;
  const alt = trip.altitude || 0;
  const south = (trip.lat ?? -33) < 0;
  if (trip.date) {
    const m = month(trip.date);
    const winterMonths = south ? [5, 6, 7, 8, 9] : [11, 12, 1, 2, 3];
    if (winterMonths.includes(m) && alt >= 1500) out.winter = 'Temporada invernal en montaña';
  }
  const f = weatherFacts(trip);
  if (f) {
    if (f.snow >= 1) out.winter = `Pronóstico con nieve (${Math.round(f.snow)} cm)`;
    else if (f.feels <= -10 && !out.winter) out.winter = `Sensación térmica de ${Math.round(f.feels)} °C`;
    if (alt && f.fzMin < alt - 200 && alt >= 3000) out.alpine = `Isoterma 0° bajo la cumbre (${Math.round(f.fzMin)} m): nieve dura o hielo`;
  }
  if (alt >= 4000) out.alpine = `Sobre ${(4000).toLocaleString('es-CL')} m de altura`;
  else if (alt >= 3000 && out.winter && !out.alpine) out.alpine = 'Altura con nieve';
  if (trip.info?.glacier && alt >= 3000) out.glacier = 'Hay glaciares a menos de 3 km de la cumbre';
  return out;
}

// Módulos activos = detectados + los que el encargado forzó (on/off).
export function activeModules(trip) {
  const det = detect(trip);
  const ov = trip.overrides || {};
  const ids = new Set(Object.keys(det));
  Object.entries(ov).forEach(([id, on]) => { if (on) ids.add(id); else ids.delete(id); });
  ids.add('base');
  return { ids: [...ids], detected: det };
}

// Equipo extra según el pronóstico.
export function weatherGear(trip) {
  const f = weatherFacts(trip);
  if (!f) return [];
  const out = [];
  const add = (name, cat, reason, weight = 0) => out.push({ name, cat, reason, weight });
  if (f.feels <= -10) {
    add('Mitones de pluma o sintéticos', 'Ropa', `sensación de ${Math.round(f.feels)} °C`, 200);
    add('Calentadores de manos y pies', 'Ropa', `sensación de ${Math.round(f.feels)} °C`, 60);
  }
  if (f.feels <= -5) add('Chaqueta de pluma', 'Ropa', `sensación de ${Math.round(f.feels)} °C`, 600);
  if (f.precip >= 1) {
    add('Cubremochila impermeable', 'Mochila y calzado', `${f.precip.toFixed(1)} mm de precipitación`, 100);
    add('Pantalón impermeable', 'Ropa', `${f.precip.toFixed(1)} mm de precipitación`, 350);
  }
  if (f.snow >= 1) add('Polainas', 'Ropa', `${Math.round(f.snow)} cm de nieve`, 250);
  if (f.gust >= 45) {
    add('Antiparras / máscara de viento', 'Ropa', `rachas de ${Math.round(f.gust)} km/h`, 150);
    add('Buff o balaclava', 'Ropa', `rachas de ${Math.round(f.gust)} km/h`, 80);
  }
  if (f.tmax >= 26) add('Agua extra (3 L en total) y sales de hidratación', 'Cocina y agua', `máxima de ${Math.round(f.tmax)} °C`, 1000);
  return out;
}

// Clave para no repetir ítems parecidos ("Buff o balaclava" = "Buff / balaclava").
const STOP = new Set(['de', 'del', 'la', 'el', 'o', 'y', 'con', 'para', 'por', 'en', 'x2', 'x3']);
const UNIQUE = { termo: 'termo', buff: 'buff', polainas: 'polainas', casco: 'casco', arnes: 'arnes', crampones: 'crampones', piolet: 'piolet', mitones: 'mitones', raquetas: 'raquetas', bastones: 'bastones', carpa: 'carpa', cocinilla: 'cocinilla', aislante: 'aislante', antiparras: 'antiparras', linterna: 'frontal', frontal: 'frontal', calentadores: 'calentadores' };
const key = (s) => {
  const words = s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w) && !/^\d/.test(w));
  return UNIQUE[words[0]] || words.slice(0, 2).join(' ');
};

// Sincroniza la lista de equipo con el tipo de salida y el pronóstico,
// sin tocar lo que alguien ya marcó ni los ítems agregados a mano.
export function syncGear(trip) {
  const { ids } = activeModules(trip);
  const used = (g) => g.checked || Object.values(g.checks || {}).some(Boolean) || g.assignee;
  // Quitar ítems automáticos de módulos que ya no aplican (si nadie los marcó).
  trip.gear = trip.gear.filter((g) => !g.mod || g.mod === 'custom' || (g.mod === 'wx' ? true : ids.includes(g.mod)) || used(g));
  const names = new Set(trip.gear.map((g) => key(g.name)));
  for (const id of ids) {
    for (const [name, cat, scope, weight] of MODULES[id]?.items || []) {
      if (names.has(key(name))) continue;
      names.add(key(name));
      trip.gear.push({ ...makeItem(name, cat, scope, weight), mod: id });
    }
  }
  // Pronóstico: reemplaza las sugerencias anteriores no marcadas.
  const wx = weatherGear(trip);
  trip.gear = trip.gear.filter((g) => g.mod !== 'wx' || used(g) || wx.some((x) => key(x.name) === key(g.name)));
  const names2 = new Set(trip.gear.map((g) => key(g.name)));
  for (const x of wx) {
    const existing = trip.gear.find((g) => g.mod === 'wx' && key(g.name) === key(x.name));
    if (existing) { existing.reason = x.reason; continue; }
    if (names2.has(key(x.name))) continue;
    trip.gear.push({ ...makeItem(x.name, x.cat, 'p', x.weight), mod: 'wx', reason: x.reason });
  }
  trip.modules = ids;
}

// ---------- Organización automática del grupo ----------

const going = (trip) => trip.members.filter((m) => m.rsvp !== 'no');

// Cordadas de 2 o 3 (una carpa cada una en salidas con campamento).
export function autoRopes(trip) {
  const ms = going(trip);
  if (ms.length < 3) { trip.ropes = []; return; }
  const size = trip.modules.includes('camp') ? 3 : 2;
  const n = Math.max(1, Math.ceil(ms.length / size));
  // Repartir primero a quienes tienen primeros auxilios y conocen la ruta.
  const sorted = [...ms].sort((a, b) => (b.firstAid ? 2 : 0) + (b.knowsRoute ? 1 : 0) - ((a.firstAid ? 2 : 0) + (a.knowsRoute ? 1 : 0)));
  const ropes = Array.from({ length: n }, (_, i) => ({ id: trip.ropes[i]?.id || uid(), name: `Cordada ${i + 1}`, memberIds: [] }));
  sorted.forEach((m, i) => {
    const round = Math.floor(i / n);
    const idx = round % 2 === 0 ? i % n : n - 1 - (i % n); // serpentina
    ropes[idx].memberIds.push(m.id);
  });
  trip.ropes = ropes;
}

// Reparte el equipo grupal y el de cada cordada equilibrando el peso.
export function autoAssign(trip) {
  const ms = going(trip);
  if (!ms.length) return;
  const load = Object.fromEntries(ms.map((m) => [m.id, 0]));
  const lightest = (ids) => ids.reduce((a, b) => (load[b] < load[a] ? b : a));
  const byWeight = (a, b) => (b.weight || 0) - (a.weight || 0);
  // Cada ítem pesa al menos 150 g en el reparto, para no darle todo lo liviano a una persona.
  const cost = (g) => Math.max(150, g.weight || 0);
  trip.gear.filter((g) => g.scope === 'g').sort(byWeight).forEach((g) => {
    // Permisos y documentos: los lleva el encargado.
    g.assignee = g.cat === 'Documentos y permisos' && load[trip.ownerId] != null ? trip.ownerId : lightest(ms.map((m) => m.id));
    load[g.assignee] += cost(g);
  });
  const ropes = trip.ropes.length ? trip.ropes : [{ id: 'all', memberIds: ms.map((m) => m.id) }];
  trip.gear.filter((g) => g.scope === 'c').sort(byWeight).forEach((g) => {
    g.carriers = {};
    ropes.forEach((r) => {
      const ids = r.memberIds.filter((id) => load[id] != null);
      if (!ids.length) return;
      const who = lightest(ids);
      g.carriers[r.id] = who;
      load[who] += cost(g);
    });
  });
}

// Organiza todo cuando cambia quién va (solo en el teléfono del encargado,
// y mientras no haya hecho cambios a mano).
export function autoOrganize(trip, { force = false } = {}) {
  const sig = going(trip).map((m) => `${m.id}:${m.carSeats || 0}:${m.firstAid ? 1 : 0}:${m.knowsRoute ? 1 : 0}`).sort().join('|') + `#${trip.gear.length}#${trip.modules.join(',')}`;
  if (!force && (trip.manualOrg || trip.orgSig === sig)) return false;
  autoRopes(trip);
  autoAssign(trip);
  autoCars(trip);
  trip.orgSig = sig;
  if (force) trip.manualOrg = false;
  return true;
}

// Autos: los que tienen auto manejan; el resto se reparte según cupos.
export function autoCars(trip) {
  const ms = going(trip);
  const drivers = ms.filter((m) => Number(m.carSeats) > 0);
  if (!drivers.length) return;
  const old = Object.fromEntries(trip.cars.map((c) => [c.driverId, c]));
  trip.cars = drivers.map((d) => ({ id: old[d.id]?.id || uid(), driverId: d.id, seats: Number(d.carSeats), from: d.carFrom || '', time: old[d.id]?.time || '', plate: old[d.id]?.plate || '', passengerIds: [] }));
  const riders = ms.filter((m) => !drivers.includes(m));
  for (const r of riders) {
    // Primero el auto que sale desde la misma comuna/lugar, luego el con más espacio.
    const free = trip.cars.filter((c) => c.passengerIds.length < c.seats);
    if (!free.length) break;
    const same = free.find((c) => c.from && r.carFrom && c.from.toLowerCase() === r.carFrom.toLowerCase());
    const car = same || free.sort((a, b) => (b.seats - b.passengerIds.length) - (a.seats - a.passengerIds.length))[0];
    car.passengerIds.push(r.id);
  }
}

// ---------- Recomendaciones ----------
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(Math.round(mins % 60)).padStart(2, '0')}`;
const toMin = (t) => { const [h, m] = t.slice(11, 16).split(':').map(Number); return h * 60 + m; };

// Sugerencias automáticas a partir de la ruta, la altura y la luz del día.
export function recommend(trip) {
  const alt = trip.altitude || 0;
  const s = trip.gpx?.stats;
  const startEle = trip.info?.start?.ele ?? trip.gpx?.wpts?.[0]?.ele ?? trip.gpx?.pts?.[0]?.ele ?? null;
  // Desnivel neto hasta la cumbre (el acumulado de la ruta puede incluir bajadas).
  const up = startEle != null && alt ? Math.max(0, alt - startEle) : s?.up ?? null;
  const km = s?.distKm ?? null;
  const upH = s?.hours ?? null; // ida
  const downH = upH != null ? upH * 0.6 : null;
  const out = { tips: [] };

  // Días sugeridos: aclimatación y esfuerzo.
  let days = 1;
  const why = [];
  if (alt >= 5000) { days = 3; why.push('sobre 5.000 m conviene dormir al menos dos noches en altura para aclimatar'); }
  else if (alt >= 4000) { days = 2; why.push('sobre 4.000 m conviene dormir una noche en altura para aclimatar'); }
  if (upH != null && upH + downH > 10 && days < 2) { days = 2; why.push(`son ~${Math.round(upH + downH)} h de marcha en total`); }
  if (up != null && up > 1600 && days < 2) { days = 2; why.push(`${up.toLocaleString('es-CL')} m de desnivel es mucho para un día`); }
  if (alt >= 5500 && days < 4) { days = 4; why.splice(0, 1, 'sobre 5.500 m se necesita una aclimatación más gradual'); }
  out.days = days;
  out.daysWhy = why;
  const planned = tripDateList(trip).length || 1;
  out.daysOk = planned >= days;

  // Campamentos intermedios (subir ~800–1.000 m por día en altura).
  if (days > 1 && up > 300 && startEle != null) {
    const campDays = days - 1;
    const perDay = up / (campDays + 1);
    out.camps = Array.from({ length: campDays }, (_, i) => Math.round((startEle + perDay * (i + 1)) / 100) * 100);
    const huts = (trip.info?.huts || []).filter((h) => h.ele);
    const used = new Set();
    out.camps = out.camps.map((c) => {
      const hut = huts.filter((h) => !used.has(h) && Math.abs(h.ele - c) < 500 && h.ele < alt).sort((a, b) => Math.abs(a.ele - c) - Math.abs(b.ele - c))[0];
      if (hut) used.add(hut);
      return hut ? { ele: Math.round(hut.ele), name: hut.name } : { ele: c };
    }).filter((c) => c.ele > startEle && c.ele < alt - 150).sort((a, b) => a.ele - b.ele);
  }

  // Horarios del día de cumbre según la luz.
  const d = trip.weather?.daily?.daily;
  const dates = tripDateList(trip);
  const summitDay = dates[Math.min(dates.length - 1, Math.max(0, days - 1))] || dates[0];
  const di = d ? d.time.indexOf(summitDay) : -1;
  const sunrise = di >= 0 ? toMin(d.sunrise[di]) : 7 * 60;
  const sunset = di >= 0 ? toMin(d.sunset[di]) : 19 * 60 + 30;
  const campUp = out.camps?.length ? Math.max(0, alt - out.camps[out.camps.length - 1].ele) : up;
  // En altura se avanza más lento de lo que dice Naismith.
  const altFactor = alt >= 5000 ? 1.8 : alt >= 4000 ? 1.4 : alt >= 3000 ? 1.15 : 1;
  const climbH = upH != null ? (days > 1 && up && out.camps?.length ? upH * Math.min(1, campUp / Math.max(up, 1)) : upH) * altFactor : null;
  const descH = climbH != null ? climbH * 0.6 : null;
  if (climbH != null) {
    const start = alt >= 4000 ? sunrise - 90 : sunrise - 30; // en altura se parte de noche
    out.start = hhmm(Math.max(3 * 60, start));
    // Límite de cumbre: bajar con luz y margen de 1 h; en alta montaña no después de las 14:00 (viento y tormentas de tarde).
    const byLight = sunset - descH * 60 - 60;
    const cap = alt >= 3500 ? 14 * 60 : 15 * 60;
    out.turnaround = hhmm(Math.min(byLight, cap));
    const eta = Math.max(3 * 60, start) + climbH * 60 * 1.25; // +25 % por descansos
    out.summitEta = eta < 22 * 60 ? hhmm(eta) : 'no alcanza en el día';
    out.late = Math.max(3 * 60, start) + climbH * 60 * 1.25 > Math.min(byLight, cap);
  }

  // Agua y comida por persona.
  const effortH = upH != null ? upH + downH : null;
  const perDayH = effortH != null ? effortH / days : null;
  out.water = perDayH != null ? Math.min(5, Math.max(1.5, Math.round((perDayH * 0.5 + (alt >= 3500 ? 1 : 0)) * 2) / 2)) : (alt >= 3500 ? 3 : 2);
  out.kcal = alt >= 3500 ? '4.000–5.000' : '2.500–3.500';

  // Dificultad física (esfuerzo) aproximada.
  if (km != null && up != null) {
    const effort = km * 2 + up / 100;
    out.effort = effort < 15 ? 'Baja' : effort < 30 ? 'Media' : effort < 45 ? 'Alta' : 'Muy alta';
  }

  // Equipo clave según el tipo de salida.
  const mods = trip.modules || [];
  const key = [];
  if (mods.includes('alpine') || mods.includes('winter')) key.push('crampones', 'piolet', 'casco');
  if (mods.includes('glacier')) key.push('cuerda y equipo de rescate en grieta');
  if (mods.includes('ski') || (mods.includes('winter') && alt < 4000)) key.push('ARVA, pala y sonda');
  if (alt >= 3500) key.push('lentes cat. 4', 'ropa de pluma');
  if (mods.includes('camp')) key.push('carpa de 4 estaciones', 'saco −5 °C o menos');
  out.keyGear = [...new Set(key)];

  if (alt >= 3000) out.tips.push('Mal de altura: sube lento, hidrátate y, si hay dolor de cabeza fuerte, vómitos o confusión, baja de inmediato.');
  if (alt >= 3500) out.tips.push('En la cordillera central el viento y las tormentas aumentan en la tarde: cumbre temprano.');
  if (mods.includes('glacier')) out.tips.push('Hay glaciares cerca: encordarse al cruzarlos y conocer rescate en grieta.');
  return out;
}
