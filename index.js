import 'dotenv/config';
import { Telegraf } from 'telegraf';
import fs from 'fs';
import path from 'path';
import { extractFromOficio, camposFaltantes } from './extract.js';
import { generateDictamen } from './generate.js';
import { resolverIniciales, cargarTecnicos } from './tecnicos.js';

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const sessions = new Map(); // chatId -> { data, own }

const ACCEPTED_MIME = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'img',
  'image/png': 'img'
};

const OWN_FIELDS = ['numero_oficio', 'dictamen_inicial', 'iniciales', 'motivo'];

function pendientes(session) {
  const f = camposFaltantes(session.data);
  for (const k of OWN_FIELDS) if (!session.own[k]) f.push(k);
  return f;
}

const EJEMPLOS = {
  numero_oficio: 'FGEO/CGSI/1429/2025',
  dictamen_inicial: '191',
  iniciales: 'igf/dsa',
  motivo: 'EQUIPO CON FALLA DE ENCENDIDO'
};

function tecnicosHint() {
  const t = cargarTecnicos();
  if (!t.length) return '';
  return '\n\nIniciales: escribe las iniciales o el nombre del técnico (varios separados por coma).\nTécnicos: ' +
    t.map(x => x.nombre ? `${x.nombre} (${x.iniciales})` : x.iniciales).join(', ');
}

function pedir(ctx, faltantes, resumen) {
  const ejemplo = faltantes.slice(0, 4).map(f => `${f}: ${EJEMPLOS[f] || '...'}`).join('\n');
  return ctx.reply(
    (resumen || '') +
    'Faltan estos datos:\n' + faltantes.map(m => `- ${m}`).join('\n') +
    '\n\nResponde en líneas "campo: valor", por ejemplo:\n' + ejemplo +
    (faltantes.includes('iniciales') ? tecnicosHint() : '')
  );
}

const U = (v) => (typeof v === 'string' ? v.toUpperCase() : v);

function mayusculas({ data, own }) {
  for (const k of ['oficio_recibido', 'fecha_oficio_recibido', 'cargo_remitente', 'nombre_remitente']) data[k] = U(data[k]);
  for (const eq of data.equipos) for (const k of Object.keys(eq)) eq[k] = U(eq[k]);
  for (const k of ['numero_oficio', 'motivo']) own[k] = U(own[k]);
}

async function finalizar(ctx, session) {
  mayusculas(session);
  const outDir = path.join(process.env.DATA_DIR || './data', 'dictamenes');
  fs.mkdirSync(outDir, { recursive: true });
  const nombre = session.own.numero_oficio.replace(/[^\w.-]+/g, '_');
  const outputPath = path.join(outDir, `dictamen_${nombre}_${Date.now()}.docx`);
  await ctx.reply(`Generando dictamen (iniciales: MDTG/${session.own.iniciales})...`);
  try {
    generateDictamen({ data: session.data, own: session.own, outputPath });
  } catch (err) {
    console.error(err);
    return ctx.reply(`No pude generar el documento: ${err.message}\nCuando lo corrijas, reenvía cualquier línea "campo: valor" para reintentar.`);
  }
  await ctx.replyWithDocument({ source: outputPath });
  sessions.delete(ctx.chat.id);
}

async function procesar(ctx, fileId, mimeType, filename) {
  await ctx.reply('Leyendo oficio...');
  const fileLink = await ctx.telegram.getFileLink(fileId);
  const buffer = Buffer.from(await (await fetch(fileLink.href)).arrayBuffer());

  let data;
  try {
    data = await extractFromOficio({ base64: buffer.toString('base64'), mimeType, filename });
  } catch (err) {
    console.error(err);
    return ctx.reply('No pude leer el oficio. Intenta de nuevo.');
  }

  const session = { data, own: {} };
  sessions.set(ctx.chat.id, session);
  return pedir(ctx, pendientes(session), `Detecté ${data.equipos.length} equipo(s). `);
}

bot.on('document', (ctx) => {
  const doc = ctx.message.document;
  if (!ACCEPTED_MIME[doc.mime_type]) return ctx.reply('Solo acepto PDF, Word (.docx) o imagen.');
  return procesar(ctx, doc.file_id, doc.mime_type, doc.file_name);
});

bot.on('photo', (ctx) => {
  const photos = ctx.message.photo;
  return procesar(ctx, photos[photos.length - 1].file_id, 'image/jpeg', 'oficio.jpg');
});

bot.on('text', async (ctx) => {
  const session = sessions.get(ctx.chat.id);
  if (!session) return;

  const { aplicados, avisos } = applyCorrections(session, ctx.message.text);
  if (avisos.length) await ctx.reply(avisos.join('\n'));
  const faltan = pendientes(session);
  if (aplicados === 0 && avisos.length === 0) return pedir(ctx, faltan, 'No reconocí ningún campo. ');
  if (faltan.length > 0) return pedir(ctx, faltan);
  return finalizar(ctx, session);
});

function applyCorrections({ data, own }, text) {
  let aplicados = 0;
  const avisos = [];
  for (const line of text.split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    const key = line.slice(0, i).toLowerCase().replace(/^[\s\-*•]+/, '').trim().replace(/\s+/g, '_');
    const valor = line.slice(i + 1).trim();
    if (!key || !valor) continue;

    const m = key.match(/^equipo_(\d+)_(.+)$/);
    if (m) {
      const eq = data.equipos[parseInt(m[1], 10) - 1];
      if (eq) { eq[m[2]] = valor; aplicados++; }
    } else if (key === 'iniciales') {
      const r = resolverIniciales(valor);
      if (r.error) avisos.push(r.error); else { own.iniciales = r.valor; aplicados++; }
    } else if (OWN_FIELDS.includes(key)) {
      own[key] = valor; aplicados++;
    } else if (key in data) {
      data[key] = valor; aplicados++;
    }
  }
  return { aplicados, avisos };
}

bot.launch();
console.log('Bot corriendo.');
