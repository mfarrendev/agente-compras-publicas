// Etapa 3: requisitos. Dos pasos separados a propósito.
//
// 1. Extraer (IA): leer las bases y devolver qué exigen, con la frase literal de la que sale
//    cada exigencia. La IA lee; no decide si cumplimos.
// 2. Verificar (código, sin IA): cruzar cada exigencia con el equipo, las experiencias y la
//    organización, y dar un veredicto. Es determinista y tiene pruebas: el mismo equipo frente
//    a las mismas bases da siempre el mismo resultado.
//
// El veredicto existe para no gastar tiempo en ofertas que van a quedar fuera. Una oferta que
// no cumple un requisito de admisibilidad no se evalúa: queda inadmisible, y si todas quedan
// así la compra se declara desierta. Por eso un solo obligatorio en "no cumple" basta para
// "no postulable".
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { pedirJson } from "../llm.js";
import { normalizar } from "../fuentes/fuente.js";
import type { Datos } from "../datos.js";
import {
  Requisitos,
  type Compra,
  type Evaluacion,
  type Experiencia,
  type Persona,
  type Verificacion,
} from "../tipos.js";

const SISTEMA_EXTRACCION = [
  "Lees bases de compras públicas chilenas (Compra Ágil y licitaciones) y extraes lo que exigen al oferente.",
  "Reglas:",
  "- Cada exigencia lleva en `cita` una frase copiada literalmente de las bases. Si no encuentras una frase que la respalde, no la incluyas.",
  "- `obligatorio` es true solo si las bases dicen que sin eso la oferta queda inadmisible, se rechaza o no se evalúa. Lo que solo da puntaje es false.",
  "- Los criterios de evaluación van con su ponderación tal como aparece. Si no hay ponderaciones, deja la lista vacía.",
  "- No inventes valores: si las bases no dicen semestres, años u horas, usa null.",
  "- `servicio.tipoEsfuerzo` debe ser una de estas claves: {CLAVES}.",
].join("\n");

export async function extraerRequisitos(
  compra: Compra,
  datos: Datos,
  simulado: boolean,
  pdfs: string[] = [],
): Promise<Requisitos> {
  if (simulado) {
    // En la demo, lo que la IA devolvería está guardado junto a la compra.
    const ruta = join(datos.dir, "compras", `${compra.id}.requisitos.json`);
    if (!existsSync(ruta)) throw new Error(`Modo simulado: falta ${ruta}`);
    return Requisitos.parse(JSON.parse(readFileSync(ruta, "utf8")));
  }
  const contenido: Anthropic.ContentBlockParam[] = pdfs.map((p) => ({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: readFileSync(p).toString("base64") },
  }));
  contenido.push({
    type: "text",
    text: [
      `Compra ${compra.id}: ${compra.nombre} (${compra.organismo}).`,
      compra.basesTexto ? `Bases:\n${compra.basesTexto}` : "Las bases van en los documentos adjuntos.",
    ].join("\n\n"),
  });
  return pedirJson({
    esquema: Requisitos,
    sistema: SISTEMA_EXTRACCION.replace("{CLAVES}", Object.keys(datos.costos.modelosEsfuerzo).join(", ")),
    contenido,
    esfuerzo: "high",
  });
}

// ---------- Verificación determinista ----------

function contiene(lista: string[], area: string): boolean {
  const a = normalizar(area);
  return lista.some((x) => {
    const n = normalizar(x);
    return n.includes(a) || a.includes(n);
  });
}

export function citaEnBases(cita: string, bases: string | null): boolean | null {
  if (!bases) return null;
  return normalizar(bases).includes(normalizar(cita));
}

type Perfil = Requisitos["perfiles"][number];

