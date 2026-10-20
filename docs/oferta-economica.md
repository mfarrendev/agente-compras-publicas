# Oferta económica

La etapa 4 no usa IA. Es aritmética y tiene que poder auditarse línea por línea.

## Costo

```
costo = horas por rol x tarifa del rol       (según el modelo de esfuerzo del servicio)
      + horas de preparación de la postulación
      + costos directos
      + contingencia (% sobre lo anterior)
      + costo financiero de la garantía       (si las bases la piden; depende del precio)
```

El modelo de esfuerzo dice cuántas horas de cada rol consume una unidad de servicio. En el
ejemplo, una hora lectiva de un curso consume 1 hora del relator, media hora de preparación de
material y un cuarto de hora de coordinación. Una consultoría se mide por entregable.

```yaml
modelosEsfuerzo:
  capacitacion:
    unidad: hora lectiva
    horasPorUnidad: { senior: 1, consultor: 0.5, coordinacion: 0.25 }
```

La IA, al leer las bases, dice qué tipo de servicio es y cuántas unidades pide (24 horas, 3
entregables). Si no lo encuentra, el costo de ejecución queda en cero y aparece una advertencia.

## Tope

El presupuesto publicado casi siempre incluye impuestos. El tope neto es el presupuesto
dividido por 1,19 (IVA), salvo que la organización facture exento. Un precio neto sobre el
tope deja la oferta fuera.

## Competidor estimado

Con el historial de compras parecidas (`historial.yaml`), se toma la mediana de
`adjudicado / presupuesto` de las del mismo tipo. Sin historial, se asume 85 % del tope.

## Escenarios y recomendación

Se prueban precios de 100 % a 70 % del tope, el precio del competidor estimado y el costo más
el margen mínimo. Para cada uno se calcula el margen y un puntaje estimado: el de precio con la
fórmula usual (precio más bajo / precio propio, por la ponderación) y el resto según lo que dio
la verificación de requisitos.

La recomendación: el precio más alto que no supera al competidor estimado y deja el margen
objetivo. Bajo ese precio ya se tiene el puntaje de precio completo, y cada peso menos es margen
perdido sin puntaje a cambio. Si ningún escenario llega al margen objetivo, se toma el de mayor
puntaje que deja el margen mínimo. Si el costo con margen mínimo supera el tope, el agente lo
dice: con esa estructura de costos no conviene postular.

## Limitaciones

- El puntaje de los criterios que no son precio es una estimación gruesa (por ejemplo, 80 % de
  la propuesta técnica). Sirve para comparar escenarios entre sí, no para predecir el resultado.
- La fórmula de precio cambia entre bases. Si una base usa otra, conviene ajustarla en
  `src/agentes/economico.ts`.
