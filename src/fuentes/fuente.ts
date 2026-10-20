// Una fuente entrega compras normalizadas. El resto del agente no sabe de dónde vienen:
// agregar otra plataforma de compras es escribir una fuente nueva, no tocar las etapas.
import type { Compra } from "../tipos.js";

export interface Fuente {
  nombre: string;
  buscar(palabras: string[]): Promise<Compra[]>;
}

export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}
