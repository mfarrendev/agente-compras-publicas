// Línea de comandos del agente.
//
//   npm run agente -- rastrear [--fuente archivo|compras-agiles|licitaciones]
//   npm run agente -- evaluar <id>     requisitos y veredicto de una compra
//   npm run agente -- costear <id>     oferta económica de una compra
//   npm run agente -- armar <id>       carpeta de postulación (borrador)
//   npm run agente -- estudiar <id>    el agente (IA con herramientas) estudia la compra entera
//   npm run agente -- todo             todo lo anterior para las compras que calzan; con
//                                      ANTHROPIC_API_KEY usa el agente, sin ella el flujo simulado
//
// Opciones: --datos <carpeta> (por defecto ejemplo/), --salida <carpeta> (por defecto salida/),
//           --simulado (sin IA ni costo), --rehacer (no reutilizar etapas guardadas),
//           --umbral <0-100> (pertinencia mínima, por defecto 60),
//           --sin-red (el agente no consulta los datos abiertos de Mercado Público).
import { join } from "node:path";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { cargarDatos, type Datos } from "./datos.js";
import { Estado } from "./estado.js";
import { FuenteArchivo } from "./fuentes/archivo.js";
import { FuenteComprasAgiles, FuenteLicitaciones } from "./fuentes/mercado-publico.js";
import type { Fuente } from "./fuentes/fuente.js";
import { rastrear } from "./agentes/rastreador.js";
import { evaluarPertinencia } from "./agentes/pertinencia.js";
import { extraerRequisitos, verificar } from "./agentes/requisitos.js";
import { costear } from "./agentes/economico.js";
import { armar } from "./agentes/postulacion.js";
import { correrAgente, type ResultadoAgente } from "./agente/agente.js";
import { OCDS } from "./fuentes/ocds.js";
import { PRECIO_USD } from "./llm.js";
import { Compra, type Evaluacion, type Oferta, type Requisitos } from "./tipos.js";

function opcion(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : porDefecto;
}
const bandera = (nombre: string) => process.argv.includes(`--${nombre}`);

// Lee .env si existe (Node 22+), para no exportar las claves a mano.
try {
  process.loadEnvFile();
} catch {}

const comando = process.argv[2] ?? "ayuda";
const idArg = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : null;
const simulado = bandera("simulado") || !process.env.ANTHROPIC_API_KEY;
const datos = cargarDatos(opcion("datos", "ejemplo"));
const estado = new Estado(opcion("salida", "salida"), bandera("rehacer"));
const umbral = Number(opcion("umbral", "60"));

function fuentes(): Fuente[] {
  const f = opcion("fuente", "archivo");
  if (f === "compras-agiles") return [new FuenteComprasAgiles()];
  if (f === "licitaciones") {
    const ticket = process.env.MERCADO_PUBLICO_TICKET;
    if (!ticket) throw new Error("Falta MERCADO_PUBLICO_TICKET (gratis en https://api.mercadopublico.cl).");
    return [new FuenteLicitaciones(ticket)];
  }
  return [new FuenteArchivo(join(datos.dir, "compras"))];
}

async function compraPorId(id: string): Promise<Compra> {
  const todas = await new FuenteArchivo(join(datos.dir, "compras")).buscar();
  const c = todas.find((x) => x.id === id) ?? estadoCompra(id);
  if (!c) throw new Error(`No encuentro la compra ${id}. Corre "rastrear" primero o deja su JSON en ${join(datos.dir, "compras")}.`);
  return c;
}
// Una compra traída de Mercado Público por "rastrear" queda guardada en salida/<id>/1-compra.json.
function estadoCompra(id: string): Compra | null {
  const ruta = join(estado.dir(id), "1-compra.json");
  return existsSync(ruta) ? Compra.parse(JSON.parse(readFileSync(ruta, "utf8"))) : null;
}

function pdfsDe(id: string): string[] {
  const d = join(datos.dir, "compras", id);
  return existsSync(d) ? readdirSync(d).filter((f) => f.toLowerCase().endsWith(".pdf")).map((f) => join(d, f)) : [];
}

