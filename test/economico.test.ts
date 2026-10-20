// Medición (2026-10-20): se puso cada defecto a mano y se corrió la suite completa (20 pruebas en esa fecha,
// el arnés exige que corran las 20; la del experto externo se midió con 28). De las 6 pruebas de este archivo caen:
// - topeNeto sin descontar el IVA: 2.
// - la mediana del historial reemplazada por el mínimo: 1.
// - recomendar siempre el escenario más barato viable: 1.
// - sin el costo financiero de la garantía: 1.
// - sin sumar el honorario del experto externo de un perfil sin cubrir: 1.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cargarDatos, type Datos } from "../src/datos.js";
import { costear, ratioCompetidor, topeNeto } from "../src/agentes/economico.js";
import { verificar } from "../src/agentes/requisitos.js";
import { FuenteArchivo } from "../src/fuentes/archivo.js";
import { Requisitos } from "../src/tipos.js";

const datos = cargarDatos("ejemplo");
const compras = await new FuenteArchivo("ejemplo/compras").buscar();
const compra = (id: string) => compras.find((c) => c.id === id)!;
const req = (id: string) => Requisitos.parse(JSON.parse(readFileSync(`ejemplo/compras/${id}.requisitos.json`, "utf8")));

describe("oferta económica", () => {
  it("el tope neto descuenta el IVA si el presupuesto lo incluye", () => {
    expect(topeNeto(compra("CA-DEMO-001"), req("CA-DEMO-001"), 0.19, false)).toBe(2_941_176);
    expect(topeNeto(compra("CA-DEMO-001"), req("CA-DEMO-001"), 0.19, true)).toBe(3_500_000);
  });
  it("el competidor sale de la mediana del historial del mismo tipo", () => {
    // compra_agil: 0,783 · 0,82 · 0,90 -> 0,82
    expect(ratioCompetidor(datos, "compra_agil")).toBeCloseTo(0.82, 3);
    expect(ratioCompetidor({ ...datos, historial: [] }, "compra_agil")).toBe(0.85);
  });
  it("el costo de CA-DEMO-001 suma ejecución, preparación, directos y contingencia", () => {
    const o = costear(compra("CA-DEMO-001"), req("CA-DEMO-001"), datos, null);
    // (35.000 + 12.500 + 4.500) x 24 + 180.000 + 100.000 = 1.528.000; +10 % = 1.680.800
    expect(o.costoTotalCLP).toBe(1_680_800);
    expect(o.topeNetoCLP).toBe(2_941_176);
  });
  it("no baja el precio más allá del competidor estimado si eso solo regala margen", () => {
    const c = compra("CA-DEMO-001");
    const r = req("CA-DEMO-001");
    const o = costear(c, r, datos, verificar(c, r, datos));
    expect(o.recomendado?.etiqueta).toBe("Igual al competidor estimado");
    expect(o.recomendado!.precioNetoCLP).toBeLessThanOrEqual(o.precioCompetidorEstimadoCLP!);
    const masBaratos = o.escenarios.filter((e) => e.precioNetoCLP < o.recomendado!.precioNetoCLP);
    expect(masBaratos.every((e) => e.puntajeTotalEstimado <= o.recomendado!.puntajeTotalEstimado)).toBe(true);
  });
  it("una garantía de fiel cumplimiento suma su costo financiero", () => {
    const c = compra("LIC-DEMO-004");
    const r = req("LIC-DEMO-004");
    const con = costear(c, r, datos, null).escenarios[0]!;
    const sin = costear(c, { ...r, garantiaCumplimientoPct: 0 }, datos, null).escenarios[0]!;
    expect(con.costoCLP - sin.costoCLP).toBe(Math.round(con.precioNetoCLP * 0.05 * 0.02));
  });
  it("un perfil sin cubrir suma el honorario del experto externo", () => {
    const c = compra("LIC-DEMO-004");
    const r = req("LIC-DEMO-004");
    const o = costear(c, r, datos, verificar(c, r, datos));
    expect(o.costoDetalle).toContainEqual({ concepto: "Experto externo: Especialista en experiencia usuaria", horas: null, montoCLP: 1_800_000 });
    const sinHonorario = costear(c, r, { ...datos, costos: { ...datos.costos, honorarioExternoPorPerfilCLP: undefined } }, verificar(c, r, datos));
    expect(sinHonorario.advertencias.some((a) => a.includes("experto externo"))).toBe(true);
  });
});
