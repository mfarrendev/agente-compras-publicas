// Herramientas del agente. El modelo decide cuáles usar y en qué orden; las decisiones que
// cuestan plata siguen siendo código:
//
// - El veredicto (postulable o no) lo da `verificar_postulacion`, que corre la verificación
//   determinista de src/agentes/requisitos.ts. El modelo no puede escribirlo: el informe final
//   lo toma de aquí.
// - El precio lo calcula `costear` con la aritmética de src/agentes/economico.ts. El modelo
//   puede proponer el precio de la competencia, pero solo citando casos que haya consultado en
//   esta misma corrida con `historial_propio` o `resultado_licitacion`.
// - Cada requisito que registra lleva una cita, y `registrar_requisitos` comprueba que esté
//   literal en las bases. Si no está, se lo devuelve para que la busque o la saque.
//
// Una herramienta que se niega lanza un Error: el SDK lo devuelve al modelo como resultado
// con is_error y el modelo sigue desde ahí.
import { readFileSync } from "node:fs";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Datos } from "../datos.js";
import { normalizar } from "../fuentes/fuente.js";
import { OCDS, unidadDeCodigo } from "../fuentes/ocds.js";
import { citaEnBases, verificar } from "../agentes/requisitos.js";
import { costear } from "../agentes/economico.js";
import { Requisitos, type Compra, type Evaluacion, type Oferta } from "../tipos.js";

export interface Documento {
  nombre: string;
  // Texto por página. Para un PDF sale de pdftotext; si no hay texto (PDF escaneado o sin
  // pdftotext), queda vacío y el PDF se entrega entero al modelo como documento.
  paginas: string[];
  rutaPdf: string | null;
}

export interface Informe {
  resumen: string;
  riesgosAdicionales: string[];
  preguntasParaRevisar: string[];
}

export interface Contexto {
  compra: Compra;
  datos: Datos;
  documentos: Documento[];
  ocds: OCDS | null;
  requisitos: Requisitos | null;
  citasNoEncontradas: string[];
  evaluacion: Evaluacion | null;
  oferta: Oferta | null;
  // Casos de historial que el agente vio en esta corrida: id -> resumen. Solo estos sirven
  // como evidencia del precio de la competencia.
  evidencia: Map<string, string>;
  informe: Informe | null;
  bitacora: { herramienta: string; entrada: unknown; salida: string; error: boolean }[];
}

const textoCompleto = (docs: Documento[]) => docs.flatMap((d) => d.paginas).join("\n");

function citasDe(req: Requisitos): { donde: string; cita: string }[] {
  return [
    ...req.perfiles.map((p) => ({ donde: `perfil "${p.rol}"`, cita: p.cita })),
    ...(req.experienciaOferente ? [{ donde: "experiencia del oferente", cita: req.experienciaOferente.cita }] : []),
    ...req.institucionales.map((r) => ({ donde: `institucional "${r.tipo}"`, cita: r.cita })),
    ...req.documentos.map((d) => ({ donde: `documento "${d.nombre}"`, cita: d.cita })),
    ...req.criterios.map((c) => ({ donde: `criterio "${c.nombre}"`, cita: c.cita })),
  ];
}

const MAX_CARACTERES_POR_LECTURA = 24_000;

