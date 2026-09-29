// Plantillas de equipo por tipo de actividad.
// Cada ítem: [nombre, categoría, alcance, gramos aprox.]
// Alcance: 'p' = personal (cada integrante), 'c' = por cordada (uno por cordada/carpa),
//          'g' = grupal (uno para toda la salida).
import { uid } from './store.js';

export const CATEGORIES = [
  'Mochila y calzado',
  'Ropa',
  'Técnico',
  'Campamento',
  'Cocina y agua',
  'Comida',
  'Navegación y comunicación',
  'Seguridad y botiquín',
  'Higiene',
  'Documentos y permisos',
  'Fotografía',
  'Otros',
];

export const MODULES = {
  base: {
    label: 'Trekking de día',
    icon: '🥾',
    items: [
      ['Mochila de ataque 25–35 L', 'Mochila y calzado', 'p', 1000],
      ['Botas o zapatillas de trekking', 'Mochila y calzado', 'p', 0],
      ['Calcetines de repuesto', 'Ropa', 'p', 80],
      ['Primera capa térmica', 'Ropa', 'p', 200],
      ['Polar o capa intermedia', 'Ropa', 'p', 350],
      ['Chaqueta impermeable / cortaviento', 'Ropa', 'p', 400],
      ['Jockey o sombrero para el sol', 'Ropa', 'p', 80],
      ['Gorro de abrigo y guantes livianos', 'Ropa', 'p', 150],
      ['Lentes de sol cat. 3–4', 'Seguridad y botiquín', 'p', 40],
      ['Bloqueador solar y protector labial', 'Seguridad y botiquín', 'p', 100],
      ['Agua (2 L mínimo)', 'Cocina y agua', 'p', 2000],
      ['Snacks y comida del día', 'Comida', 'p', 500],
      ['Linterna frontal + pilas de repuesto', 'Navegación y comunicación', 'p', 100],
      ['Celular cargado + batería externa', 'Navegación y comunicación', 'p', 250],
      ['Silbato', 'Seguridad y botiquín', 'p', 10],
      ['Manta térmica de emergencia', 'Seguridad y botiquín', 'p', 60],
      ['Bastones', 'Técnico', 'p', 500],
      ['Papel higiénico + bolsa para basura', 'Higiene', 'p', 50],
      ['Carnet de identidad', 'Documentos y permisos', 'p', 0],
      ['Efectivo', 'Documentos y permisos', 'p', 0],
      ['Botiquín de grupo', 'Seguridad y botiquín', 'g', 400],
      ['Track GPX / mapa descargado offline', 'Navegación y comunicación', 'g', 0],
      ['Brújula', 'Navegación y comunicación', 'g', 50],
      ['Cortaplumas / multiherramienta', 'Técnico', 'g', 100],
      ['Cinta americana (reparaciones)', 'Técnico', 'g', 30],
    ],
  },
  camp: {
    label: 'Campamento / varios días',
    icon: '⛺',
    items: [
      ['Mochila de carga 50–70 L', 'Mochila y calzado', 'p', 1800],
      ['Carpa', 'Campamento', 'c', 2500],
      ['Saco de dormir (ej. −5 °C de confort)', 'Campamento', 'p', 1200],
      ['Aislante / colchoneta', 'Campamento', 'p', 500],
      ['Liner para el saco (opcional)', 'Campamento', 'p', 200],
      ['Ropa seca para el campamento', 'Ropa', 'p', 500],
      ['Calzado de campamento', 'Mochila y calzado', 'p', 300],
      ['Bolsas estancas', 'Campamento', 'p', 100],
      ['Cocinilla', 'Cocina y agua', 'c', 300],
      ['Cartuchos de gas / combustible', 'Cocina y agua', 'c', 400],
      ['Set de ollas', 'Cocina y agua', 'c', 300],
      ['Encendedor x2 / fósforos', 'Cocina y agua', 'c', 30],
      ['Cena y desayuno (comida, condimentos)', 'Comida', 'c', 800],
      ['Filtro o pastillas potabilizadoras', 'Cocina y agua', 'g', 100],
      ['Plato, taza y servicio', 'Cocina y agua', 'p', 150],
      ['Termo / navaja (opcional)', 'Cocina y agua', 'p', 300],
      ['Kit de reparación (varilla, parches)', 'Campamento', 'g', 100],
      ['Tubo / bolsa para desechos orgánicos', 'Higiene', 'p', 150],
      ['Cepillo de dientes y alcohol gel', 'Higiene', 'p', 80],
    ],
  },
  alpine: {
    label: 'Alta montaña / nieve',
    icon: '🏔️',
    items: [
      ['Botas de alta montaña (o dobles)', 'Mochila y calzado', 'p', 0],
      ['Crampones', 'Técnico', 'p', 900],
      ['Piolet', 'Técnico', 'p', 450],
      ['Casco', 'Técnico', 'p', 350],
      ['Polainas', 'Ropa', 'p', 250],
      ['Chaqueta de pluma', 'Ropa', 'p', 600],
      ['Pantalón impermeable', 'Ropa', 'p', 400],
      ['Mitones / guantes gruesos + repuesto', 'Ropa', 'p', 350],
      ['Lentes de glaciar cat. 4', 'Seguridad y botiquín', 'p', 50],
      ['Buff / balaclava', 'Ropa', 'p', 80],
      ['Termo 1 L', 'Cocina y agua', 'p', 450],
      ['Oxímetro', 'Seguridad y botiquín', 'g', 60],
      ['Medicamentos para la altura (consultar médico)', 'Seguridad y botiquín', 'g', 50],
      ['Radio VHF / comunicador satelital (inReach)', 'Navegación y comunicación', 'g', 200],
      ['Permiso DIFROL / parque (si corresponde)', 'Documentos y permisos', 'g', 0],
    ],
  },
  glacier: {
    label: 'Glaciar (rescate en grieta)',
    icon: '🧊',
    items: [
      ['Arnés', 'Técnico', 'p', 400],
      ['Mosquetones con seguro x3', 'Técnico', 'p', 180],
      ['Cordinos / prusik x2', 'Técnico', 'p', 80],
      ['Anillos de cinta 120 cm x2', 'Técnico', 'p', 80],
      ['Bloqueador (Tibloc / Micro Traxion)', 'Técnico', 'p', 80],
      ['Cuerda dinámica 50–60 m', 'Técnico', 'g', 3000],
      ['Tornillos de hielo x2', 'Técnico', 'g', 300],
      ['Poleas / kit de rescate en grieta', 'Técnico', 'g', 250],
      ['Estacas de nieve', 'Técnico', 'g', 400],
    ],
  },
  rock: {
    label: 'Escalada en roca',
    icon: '🧗',
    items: [
      ['Arnés', 'Técnico', 'p', 400],
      ['Casco', 'Técnico', 'p', 350],
      ['Pies de gato', 'Técnico', 'p', 500],
      ['Magnesio', 'Técnico', 'p', 150],
      ['Aparato de aseguramiento + mosquetón con seguro', 'Técnico', 'p', 150],
      ['Cordino de reunión / anillos', 'Técnico', 'p', 150],
      ['Cuerda', 'Técnico', 'g', 3500],
      ['Cintas exprés', 'Técnico', 'g', 1200],
      ['Friends / empotradores (si es tradicional)', 'Técnico', 'g', 2000],
      ['Reseña / topo de la vía', 'Navegación y comunicación', 'g', 0],
    ],
  },
  ice: {
    label: 'Hielo / mixto',
    icon: '⛏️',
    items: [
      ['Piolets técnicos x2', 'Técnico', 'p', 1100],
      ['Crampones técnicos', 'Técnico', 'p', 1000],
      ['Guantes de escalada extra', 'Ropa', 'p', 200],
      ['Tornillos de hielo x8+', 'Técnico', 'g', 1200],
      ['Cordino abandonable / Abalakov', 'Técnico', 'g', 200],
      ['Cuerdas dobles / gemelas', 'Técnico', 'g', 5000],
    ],
  },
  ski: {
    label: 'Esquí de travesía / splitboard',
    icon: '🎿',
    items: [
      ['Esquís / splitboard', 'Técnico', 'p', 3000],
      ['Botas de travesía', 'Mochila y calzado', 'p', 0],
      ['Pieles de foca', 'Técnico', 'p', 500],
      ['Cuchillas', 'Técnico', 'p', 300],
      ['ARVA / DVA con pilas nuevas', 'Seguridad y botiquín', 'p', 250],
      ['Pala de avalanchas', 'Seguridad y botiquín', 'p', 600],
      ['Sonda', 'Seguridad y botiquín', 'p', 300],
      ['Casco', 'Técnico', 'p', 350],
      ['Boletín de avalanchas revisado', 'Navegación y comunicación', 'g', 0],
      ['Kit de reparación de esquí', 'Técnico', 'g', 200],
    ],
  },
  winter: {
    label: 'Invernal',
    icon: '❄️',
    items: [
      ['Capa de abrigo extra', 'Ropa', 'p', 400],
      ['Calentadores de manos', 'Ropa', 'p', 50],
      ['Termo con bebida caliente', 'Cocina y agua', 'p', 600],
      ['Raquetas de nieve', 'Técnico', 'p', 1800],
      ['ARVA, pala y sonda (terreno de avalancha)', 'Seguridad y botiquín', 'p', 1150],
      ['Frontal potente + pilas de litio', 'Navegación y comunicación', 'p', 150],
    ],
  },
  photo: {
    label: 'Fotografía',
    icon: '📷',
    items: [
      ['Cámara', 'Fotografía', 'p', 700],
      ['Lentes', 'Fotografía', 'p', 600],
      ['Baterías extra (guardarlas al calor del cuerpo)', 'Fotografía', 'p', 150],
      ['Tarjetas de memoria de repuesto', 'Fotografía', 'p', 20],
      ['Paño + bolsa hermética para la condensación', 'Fotografía', 'p', 50],
      ['Filtros (polarizador / ND)', 'Fotografía', 'p', 100],
      ['Trípode liviano', 'Fotografía', 'g', 1200],
      ['Drone + baterías (revisar normativa DGAC y áreas protegidas)', 'Fotografía', 'g', 900],
    ],
  },
};

