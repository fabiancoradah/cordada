// Pronóstico desde Open-Meteo (gratis, sin API key, con CORS).
// Compara varios modelos globales para ver cuánto "confían" entre ellos.

export const MODELS = [
  { id: 'ecmwf_ifs025', label: 'ECMWF', slot: 1 },
  { id: 'gfs_seamless', label: 'GFS', slot: 2 },
  { id: 'icon_seamless', label: 'ICON', slot: 3 },
];

const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'snowfall',
  'wind_speed_10m',
  'wind_gusts_10m',
  'cloud_cover',
  'freezing_level_height',
  'weather_code',
  'wind_speed_500hPa',
];

const DAILY = [
  'weather_code',
  'temperature_2m_max',
  'temperature_2m_min',
  'precipitation_sum',
  'snowfall_sum',
  'wind_speed_10m_max',
  'wind_gusts_10m_max',
  'sunrise',
  'sunset',
  'uv_index_max',
];

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo respondió ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.reason || 'Error de Open-Meteo');
  return data;
}

export async function fetchWeather({ lat, lon, altitude }) {
  const base = {
    latitude: lat,
    longitude: lon,
    timezone: 'auto',
    forecast_days: 14,
    wind_speed_unit: 'kmh',
  };
  // Con "elevation" Open-Meteo corrige la temperatura a la cota de la cumbre.
  if (altitude) base.elevation = altitude;

  const hourlyUrl = new URL('https://api.open-meteo.com/v1/forecast');
  Object.entries({ ...base, hourly: HOURLY.join(','), models: MODELS.map((m) => m.id).join(',') })
    .forEach(([k, v]) => hourlyUrl.searchParams.set(k, v));

  const dailyUrl = new URL('https://api.open-meteo.com/v1/forecast');
  Object.entries({ ...base, daily: DAILY.join(',') }).forEach(([k, v]) => dailyUrl.searchParams.set(k, v));

  const [hourly, daily] = await Promise.all([getJSON(hourlyUrl), getJSON(dailyUrl)]);
  return { fetchedAt: new Date().toISOString(), altitude: altitude || hourly.elevation, hourly, daily };
}

// Serie horaria de un modelo; si el modelo no entrega isoterma 0°, se estima
// con el gradiente estándar (6,5 °C / 1000 m) desde la temperatura en la cota.
export function series(w, modelId, variable) {
  const h = w.hourly.hourly;
  let arr = h[`${variable}_${modelId}`] ?? (MODELS.length === 1 ? h[variable] : null);
  if (variable === 'freezing_level_height' && (!arr || arr.every((v) => v == null))) {
    const t = h[`temperature_2m_${modelId}`];
    if (t) arr = t.map((v) => (v == null ? null : Math.round(w.altitude + (v / 6.5) * 1000)));
  }
  return arr || [];
}

export const hourlyTimes = (w) => w.hourly.hourly.time;

const WMO = {
  0: ['☀️', 'Despejado'],
  1: ['🌤️', 'Mayormente despejado'],
  2: ['⛅', 'Parcial'],
  3: ['☁️', 'Nublado'],
  45: ['🌫️', 'Niebla'],
  48: ['🌫️', 'Niebla con escarcha'],
  51: ['🌦️', 'Llovizna'],
  53: ['🌦️', 'Llovizna'],
  55: ['🌧️', 'Llovizna intensa'],
  61: ['🌧️', 'Lluvia débil'],
  63: ['🌧️', 'Lluvia'],
  65: ['🌧️', 'Lluvia intensa'],
  66: ['🌧️', 'Lluvia helada'],
  67: ['🌧️', 'Lluvia helada'],
  71: ['🌨️', 'Nieve débil'],
  73: ['🌨️', 'Nieve'],
  75: ['❄️', 'Nevazón'],
  77: ['🌨️', 'Granizo fino'],
  80: ['🌦️', 'Chubascos'],
  81: ['🌧️', 'Chubascos'],
  82: ['⛈️', 'Chubascos fuertes'],
  85: ['🌨️', 'Chubascos de nieve'],
  86: ['❄️', 'Chubascos de nieve'],
  95: ['⛈️', 'Tormenta eléctrica'],
  96: ['⛈️', 'Tormenta con granizo'],
  99: ['⛈️', 'Tormenta con granizo'],
};
export const wmo = (code) => WMO[code] || ['❔', '—'];

