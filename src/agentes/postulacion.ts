// Etapa 5: armar la carpeta de postulación. Deja en salida/<id>/ un borrador listo para que
// una persona lo revise, lo firme y lo suba. El agente nunca envía nada al portal: la oferta
// la presenta el representante legal, y lo que se declara ahí es su responsabilidad.
//
// Todo sale en HTML para imprimir a PDF (cualquier navegador: Imprimir > Guardar como PDF).
import { z } from "zod";
import { pedirJson } from "../llm.js";
import type { Datos } from "../datos.js";
import type { Estado } from "../estado.js";
import type { Compra, Evaluacion, Oferta, Persona, Requisitos } from "../tipos.js";

const clp = (n: number) => `$ ${Math.round(n).toLocaleString("es-CL")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CSS = `
  @page { size: Letter; margin: 20mm; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 10pt; line-height: 1.3; color: #000; }
  h1 { font-size: 14pt; text-align: center; } h2 { font-size: 11pt; margin-top: 14pt; }
  p { text-align: justify; margin: 0 0 6pt; }
  table { width: 100%; border-collapse: collapse; margin: 4pt 0 10pt; }
  th, td { border: 0.75pt solid #9aa5b1; padding: 3pt 5pt; text-align: left; vertical-align: top; }
  tr:nth-child(even) td { background: #eef1f4; }
  .n { text-align: right; white-space: nowrap; }
  .borrador { border: 1pt solid #b45309; padding: 4pt 6pt; margin-bottom: 10pt; font-size: 9pt; }
  .firma { margin-top: 40pt; text-align: center; } .firma div { width: 60%; margin: 0 auto 3pt; border-top: 0.75pt solid #000; }`;

const pagina = (titulo: string, cuerpo: string) =>
  `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${CSS}</style></head><body>${cuerpo}</body></html>`;

const AVISO = `<p class="borrador">Borrador generado automáticamente. Revisar cada dato contra sus respaldos antes de firmar y subir.</p>`;

export function cotizacionHtml(compra: Compra, datos: Datos, oferta: Oferta): string {
  const org = datos.organizacion;
  const r = oferta.recomendado;
  const filas = r
    ? org.facturaExenta
      ? `<tr><td>Valor exento</td><td class="n">${clp(r.precioNetoCLP)}</td></tr><tr><td><b>Total</b></td><td class="n"><b>${clp(r.precioTotalCLP)}</b></td></tr>`
      : `<tr><td>Valor neto</td><td class="n">${clp(r.precioNetoCLP)}</td></tr><tr><td>IVA (${Math.round(datos.costos.ivaPct * 100)} %)</td><td class="n">${clp(r.precioTotalCLP - r.precioNetoCLP)}</td></tr><tr><td><b>Total</b></td><td class="n"><b>${clp(r.precioTotalCLP)}</b></td></tr>`
    : `<tr><td colspan="2">Sin precio recomendado: revisar la etapa económica.</td></tr>`;
  return pagina(
    `Cotización ${compra.id}`,
    `${AVISO}<p>Santiago, ___ de __________ de 20__</p>
<p>Señores<br>${esc(compra.organismo)}<br>Presente</p>
<p>Ref.: ${esc(compra.id)}, “${esc(compra.nombre)}”.</p>
<p>De nuestra consideración:</p>
<p>${esc(org.nombre)}, RUT ${esc(org.rut)}, presenta su cotización para el servicio de la referencia, conforme a las bases y especificaciones técnicas publicadas.</p>
<table><tr><th>Concepto</th><th class="n">Monto</th></tr>${filas}</table>
<p>Sin otro particular, saluda atentamente,</p>
<div class="firma"><div></div><p>Representante legal<br>${esc(org.nombre)}</p></div>`,
  );
}

export function cvHtml(p: Persona, compra: Compra): string {
  const titulos = [p.titulo, ...p.grados]
    .filter((t): t is NonNullable<typeof t> => t !== null)
    .map((t) => `<li>${esc(t.nombre)} (${esc(t.area)}, ${t.semestres} semestres)${t.obtenido ? "" : ", en curso"}</li>`)
    .join("");
  return pagina(
    `CV ${p.nombre}`,
    `${AVISO}<h1>${esc(p.nombre.toUpperCase())}</h1>
<p style="text-align:center">Currículum para ${esc(compra.id)}</p>
<h2>FORMACIÓN</h2><ul>${titulos || "<li>Sin títulos registrados</li>"}</ul>
<h2>EXPERIENCIA</h2><p>${p.anosExperiencia} años, en ${esc(p.areasExperiencia.join(", "))}.</p>
<h2>DOCENCIA</h2><p>${p.horasDocencia} horas de docencia o capacitación.</p>`,
  );
}

const Borrador = z.object({
  secciones: z.array(z.object({ titulo: z.string(), parrafos: z.array(z.string()) })),
});

async function borradorPropuesta(compra: Compra, req: Requisitos, datos: Datos, simulado: boolean) {
  if (simulado) {
    return {
      secciones: [
        { titulo: "1. Presentación del oferente", parrafos: [datos.organizacion.descripcion] },
        { titulo: "2. Comprensión del requerimiento", parrafos: [compra.descripcion || compra.nombre] },
        { titulo: "3. Metodología y plan de trabajo", parrafos: ["(Modo simulado: con la IA activa, aquí va el borrador de la metodología, escrito a partir de las bases y del equipo.)"] },
        { titulo: "4. Equipo", parrafos: datos.equipo.map((p) => `${p.nombre}: ${p.areasExperiencia.join(", ")}.`) },
      ],
    };
  }
  return pedirJson({
    esquema: Borrador,
    sistema: [
      "Redactas borradores de propuestas técnicas para compras públicas chilenas.",
      "Escribe como una consultora: en futuro y tercera persona, prosa clara y sin adornos, sin listas de eslóganes.",
      "Usa solo los datos entregados del oferente, su equipo y sus experiencias. No inventes experiencias, cifras, clientes ni títulos; si falta algo, escribe [COMPLETAR: qué falta].",
      "Cubre cada contenido mínimo y cada criterio de evaluación que piden las bases.",
    ].join("\n"),
    contenido: [
      {
        type: "text",
        text: JSON.stringify({
          compra: { id: compra.id, nombre: compra.nombre, organismo: compra.organismo, descripcion: compra.descripcion },
          requisitos: req,
          oferente: datos.organizacion,
          equipo: datos.equipo,
          experiencias: datos.experiencias,
          bases: compra.basesTexto,
        }),
      },
    ],
    esfuerzo: "high",
  });
}

export function resumenMd(compra: Compra, ev: Evaluacion, oferta: Oferta | null): string {
  const marca = { cumple: "Cumple", parcial: "Parcial", no_cumple: "No cumple", revisar: "Revisar" } as const;
  const lineas = [
    `# ${compra.id}: ${compra.nombre}`,
    "",
    `- Organismo: ${compra.organismo}`,
    `- Tipo: ${compra.tipo === "compra_agil" ? "Compra Ágil" : "Licitación"} · Cierre: ${compra.cierre ?? "sin dato"}`,
    `- Presupuesto: ${compra.presupuestoCLP !== null ? clp(compra.presupuestoCLP) : "no informado"}`,
    compra.url ? `- Ficha: ${compra.url}` : "",
    "",
    `## Veredicto: ${{ postulable: "Postulable", postulable_con_brechas: "Postulable con brechas", no_postulable: "No postulable" }[ev.veredicto]}`,
    "",
    "| Requisito | Obligatorio | Estado | Detalle | Cita verificada |",
    "|---|---|---|---|---|",
    ...ev.verificaciones.map(
      (v) => `| ${v.requisito} | ${v.obligatorio ? "Sí" : "No"} | ${marca[v.estado]} | ${v.motivo} | ${v.citaVerificada === null ? "sin texto de bases" : v.citaVerificada ? "Sí" : "No"} |`,
    ),
    "",
  ];
  if (ev.riesgos.length) lineas.push("## Riesgos", "", ...ev.riesgos.map((r) => `- ${r}`), "");
  if (ev.acciones.length) lineas.push("## Qué falta para postular", "", ...ev.acciones.map((a) => `- ${a}`), "");
  if (oferta) {
    lineas.push(
      "## Oferta económica",
      "",
      `Costo estimado: ${clp(oferta.costoTotalCLP)} neto. Tope: ${oferta.topeNetoCLP !== null ? clp(oferta.topeNetoCLP) : "sin dato"} neto. Competidor estimado: ${oferta.precioCompetidorEstimadoCLP !== null ? clp(oferta.precioCompetidorEstimadoCLP) : "sin dato"}.`,
      "",
      "| Escenario | Precio neto | Total | Margen | Margen % | Puntaje estimado |",
      "|---|---|---|---|---|---|",
      ...oferta.escenarios.map(
        (e) =>
          `| ${e.etiqueta}${oferta.recomendado?.etiqueta === e.etiqueta ? " (recomendado)" : ""} | ${clp(e.precioNetoCLP)} | ${clp(e.precioTotalCLP)} | ${clp(e.margenCLP)} | ${Math.round(e.margenPct * 100)} % | ${e.puntajeTotalEstimado} |`,
      ),
      "",
      ...oferta.advertencias.map((a) => `- ${a}`),
      "",
    );
  }
  lineas.push("Este resumen lo generó el agente. La decisión de postular y lo que se declara en la oferta son de una persona.");
  return lineas.filter((l, i, a) => !(l === "" && a[i - 1] === "")).join("\n");
}

export async function armar(
  compra: Compra,
  req: Requisitos,
  ev: Evaluacion,
  oferta: Oferta,
  datos: Datos,
  estado: Estado,
  simulado: boolean,
): Promise<string[]> {
  const archivos: string[] = [];
  archivos.push(estado.escribir(compra.id, "resumen.md", resumenMd(compra, ev, oferta)));
  archivos.push(estado.escribir(compra.id, "cotizacion.html", cotizacionHtml(compra, datos, oferta)));

  const asignadas = new Set(ev.verificaciones.flatMap((v) => v.cubiertoPor));
  for (const p of datos.equipo.filter((x) => asignadas.has(x.id))) {
    archivos.push(estado.escribir(compra.id, `cv-${p.id}.html`, cvHtml(p, compra)));
  }

  const borrador = await estado.paso(compra.id, "5-propuesta", () => borradorPropuesta(compra, req, datos, simulado));
  const cuerpo = borrador.secciones
    .map((s) => `<h2>${esc(s.titulo)}</h2>${s.parrafos.map((p) => `<p>${esc(p)}</p>`).join("")}`)
    .join("");
  archivos.push(
    estado.escribir(compra.id, "propuesta.html", pagina(`Propuesta ${compra.id}`, `${AVISO}<h1>PROPUESTA TÉCNICA</h1><p style="text-align:center">${esc(compra.id)} · ${esc(compra.nombre)}</p>${cuerpo}`)),
  );

  const lista = [
    `# Lista de chequeo: ${compra.id}`,
    "",
    ...req.documentos.map((d) => `- [ ] ${d.nombre}${d.obligatorio ? " (obligatorio)" : ""}`),
    "- [ ] Cotización revisada y firmada (cotizacion.html)",
    "- [ ] Propuesta técnica revisada (propuesta.html)",
    ...datos.equipo.filter((x) => asignadas.has(x.id)).map((p) => `- [ ] CV y respaldos de ${p.nombre}`),
    "- [ ] Respaldos de experiencia: " + (ev.verificaciones.find((v) => v.requisito.startsWith("Experiencia"))?.cubiertoPor.join(", ") || "ninguno"),
    "- [ ] Si el portal pide el precio neto, ingresar el neto y no el total",
    "",
  ];
  archivos.push(estado.escribir(compra.id, "lista-de-chequeo.md", lista.join("\n")));
  return archivos;
}