async function evaluar(c: Compra): Promise<{ req: Requisitos; ev: Evaluacion }> {
  const req = await estado.paso(c.id, "3-requisitos", () => extraerRequisitos(c, datos, simulado, pdfsDe(c.id)));
  const ev = verificar(c, req, datos); // determinista: se recalcula siempre con los datos vigentes
  estado.escribir(c.id, "3-evaluacion.json", JSON.stringify(ev, null, 2));
  return { req, ev };
}

function oferta(c: Compra, req: Requisitos, ev: Evaluacion): Oferta {
  const o = costear(c, req, datos, ev);
  estado.escribir(c.id, "4-oferta.json", JSON.stringify(o, null, 2));
  return o;
}

// El agente es una sola etapa guardada: volver a correr reutiliza su resultado sin pagar tokens.
async function estudiar(c: Compra): Promise<ResultadoAgente> {
  const r = await estado.paso(c.id, "3-agente", () => {
    console.log(`${c.id}: el agente está estudiando la compra`);
    return correrAgente(c, datos, {
      ocds: bandera("sin-red") ? null : new OCDS(join(opcion("salida", "salida"), ".cache", "ocds")),
      alAvanzar: (l) => console.log(l),
    });
  });
  estado.escribir(c.id, "3-evaluacion.json", JSON.stringify(r.evaluacion, null, 2));
  if (r.oferta) estado.escribir(c.id, "4-oferta.json", JSON.stringify(r.oferta, null, 2));
  estado.escribir(c.id, "informe-agente.md", informeMd(c, r));
  return r;
}

function informeMd(c: Compra, r: ResultadoAgente): string {
  const l = [`# Informe del agente: ${c.id}`, "", `Veredicto (verificación determinista): ${r.evaluacion.veredicto}`, "", r.informe.resumen, ""];
  if (r.informe.riesgosAdicionales.length) l.push("## Riesgos que vio al leer", "", ...r.informe.riesgosAdicionales.map((x) => `- ${x}`), "");
  if (r.informe.preguntasParaRevisar.length) l.push("## Para revisar a mano", "", ...r.informe.preguntasParaRevisar.map((x) => `- ${x}`), "");
  if (r.citasNoEncontradas.length) l.push("## Citas que no aparecen literales en las bases", "", ...r.citasNoEncontradas.map((x) => `- ${x}`), "");
  const t = r.tokens;
  l.push(`## Cómo trabajó (${r.iteraciones} vueltas, ${r.bitacora.length} herramientas)`, "");
  const usd = (t.entrada * PRECIO_USD.entrada + t.salida * PRECIO_USD.salida + t.cacheLeida * PRECIO_USD.cacheLeida + t.cacheEscrita * PRECIO_USD.cacheEscrita) / 1e6;
  l.push(`Tokens: ${t.entrada} de entrada, ${t.cacheLeida} leídos de caché, ${t.cacheEscrita} escritos en caché, ${t.salida} de salida. Costo aproximado: USD ${usd.toFixed(2)}.`, "");
  l.push(...r.bitacora.map((b, i) => `${i + 1}. ${b.herramienta}${b.error ? " (rechazada)" : ""} ${JSON.stringify(b.entrada).slice(0, 140)}`));
  return l.join("\n") + "\n";
}

const clp = (n: number | null) => (n === null ? "sin dato" : `$ ${Math.round(n).toLocaleString("es-CL")}`);