export function makeItem(name, cat = 'Otros', scope = 'p', weight = 0) {
  return { id: uid(), name, cat, scope, weight, assignee: '', checked: false, checks: {} };
}

// Agrega los ítems de los módulos, sin duplicar nombres ya presentes.
export function addModules(trip, moduleIds) {
  const names = new Set(trip.gear.map((g) => g.name.toLowerCase()));
  for (const id of moduleIds) {
    const mod = MODULES[id];
    if (!mod) continue;
    if (!trip.modules.includes(id)) trip.modules.push(id);
    for (const [name, cat, scope, weight] of mod.items) {
      if (names.has(name.toLowerCase())) continue;
      names.add(name.toLowerCase());
      trip.gear.push(makeItem(name, cat, scope, weight));
    }
  }
}

export const SCOPES = { p: 'personal', c: 'por cordada', g: 'grupal' };

// Cordadas de la salida; si no hay, todo el grupo es una sola.
export function ropesOf(trip) {
  if (trip.ropes?.length) return trip.ropes;
  return [{ id: 'all', name: 'Grupo', memberIds: trip.members.map((m) => m.id) }];
}
export const ropeKey = (rope) => `r_${rope.id}`;
export const ropeOfMember = (trip, memberId) => ropesOf(trip).find((r) => r.memberIds.includes(memberId));

