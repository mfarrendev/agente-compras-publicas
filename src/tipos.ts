// Contratos de datos del agente. Todo lo que entra (perfil, equipo, compras) y todo lo que
// produce cada etapa (pertinencia, requisitos, evaluación, oferta) pasa por estos esquemas,
// así un archivo mal escrito falla al cargarse y no a mitad de una evaluación.
import { z } from "zod";

// ---------- Lo que la organización declara de sí misma (carpeta de datos) ----------

export const Organizacion = z.object({
  nombre: z.string(),
  rut: z.string(),
  tamano: z.enum(["micro", "pequena", "mediana", "grande"]),
  inscritaRegistroProveedores: z.boolean(),
  selloEmpresaMujer: z.boolean().default(false),
  sancionesUltimos24Meses: z.number().int().min(0).default(0),
  // Tipos de institución que algunas bases exigen (universidad acreditada, OTEC con norma, etc.).
  tiposInstitucion: z.array(z.string()).default([]),
  facturaExenta: z.boolean().default(false),
  // Qué hace la organización: alimenta el prefiltro y el juicio de pertinencia.
  descripcion: z.string(),
  rubros: z.array(z.string()),
  palabrasClave: z.array(z.string()),
  exclusiones: z.array(z.string()).default([]),
  montoMinimo: z.number().default(0),
  montoMaximo: z.number().default(Number.MAX_SAFE_INTEGER),
  // Si la organización acepta sumar expertos externos para cubrir un perfil que no tiene.
  aceptaExpertosExternos: z.boolean().default(true),
});
export type Organizacion = z.infer<typeof Organizacion>;

const Titulo = z.object({
  nombre: z.string(),
  area: z.string(),
  semestres: z.number().int(),
  obtenido: z.boolean(),
});

export const Persona = z.object({
  id: z.string(),
  nombre: z.string(),
  titulo: Titulo.nullable(),
  grados: z.array(Titulo).default([]),
  anosExperiencia: z.number(),
  areasExperiencia: z.array(z.string()),
  horasDocencia: z.number().default(0),
  // Qué respaldos existen de verdad. Sin respaldo, el requisito queda "parcial", no "cumple".
  respaldos: z.object({
    cv: z.boolean().default(false),
    titulo: z.boolean().default(false),
    certificadosDocencia: z.boolean().default(false),
  }),
  externo: z.boolean().default(false),
  tarifaRol: z.string().describe("Rol de costos.yaml con el que se valoriza su hora"),
});
export type Persona = z.infer<typeof Persona>;

export const Respaldo = z.enum(["orden_de_compra", "factura", "contrato", "carta_mandante", "certificado", "recepcion_conforme"]);

export const Experiencia = z.object({
  id: z.string(),
  cliente: z.string(),
  servicio: z.string(),
  tipo: z.enum(["capacitacion", "consultoria", "estudio", "desarrollo", "otro"]),
  areas: z.array(z.string()),
  inicio: z.string(),
  termino: z.string(),
  montoCLP: z.number().optional(),
  respaldos: z.array(Respaldo),
});
export type Experiencia = z.infer<typeof Experiencia>;

export const Costos = z.object({
  tarifasHora: z.record(z.string(), z.number()),
  // Horas por unidad de servicio según el tipo de compra (por hora lectiva, por entregable...).
  modelosEsfuerzo: z.record(
    z.string(),
    z.object({ unidad: z.string(), horasPorUnidad: z.record(z.string(), z.number()) }),
  ),
  horasPreparacionPostulacion: z.number(),
  rolPreparacion: z.string(),
  costosDirectosCLP: z.number().default(0),
  // Honorario de un experto externo que cubre un perfil que el equipo no tiene, por perfil.
  honorarioExternoPorPerfilCLP: z.number().optional(),
  contingenciaPct: z.number().default(0.1),
  costoFinancieroGarantiaPct: z.number().default(0.02),
  margenMinimoPct: z.number(),
  margenObjetivoPct: z.number(),
  ivaPct: z.number().default(0.19),
});
export type Costos = z.infer<typeof Costos>;

// Resultados de compras pasadas: sirven para estimar a qué precio adjudica la competencia.
export const Historial = z.array(
  z.object({
    id: z.string(),
    tipo: z.string(),
    nombre: z.string().optional(),
    organismo: z.string().optional(),
    presupuestoCLP: z.number(),
    adjudicadoCLP: z.number().nullable(),
    cotizaciones: z.number().nullable(),
  }),
);
export type Historial = z.infer<typeof Historial>;

// ---------- Una compra pública, normalizada desde cualquier fuente ----------