async function main(datos: Datos) {
  if (simulado) console.log("Modo simulado: sin IA, sin costo. Para usar Claude, define ANTHROPIC_API_KEY.\n");
  switch (comando) {
    case "rastrear": {
      const r = await rastrear(fuentes(), datos.organizacion);
      for (const x of r) {
        if (x.pasa) estado.escribir(x.compra.id, "1-compra.json", JSON.stringify(x.compra, null, 2));
        console.log(`${x.pasa ? "PASA   " : "DESCARTA"} ${x.compra.id}  ${x.compra.nombre.slice(0, 70)}  (${x.motivo})`);
      }
      return;
    }
    case "evaluar":
    case "costear":
    case "armar": {
      if (!idArg) throw new Error(`Uso: npm run agente -- ${comando} <id>`);
      const c = await compraPorId(idArg);
      const { req, ev } = await evaluar(c);
      console.log(`${c.id}: ${ev.veredicto}`);
      for (const v of ev.verificaciones) console.log(`  [${v.estado}] ${v.requisito}: ${v.motivo}`);
      for (const r of ev.riesgos) console.log(`  riesgo: ${r}`);
      if (comando === "evaluar") return;
      const o = oferta(c, req, ev);
      console.log(`  costo ${clp(o.costoTotalCLP)} · tope neto ${clp(o.topeNetoCLP)} · recomendado ${clp(o.recomendado?.precioNetoCLP ?? null)} neto, margen ${clp(o.recomendado?.margenCLP ?? null)}`);
      if (comando === "costear") return;
      const archivos = await armar(c, req, ev, o, datos, estado, simulado);
      console.log(`  carpeta: ${archivos.length} archivos en ${estado.dir(c.id)}`);
      return;
    }
    case "estudiar": {
      if (simulado) throw new Error("El agente necesita ANTHROPIC_API_KEY. Sin ella, usa evaluar, costear y armar (flujo simulado).");
      if (!idArg) throw new Error("Uso: npm run agente -- estudiar <id>");
      const c = await compraPorId(idArg);
      const r = await estudiar(c);
      console.log(`${c.id}: ${r.evaluacion.veredicto}. ${r.informe.resumen}`);
      if (r.oferta) {
        await armar(c, r.requisitos, r.evaluacion, r.oferta, datos, estado, simulado);
        console.log(`Precio recomendado ${clp(r.oferta.recomendado?.precioNetoCLP ?? null)} neto. Carpeta en ${estado.dir(c.id)}`);
      }
      return;
    }
    case "todo": {
      const r = await rastrear(fuentes(), datos.organizacion);
      const pasan = r.filter((x) => x.pasa);
      console.log(`${r.length} compras rastreadas, ${pasan.length} pasan el prefiltro.\n`);
      for (const { compra: c } of pasan) {
        const p = await estado.paso(c.id, "2-pertinencia", () => evaluarPertinencia(c, datos.organizacion, simulado));
        if (p.puntaje < umbral) {
          console.log(`- ${c.id} no calza (${p.puntaje}/100): ${p.motivo}`);
          continue;
        }
        let req: Requisitos, ev: Evaluacion, o: Oferta;
        if (simulado) {
          ({ req, ev } = await evaluar(c));
          if (ev.veredicto !== "no_postulable") o = oferta(c, req, ev);
        } else {
          const r = await estudiar(c);
          ({ requisitos: req, evaluacion: ev } = r);
          if (r.oferta) o = r.oferta;
        }
        if (ev.veredicto === "no_postulable") {
          console.log(`- ${c.id} calza (${p.puntaje}/100) pero NO es postulable: ${ev.riesgos[0] ?? ""}`);
          continue;
        }
        o ??= oferta(c, req, ev);
        await armar(c, req, ev, o, datos, estado, simulado);
        console.log(
          `- ${c.id} ${ev.veredicto === "postulable" ? "POSTULABLE" : "POSTULABLE CON BRECHAS"} (${p.puntaje}/100). ` +
            `Precio recomendado ${clp(o.recomendado?.precioNetoCLP ?? null)} neto, margen ${clp(o.recomendado?.margenCLP ?? null)}. ` +
            `Carpeta en ${estado.dir(c.id)}`,
        );
      }
      return;
    }
    default:
      console.log("Comandos: rastrear | evaluar <id> | costear <id> | armar <id> | estudiar <id> | todo. Ver README.md.");
  }
}

main(datos).catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
