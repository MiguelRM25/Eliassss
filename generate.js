import fs from 'fs';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const U = (v) => (v == null ? '' : String(v).toUpperCase());

function fechaLarga(d = new Date()) {
  return `${String(d.getDate()).padStart(2, '0')} de ${MESES[d.getMonth()]} del ${d.getFullYear()}`;
}

export function generateDictamen({ data, own, outputPath }) {
  const content = fs.readFileSync(process.env.DICTAMEN_TEMPLATE_PATH, 'binary');
  const doc = new Docxtemplater(new PizZip(content), { paragraphLoop: true, linebreaks: true });
  const inicio = parseInt(own.dictamen_inicial, 10);

  doc.render({
    numero_oficio: U(own.numero_oficio),
    fecha_larga: U(fechaLarga()),
    nombre_remitente: U(data.nombre_remitente),
    cargo_remitente: U(data.cargo_remitente),
    oficio_recibido: U(data.oficio_recibido),
    fecha_oficio_recibido: U(data.fecha_oficio_recibido),
    frase_equipos: data.equipos.length === 1 ? 'del siguiente equipo' : 'de los siguientes equipos',
    iniciales: own.iniciales,
    otros_componentes: '---',
    equipos: data.equipos.map((eq, i) => ({
      num_dictamen: inicio + i,
      tipo_equipo: U(eq.tipo_equipo),
      marca: U(eq.marca),
      modelo: U(eq.modelo),
      numero_serie: U(eq.numero_serie),
      numero_inventario: U(eq.numero_inventario || 'S/N'),
      motivo: U(eq.motivo || own.motivo)
    }))
  });

  fs.writeFileSync(outputPath, doc.getZip().generate({ type: 'nodebuffer' }));
  return outputPath;
}
