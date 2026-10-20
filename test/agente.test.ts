// El agente contra un modelo falso: un servidor HTTP local que responde como la API de
// Anthropic con un guion fijo de llamadas a herramientas. El guion se porta mal a propósito
// (cita inventada, informe antes de verificar o de costear, evidencia que no consultó) y la
// prueba exige que las herramientas lo frenen y que el veredicto final sea el determinista.
//
// Medición (2026-10-20): se puso cada defecto a mano y se corrió la suite completa (27 pruebas,
// el arnés exige que corran las 27). De las 4 pruebas de este archivo caen:
// - registrar_requisitos sin comprobar las citas: 1.
// - entregar_informe sin exigir verificar_postulacion: 1.
// - entregar_informe sin exigir costear en una compra postulable: 1.
// - costear aceptando evidencia que no se consultó: 1.
// - correrAgente devolviendo un resultado aunque el modelo no entregó informe: 1.
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { correrAgente } from "../src/agente/agente.js";
import { verificar } from "../src/agentes/requisitos.js";
import { cargarDatos } from "../src/datos.js";
import { FuenteArchivo } from "../src/fuentes/archivo.js";
import { Requisitos } from "../src/tipos.js";

const datos = cargarDatos("ejemplo");
const compras = await new FuenteArchivo("ejemplo/compras").buscar();
const compra = (id: string) => compras.find((c) => c.id === id)!;
const req = (id: string) => Requisitos.parse(JSON.parse(readFileSync(`ejemplo/compras/${id}.requisitos.json`, "utf8")));

type Paso = { herramienta: string; entrada: Record<string, unknown> } | { texto: string };
interface Pedido {
  model: string;
  system: { text: string; cache_control?: unknown }[];
  tools: { name: string }[];
  messages: { role: string; content: unknown }[];
}

let servidor: Server;
let guion: Paso[] = [];
let pedidos: Pedido[] = [];

