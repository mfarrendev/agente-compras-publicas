// Etapa 1: rastrear. Trae las compras abiertas de las fuentes y aplica un prefiltro sin IA:
// descarta lo que nombra una exclusión (insumos, coffee break, arriendos...) o se sale del
// rango de montos. Es barato y saca la mayor parte del ruido antes de pagar un solo token.
import type { Fuente } from "../fuentes/fuente.js";
import { normalizar } from "../fuentes/fuente.js";
import type { Compra, Organizacion } from "../tipos.js";

export interface Prefiltrada {
  compra: Compra;
  pasa: boolean;
  motivo: string;
  coincidencias: string[];
}

export function prefiltrar(compra: Compra, org: Organizacion): Prefiltrada {
  const texto = normalizar(`${compra.nombre} ${compra.descripcion}`);
  const excluida = org.exclusiones.find((e) => texto.includes(normalizar(e)));
  if (excluida) return { compra, pasa: false, motivo: `nombra una exclusión: "${excluida}"`, coincidencias: [] };

  if (compra.presupuestoCLP !== null) {
    if (compra.presupuestoCLP < org.montoMinimo) {
      return { compra, pasa: false, motivo: "monto bajo el mínimo que vale la pena preparar", coincidencias: [] };
    }
    if (compra.presupuestoCLP > org.montoMaximo) {
      return { compra, pasa: false, motivo: "monto sobre la capacidad declarada", coincidencias: [] };
    }
  }
  if (compra.cierre && new Date(compra.cierre).getTime() < Date.now()) {
    return { compra, pasa: false, motivo: "ya cerró", coincidencias: [] };
  }

  const coincidencias = org.palabrasClave.filter((p) => texto.includes(normalizar(p)));
  return coincidencias.length > 0
    ? { compra, pasa: true, motivo: "calza con palabras clave", coincidencias }
    : { compra, pasa: false, motivo: "no nombra ninguna palabra clave", coincidencias };
}

export async function rastrear(fuentes: Fuente[], org: Organizacion): Promise<Prefiltrada[]> {
  const todas = new Map<string, Compra>();
  for (const f of fuentes) {
    for (const c of await f.buscar(org.palabrasClave)) todas.set(c.id, c);
  }
  return [...todas.values()].map((c) => prefiltrar(c, org));
}
