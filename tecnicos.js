import fs from 'fs';

const FILE = process.env.TECNICOS_PATH || './tecnicos.json';
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

export function cargarTecnicos() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return []; }
}

function resolverToken(token, tecnicos) {
  const t = norm(token);
  const porIniciales = tecnicos.find(x => norm(x.iniciales) === t);
  if (porIniciales) return { valor: porIniciales.iniciales.toLowerCase() };

  const palabras = t.split(/\s+/);
  const coinciden = tecnicos.filter(x => x.nombre && palabras.every(p => norm(x.nombre).split(/\s+/).some(w => w.startsWith(p))));
  if (coinciden.length === 1) return { valor: coinciden[0].iniciales.toLowerCase() };
  if (coinciden.length > 1) return { error: `"${token}" coincide con varios técnicos (${coinciden.map(c => c.nombre).join(', ')}). Sé más específico.` };

  if (palabras.length === 1) return { valor: t.replace(/[^a-zñ]/g, '') };
  if (palabras.every(p => tecnicos.some(x => norm(x.iniciales) === p))) return { valor: palabras.join('/') };
  return { valor: palabras.map(p => p[0]).join('') }; // nombre desconocido: toma sus iniciales
}

export function resolverIniciales(texto) {
  const tecnicos = cargarTecnicos();
  const tokens = texto.split(/[\/,;\n]+|\s+y\s+/i).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const tk of tokens) {
    const r = resolverToken(tk, tecnicos);
    if (r.error) return r;
    if (r.valor) out.push(r.valor);
  }
  return out.length ? { valor: out.join('/') } : { error: 'No pude leer las iniciales.' };
}
