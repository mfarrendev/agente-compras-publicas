// La lectura de los datos abiertos OCDS, con respuestas inventadas que imitan el formato real
// (comprobado contra la API el 2026-10-20; ver src/fuentes/ocds.ts).
//
// Medición (2026-10-20): se puso cada defecto a mano y se corrió la suite completa (27 pruebas,
// el arnés exige que corran las 27). De las 3 pruebas de este archivo caen:
// - contar como válidas todas las ofertas (sin mirar status): 1.
// - filtrar por comprador con includes en vez del prefijo del código: 1.
// - no paginar el listado del mes (solo la primera página): 1.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { OCDS, unidadDeCodigo } from "../src/fuentes/ocds.js";

const respuestas: Record<string, unknown> = {
  "/OCDS/tender/100-5-LE25": {
    releases: [
      { tender: { title: "Primera versión" } },
      {
        tender: {
          title: "Curso de ofimática",
          procuringEntity: { name: "MUNICIPALIDAD DEMO | MUNICIPALIDAD DEMO" },
          procurementMethodDetails: "Licitación Pública Entre 100 y 1000 UTM (LE)",
          tenderPeriod: { endDate: "2025-05-01T15:00:00Z" },
        },
        bids: {
          details: [
            { status: "valid", value: { amount: 4_000_000 } },
            { status: "valid", value: { amount: 3_500_000 } },
            { status: "disqualified", value: { amount: 2_000_000 } },
          ],
        },
      },
    ],
  },
  "/OCDS/award/100-5-LE25": {
    releases: [{ awards: [{ status: "active", value: { amount: 3_500_000 }, suppliers: [{ name: "PROVEEDOR UNO SPA | Proveedor Uno" }] }] }],
  },
  "/OCDS/tender/100-6-LE25": { status: 404, detail: "No se encontraron resultados." },
  "/OCDS/listaOCDSAgnoMes/2025/05/0/1000": {
    pagination: { total: 1002 },
    data: [{ ocid: "ocds-70d2nz-100-5-LE25" }, { ocid: "ocds-70d2nz-1000-9-L125" }, ...Array.from({ length: 998 }, (_, i) => ({ ocid: `ocds-70d2nz-7-${i}-L125` }))],
  },
  "/OCDS/listaOCDSAgnoMes/2025/05/1000/1000": { pagination: { total: 1002 }, data: [{ ocid: "ocds-70d2nz-100-7-LP25" }, { ocid: "ocds-70d2nz-2100-1-LE25" }] },
};

function falso(): typeof fetch {
  return (async (url: string | URL) => {
    const ruta = String(url).replace("https://api.mercadopublico.cl/APISOCDS", "");
    const d = respuestas[ruta];
    if (d === undefined) return new Response("no", { status: 500 });
    return new Response(JSON.stringify(d), { status: 200 });
  }) as typeof fetch;
}

const nuevo = () => new OCDS(mkdtempSync(join(tmpdir(), "ocds-")), falso());

describe("OCDS", () => {
  it("resume ofertas válidas y descalificadas, montos y adjudicación del último release", async () => {
    const r = await nuevo().licitacion("100-5-LE25");
    expect(r).toMatchObject({
      titulo: "Curso de ofimática",
      organismo: "MUNICIPALIDAD DEMO",
      ofertas: { total: 3, validas: 2, descalificadas: 1, montosCLP: [4_000_000, 3_500_000, 2_000_000] },
      adjudicacion: [{ montoCLP: 3_500_000, proveedor: "PROVEEDOR UNO SPA" }],
    });
    expect(await nuevo().licitacion("100-6-LE25")).toBeNull();
  });
  it("encuentra las licitaciones de un comprador por el prefijo del código, en todas las páginas del mes", async () => {
    const codigos = await nuevo().delComprador("100", 1, new Date("2025-05-20"));
    expect(codigos).toEqual(["100-5-LE25", "100-7-LP25"]);
  });
  it("saca la unidad compradora del código", () => {
    expect(unidadDeCodigo("1234-12-LE25")).toBe("1234");
    expect(unidadDeCodigo("CA-DEMO-001")).toBeNull();
  });
});