export const Compra = z.object({
  id: z.string(),
  tipo: z.enum(["compra_agil", "licitacion"]),
  nombre: z.string(),
  descripcion: z.string().default(""),
  organismo: z.string(),
  presupuestoCLP: z.number().nullable(),
  presupuestoIncluyeImpuestos: z.boolean().nullable().default(null),
  cierre: z.string().nullable(),
  cotizacionesRecibidas: z.number().nullable().default(null),
  url: z.string().nullable().default(null),
  fuente: z.string(),
  // Texto de las bases, si la fuente lo trae o si alguien lo dejó en la carpeta de la compra.
  basesTexto: z.string().nullable().default(null),
});
export type Compra = z.infer<typeof Compra>;

// ---------- Salida de cada etapa ----------

export const Pertinencia = z.object({
  puntaje: z.number().describe("0 a 100: cuánto calza la compra con lo que hace la organización"),
  calza: z.boolean(),
  motivo: z.string().describe("Dos o tres frases, en español, con el porqué"),
  rubro: z.string().describe("El rubro de la organización con que calza, o 'ninguno'"),
});
export type Pertinencia = z.infer<typeof Pertinencia>;

// Cada requisito trae la frase literal de las bases de la que salió. Si la frase no aparece en
// el texto, el requisito se marca "cita no verificada": la IA no decide sola qué exige una base.
const Cita = z.string().describe("Frase copiada literalmente de las bases, sin parafrasear");

export const Requisitos = z.object({
  perfiles: z.array(
    z.object({
      rol: z.string(),
      obligatorio: z.boolean(),
      tituloAreas: z.array(z.string()).describe("Áreas de título aceptadas; vacío si no se exige título"),
      semestresMinimos: z.number().nullable(),
      tituloObtenidoExigido: z.boolean().describe("true si exige título profesional ya obtenido"),
      gradoExigido: z.string().nullable().describe("Magíster, doctorado, etc., o null"),
      anosExperienciaMinimos: z.number().nullable(),
      areasExperiencia: z.array(z.string()),
      horasDocenciaMinimas: z.number().nullable(),
      cita: Cita,
    }),
  ),
  experienciaOferente: z
    .object({
      obligatorio: z.boolean(),
      serviciosMinimos: z.number().nullable(),
      anosHaciaAtras: z.number().nullable(),
      areas: z.array(z.string()),
      respaldosAceptados: z.array(Respaldo),
      cita: Cita,
    })
    .nullable(),
  institucionales: z.array(
    z.object({
      tipo: z.string().describe("p. ej. universidad_acreditada, otec_norma_2728, registro_proveedores"),
      descripcion: z.string(),
      obligatorio: z.boolean(),
      cita: Cita,
    }),
  ),
  documentos: z.array(z.object({ nombre: z.string(), obligatorio: z.boolean(), cita: Cita })),
  criterios: z.array(
    z.object({
      nombre: z.string(),
      tipo: z.enum(["precio", "experiencia_oferente", "perfil_equipo", "propuesta_tecnica", "sanciones", "sello_empresa_mujer", "formal", "integridad", "otro"]),
      ponderacion: z.number().describe("Porcentaje, 0 a 100"),
      cita: Cita,
    }),
  ),
  servicio: z.object({
    tipoEsfuerzo: z.string().describe("Una clave de modelosEsfuerzo: capacitacion, consultoria, estudio..."),
    unidades: z.number().nullable().describe("Horas lectivas, entregables, meses, según el tipo"),
    modalidad: z.string().nullable(),
    plazoDias: z.number().nullable(),
  }),
  garantiaCumplimientoPct: z.number().nullable(),
  presupuestoIncluyeImpuestos: z.boolean().nullable(),
});
export type Requisitos = z.infer<typeof Requisitos>;

export type Estado = "cumple" | "parcial" | "no_cumple" | "revisar";

export interface Verificacion {
  requisito: string;
  obligatorio: boolean;
  estado: Estado;
  motivo: string;
  cubiertoPor: string[];
  citaVerificada: boolean | null;
}

export type Veredicto = "postulable" | "postulable_con_brechas" | "no_postulable";

export interface Evaluacion {
  compraId: string;
  veredicto: Veredicto;
  verificaciones: Verificacion[];
  riesgos: string[];
  acciones: string[];
}

export interface Escenario {
  etiqueta: string;
  precioNetoCLP: number;
  precioTotalCLP: number;
  costoCLP: number;
  margenCLP: number;
  margenPct: number;
  puntajePrecioEstimado: number;
  puntajeTotalEstimado: number;
  sobreTope: boolean;
}

export interface Oferta {
  compraId: string;
  costoDetalle: { concepto: string; horas: number | null; montoCLP: number }[];
  costoTotalCLP: number;
  topeNetoCLP: number | null;
  precioCompetidorEstimadoCLP: number | null;
  escenarios: Escenario[];
  recomendado: Escenario | null;
  advertencias: string[];
}
