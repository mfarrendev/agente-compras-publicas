// Carga la carpeta de datos de la organización. La estructura es la de ejemplo/:
//   organizacion.yaml, costos.yaml, experiencias.yaml, historial.yaml (opcional),
//   equipo/*.yaml (una persona por archivo) y compras/*.json (solo para la fuente "archivo").
// Los datos reales de una organización van en una carpeta fuera del repositorio o en datos/,
// que está en .gitignore.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { Costos, Experiencia, Historial, Organizacion, Persona } from "./tipos.js";

export interface Datos {
  dir: string;
  organizacion: Organizacion;
  equipo: Persona[];
  experiencias: Experiencia[];
  costos: Costos;
  historial: Historial;
}

function leerYaml<T>(ruta: string, esquema: z.ZodType<T>): T {
  const crudo = parse(readFileSync(ruta, "utf8"));
  const r = esquema.safeParse(crudo);
  if (!r.success) {
    throw new Error(`${ruta} no cumple el formato esperado:\n${z.prettifyError(r.error)}`);
  }
  return r.data;
}

export function cargarDatos(dir: string): Datos {
  if (!existsSync(join(dir, "organizacion.yaml"))) {
    throw new Error(`No encuentro ${join(dir, "organizacion.yaml")}. Copia ejemplo/ y edítalo.`);
  }
  const dirEquipo = join(dir, "equipo");
  const equipo = existsSync(dirEquipo)
    ? readdirSync(dirEquipo)
        .filter((f) => f.endsWith(".yaml"))
        .sort()
        .map((f) => leerYaml(join(dirEquipo, f), Persona))
    : [];
  const rutaHist = join(dir, "historial.yaml");
  return {
    dir,
    organizacion: leerYaml(join(dir, "organizacion.yaml"), Organizacion),
    equipo,
    experiencias: leerYaml(join(dir, "experiencias.yaml"), z.array(Experiencia)),
    costos: leerYaml(join(dir, "costos.yaml"), Costos),
    historial: existsSync(rutaHist) ? leerYaml(rutaHist, Historial) : [],
  };
}
