// Etapa 4: oferta económica. Sin IA: es aritmética y tiene que poder auditarse.
//
// Costo = horas por rol (según el modelo de esfuerzo del tipo de servicio) x tarifa
//       + preparación de la postulación + costos directos + contingencia
//       + costo financiero de la garantía de fiel cumplimiento.
// Precio: se prueban escenarios entre el tope y el costo con margen mínimo. El puntaje de
// precio se estima con la fórmula usual (menor precio / precio propio) contra un competidor
// estimado desde el historial de adjudicaciones; sin historial, se asume 85 % del tope.
import type { Datos } from "../datos.js";
import type { Compra, Escenario, Evaluacion, Oferta, Requisitos } from "../tipos.js";

const RATIO_COMPETIDOR_SIN_HISTORIAL = 0.85;

export function topeNeto(compra: Compra, req: Requisitos, ivaPct: number, exenta: boolean): number | null {
  if (compra.presupuestoCLP === null) return null;
  const conImpuestos = req.presupuestoIncluyeImpuestos ?? compra.presupuestoIncluyeImpuestos ?? true;
  if (!conImpuestos || exenta) return Math.floor(compra.presupuestoCLP);
  return Math.floor(compra.presupuestoCLP / (1 + ivaPct));
}

export function ratioCompetidor(datos: Datos, tipo: string): number {
  const casos = datos.historial.filter((h) => h.tipo === tipo && h.adjudicadoCLP !== null && h.presupuestoCLP > 0);
  if (casos.length === 0) return RATIO_COMPETIDOR_SIN_HISTORIAL;
  const ratios = casos.map((h) => (h.adjudicadoCLP as number) / h.presupuestoCLP).sort((a, b) => a - b);
  return ratios[Math.floor(ratios.length / 2)] as number; // mediana
}

// Puntaje esperado en los criterios que no son precio, según lo que dio la verificación.
function puntajeNoPrecio(req: Requisitos, ev: Evaluacion | null, datos: Datos): number {
  let total = 0;
  for (const c of req.criterios) {
    if (c.tipo === "precio") continue;
    if (c.tipo === "sello_empresa_mujer") total += datos.organizacion.selloEmpresaMujer ? c.ponderacion : 0;
    else if (c.tipo === "sanciones") total += datos.organizacion.sancionesUltimos24Meses === 0 ? c.ponderacion : c.ponderacion / 2;
    else if (c.tipo === "experiencia_oferente" || c.tipo === "perfil_equipo") {
      const prefijo = c.tipo === "perfil_equipo" ? "Perfil:" : "Experiencia del oferente";
      const vs = ev?.verificaciones.filter((v) => v.requisito.startsWith(prefijo)) ?? [];
      const f = vs.length === 0 ? 0.5 : vs.filter((v) => v.estado === "cumple").length / vs.length;
      total += c.ponderacion * f;
    } else total += c.ponderacion * 0.8; // propuesta técnica, formales, integridad: supuesto conservador
  }
  return total;
}

