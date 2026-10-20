// Única puerta hacia el modelo. Devuelve JSON validado contra un esquema Zod: la respuesta
// llega con salida estructurada (output_config.format) y se vuelve a validar aquí, porque
// una respuesta que no calza con el esquema es un error, no un dato.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const MODELO = "claude-opus-5-5";

export type Esfuerzo = "low" | "medium" | "high" | "xhigh" | "max";

export interface Pedido<T> {
  esquema: z.ZodType<T>;
  // Parte estable del prompt (perfil de la organización, reglas): se cachea entre compras.
  sistema: string;
  // Contenido variable: la compra, sus bases. Puede incluir PDFs como bloques de documento.
  contenido: Anthropic.ContentBlockParam[];
  esfuerzo: Esfuerzo;
  maxTokens?: number;
}

let cliente: Anthropic | null = null;

export async function pedirJson<T>(p: Pedido<T>): Promise<T> {
  cliente ??= new Anthropic();
  const stream = cliente.beta.messages.stream({
    model: MODELO,
    max_tokens: p.maxTokens ?? 32000,
    // Si un clasificador de seguridad declina, la API reintenta en el modelo que corresponda.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: p.sistema, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: p.contenido }],
    output_config: { effort: p.esfuerzo, format: zodOutputFormat(p.esquema) },
  });
  const mensaje = await stream.finalMessage();

  if (mensaje.stop_reason === "refusal") {
    throw new Error("El modelo declinó la solicitud; la compra queda para revisión humana.");
  }
  if (mensaje.stop_reason === "max_tokens") {
    throw new Error("La respuesta se cortó por largo; sube maxTokens para esta etapa.");
  }
  const texto = mensaje.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  const r = p.esquema.safeParse(JSON.parse(texto));
  if (!r.success) throw new Error(`La respuesta no calza con el esquema: ${r.error.message}`);
  return r.data;
}