beforeAll(async () => {
  servidor = createServer((rq, rs) => {
    let cuerpo = "";
    rq.on("data", (c) => (cuerpo += c));
    rq.on("end", () => {
      pedidos.push(JSON.parse(cuerpo) as Pedido);
      const paso = guion.shift() ?? { texto: "Listo." };
      const content =
        "texto" in paso
          ? [{ type: "text", text: paso.texto }]
          : [{ type: "tool_use", id: `toolu_${pedidos.length}`, name: paso.herramienta, input: paso.entrada }];
      rs.writeHead(200, { "content-type": "application/json" });
      rs.end(
        JSON.stringify({
          id: `msg_${pedidos.length}`,
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          content,
          stop_reason: "texto" in paso ? "end_turn" : "tool_use",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    });
  });
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r));
});
afterAll(() => new Promise<void>((r) => servidor.close(() => r())));

function cliente() {
  const { port } = servidor.address() as AddressInfo;
  return new Anthropic({ apiKey: "prueba", baseURL: `http://127.0.0.1:${port}`, maxRetries: 0 });
}

// Los resultados de herramienta que recibió el modelo, en orden.
function resultados(): { texto: string; error: boolean }[] {
  const ultimo = pedidos[pedidos.length - 1]!;
  return ultimo.messages
    .filter((m) => m.role === "user" && Array.isArray(m.content))
    .flatMap((m) => m.content as { type: string; content?: unknown; is_error?: boolean }[])
    .filter((b) => b.type === "tool_result")
    .map((b) => ({ texto: typeof b.content === "string" ? b.content : JSON.stringify(b.content), error: b.is_error === true }));
}

describe("agente", () => {
  it("frena una cita inventada, un informe prematuro y evidencia no consultada; el veredicto es el determinista", async () => {
    const r4 = req("LIC-DEMO-004");
    const conCitaInventada = { ...r4, perfiles: r4.perfiles.map((p, i) => (i === 2 ? { ...p, cita: "certificación vigente en metodologías ágiles" } : p)) };
    guion = [
      { herramienta: "listar_documentos", entrada: {} },
      { herramienta: "leer_documento", entrada: { nombre: "bases.txt" } },
      { herramienta: "registrar_requisitos", entrada: { requisitos: conCitaInventada } },
      { herramienta: "entregar_informe", entrada: { resumen: "Postulemos." } },
      { herramienta: "buscar_en_bases", entrada: { texto: "experiencia usuaria" } },
      { herramienta: "registrar_requisitos", entrada: { requisitos: r4 } },
      { herramienta: "verificar_postulacion", entrada: {} },
      { herramienta: "entregar_informe", entrada: { resumen: "Postulemos." } },
      { herramienta: "historial_propio", entrada: { organismo: "Corporación Ficticia" } },
      { herramienta: "costear", entrada: { precioCompetidorNetoCLP: 9_000_000, evidencia: ["LIC-HIST-99"] } },
      { herramienta: "costear", entrada: { precioCompetidorNetoCLP: 12_000_000, evidencia: ["LIC-HIST-01"], razonamiento: "La única comparable adjudicó al 76 % del presupuesto." } },
      { herramienta: "entregar_informe", entrada: { resumen: "Postulable con brechas: falta un especialista.", preguntasParaRevisar: ["Confirmar el externo."] } },
      { texto: "Informe entregado." },
    ];
    pedidos = [];
    const r = await correrAgente(compra("LIC-DEMO-004"), datos, { cliente: cliente(), ocds: null });

    const res = resultados();
    expect(res).toHaveLength(12);
    expect(res[2]!.texto).toContain("1 citas no aparecen");
    expect(res[3]).toMatchObject({ error: true });
    expect(res[3]!.texto).toContain("verificar_postulacion");
    expect(res[4]!.texto).toContain("experiencia usuaria");
    expect(res[5]!.texto).toContain("aparecen literales");
    expect(res[7]).toMatchObject({ error: true });
    expect(res[7]!.texto).toContain("falta costear");
    expect(res[9]).toMatchObject({ error: true });
    expect(res[9]!.texto).toContain("LIC-HIST-99");
    expect(res[10]!.error).toBe(false);

    const esperado = verificar({ ...compra("LIC-DEMO-004") }, r4, datos);
    expect(r.evaluacion.veredicto).toBe(esperado.veredicto);
    expect(r.citasNoEncontradas).toEqual([]);
    expect(r.oferta?.precioCompetidorEstimadoCLP).toBe(12_000_000);
    expect(r.oferta?.advertencias.some((a) => a.includes("LIC-HIST-01"))).toBe(true);
    expect(r.informe.resumen).toContain("brechas");
  });

  it("una compra no postulable se informa sin costear", async () => {
    guion = [
      { herramienta: "registrar_requisitos", entrada: { requisitos: req("LIC-DEMO-002") } },
      { herramienta: "verificar_postulacion", entrada: {} },
      { herramienta: "entregar_informe", entrada: { resumen: "No postulable: exige universidad acreditada." } },
      { texto: "Listo." },
    ];
    pedidos = [];
    const r = await correrAgente(compra("LIC-DEMO-002"), datos, { cliente: cliente(), ocds: null });
    expect(r.evaluacion.veredicto).toBe("no_postulable");
    expect(r.oferta).toBeNull();
  });

  it("si el modelo termina sin entregar informe, no hay resultado", async () => {
    guion = [{ herramienta: "listar_documentos", entrada: {} }, { texto: "Creo que conviene postular." }];
    pedidos = [];
    await expect(correrAgente(compra("CA-DEMO-001"), datos, { cliente: cliente(), ocds: null })).rejects.toThrow("sin entregar el informe");
  });

  it("pide al modelo correcto, con el perfil cacheado y todas las herramientas", async () => {
    guion = [{ texto: "Nada." }];
    pedidos = [];
    await correrAgente(compra("CA-DEMO-001"), datos, { cliente: cliente(), ocds: null }).catch(() => {});
    const p = pedidos[0]!;
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.system[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(p.system[0]!.text).toContain(datos.organizacion.nombre);
    expect(p.tools.map((t) => t.name)).toEqual([
      "listar_documentos", "leer_documento", "buscar_en_bases", "registrar_requisitos", "ver_equipo",
      "verificar_postulacion", "historial_propio", "licitaciones_del_comprador", "resultado_licitacion",
      "costear", "entregar_informe",
    ]);
  });
});
