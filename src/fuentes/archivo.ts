// Fuente de archivos: compras guardadas como JSON en <datos>/compras/. Sirve para la demo,
// para pruebas y para trabajar una compra cuyas bases alguien bajó a mano.
// Si existe <id>.bases.txt junto al JSON, se usa como texto de las bases.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Compra } from "../tipos.js";
import type { Fuente } from "./fuente.js";

export class FuenteArchivo implements Fuente {
  nombre = "archivo";
  constructor(private readonly dir: string) {}

  async buscar(): Promise<Compra[]> {
    if (!existsSync(this.dir)) return [];
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".requisitos.json"))
      .sort()
      .map((f) => {
        const compra = Compra.parse(JSON.parse(readFileSync(join(this.dir, f), "utf8")));
        const bases = join(this.dir, `${compra.id}.bases.txt`);
        if (!compra.basesTexto && existsSync(bases)) compra.basesTexto = readFileSync(bases, "utf8");
        return compra;
      });
  }
}
