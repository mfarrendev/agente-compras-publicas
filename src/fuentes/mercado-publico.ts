// Fuentes de Mercado Público (Chile).
//
// Licitaciones: API pública oficial de ChileCompra, con un ticket gratuito que se pide en
// https://api.mercadopublico.cl. El listado de licitaciones activas trae código, nombre y
// cierre; el detalle de cada una trae organismo, monto estimado y descripción.
//
// Compras Ágiles: no están en la API oficial. El buscador público
// (buscador.mercadopublico.cl/compra-agil) consulta una API propia con un token que la página
// obtiene sola, y rechaza (403) las llamadas que no vienen del navegador. Por eso esta fuente
// abre la página con Playwright, toma las cabeceras de su primera consulta y las reutiliza.
// Es una integración no oficial: si el sitio cambia, es lo primero que se rompe.
import { Compra } from "../tipos.js";
import { normalizar, type Fuente } from "./fuente.js";

const API = "https://api.mercadopublico.cl/servicios/v1/publico";

interface ListadoLicitaciones {
  Listado?: { CodigoExterno: string; Nombre: string; FechaCierre: string | null }[];
}
interface DetalleLicitacion {
  Listado?: {
    CodigoExterno: string;
    Nombre: string;
    Descripcion?: string;
    Comprador?: { NombreOrganismo?: string };
    MontoEstimado?: number | null;
    Fechas?: { FechaCierre?: string | null };
  }[];
}

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Mercado Público respondió ${r.status} para ${url.split("?")[0]}`);
  return (await r.json()) as T;
}

export class FuenteLicitaciones implements Fuente {
  nombre = "mercado-publico-licitaciones";
  constructor(private readonly ticket: string, private readonly maxDetalles = 40) {}

  async buscar(palabras: string[]): Promise<Compra[]> {
    const lista = await json<ListadoLicitaciones>(`${API}/licitaciones.json?estado=activas&ticket=${this.ticket}`);
    const claves = palabras.map(normalizar);
    // El listado no trae descripción: se filtra por nombre y solo se pide el detalle de las que calzan.
    const candidatas = (lista.Listado ?? []).filter((l) => claves.some((k) => normalizar(l.Nombre).includes(k)));
    const compras: Compra[] = [];
    for (const l of candidatas.slice(0, this.maxDetalles)) {
      const d = await json<DetalleLicitacion>(`${API}/licitaciones.json?codigo=${l.CodigoExterno}&ticket=${this.ticket}`);
      const x = d.Listado?.[0];
      if (!x) continue;
      compras.push(
        Compra.parse({
          id: x.CodigoExterno,
          tipo: "licitacion",
          nombre: x.Nombre,
          descripcion: x.Descripcion ?? "",
          organismo: x.Comprador?.NombreOrganismo ?? "",
          presupuestoCLP: x.MontoEstimado ?? null,
          cierre: x.Fechas?.FechaCierre ?? l.FechaCierre,
          url: `https://www.mercadopublico.cl/Procurement/Modules/RFB/DetailsAcquisition.aspx?idlicitacion=${x.CodigoExterno}`,
          fuente: this.nombre,
        }),
      );
    }
    return compras;
  }
}

interface ResultadoCompraAgil {
  codigo: string;
  nombre: string;
  organismo: string;
  monto_disponible_CLP: number | null;
  fecha_cierre: string | null;
  cantidad_proveedores_cotizando: number | null;
}

export class FuenteComprasAgiles implements Fuente {
  nombre = "mercado-publico-compras-agiles";
  constructor(private readonly diasHaciaAtras = 30, private readonly maxPaginas = 10) {}

  async buscar(palabras: string[]): Promise<Compra[]> {
    // Playwright es opcional: solo lo necesita esta fuente.
    const { chromium } = await import("playwright").catch(() => {
      throw new Error("La fuente de Compras Ágiles necesita Playwright: npm i -D playwright && npx playwright install chromium");
    });
    const navegador = await chromium.launch({ headless: true });
    try {
      const ctx = await navegador.newContext({ locale: "es-CL" });
      const pagina = await ctx.newPage();
      let cabeceras: Record<string, string> | null = null;
      pagina.on("request", (r) => {
        if (!cabeceras && r.url().startsWith("https://api.buscador.mercadopublico.cl/compra-agil?")) cabeceras = r.headers();
      });
      await pagina.goto("https://buscador.mercadopublico.cl/compra-agil", { waitUntil: "networkidle", timeout: 60_000 });
      if (!cabeceras) throw new Error("El buscador de Compras Ágiles no hizo su consulta inicial; puede haber cambiado.");

      const hoy = new Date();
      const desde = new Date(hoy.getTime() - this.diasHaciaAtras * 86_400_000);
      const f = (d: Date) => d.toISOString().slice(0, 10);
      const vistas = new Map<string, Compra>();
      for (const palabra of palabras) {
        for (let pag = 1; pag <= this.maxPaginas; pag++) {
          const url =
            `https://api.buscador.mercadopublico.cl/compra-agil?date_from=${f(desde)}&date_to=${f(hoy)}` +
            `&keywords=${encodeURIComponent(palabra)}&order_by=recent&page_number=${pag}&status=2`;
          const r = await ctx.request.get(url, { headers: cabeceras });
          if (!r.ok()) break; // el servicio a veces responde 502; se sigue con la palabra siguiente
          const j = (await r.json()) as { payload: { resultados: ResultadoCompraAgil[]; pageCount: number } };
          for (const x of j.payload.resultados) {
            if (vistas.has(x.codigo)) continue;
            vistas.set(
              x.codigo,
              Compra.parse({
                id: x.codigo,
                tipo: "compra_agil",
                nombre: x.nombre,
                organismo: x.organismo,
                presupuestoCLP: x.monto_disponible_CLP,
                presupuestoIncluyeImpuestos: true,
                cierre: x.fecha_cierre,
                cotizacionesRecibidas: x.cantidad_proveedores_cotizando,
                url: `https://buscador.mercadopublico.cl/ficha?code=${x.codigo}`,
                fuente: this.nombre,
              }),
            );
          }
          if (pag >= j.payload.pageCount) break;
        }
      }
      return [...vistas.values()];
    } finally {
      await navegador.close();
    }
  }
}