export function personaCumplePerfil(p: Persona, req: Perfil): { estado: Verificacion["estado"]; faltas: string[] } {
  const faltas: string[] = [];
  let soloRespaldo = false;

  if (req.tituloAreas.length > 0) {
    const titulos = [p.titulo, ...p.grados].filter((t): t is NonNullable<typeof t> => t !== null);
    const valido = titulos.find(
      (t) =>
        contiene(req.tituloAreas, t.area) &&
        (req.semestresMinimos === null || t.semestres >= req.semestresMinimos) &&
        (!req.tituloObtenidoExigido || t.obtenido),
    );
    if (!valido) faltas.push(`título en ${req.tituloAreas.join(" / ")}${req.semestresMinimos ? ` de ${req.semestresMinimos}+ semestres` : ""}${req.tituloObtenidoExigido ? " ya obtenido" : ""}`);
    else if (!p.respaldos.titulo) soloRespaldo = true;
  }
  if (req.gradoExigido) {
    const g = normalizar(req.gradoExigido);
    if (!p.grados.some((x) => x.obtenido && normalizar(x.nombre).includes(g))) faltas.push(`grado de ${req.gradoExigido}`);
  }
  if (req.anosExperienciaMinimos !== null && p.anosExperiencia < req.anosExperienciaMinimos) {
    faltas.push(`${req.anosExperienciaMinimos} años de experiencia (tiene ${p.anosExperiencia})`);
  }
  if (req.areasExperiencia.length > 0 && !req.areasExperiencia.some((a) => contiene(p.areasExperiencia, a))) {
    faltas.push(`experiencia en ${req.areasExperiencia.join(" / ")}`);
  }
  if (req.horasDocenciaMinimas !== null) {
    if (p.horasDocencia < req.horasDocenciaMinimas) faltas.push(`${req.horasDocenciaMinimas} horas de docencia (tiene ${p.horasDocencia})`);
    else if (!p.respaldos.certificadosDocencia) soloRespaldo = true;
  }
  if (faltas.length) return { estado: "no_cumple", faltas };
  return { estado: soloRespaldo ? "parcial" : "cumple", faltas: soloRespaldo ? ["falta el respaldo documental"] : [] };
}

const RESPALDO_FUERTE = new Set(["orden_de_compra", "factura", "contrato", "recepcion_conforme", "carta_mandante", "certificado"]);

export function experienciasValidas(exps: Experiencia[], req: NonNullable<Requisitos["experienciaOferente"]>, hoy = new Date()): Experiencia[] {
  const limite = req.anosHaciaAtras ? new Date(hoy.getFullYear() - req.anosHaciaAtras, hoy.getMonth(), hoy.getDate()) : null;
  const aceptados = req.respaldosAceptados.length ? new Set<string>(req.respaldosAceptados) : RESPALDO_FUERTE;
  return exps.filter(
    (e) =>
      (limite === null || new Date(e.termino) >= limite) &&
      (req.areas.length === 0 || req.areas.some((a) => contiene(e.areas, a) || normalizar(e.servicio).includes(normalizar(a)))) &&
      e.respaldos.some((r) => aceptados.has(r)),
  );
}