export function costear(compra: Compra, req: Requisitos, datos: Datos, ev: Evaluacion | null): Oferta {
  const { costos, organizacion: org } = datos;
  const advertencias: string[] = [];
  const detalle: Oferta["costoDetalle"] = [];

  const modelo = costos.modelosEsfuerzo[req.servicio.tipoEsfuerzo];
  const unidades = req.servicio.unidades;
  if (!modelo) advertencias.push(`No hay modelo de esfuerzo para "${req.servicio.tipoEsfuerzo}" en costos.yaml.`);
  if (unidades === null) advertencias.push("Las bases no dicen cuántas unidades (horas, entregables): el costo de ejecución queda en cero.");
  if (modelo && unidades !== null) {
    for (const [rol, porUnidad] of Object.entries(modelo.horasPorUnidad)) {
      const tarifa = costos.tarifasHora[rol];
      if (tarifa === undefined) {
        advertencias.push(`Falta la tarifa del rol "${rol}" en costos.yaml.`);
        continue;
      }
      const horas = porUnidad * unidades;
      detalle.push({ concepto: `${rol} (${porUnidad} h por ${modelo.unidad} x ${unidades})`, horas, montoCLP: Math.round(horas * tarifa) });
    }
  }
  const tarifaPrep = costos.tarifasHora[costos.rolPreparacion] ?? 0;
  detalle.push({ concepto: "Preparación de la postulación", horas: costos.horasPreparacionPostulacion, montoCLP: Math.round(costos.horasPreparacionPostulacion * tarifaPrep) });
  if (costos.costosDirectosCLP) detalle.push({ concepto: "Costos directos", horas: null, montoCLP: costos.costosDirectosCLP });
  const base = detalle.reduce((s, d) => s + d.montoCLP, 0);
  detalle.push({ concepto: `Contingencia (${Math.round(costos.contingenciaPct * 100)} %)`, horas: null, montoCLP: Math.round(base * costos.contingenciaPct) });

  const tope = topeNeto(compra, req, costos.ivaPct, org.facturaExenta);
  const garantiaPct = req.garantiaCumplimientoPct ?? 0;
  const costoGarantia = (precio: number) => Math.round(precio * (garantiaPct / 100) * costos.costoFinancieroGarantiaPct);
  const costoSinGarantia = detalle.reduce((s, d) => s + d.montoCLP, 0);

  const pesoPrecio = req.criterios.find((c) => c.tipo === "precio")?.ponderacion ?? 0;
  const ratio = ratioCompetidor(datos, compra.tipo);
  const competidor = tope !== null ? Math.round(tope * ratio) : null;
  const noPrecio = puntajeNoPrecio(req, ev, datos);
  const factorImpuesto = org.facturaExenta ? 1 : 1 + costos.ivaPct;

  const escenario = (etiqueta: string, precio: number): Escenario => {
    const costo = costoSinGarantia + costoGarantia(precio);
    const puntajePrecio = competidor !== null ? pesoPrecio * Math.min(1, competidor / precio) : 0;
    return {
      etiqueta,
      precioNetoCLP: precio,
      precioTotalCLP: Math.round(precio * factorImpuesto),
      costoCLP: costo,
      margenCLP: precio - costo,
      margenPct: precio > 0 ? (precio - costo) / precio : 0,
      puntajePrecioEstimado: Math.round(puntajePrecio * 10) / 10,
      puntajeTotalEstimado: Math.round((puntajePrecio + noPrecio) * 10) / 10,
      sobreTope: tope !== null && precio > tope,
    };
  };

  const escenarios: Escenario[] = [];
  const minimo = Math.ceil(costoSinGarantia / (1 - costos.margenMinimoPct));
  if (tope !== null) {
    for (const f of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) escenarios.push(escenario(`${Math.round(f * 100)} % del tope`, Math.floor(tope * f)));
  }
  if (competidor !== null) escenarios.push(escenario("Igual al competidor estimado", competidor));
  escenarios.push(escenario("Costo + margen mínimo", minimo));
  escenarios.sort((a, b) => b.precioNetoCLP - a.precioNetoCLP);

  // Recomendación: bajar el precio solo hasta donde suma puntaje. Bajo el precio del competidor
  // estimado ya se tiene el puntaje de precio completo y cada peso menos es margen perdido.
  // Entre los escenarios con margen objetivo, se toma el más alto que no supera al competidor;
  // si ninguno llega, el de mayor puntaje con margen mínimo.
  const viables = escenarios.filter((e) => !e.sobreTope && e.margenPct >= costos.margenMinimoPct);
  const conObjetivo = viables.filter((e) => e.margenPct >= costos.margenObjetivoPct);
  const recomendado =
    conObjetivo.find((e) => competidor === null || e.precioNetoCLP <= competidor) ??
    [...viables].sort((a, b) => b.puntajeTotalEstimado - a.puntajeTotalEstimado || b.margenCLP - a.margenCLP)[0] ??
    null;

  if (tope !== null && minimo > tope) {
    advertencias.push(`El costo con margen mínimo (${minimo} neto) supera el tope (${tope} neto): con esta estructura de costos no conviene postular.`);
  }
  if (recomendado && recomendado.margenPct < costos.margenObjetivoPct) {
    advertencias.push(`El precio recomendado deja ${Math.round(recomendado.margenPct * 100)} % de margen, bajo el objetivo de ${Math.round(costos.margenObjetivoPct * 100)} %.`);
  }
  if (datos.historial.length === 0) {
    advertencias.push(`Sin historial de adjudicaciones: el competidor se estima en ${RATIO_COMPETIDOR_SIN_HISTORIAL * 100} % del tope.`);
  }
  return {
    compraId: compra.id,
    costoDetalle: detalle,
    costoTotalCLP: costoSinGarantia,
    topeNetoCLP: tope,
    precioCompetidorEstimadoCLP: competidor,
    escenarios,
    recomendado,
    advertencias,
  };
}
