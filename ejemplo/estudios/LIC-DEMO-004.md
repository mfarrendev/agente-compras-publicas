# Informe del agente: LIC-DEMO-004

Veredicto (verificación determinista): postulable_con_brechas

Veredicto: postulable con brechas. La consultoría (diagnóstico, rediseño y plan de implementación en 90 días, presupuesto de $18.000.000 con impuestos incluidos) calza con nuestro rubro. Andrea Ejemplo cubre al jefe de proyecto y Bruno Demo al analista de datos. La brecha que bloquea es el especialista en experiencia usuaria: nadie del equipo tiene título de diseño ni experiencia en experiencia usuaria (Carla es psicóloga), y si falta el equipo mínimo la oferta queda inadmisible. Sin un experto externo con carta de compromiso no conviene postular. La experiencia del oferente da puntaje pero no deja fuera: solo exp-03 (consultoría para este mismo comprador, con contrato) se acredita como piden las bases. Precio recomendado: $11.500.000 netos ($13.685.000 con impuestos), con un costo estimado de $9.084.300 (incluye $1.800.000 del externo) y un margen de 21%, bajo el objetivo de 30%. La referencia es LIC-HIST-01 de este comprador: 7 ofertas y adjudicación al 76% del presupuesto. Si se ofrece el tope, el margen sube a 40%, pero se pierden unos 10 puntos de precio.

## Riesgos que vio al leer

- Si no se consigue a tiempo un especialista en experiencia usuaria con título de diseño, 3 años de experiencia y carta de compromiso, la oferta queda inadmisible.
- Parece haber mucha competencia: LIC-HIST-01 recibió 7 ofertas y se adjudicó al 76% del presupuesto. El precio es el 40% de la nota.
- La estimación del precio de la competencia sale de un solo caso y no sé si su monto adjudicado era neto o bruto. Si era neto, la competencia podría estar más arriba y nos sobraría margen.
- LIC-HIST-03 (Rediseño de atención ciudadana, del mismo comprador, $12.000.000) terminó sin ofertas ni adjudicación. Conviene saber por qué: alcance, plazos o requisitos.
- Experiencia: exp-04 (Fundación Imaginaria) solo tiene certificado, y las bases aceptan contratos u órdenes de compra. Las experiencias exp-01 y exp-02 son capacitaciones, no consultorías. Se pierde puntaje en un criterio que vale 15%.
- Se pierde el 5% del Sello Empresa Mujer.
- El adjudicado debe entregar una garantía de fiel cumplimiento del 5% del contrato (unos $684.000 al precio recomendado), y eso inmoviliza caja durante el contrato.
- Las bases no dicen la modalidad (presencial o remota). Si exige terreno, los costos directos de $100.000 pueden quedarse cortos.

## Para revisar a mano

- ¿Tenemos a mano un diseñador o diseñadora titulado con 3 años o más en experiencia usuaria que firme carta de compromiso? ¿Su costo cabe en los $1.800.000 estimados?
- ¿Se puede pedir a Fundación Imaginaria el contrato u orden de compra de exp-04 para que cuente como experiencia acreditable?
- ¿Hay otras consultorías de los últimos 5 años con contrato u orden de compra que no estén en el registro?
- ¿Aceptamos un margen de 21% para competir en precio, o vamos con un precio más alto (90% del tope, 33% de margen) y apostamos por la propuesta técnica?
- ¿El monto adjudicado en LIC-HIST-01 ($15.200.000) era neto o con impuestos?
- ¿Por qué quedó desierta LIC-HIST-03? ¿Algo de esa compra se repite en esta?

## Cómo trabajó (9 vueltas, 12 herramientas)

Tokens: 36909 de entrada, 46080 leídos de caché, 0 escritos en caché, 4908 de salida. Costo aproximado: USD 0.26.

1. listar_documentos {}
2. leer_documento {"nombre":"bases.txt","desde":1}
3. registrar_requisitos {"requisitos":{"perfiles":[{"rol":"Jefe de proyecto","obligatorio":true,"tituloAreas":["ingeniería"],"semestresMinimos":null,"tituloObtenido
4. verificar_postulacion {}
5. ver_equipo {}
6. historial_propio {"texto":"consultoría diagnóstico rediseño procesos"}
7. historial_propio {"organismo":"Corporación Ficticia de Desarrollo"}
8. licitaciones_del_comprador (rechazada) {"meses":12}
9. resultado_licitacion {"codigo":"LIC-HIST-01"}
10. resultado_licitacion {"codigo":"LIC-HIST-03"}
11. costear {"precioCompetidorNetoCLP":11500000,"evidencia":["LIC-HIST-01"],"razonamiento":"LIC-HIST-01 (Consultoría de procesos, mismo comprador): pres
12. entregar_informe {"resumen":"Veredicto: postulable con brechas. La consultoría (diagnóstico, rediseño y plan de implementación en 90 días, presupuesto de $18
