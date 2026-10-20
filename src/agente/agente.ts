// El agente: un modelo con herramientas que decide cómo estudiar una compra. Lee las bases a su
// ritmo (los anexos que hagan falta), busca la frase literal de cada requisito, investiga al
// comprador en los datos abiertos de Mercado Público y entrega un informe.
//
// Lo que el agente no puede hacer, porque las herramientas no lo dejan (ver herramientas.ts):
// escribir el veredicto, inventar el precio de la competencia sin evidencia consultada, ni
// entregar el informe sin haber verificado y costeado.
//
// Usa el tool runner del SDK: el bucle (modelo -> herramientas -> resultados -> modelo) lo
// lleva el SDK, con un tope de iteraciones.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Datos } from "../datos.js";
import type { OCDS } from "../fuentes/ocds.js";
import { MODELO } from "../llm.js";
import type { Compra, Evaluacion, Oferta, Requisitos } from "../tipos.js";
import { crearHerramientas, type Contexto, type Documento, type Informe } from "./herramientas.js";

export interface ResultadoAgente {
  requisitos: Requisitos;
  evaluacion: Evaluacion;
  oferta: Oferta | null;
  informe: Informe;
  citasNoEncontradas: string[];
  bitacora: Contexto["bitacora"];
  iteraciones: number;
  // Tokens sumados de todas las vueltas, para saber cuánto costó el estudio.
  tokens: { entrada: number; salida: number; cacheLeida: number; cacheEscrita: number };
}

const CARACTERES_POR_PAGINA_TXT = 4000;

function paginasDeTexto(texto: string): string[] {
  if (texto.includes("\f")) return texto.split("\f");
  const paginas: string[] = [];
  for (let i = 0; i < texto.length; i += CARACTERES_POR_PAGINA_TXT) paginas.push(texto.slice(i, i + CARACTERES_POR_PAGINA_TXT));
  return paginas.length ? paginas : [""];
}

// pdftotext (poppler) da el texto con un salto de página (\f) entre páginas. Sin él, el PDF
// va entero al modelo y las citas de ese documento no se pueden verificar.
function textoDePdf(ruta: string): string[] {
  try {
    return execFileSync("pdftotext", ["-layout", ruta, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\f");
  } catch {
    return [];
  }
}

export function documentosDe(compra: Compra, datos: Datos): Documento[] {
  const docs: Documento[] = [];
  if (compra.basesTexto) docs.push({ nombre: "bases.txt", paginas: paginasDeTexto(compra.basesTexto), rutaPdf: null });
  const dir = join(datos.dir, "compras", compra.id);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).sort()) {
      if (f.toLowerCase().endsWith(".pdf")) docs.push({ nombre: f, paginas: textoDePdf(join(dir, f)), rutaPdf: join(dir, f) });
      else if (f.toLowerCase().endsWith(".txt")) docs.push({ nombre: f, paginas: paginasDeTexto(readFileSync(join(dir, f), "utf8")), rutaPdf: null });
    }
  }
  return docs;
}

export function sistemaAgente(datos: Datos): string {
  const org = datos.organizacion;
  return [
    `Trabajas para ${org.nombre}, que postula a compras públicas en Chile (Mercado Público).`,
    `Qué hace la organización: ${org.descripcion}`,
    "",
    "Tu trabajo con cada compra es decir si conviene postular y a qué precio, y dejar listo lo que una persona necesita para decidir.",
    "",
    "Cómo trabajar:",
    "- Lee los documentos de la compra con listar_documentos y leer_documento. Las bases suelen tener los requisitos de admisibilidad, el equipo exigido y la pauta de evaluación en secciones distintas, a veces en anexos: léelas antes de registrar.",
    "- Registra los requisitos con registrar_requisitos. Cada cita es una frase copiada literal. Si la herramienta dice que una cita no aparece, búscala con buscar_en_bases y corrígela; si no la encuentras, saca ese requisito. No inventes exigencias.",
    "- `obligatorio` es true solo si las bases dicen que sin eso la oferta queda inadmisible, se rechaza o no se evalúa.",
    "- Llama a verificar_postulacion. Su veredicto es el que vale; no lo discutas en el informe, explícalo.",
    "- Si la compra no es postulable, no costees: entrega el informe diciendo qué la deja fuera.",
    "- Si es postulable, investiga el precio de la competencia antes de costear: historial_propio y, si la compra es una licitación, licitaciones_del_comprador y resultado_licitacion para las parecidas del mismo comprador (mismo tipo de servicio). Fíjate en cuántas ofertas reciben, cuántas descalifican y a cuánto adjudican. Si encuentras casos comparables, pasa a costear el precio neto estimado con esos casos como evidencia; si no, costea sin él.",
    "- Termina con entregar_informe. Escribe en español de Chile, claro y sin adornos.",
  ].join("\n");
}

