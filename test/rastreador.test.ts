// Medición (2026-10-20): se puso cada defecto a mano y se corrió la suite completa (20 pruebas,
// el arnés exige que corran las 20). Cada mutación hace caer 1 de las 5 pruebas de este archivo:
// exclusiones comparadas sin normalizar, sin el chequeo de cierre, y el prefiltro dejando pasar
// lo que no nombra palabras clave (esta última no caía hasta agregar su prueba).
import { describe, expect, it } from "vitest";
import { prefiltrar } from "../src/agentes/rastreador.js";
import { cargarDatos } from "../src/datos.js";
import type { Compra } from "../src/tipos.js";

const { organizacion: org } = cargarDatos("ejemplo");
const base: Compra = {
  id: "X", tipo: "compra_agil", nombre: "", descripcion: "", organismo: "Organismo Demo",
  presupuestoCLP: 2_000_000, presupuestoIncluyeImpuestos: true, cierre: "2099-01-01T00:00:00Z",
  cotizacionesRecibidas: null, url: null, fuente: "prueba", basesTexto: null,
};

describe("prefiltro", () => {
  it("pasa lo que nombra una palabra clave, con o sin tildes", () => {
    const r = prefiltrar({ ...base, nombre: "CAPACITACIÓN en Inteligencia Artificial" }, org);
    expect(r.pasa).toBe(true);
    expect(r.coincidencias).toEqual(expect.arrayContaining(["capacitacion", "inteligencia artificial"]));
  });
  it("descarta una exclusión aunque también nombre palabras clave", () => {
    const r = prefiltrar({ ...base, nombre: "Coffee Break para jornada de capacitación" }, org);
    expect(r.pasa).toBe(false);
    expect(r.motivo).toContain("coffee break");
  });
  it("descarta lo que está fuera del rango de montos", () => {
    expect(prefiltrar({ ...base, nombre: "Curso", presupuestoCLP: 100_000 }, org).pasa).toBe(false);
    expect(prefiltrar({ ...base, nombre: "Curso", presupuestoCLP: 900_000_000 }, org).pasa).toBe(false);
  });
  it("descarta lo que no nombra ninguna palabra clave", () => {
    const r = prefiltrar({ ...base, nombre: "Mantención de ascensores" }, org);
    expect(r).toMatchObject({ pasa: false, motivo: "no nombra ninguna palabra clave" });
  });
  it("descarta lo que ya cerró", () => {
    const r = prefiltrar({ ...base, nombre: "Curso de IA", cierre: "2001-01-01T00:00:00Z" }, org);
    expect(r).toMatchObject({ pasa: false, motivo: "ya cerró" });
  });
});
