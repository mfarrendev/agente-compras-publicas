// Etapa 2: pertinencia. ¿Esta compra es algo que la organización hace? La IA lo juzga con el
// perfil completo de la organización, que va en el prompt de sistema y se cachea: es el mismo
// para todas las compras de la corrida. En modo simulado se usa la proporción de palabras
// clave, que sirve para la demo y para probar el flujo sin costo.
import { pedirJson } from "../llm.js";
import { Pertinencia, type Compra, type Organizacion } from "../tipos.js";
import { normalizar } from "../fuentes/fuente.js";

export function sistemaPertinencia(org: Organizacion): string {
  return [
    "Evalúas compras públicas chilenas para decidir si una organización debería postular.",
    "Juzga solo si el servicio pedido es algo que esta organización hace hoy. No juzgues precio ni requisitos formales: eso lo revisan otras etapas.",
    "Una compra que se parece en palabras pero pide otra cosa (por ejemplo, comprar licencias cuando la organización dicta cursos) no calza.",
    "",
    `Organización: ${org.nombre}`,
    `Qué hace: ${org.descripcion}`,
    `Rubros: ${org.rubros.join("; ")}`,
    `No hace: ${org.exclusiones.join("; ") || "(no declarado)"}`,
  ].join("\n");
}

export function pertinenciaSimulada(compra: Compra, org: Organizacion): Pertinencia {
  const texto = normalizar(`${compra.nombre} ${compra.descripcion}`);
  const hits = org.palabrasClave.filter((p) => texto.includes(normalizar(p)));
  const puntaje = Math.min(100, Math.round((hits.length / Math.max(3, org.palabrasClave.length / 4)) * 100));
  return {
    puntaje,
    calza: puntaje >= 50,
    motivo: hits.length ? `Modo simulado: nombra ${hits.join(", ")}.` : "Modo simulado: no nombra palabras clave.",
    rubro: hits.length ? (org.rubros[0] ?? "ninguno") : "ninguno",
  };
}

export async function evaluarPertinencia(compra: Compra, org: Organizacion, simulado: boolean): Promise<Pertinencia> {
  if (simulado) return pertinenciaSimulada(compra, org);
  return pedirJson({
    esquema: Pertinencia,
    sistema: sistemaPertinencia(org),
    contenido: [
      {
        type: "text",
        text: [
          `Compra ${compra.id} (${compra.tipo}) de ${compra.organismo}`,
          `Nombre: ${compra.nombre}`,
          `Descripción: ${compra.descripcion || "(sin descripción)"}`,
          `Presupuesto: ${compra.presupuestoCLP ?? "no informado"} CLP`,
        ].join("\n"),
      },
    ],
    // Clasificar es una tarea simple y de volumen: esfuerzo bajo.
    esfuerzo: "low",
    maxTokens: 8000,
  });
}