// Evalúa condiciones para las fechas de la salida y entrega alertas.
export function assess(w, dates) {
  const alerts = [];
  const times = hourlyTimes(w);
  const idx = times.map((t, i) => (dates.includes(t.slice(0, 10)) ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) {
    return [{ level: 'info', text: 'Las fechas de la salida aún están fuera del horizonte del pronóstico (≈14 días).' }];
  }
  const alt = w.altitude || 0;
  const perModel = MODELS.map((m) => {
    const pick = (v) => idx.map((i) => series(w, m.id, v)[i]).filter((x) => x != null);
    return {
      label: m.label,
      gust: Math.max(0, ...pick('wind_gusts_10m')),
      wind500: Math.max(0, ...pick('wind_speed_500hPa')),
      precip: pick('precipitation').reduce((a, b) => a + b, 0),
      snow: pick('snowfall').reduce((a, b) => a + b, 0),
      feels: Math.min(99, ...pick('apparent_temperature')),
      tmax: Math.max(-99, ...pick('temperature_2m')),
      fzMin: Math.min(99999, ...pick('freezing_level_height')),
      storm: pick('weather_code').some((c) => c >= 95),
    };
  });
  const worst = (k, fn = Math.max) => fn(...perModel.map((p) => p[k]));

  const gust = worst('gust');
  if (gust >= 70) alerts.push({ level: 'danger', text: `Rachas de hasta ${Math.round(gust)} km/h en la cota: viento peligroso.` });
  else if (gust >= 45) alerts.push({ level: 'warn', text: `Rachas de hasta ${Math.round(gust)} km/h: viento incómodo en filos y cumbres.` });

  const w500 = worst('wind500');
  if (alt > 4500 && w500 >= 60) alerts.push({ level: w500 >= 90 ? 'danger' : 'warn', text: `Viento en altura (500 hPa ≈ 5.500 m) de ${Math.round(w500)} km/h.` });

  const precip = worst('precip');
  if (precip >= 10) alerts.push({ level: 'danger', text: `Precipitación acumulada de hasta ${precip.toFixed(1)} mm.` });
  else if (precip >= 1) alerts.push({ level: 'warn', text: `Posible precipitación (${precip.toFixed(1)} mm en el peor modelo).` });

  const snow = worst('snow');
  if (snow >= 1) alerts.push({ level: snow >= 10 ? 'danger' : 'warn', text: `Nieve nueva: hasta ${snow.toFixed(0)} cm. Revisa riesgo de avalanchas.` });

  if (perModel.some((p) => p.storm)) alerts.push({ level: 'danger', text: 'Algún modelo indica tormenta eléctrica: evita filos y cumbres expuestas.' });

  const feels = worst('feels', Math.min);
  if (feels <= -20) alerts.push({ level: 'danger', text: `Sensación térmica de hasta ${Math.round(feels)} °C: riesgo de congelamiento.` });
  else if (feels <= -8) alerts.push({ level: 'warn', text: `Sensación térmica de hasta ${Math.round(feels)} °C: abrigo completo y cuidado con manos y pies.` });

  const fz = worst('fzMin', Math.min);
  if (alt && fz < 99999 && fz < alt) alerts.push({ level: 'info', text: `La isoterma 0° baja a ${Math.round(fz)} m, bajo la cota objetivo (${alt} m): espera nieve dura o hielo; lleva crampones.` });

  const tmaxs = perModel.map((p) => p.tmax).filter((v) => v > -99);
  const precs = perModel.map((p) => p.precip);
  if ((tmaxs.length > 1 && Math.max(...tmaxs) - Math.min(...tmaxs) >= 6) || (Math.max(...precs) >= 3 && Math.min(...precs) < 0.5)) {
    alerts.push({ level: 'warn', text: 'Los modelos no coinciden: pronóstico de baja confianza. Vuelve a revisar más cerca de la fecha.' });
  }

  if (!alerts.some((a) => a.level !== 'info')) alerts.unshift({ level: 'good', text: 'Sin alertas relevantes en los modelos para las fechas de la salida.' });
  return alerts;
}

export function externalLinks({ lat, lon, peak }) {
  const la = Number(lat).toFixed(3);
  const lo = Number(lon).toFixed(3);
  const mb = `${Math.abs(la)}${la < 0 ? 'S' : 'N'}${Math.abs(lo)}${lo < 0 ? 'W' : 'E'}`;
  return [
    ['Windy', `https://www.windy.com/${la}/${lo}?${la},${lo},11`],
    ['Meteoblue', `https://www.meteoblue.com/es/tiempo/semana/${mb}`],
    ['Ventusky', `https://www.ventusky.com/?p=${la};${lo};9`],
    ['Mountain-Forecast', `https://www.google.com/search?q=${encodeURIComponent(`mountain-forecast ${peak || ''}`)}`],
    ['Meteochile', 'https://www.meteochile.gob.cl/'],
    ['SMN Argentina', 'https://www.smn.gob.ar/'],
  ];
}

// ---------- Gráfico de líneas SVG (multi-modelo) con tooltip ----------

export function lineChart({ times, lines, refLine, unit, height = 220, fmtX, W = 720 }) {
  const H = height;
  const m = { l: 48, r: 16, t: 16, b: 28 };
  const all = lines.flatMap((l) => l.values).filter((v) => v != null);
  if (refLine) all.push(refLine.value);
  if (!all.length) return '<p class="muted">Sin datos para graficar.</p>';
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const pad = (hi - lo) * 0.08 || 1;
  lo -= pad;
  hi += pad;
  const x = (i) => m.l + (i / Math.max(1, times.length - 1)) * (W - m.l - m.r);
  const y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);

  const ticks = niceTicks(lo, hi, 4);
  const grid = ticks
    .map((t) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${m.l - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`)
    .join('');
  const days = [];
  times.forEach((t, i) => {
    if (t.endsWith('T00:00')) days.push(i);
  });
  const every = Math.max(1, Math.ceil((days.length * 60) / (W - m.l - m.r)));
  const xlabels = days
    .filter((_, k) => k % every === 0)
    .map((i) => `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="${m.t}" y2="${H - m.b}"/><text class="axis" x="${x(i) + 3}" y="${H - 8}">${fmtX(times[i])}</text>`)
    .join('');

  const paths = lines
    .map((l) => {
      let d = '';
      let pen = false;
      l.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      });
      return `<path class="line s${l.slot}" d="${d}"/>`;
    })
    .join('');

  // Etiqueta directa al final de cada línea (≤ 4 series).
  const labels = lines
    .map((l) => {
      let i = l.values.length - 1;
      while (i > 0 && l.values[i] == null) i--;
      if (l.values[i] == null) return '';
      return `<circle class="dot s${l.slot}" cx="${x(i)}" cy="${y(l.values[i])}" r="3"/>`;
    })
    .join('');

  const ref = refLine
    ? `<line class="ref" x1="${m.l}" x2="${W - m.r}" y1="${y(refLine.value)}" y2="${y(refLine.value)}"/><text class="ref-label" x="${W - m.r - 4}" y="${y(refLine.value) - 6}" text-anchor="end">${refLine.label}</text>`
    : '';

  const legend = lines.map((l) => `<span class="key"><i class="sw s${l.slot}"></i>${l.label}</span>`).join('');
  const data = encodeURIComponent(JSON.stringify({ times, lines: lines.map((l) => ({ label: l.label, slot: l.slot, values: l.values })), unit, m, W }));

  return `<div class="chart" data-chart="${data}">
    <div class="legend">${legend}${refLine ? `<span class="key"><i class="sw ref"></i>${refLine.label}</span>` : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${lines.map((l) => l.label).join(', ')} (${unit})">
      ${grid}${xlabels}${ref}${paths}${labels}
      <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" style="display:none"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
    </svg>
    <div class="tooltip" hidden></div>
  </div>`;
}

// Crosshair + tooltip para todos los .chart dentro de root.
export function wireCharts(root, fmtTime) {
  root.querySelectorAll('.chart[data-chart]').forEach((el) => {
    const cfg = JSON.parse(decodeURIComponent(el.dataset.chart));
    const svg = el.querySelector('svg');
    const hit = el.querySelector('.hit');
    const cross = el.querySelector('.cross');
    const tip = el.querySelector('.tooltip');
    const move = (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * cfg.W;
      const frac = (px - cfg.m.l) / (cfg.W - cfg.m.l - cfg.m.r);
      const i = Math.max(0, Math.min(cfg.times.length - 1, Math.round(frac * (cfg.times.length - 1))));
      const cx = cfg.m.l + (i / Math.max(1, cfg.times.length - 1)) * (cfg.W - cfg.m.l - cfg.m.r);
      cross.setAttribute('x1', cx);
      cross.setAttribute('x2', cx);
      cross.style.display = '';
      tip.hidden = false;
      tip.innerHTML = `<b>${fmtTime(cfg.times[i])}</b>` +
        cfg.lines.map((l) => `<div><i class="sw s${l.slot}"></i>${l.label}: <b>${l.values[i] == null ? '—' : fmtNum(l.values[i])} ${cfg.unit}</b></div>`).join('');
      const left = ((cx / cfg.W) * r.width);
      tip.style.left = `${Math.min(r.width - 150, Math.max(0, left + 10))}px`;
    };
    const leave = () => { cross.style.display = 'none'; tip.hidden = true; };
    hit.addEventListener('pointermove', move);
    hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', leave);
  });
}

function niceTicks(lo, hi, n) {
  const span = hi - lo;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(+v.toFixed(6));
  return out;
}

const fmtNum = (v) => (Math.abs(v) >= 100 ? Math.round(v).toLocaleString('es-CL') : (Math.round(v * 10) / 10).toLocaleString('es-CL'));