// Progreso: los ítems personales cuentan una vez por integrante y los de cordada una vez por cordada.
export function gearProgress(trip, memberId = null) {
  let total = 0;
  let done = 0;
  const members = trip.members.length ? trip.members : [{ id: '_' }];
  for (const g of trip.gear) {
    if (g.scope === 'c') {
      for (const r of ropesOf(trip)) {
        if (memberId && !r.memberIds.includes(memberId)) continue;
        total++;
        if (g.checks?.[ropeKey(r)]) done++;
      }
    } else if (g.scope === 'p') {
      for (const m of members) {
        if (memberId && m.id !== memberId) continue;
        total++;
        if (g.checks?.[m.id]) done++;
      }
    } else {
      if (memberId && g.assignee !== memberId) continue;
      total++;
      if (g.checked) done++;
    }
  }
  return { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
}

// Peso estimado que carga cada integrante (personal + grupal asignado).
export function weightByMember(trip) {
  const out = {};
  for (const m of trip.members) out[m.id] = 0;
  for (const g of trip.gear) {
    const w = Number(g.weight) || 0;
    if (g.scope === 'p') {
      for (const m of trip.members) out[m.id] += w;
    } else if (g.scope === 'c') {
      // Se reparte entre los integrantes de cada cordada.
      for (const r of ropesOf(trip)) {
        const ids = r.memberIds.filter((id) => out[id] != null);
        ids.forEach((id) => { out[id] += w / ids.length; });
      }
    } else if (g.assignee && out[g.assignee] != null) {
      out[g.assignee] += w;
    }
  }
  return out;
}