export interface OpcionesAgente {
  cliente?: Anthropic;
  ocds: OCDS | null;
  maxIteraciones?: number;
  alAvanzar?: (linea: string) => void;
}

export async function correrAgente(compra: Compra, datos: Datos, op: OpcionesAgente): Promise<ResultadoAgente> {
  const documentos = documentosDe(compra, datos);
  const ctx: Contexto = {
    // La verificación busca las citas en compra.basesTexto: se le da el texto de todos los documentos.
    compra: { ...compra, basesTexto: documentos.flatMap((d) => d.paginas).join("\n") || null },
    datos,
    documentos,
    ocds: op.ocds,
    requisitos: null,
    citasNoEncontradas: [],
    evaluacion: null,
    oferta: null,
    evidencia: new Map(),
    informe: null,
    bitacora: [],
  };
  const cliente = op.cliente ?? new Anthropic();
  const runner = cliente.beta.messages.toolRunner({
    model: MODELO,
    max_tokens: 16000,
    max_iterations: op.maxIteraciones ?? 40,
    thinking: { type: "adaptive" },
    output_config: { effort: "high" },
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: sistemaAgente(datos), cache_control: { type: "ephemeral" } }],
    tools: crearHerramientas(ctx),
    messages: [
      {
        role: "user",
        content: [
          `Estudia la compra ${compra.id} (${compra.tipo === "compra_agil" ? "Compra Ágil" : "licitación"}): "${compra.nombre}", de ${compra.organismo}.`,
          `Descripción: ${compra.descripcion || "(sin descripción)"}`,
          `Presupuesto: ${compra.presupuestoCLP ?? "no informado"} CLP${compra.presupuestoIncluyeImpuestos === false ? " neto" : ""}. Cierre: ${compra.cierre ?? "sin dato"}.`,
          `Documentos: ${documentos.map((d) => d.nombre).join(", ") || "ninguno (solo la descripción)"}.`,
        ].join("\n"),
      },
    ],
  });

  let iteraciones = 0;
  let ultimo: Anthropic.Beta.BetaMessage | null = null;
  let visto = 0;
  const tokens = { entrada: 0, salida: 0, cacheLeida: 0, cacheEscrita: 0 };
  for await (const mensaje of runner) {
    iteraciones++;
    ultimo = mensaje;
    tokens.entrada += mensaje.usage.input_tokens;
    tokens.salida += mensaje.usage.output_tokens;
    tokens.cacheLeida += mensaje.usage.cache_read_input_tokens ?? 0;
    tokens.cacheEscrita += mensaje.usage.cache_creation_input_tokens ?? 0;
    if (mensaje.stop_reason === "refusal") throw new Error("El modelo declinó la solicitud; la compra queda para revisión humana.");
    if (mensaje.stop_reason === "max_tokens") throw new Error("Una respuesta del agente se cortó por largo (max_tokens).");
    // Primero lo que pasó con las herramientas de la vuelta anterior, después lo que pide ahora.
    for (const e of ctx.bitacora.slice(visto)) if (e.error) op.alAvanzar?.(`     (${e.herramienta} rechazada: ${e.salida.slice(0, 120)})`);
    visto = ctx.bitacora.length;
    for (const b of mensaje.content) if (b.type === "tool_use") op.alAvanzar?.(`  -> ${b.name}`);
  }
  if (!ctx.informe || !ctx.evaluacion || !ctx.requisitos) {
    const motivo = iteraciones >= (op.maxIteraciones ?? 40) ? "llegó al tope de iteraciones" : `se detuvo (${ultimo?.stop_reason ?? "sin respuesta"})`;
    throw new Error(`El agente ${motivo} sin entregar el informe. Bitácora: ${ctx.bitacora.map((b) => b.herramienta).join(" > ")}`);
  }
  return {
    requisitos: ctx.requisitos,
    evaluacion: ctx.evaluacion,
    oferta: ctx.oferta,
    informe: ctx.informe,
    citasNoEncontradas: ctx.citasNoEncontradas,
    bitacora: ctx.bitacora,
    iteraciones,
    tokens,
  };
}
