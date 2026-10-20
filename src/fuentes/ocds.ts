// Datos abiertos de ChileCompra en el estándar OCDS (api.mercadopublico.cl/APISOCDS). No piden
// ticket. Por cada licitación traen las ofertas recibidas (con su monto y si quedaron válidas
// o descalificadas) y la adjudicación (monto y proveedor). Es lo que el agente usa para
// investigar a un comprador: a cuánto adjudica, cuántos postulan y cuántos quedan fuera.
//
// Lo que se comprobó contra la API (2026-10-20):
// - /OCDS/tender/<codigo> trae `releases`; el último, cuando la licitación cerró, trae `bids`.
// - /OCDS/award/<codigo> trae `awards[].value.amount` y `suppliers`. Si no hay adjudicación
//   responde 200 con {"status": 404 | 500, "detail": ...}, no un error HTTP.
// - /OCDS/listaOCDSAgnoMes/<año>/<mes>/<offset>/<limit> lista los códigos del mes; el límite
//   máximo es 1000 por página y un mes trae del orden de 9.000. No hay listado por comprador:
//   se filtra por el prefijo del código, que es el número de la unidad compradora
//   (1234-12-LE25 es de la unidad 1234).
// - El monto estimado de la licitación no viene en OCDS (`tender.value` vacío).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.mercadopublico.cl/APISOCDS";

export interface ResultadoLicitacion {
  codigo: string;
  titulo: string;
  organismo: string | null;
  metodo: string | null;
  cierre: string | null;
  ofertas: { total: number; validas: number; descalificadas: number; montosCLP: number[] };
  adjudicacion: { montoCLP: number; proveedor: string }[];
}

interface Release {
  tender?: {
    title?: string;
    procuringEntity?: { name?: string };
    procurementMethodDetails?: string;
    tenderPeriod?: { endDate?: string };
  };
  bids?: { details?: { status?: string; value?: { amount?: number } }[] };
  awards?: { status?: string; value?: { amount?: number }; suppliers?: { name?: string }[] }[];
}

export class OCDS {
  constructor(
    private readonly cache: string,
    private readonly traer: typeof fetch = fetch,
  ) {
    mkdirSync(cache, { recursive: true });
  }

  private async json(ruta: string, archivoCache: string | null): Promise<Record<string, unknown>> {
    const enCache = archivoCache ? join(this.cache, archivoCache) : null;
    if (enCache && existsSync(enCache)) return JSON.parse(readFileSync(enCache, "utf8"));
    const r = await this.traer(`${API}${ruta}`, { headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(`OCDS respondió ${r.status} para ${ruta}`);
    const d = (await r.json()) as Record<string, unknown>;
    if (enCache) writeFileSync(enCache, JSON.stringify(d));
    return d;
  }

  async licitacion(codigo: string): Promise<ResultadoLicitacion | null> {
    if (!/^[\w-]+$/.test(codigo)) throw new Error(`Código inválido: ${codigo}`);
    const tender = await this.json(`/OCDS/tender/${codigo}`, `tender-${codigo}.json`);
    const releases = (tender.releases as Release[] | undefined) ?? [];
    if (releases.length === 0) return null;
    const ultimo = releases[releases.length - 1] as Release;
    const t = ultimo.tender ?? {};
    const bids = ultimo.bids?.details ?? [];
    const award = await this.json(`/OCDS/award/${codigo}`, `award-${codigo}.json`).catch(() => ({}));
    const awards = ((award as { releases?: Release[] }).releases ?? []).flatMap((r) => r.awards ?? []);
    return {
      codigo,
      titulo: t.title ?? "",
      organismo: t.procuringEntity?.name?.split(" | ")[0] ?? null,
      metodo: t.procurementMethodDetails ?? null,
      cierre: t.tenderPeriod?.endDate ?? null,
      ofertas: {
        total: bids.length,
        validas: bids.filter((b) => b.status === "valid").length,
        descalificadas: bids.filter((b) => b.status === "disqualified").length,
        montosCLP: bids.map((b) => b.value?.amount).filter((m): m is number => typeof m === "number"),
      },
      adjudicacion: awards
        .filter((a) => a.status === "active" && typeof a.value?.amount === "number")
        .map((a) => ({ montoCLP: a.value!.amount!, proveedor: a.suppliers?.[0]?.name?.split(" | ")[0] ?? "sin nombre" })),
    };
  }

  // Códigos de un mes. Los meses ya cerrados se guardan en caché; el mes en curso no.
  async codigosDelMes(anio: number, mes: number, hoy = new Date()): Promise<string[]> {
    const cerrado = anio < hoy.getFullYear() || (anio === hoy.getFullYear() && mes < hoy.getMonth() + 1);
    const archivo = `mes-${anio}-${String(mes).padStart(2, "0")}.json`;
    if (cerrado && existsSync(join(this.cache, archivo))) return JSON.parse(readFileSync(join(this.cache, archivo), "utf8"));
    const codigos: string[] = [];
    for (let offset = 0; ; offset += 1000) {
      const d = await this.json(`/OCDS/listaOCDSAgnoMes/${anio}/${String(mes).padStart(2, "0")}/${offset}/1000`, null);
      const datos = (d.data as { ocid: string }[] | undefined) ?? [];
      codigos.push(...datos.map((x) => x.ocid.replace(/^ocds-[a-z0-9]+-/, "")));
      const total = (d.pagination as { total?: number } | undefined)?.total ?? 0;
      if (datos.length === 0 || offset + 1000 >= total) break;
    }
    if (cerrado) writeFileSync(join(this.cache, archivo), JSON.stringify(codigos));
    return codigos;
  }

  // Licitaciones de una unidad compradora en los últimos meses, de la más nueva a la más vieja.
  async delComprador(unidad: string, meses: number, hoy = new Date()): Promise<string[]> {
    const encontrados: string[] = [];
    for (let i = 0; i < meses; i++) {
      const f = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
      const delMes = await this.codigosDelMes(f.getFullYear(), f.getMonth() + 1, hoy);
      encontrados.push(...delMes.filter((c) => c.startsWith(`${unidad}-`)));
    }
    return [...new Set(encontrados)];
  }
}

// La unidad compradora es el prefijo numérico del código de una licitación.
export function unidadDeCodigo(codigo: string): string | null {
  return /^(\d+)-\d+-[A-Z0-9]+$/.exec(codigo)?.[1] ?? null;
}