export function verificar(compra: Compra, req: Requisitos, datos: Datos): Evaluacion {
  const { organizacion: org, equipo, experiencias } = datos;
  const v: Verificacion[] = [];
  const acciones: string[] = [];
  const riesgos: string[] = [];
  const cita = (c: string) => citaEnBases(c, compra.basesTexto);

  // Perfiles: cada perfil lo tiene que cubrir una persona distinta.
  const ocupadas = new Set<string>();
  for (const perfil of req.perfiles) {
    const candidatas = equipo
      .filter((p) => !ocupadas.has(p.id))
      .map((p) => ({ p, r: personaCumplePerfil(p, perfil) }));
    const mejor =
      candidatas.find((c) => c.r.estado === "cumple") ?? candidatas.find((c) => c.r.estado === "parcial");
    if (mejor) {
      ocupadas.add(mejor.p.id);
      v.push({
        requisito: `Perfil: ${perfil.rol}`,
        obligatorio: perfil.obligatorio,
        estado: mejor.r.estado,
        motivo: mejor.r.estado === "cumple" ? `lo cubre ${mejor.p.nombre}` : `${mejor.p.nombre} cumple, pero ${mejor.r.faltas.join("; ")}`,
        cubiertoPor: [mejor.p.id],
        citaVerificada: cita(perfil.cita),
      });
      if (mejor.r.estado === "parcial") acciones.push(`Conseguir el respaldo de ${mejor.p.nombre} para "${perfil.rol}".`);
    } else {
      const masCerca = candidatas.sort((a, b) => a.r.faltas.length - b.r.faltas.length)[0];
      v.push({
        requisito: `Perfil: ${perfil.rol}`,
        obligatorio: perfil.obligatorio,
        estado: "no_cumple",
        motivo: masCerca ? `nadie del equipo lo cubre; a ${masCerca.p.nombre} le falta ${masCerca.r.faltas.join("; ")}` : "el equipo está vacío",
        cubiertoPor: [],
        citaVerificada: cita(perfil.cita),
      });
      if (org.aceptaExpertosExternos) {
        acciones.push(`Buscar un experto externo para "${perfil.rol}" (con carta de compromiso firmada).`);
      }
    }
  }

  // Experiencia del oferente.
  if (req.experienciaOferente) {
    const e = req.experienciaOferente;
    const validas = experienciasValidas(experiencias, e);
    const minimo = e.serviciosMinimos ?? 1;
    const estado = validas.length >= minimo ? "cumple" : validas.length > 0 ? "parcial" : "no_cumple";
    v.push({
      requisito: `Experiencia del oferente (${minimo}+ servicios${e.anosHaciaAtras ? ` en ${e.anosHaciaAtras} años` : ""})`,
      obligatorio: e.obligatorio,
      estado,
      motivo: `con respaldo aceptado: ${validas.map((x) => x.id).join(", ") || "ninguna"} (${validas.length} de ${minimo})`,
      cubiertoPor: validas.map((x) => x.id),
      citaVerificada: cita(e.cita),
    });
    if (estado !== "cumple") acciones.push(`Faltan ${minimo - validas.length} experiencias acreditables; revisar facturas y órdenes de compra antiguas.`);
  }

  // Requisitos institucionales.
  for (const r of req.institucionales) {
    let estado: Verificacion["estado"] = "revisar";
    let motivo = "requiere revisión humana";
    if (normalizar(r.tipo).includes("registro")) {
      estado = org.inscritaRegistroProveedores ? "cumple" : "no_cumple";
      motivo = org.inscritaRegistroProveedores ? "inscrita y hábil" : "no está inscrita en el Registro de Proveedores";
    } else if (normalizar(r.tipo).includes("garantia")) {
      motivo = "se entrega al adjudicar; confirmar que la organización puede emitirla";
    } else if (org.tiposInstitucion.some((t) => normalizar(t) === normalizar(r.tipo))) {
      estado = "cumple";
      motivo = "la organización declara ese tipo de institución";
    } else {
      estado = "no_cumple";
      motivo = `la organización no declara ser: ${r.descripcion}`;
    }
    v.push({ requisito: `Institucional: ${r.descripcion}`, obligatorio: r.obligatorio, estado, motivo, cubiertoPor: [], citaVerificada: cita(r.cita) });
  }

  // Documentos: no se pueden verificar contra datos; quedan como lista de chequeo.
  for (const d of req.documentos) {
    v.push({ requisito: `Documento: ${d.nombre}`, obligatorio: d.obligatorio, estado: "revisar", motivo: "se prepara en la carpeta de postulación", cubiertoPor: [], citaVerificada: cita(d.cita) });
  }

  // Riesgos que no son requisitos pero pesan en la decisión.
  const sello = req.criterios.find((c) => c.tipo === "sello_empresa_mujer");
  if (sello && !org.selloEmpresaMujer) riesgos.push(`Se pierde ${sello.ponderacion} % por no tener Sello Empresa Mujer.`);
  if (org.sancionesUltimos24Meses > 0) riesgos.push(`La organización tiene ${org.sancionesUltimos24Meses} sanciones en 24 meses; baja el puntaje de comportamiento.`);
  if (compra.cotizacionesRecibidas !== null && compra.cotizacionesRecibidas >= 6) {
    riesgos.push(`Ya hay ${compra.cotizacionesRecibidas} cotizaciones: la competencia por precio será fuerte.`);
  }
  const sinCita = v.filter((x) => x.citaVerificada === false);
  if (sinCita.length) riesgos.push(`${sinCita.length} requisitos traen una cita que no aparece literal en las bases: revisarlos a mano.`);

  const obligatoriosFallidos = v.filter((x) => x.obligatorio && x.estado === "no_cumple");
  const brechas = v.filter((x) => x.estado === "parcial" || (!x.obligatorio && x.estado === "no_cumple"));
  // Un perfil obligatorio que falta se puede cubrir con un externo: es brecha, no descarte.
  const descartan = obligatoriosFallidos.filter((x) => !(x.requisito.startsWith("Perfil:") && org.aceptaExpertosExternos));
  const veredicto = descartan.length
    ? "no_postulable"
    : obligatoriosFallidos.length || brechas.length
      ? "postulable_con_brechas"
      : "postulable";
  if (descartan.length) {
    riesgos.unshift(`Quedaría inadmisible por: ${descartan.map((x) => x.requisito).join("; ")}.`);
  }
  return { compraId: compra.id, veredicto, verificaciones: v, riesgos, acciones };
}
