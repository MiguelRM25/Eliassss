import mammoth from 'mammoth';

const MODELS = (process.env.GEMINI_MODELS || 'gemini-3.1-flash-lite,gemini-3.5-flash-lite,gemini-3.6-flash').split(',').map(m => m.trim());
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const str = (description) => ({ type: 'STRING', nullable: true, ...(description && { description }) });

const EXTRACT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    oficio_recibido: str('Número del oficio recibido'),
    fecha_oficio_recibido: str('Fecha del oficio, en mayúsculas, ej. 20 DE AGOSTO DEL 2025'),
    cargo_remitente: str(),
    nombre_remitente: str('Nombre con título, ej. MTRA. ARIMA OJEDA SANTIAGO'),
    equipos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          tipo_equipo: str(),
          marca: str(),
          modelo: str(),
          numero_serie: str(),
          numero_inventario: str()
        },
        required: ['tipo_equipo', 'marca', 'modelo', 'numero_serie', 'numero_inventario']
      }
    }
  },
  required: ['oficio_recibido', 'fecha_oficio_recibido', 'cargo_remitente', 'nombre_remitente', 'equipos']
};

async function filePart({ base64, mimeType }) {
  if (mimeType === DOCX) {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(base64, 'base64') });
    return { text: `CONTENIDO DEL OFICIO:\n${value}` };
  }
  return { inlineData: { mimeType, data: base64 } };
}

async function generate(body) {
  let lastErr;
  for (const model of MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
      );
      if (res.ok) return res.json();
      lastErr = new Error(`Gemini ${model} ${res.status}: ${await res.text()}`);
      console.error(lastErr.message);
      if (res.status === 404) break; // modelo inexistente: siguiente
      if (![429, 500, 503].includes(res.status)) throw lastErr;
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

export async function extractFromOficio({ base64, mimeType }) {
  const json = await generate(JSON.stringify({
    contents: [{
      role: 'user',
      parts: [
        await filePart({ base64, mimeType }),
        { text: 'Extrae los datos de este oficio y su tabla de equipos según el schema dado. Si un campo no aparece explícitamente en el documento, ponlo en null; no inventes valores.' }
      ]
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 16000,
      responseMimeType: 'application/json',
      responseSchema: EXTRACT_SCHEMA
    }
  }));
  const cand = json.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') throw new Error('Respuesta truncada (MAX_TOKENS)');
  return JSON.parse(cand.content.parts.map(p => p.text || '').join(''));
}

const EQUIPO_CAMPOS = ['tipo_equipo', 'marca', 'modelo', 'numero_serie']; // inventario es opcional (S/N)

export function camposFaltantes(data) {
  const faltantes = [];
  for (const k of ['oficio_recibido', 'fecha_oficio_recibido', 'cargo_remitente', 'nombre_remitente']) {
    if (!data[k]) faltantes.push(k);
  }
  data.equipos.forEach((eq, i) => {
    for (const campo of EQUIPO_CAMPOS) {
      if (!eq[campo]) faltantes.push(`equipo_${i + 1}_${campo}`);
    }
  });
  return faltantes;
}