export function crearHerramientas(ctx: Contexto) {
  const registrar = <T>(nombre: string, run: (e: T) => Promise<string | ReturnType<typeof documentoPdf>> | string | ReturnType<typeof documentoPdf>) =>
    async (entrada: T) => {
      try {
        const salida = await run(entrada);
        ctx.bitacora.push({ herramienta: nombre, entrada, salida: typeof salida === "string" ? salida.slice(0, 2000) : "[documento PDF]", error: false });
        return salida;
      } catch (e) {
        ctx.bitacora.push({ herramienta: nombre, entrada, salida: e instanceof Error ? e.message : String(e), error: true });
        throw e;
      }
    };

  const listarDocumentos = betaZodTool({
    name: "listar_documentos",
    description: "Lista los documentos de la compra (bases, anexos) con su número de páginas y si tienen texto legible.",
    inputSchema: z.object({}),
    run: registrar("listar_documentos", () =>
      JSON.stringify(
        ctx.documentos.map((d) => ({
          nombre: d.nombre,
          paginas: d.paginas.length,
          conTexto: d.paginas.some((p) => p.trim().length > 0),
        })),
      ),
    ),
  });

  const leerDocumento = betaZodTool({
    name: "leer_documento",
    description:
      "Lee páginas de un documento de la compra. Para documentos largos, lee por tramos. Si el PDF no tiene texto, se entrega entero como documento.",
    inputSchema: z.object({
      nombre: z.string(),
      desde: z.number().int().min(1).default(1).describe("Primera página, desde 1"),
      hasta: z.number().int().min(1).optional().describe("Última página, incluida"),
    }),
    run: registrar("leer_documento", ({ nombre, desde, hasta }: { nombre: string; desde: number; hasta?: number }) => {
      const d = ctx.documentos.find((x) => x.nombre === nombre);
      if (!d) throw new Error(`No existe "${nombre}". Documentos: ${ctx.documentos.map((x) => x.nombre).join(", ")}`);
      if (d.rutaPdf && !d.paginas.some((p) => p.trim())) return documentoPdf(d.rutaPdf);
      let texto = "";
      let ultima = desde - 1;
      for (let i = desde - 1; i < Math.min(hasta ?? d.paginas.length, d.paginas.length); i++) {
        const pagina = `\n--- página ${i + 1} ---\n${d.paginas[i]}`;
        if (texto.length + pagina.length > MAX_CARACTERES_POR_LECTURA && texto) break;
        texto += pagina;
        ultima = i + 1;
      }
      if (!texto) throw new Error(`"${nombre}" tiene ${d.paginas.length} páginas.`);
      const resto = ultima < d.paginas.length ? `\n[Quedan páginas ${ultima + 1} a ${d.paginas.length}.]` : "";
      return texto.slice(0, MAX_CARACTERES_POR_LECTURA) + resto;
    }),
  });

  const buscarEnBases = betaZodTool({
    name: "buscar_en_bases",
    description:
      "Busca un texto en todos los documentos, sin distinguir tildes ni mayúsculas, y devuelve los pasajes con su documento y página. Úsala para encontrar la frase literal que respalda un requisito.",
    inputSchema: z.object({ texto: z.string().min(3) }),
    run: registrar("buscar_en_bases", ({ texto }: { texto: string }) => {
      const buscado = normalizar(texto);
      const palabras = buscado.split(/\s+/).filter((p) => p.length > 3);
      const hallazgos: string[] = [];
      for (const d of ctx.documentos) {
        d.paginas.forEach((pag, i) => {
          const n = normalizar(pag);
          let pos = n.indexOf(buscado);
          // Si la frase exacta no está, se aceptan páginas que tengan todas las palabras largas.
          if (pos < 0 && palabras.length > 1 && palabras.every((p) => n.includes(p))) pos = n.indexOf(palabras[0] as string);
          if (pos >= 0 && hallazgos.length < 8) {
            hallazgos.push(`[${d.nombre}, p. ${i + 1}] ...${pag.slice(Math.max(0, pos - 250), pos + buscado.length + 250)}...`);
          }
        });
      }
      return hallazgos.length ? hallazgos.join("\n\n") : "Sin resultados.";
    }),
  });

  const registrarRequisitos = betaZodTool({
    name: "registrar_requisitos",
    description:
      "Registra lo que exigen las bases. Cada cita debe ser una frase copiada literal de los documentos. Devuelve las citas que no aparecen: búscalas y vuelve a registrar, o saca el requisito si no tiene respaldo.",
    inputSchema: z.object({ requisitos: Requisitos }),
    run: registrar("registrar_requisitos", ({ requisitos }: { requisitos: Requisitos }) => {
      const claves = Object.keys(ctx.datos.costos.modelosEsfuerzo);
      if (!claves.includes(requisitos.servicio.tipoEsfuerzo)) {
        throw new Error(`servicio.tipoEsfuerzo debe ser una de: ${claves.join(", ")}.`);
      }
      const texto = textoCompleto(ctx.documentos);
      const fallidas = texto.trim() ? citasDe(requisitos).filter((c) => citaEnBases(c.cita, texto) === false) : [];
      ctx.requisitos = requisitos;
      ctx.citasNoEncontradas = fallidas.map((f) => `${f.donde}: "${f.cita}"`);
      // Requisitos nuevos invalidan lo calculado con los anteriores.
      ctx.evaluacion = null;
      ctx.oferta = null;
      if (!texto.trim()) return "Registrado. Las bases no tienen texto legible: las citas no se pudieron verificar y el informe lo dirá.";
      return fallidas.length
        ? `Registrado, pero ${fallidas.length} citas no aparecen literales en las bases:\n${ctx.citasNoEncontradas.join("\n")}\nBúscalas con buscar_en_bases y vuelve a registrar, o saca esos requisitos.`
        : `Registrado. Las ${citasDe(requisitos).length} citas aparecen literales en las bases.`;
    }),
  });

  const verEquipo = betaZodTool({
    name: "ver_equipo",
    description: "Muestra el equipo (títulos, años, áreas, docencia, respaldos) y las experiencias de la organización.",
    inputSchema: z.object({}),
    run: registrar("ver_equipo", () =>
      JSON.stringify({
        organizacion: { ...ctx.datos.organizacion, rut: undefined },
        equipo: ctx.datos.equipo,
        experiencias: ctx.datos.experiencias,
      }),
    ),
  });

  const verificarPostulacion = betaZodTool({
    name: "verificar_postulacion",
    description:
      "Cruza los requisitos registrados con el equipo y la organización y da el veredicto (postulable, con brechas, no postulable). Es código determinista: el veredicto que devuelve es el que va al informe.",
    inputSchema: z.object({}),
    run: registrar("verificar_postulacion", () => {
      if (!ctx.requisitos) throw new Error("Primero registra los requisitos con registrar_requisitos.");
      ctx.evaluacion = verificar(ctx.compra, ctx.requisitos, ctx.datos);
      return JSON.stringify(ctx.evaluacion);
    }),
  });

  const historialPropio = betaZodTool({
    name: "historial_propio",
    description:
      "Busca en el historial de la organización compras pasadas parecidas (por nombre, organismo o tipo) con su presupuesto y monto adjudicado.",
    inputSchema: z.object({ texto: z.string().optional(), organismo: z.string().optional() }),
    run: registrar("historial_propio", ({ texto, organismo }: { texto?: string; organismo?: string }) => {
      const casos = ctx.datos.historial.filter(
        (h) =>
          (!texto || normalizar(`${h.nombre ?? ""} ${h.tipo}`).includes(normalizar(texto))) &&
          (!organismo || normalizar(h.organismo ?? "").includes(normalizar(organismo))),
      );
      for (const h of casos) {
        ctx.evidencia.set(h.id, `${h.id}: presupuesto ${h.presupuestoCLP}, adjudicado ${h.adjudicadoCLP ?? "desierta"}, ${h.cotizaciones ?? "?"} ofertas`);
      }
      return casos.length ? JSON.stringify(casos) : "Sin casos.";
    }),
  });

  const sinRed = () => {
    throw new Error("Los datos abiertos de Mercado Público no están disponibles en esta corrida (sin red).");
  };

  const licitacionesDelComprador = betaZodTool({
    name: "licitaciones_del_comprador",
    description:
      "Lista las licitaciones de la misma unidad compradora en los últimos meses (datos abiertos OCDS de ChileCompra). La unidad es el prefijo del código: 1234-12-LE25 es de la 1234. La primera consulta de cada mes tarda; después queda en caché.",
    inputSchema: z.object({
      unidad: z.string().regex(/^\d+$/).optional().describe("Si se omite, se toma del código de esta compra"),
      meses: z.number().int().min(1).max(12).default(6),
    }),
    run: registrar("licitaciones_del_comprador", async ({ unidad, meses }: { unidad?: string; meses: number }) => {
      if (!ctx.ocds) return sinRed();
      const u = unidad ?? unidadDeCodigo(ctx.compra.id);
      if (!u) throw new Error(`No puedo sacar la unidad compradora de "${ctx.compra.id}"; pásala en "unidad".`);
      const codigos = (await ctx.ocds.delComprador(u, meses)).filter((c) => c !== ctx.compra.id);
      return codigos.length ? `${codigos.length} licitaciones: ${codigos.slice(0, 60).join(", ")}` : "Sin licitaciones en ese período.";
    }),
  });

  const resultadoLicitacion = betaZodTool({
    name: "resultado_licitacion",
    description:
      "Trae el resultado de una licitación pasada: título, ofertas (cuántas, cuántas descalificadas, montos) y adjudicación (monto y proveedor). Los montos de OCDS son los que ofertaron los proveedores, normalmente netos.",
    inputSchema: z.object({ codigo: z.string() }),
    run: registrar("resultado_licitacion", async ({ codigo }: { codigo: string }) => {
      if (!ctx.ocds) return sinRed();
      const r = await ctx.ocds.licitacion(codigo);
      if (!r) return `Sin datos para ${codigo}.`;
      const adj = r.adjudicacion.map((a) => `${a.montoCLP} a ${a.proveedor}`).join("; ") || "sin adjudicar";
      ctx.evidencia.set(codigo, `${codigo} "${r.titulo}": ${r.ofertas.total} ofertas (${r.ofertas.descalificadas} descalificadas), adjudicada en ${adj}`);
      return JSON.stringify(r);
    }),
  });

  const costearHerramienta = betaZodTool({
    name: "costear",
    description:
      "Calcula costo, escenarios de precio, margen y precio recomendado. Opcionalmente recibe el precio neto que estimaste para la competencia; en ese caso cita los casos (ids o códigos) que consultaste en esta corrida y que lo respaldan.",
    inputSchema: z.object({
      precioCompetidorNetoCLP: z.number().positive().optional(),
      evidencia: z.array(z.string()).default([]).describe("Ids de historial_propio o códigos de resultado_licitacion"),
      razonamiento: z.string().optional().describe("Cómo se llegó al precio de la competencia a partir de la evidencia"),
    }),
    run: registrar(
      "costear",
      ({ precioCompetidorNetoCLP, evidencia, razonamiento }: { precioCompetidorNetoCLP?: number; evidencia: string[]; razonamiento?: string }) => {
        if (!ctx.requisitos || !ctx.evaluacion) throw new Error("Primero verifica la postulación con verificar_postulacion.");
        let investigado;
        if (precioCompetidorNetoCLP !== undefined) {
          if (evidencia.length === 0) throw new Error("Un precio de la competencia necesita evidencia: cita los casos que consultaste.");
          const noVistos = evidencia.filter((e) => !ctx.evidencia.has(e));
          if (noVistos.length) {
            throw new Error(`Estos casos no se consultaron en esta corrida: ${noVistos.join(", ")}. Consúltalos primero o no los cites.`);
          }
          investigado = {
            precioNetoCLP: precioCompetidorNetoCLP,
            evidencia: `${razonamiento ?? "sin razonamiento"} (${evidencia.map((e) => ctx.evidencia.get(e)).join(" | ")})`,
          };
        }
        ctx.oferta = costear(ctx.compra, ctx.requisitos, ctx.datos, ctx.evaluacion, investigado);
        return JSON.stringify(ctx.oferta);
      },
    ),
  });

  const entregarInforme = betaZodTool({
    name: "entregar_informe",
    description:
      "Entrega el informe final y termina. El veredicto y el precio no se escriben aquí: salen de verificar_postulacion y costear. Aquí va el resumen para quien decide, los riesgos que encontraste leyendo y lo que una persona debe revisar.",
    inputSchema: z.object({
      resumen: z.string().describe("Cinco a diez líneas para quien decide si se postula"),
      riesgosAdicionales: z.array(z.string()).default([]),
      preguntasParaRevisar: z.array(z.string()).default([]),
    }),
    run: registrar("entregar_informe", (informe: Informe) => {
      if (!ctx.evaluacion) throw new Error("Falta verificar_postulacion: el informe necesita el veredicto determinista.");
      if (ctx.evaluacion.veredicto !== "no_postulable" && !ctx.oferta) {
        throw new Error("La compra es postulable: falta costear antes de entregar el informe.");
      }
      ctx.informe = informe;
      return "Informe recibido. No llames más herramientas.";
    }),
  });

  return [
    listarDocumentos,
    leerDocumento,
    buscarEnBases,
    registrarRequisitos,
    verEquipo,
    verificarPostulacion,
    historialPropio,
    licitacionesDelComprador,
    resultadoLicitacion,
    costearHerramienta,
    entregarInforme,
  ];
}

function documentoPdf(ruta: string) {
  return [
    {
      type: "document" as const,
      source: { type: "base64" as const, media_type: "application/pdf" as const, data: readFileSync(ruta).toString("base64") },
    },
  ];
}
