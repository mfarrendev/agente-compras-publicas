// Medición (2026-10-20): se puso cada defecto a mano y se corrió la suite completa (20 pruebas,
// el arnés exige que corran las 20). De las 10 pruebas de este archivo caen:
// - sin el chequeo de semestres: 1.            - sin exigir título obtenido: 1.
// - respaldo faltante contado como "cumple": 1. - sin la ventana de años: 1.
// - una persona cubriendo dos perfiles: 1 (no caía hasta agregar "una persona no cubre dos perfiles").
// - un institucional obligatorio que falla tratado como brecha: 2.
// - citaEnBases sin normalizar: 1.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cargarDatos, type Datos } from "../src/datos.js";
import { citaEnBases, experienciasValidas, personaCumplePerfil, verificar } from "../src/agentes/requisitos.js";
import { FuenteArchivo } from "../src/fuentes/archivo.js";
import { Requisitos, type Persona } from "../src/tipos.js";

const datos = cargarDatos("ejemplo");
const compras = await new FuenteArchivo("ejemplo/compras").buscar();
const compra = (id: string) => compras.find((c) => c.id === id)!;
const req = (id: string) => Requisitos.parse(JSON.parse(readFileSync(`ejemplo/compras/${id}.requisitos.json`, "utf8")));

const perfil = {
  rol: "Relator", obligatorio: true, tituloAreas: ["ingeniería"], semestresMinimos: 10, tituloObtenidoExigido: true,
  gradoExigido: null, anosExperienciaMinimos: 2, areasExperiencia: [], horasDocenciaMinimas: 100, cita: "",
};
const persona: Persona = {
  id: "p", nombre: "Persona Prueba", titulo: { nombre: "Ingeniería", area: "ingenieria", semestres: 10, obtenido: true },
  grados: [], anosExperiencia: 5, areasExperiencia: [], horasDocencia: 200,
  respaldos: { cv: true, titulo: true, certificadosDocencia: true }, externo: false, tarifaRol: "senior",
};

describe("perfil de una persona", () => {
  it("cumple con título, semestres, años y docencia respaldada", () => {
    expect(personaCumplePerfil(persona, perfil).estado).toBe("cumple");
  });
  it("no cumple con menos semestres o con el título en curso", () => {
    expect(personaCumplePerfil({ ...persona, titulo: { ...persona.titulo!, semestres: 8 } }, perfil).estado).toBe("no_cumple");
    expect(personaCumplePerfil({ ...persona, titulo: { ...persona.titulo!, obtenido: false } }, perfil).estado).toBe("no_cumple");
  });
  it("sin el certificado de docencia queda parcial, no cumple", () => {
    const r = personaCumplePerfil({ ...persona, respaldos: { ...persona.respaldos, certificadosDocencia: false } }, perfil);
    expect(r.estado).toBe("parcial");
  });
});

describe("experiencia del oferente", () => {
  it("cuenta solo lo que está dentro de la ventana y con un respaldo aceptado", () => {
    const e = { obligatorio: true, serviciosMinimos: 1, anosHaciaAtras: 2, areas: ["consultoría"], respaldosAceptados: ["contrato" as const], cita: "" };
    const ids = experienciasValidas(datos.experiencias, e, new Date("2026-10-20")).map((x) => x.id);
    // exp-03 terminó en 2024-08 (fuera de 2 años), exp-04 solo tiene certificado.
    expect(ids).toEqual([]);
    expect(experienciasValidas(datos.experiencias, { ...e, anosHaciaAtras: 5 }, new Date("2026-10-20")).map((x) => x.id)).toEqual(["exp-03"]);
  });
});

describe("veredicto con las compras de ejemplo", () => {
  it("CA-DEMO-001 es postulable", () => {
    expect(verificar(compra("CA-DEMO-001"), req("CA-DEMO-001"), datos).veredicto).toBe("postulable");
  });
  it("LIC-DEMO-002 no es postulable: exige una universidad acreditada", () => {
    const ev = verificar(compra("LIC-DEMO-002"), req("LIC-DEMO-002"), datos);
    expect(ev.veredicto).toBe("no_postulable");
    expect(ev.riesgos[0]).toContain("Universidad acreditada");
  });
  it("LIC-DEMO-004 tiene brechas: un perfil sin cubrir y experiencia parcial, cada perfil con una persona distinta", () => {
    const ev = verificar(compra("LIC-DEMO-004"), req("LIC-DEMO-004"), datos);
    expect(ev.veredicto).toBe("postulable_con_brechas");
    const cubren = ev.verificaciones.filter((v) => v.requisito.startsWith("Perfil:")).flatMap((v) => v.cubiertoPor);
    expect(new Set(cubren).size).toBe(cubren.length);
    expect(ev.acciones.some((a) => a.includes("experto externo"))).toBe(true);
  });
  it("una persona no cubre dos perfiles a la vez", () => {
    // Los dos perfiles los cumple solo Andrea Ejemplo: el segundo tiene que quedar sin cubrir.
    const r = req("LIC-DEMO-004");
    const jefe = r.perfiles[0]!;
    const ev = verificar(compra("LIC-DEMO-004"), { ...r, perfiles: [jefe, { ...jefe, rol: "Jefe suplente" }] }, datos);
    const [a, b] = ev.verificaciones;
    expect(a).toMatchObject({ estado: "cumple", cubiertoPor: ["andrea-ejemplo"] });
    expect(b).toMatchObject({ estado: "no_cumple", cubiertoPor: [] });
  });
  it("sin aceptar externos, el mismo perfil faltante deja la oferta fuera", () => {
    const sinExternos: Datos = { ...datos, organizacion: { ...datos.organizacion, aceptaExpertosExternos: false } };
    expect(verificar(compra("LIC-DEMO-004"), req("LIC-DEMO-004"), sinExternos).veredicto).toBe("no_postulable");
  });
});

describe("citas", () => {
  it("una cita se verifica contra las bases sin importar tildes ni mayúsculas, y una inventada no", () => {
    const bases = "El relator deberá contar con TÍTULO PROFESIONAL de ingeniería.";
    expect(citaEnBases("titulo profesional de ingenieria", bases)).toBe(true);
    expect(citaEnBases("título técnico de nivel superior", bases)).toBe(false);
    expect(citaEnBases("lo que sea", null)).toBeNull();
  });
});
