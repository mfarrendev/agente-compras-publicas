// Estado en disco por compra y por etapa: salida/<id>/<etapa>.json.
// Volver a correr una etapa ya guardada no vuelve a llamar a la IA ni a pagar tokens;
// --rehacer la fuerza. Así una corrida que se corta a la mitad se retoma donde quedó.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class Estado {
  constructor(private readonly raiz: string, private readonly rehacer = false) {}

  dir(compraId: string): string {
    const d = join(this.raiz, compraId.replace(/[^\w.-]/g, "_"));
    mkdirSync(d, { recursive: true });
    return d;
  }

  async paso<T>(compraId: string, etapa: string, hacer: () => Promise<T>): Promise<T> {
    const ruta = join(this.dir(compraId), `${etapa}.json`);
    if (!this.rehacer && existsSync(ruta)) {
      return JSON.parse(readFileSync(ruta, "utf8")) as T;
    }
    const resultado = await hacer();
    writeFileSync(ruta, JSON.stringify(resultado, null, 2));
    return resultado;
  }

  escribir(compraId: string, archivo: string, contenido: string): string {
    const ruta = join(this.dir(compraId), archivo);
    writeFileSync(ruta, contenido);
    return ruta;
  }
}
