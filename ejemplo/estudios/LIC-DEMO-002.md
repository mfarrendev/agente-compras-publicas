# Informe del agente: LIC-DEMO-002

Veredicto (verificación determinista): no_postulable

No conviene postular: la oferta no sería evaluada. El punto 2 de las bases dice que "Podrán participar únicamente universidades acreditadas por la Comisión Nacional de Acreditación por al menos 4 años. Las ofertas de instituciones que no cumplan este requisito no serán evaluadas". Consultora Ejemplo SpA es una SpA y no una universidad acreditada, así que la oferta no pasaría la admisibilidad. No calculamos precio porque no es postulable.
En lo técnico el servicio sí nos calza: es un diplomado de 120 horas en modalidad mixta, sobre transformación digital, con un presupuesto de $25.000.000. El coordinador académico tiene que tener magíster y 10 años de experiencia en transformación digital, y Andrea Ejemplo cumple (magíster y 12 años). La evaluación pondera precio 30%, propuesta técnica 40% y equipo docente 30%, y pide garantía de fiel cumplimiento del 5%.
La única forma de entrar sería como subcontratista o docente de una universidad acreditada que postule. Las bases no hablan de uniones temporales ni de subcontratación.

## Riesgos que vio al leer

- La restricción a universidades acreditadas viene en el punto 2 de las bases como requisito de admisibilidad y deja fuera a cualquier oferente que no sea universidad acreditada.
- Las bases no dicen si el presupuesto de $25.000.000 incluye impuestos.
- Las bases no dicen si se permite la subcontratación ni las uniones temporales de proveedores, así que no está claro que se pueda participar como socio de una universidad.

## Para revisar a mano

- ¿Tenemos relación con alguna universidad acreditada por 4 años o más que quiera postular y sumarnos como equipo docente o subcontratista? (Andrea Ejemplo cumple el perfil de coordinadora académica)
- ¿Vale la pena preguntar al Servicio Regional Demo en el foro de preguntas si acepta subcontratación? Ya trabajamos con ellos (exp-02, curso de análisis de datos, 2025).

## Cómo trabajó (6 vueltas, 6 herramientas)

Tokens: 10491 de entrada, 30720 leídos de caché, 0 escritos en caché, 2339 de salida. Costo aproximado: USD 0.09.

1. listar_documentos {}
2. leer_documento {"nombre":"bases.txt","desde":1}
3. registrar_requisitos {"requisitos":{"perfiles":[{"rol":"Coordinador académico","obligatorio":false,"tituloAreas":[],"semestresMinimos":null,"tituloObtenidoExigid
4. verificar_postulacion {}
5. ver_equipo {}
6. entregar_informe {"resumen":"No conviene postular: la oferta no sería evaluada. El punto 2 de las bases dice que \"Podrán participar únicamente universidades
