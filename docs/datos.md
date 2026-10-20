# Formato de la carpeta de datos

Todo se valida al cargar con los esquemas de [`src/tipos.ts`](../src/tipos.ts): un archivo mal
escrito falla al empezar, con el campo que falta, y no a mitad de una evaluación.

```
datos/
  organizacion.yaml     quién es la organización y qué hace
  equipo/*.yaml         una persona por archivo
  experiencias.yaml     servicios prestados, con sus respaldos
  costos.yaml           tarifas, modelos de esfuerzo y márgenes
  historial.yaml        (opcional) a cuánto se adjudicaron compras parecidas
  compras/              (solo para la fuente "archivo") compras guardadas a mano
    <id>.json
    <id>.bases.txt      texto de las bases, si se tiene
    <id>/*.pdf          PDFs de las bases: van a la IA como documentos
```

`datos/` y `salida/` están en `.gitignore`. Los datos de una organización real no deberían
estar en un repositorio.

## organizacion.yaml

| Campo | Para qué sirve |
|---|---|
| `descripcion`, `rubros` | El juicio de pertinencia. Mientras más concreto, mejor decide la IA |
| `palabrasClave`, `exclusiones` | El prefiltro sin IA. Se comparan sin tildes ni mayúsculas |
| `montoMinimo`, `montoMaximo` | Lo que vale la pena preparar y lo que se puede ejecutar |
| `inscritaRegistroProveedores` | Requisito casi universal |
| `tiposInstitucion` | Para bases que exigen, por ejemplo, `universidad_acreditada` u `otec_norma_2728` |
| `selloEmpresaMujer`, `sancionesUltimos24Meses` | Criterios de puntaje frecuentes |
| `aceptaExpertosExternos` | Si es `true`, un perfil que falta es una brecha y no un descarte |

## equipo/*.yaml

Cada persona trae su título (área, semestres, si está obtenido), grados, años de experiencia,
áreas, horas de docencia y **qué respaldos existen de verdad**. Sin respaldo, el agente marca el
perfil como parcial. `tarifaRol` dice con qué tarifa de `costos.yaml` se valoriza su hora.

## experiencias.yaml

Cada servicio prestado, con fechas y respaldos (`orden_de_compra`, `factura`, `contrato`,
`carta_mandante`, `certificado`, `recepcion_conforme`). Las bases suelen aceptar solo algunos;
el agente cuenta solo los que calzan y solo dentro de la ventana de años que piden.

## compras/<id>.json

```json
{
  "id": "CA-DEMO-001",
  "tipo": "compra_agil",
  "nombre": "Curso de inteligencia artificial aplicada para funcionarios",
  "descripcion": "...",
  "organismo": "Municipalidad de Villa Ejemplo",
  "presupuestoCLP": 3500000,
  "presupuestoIncluyeImpuestos": true,
  "cierre": "2030-12-15T15:00:00-03:00",
  "fuente": "ejemplo"
}
```

En el ejemplo, cada compra trae además `<id>.requisitos.json`: es lo que la IA devolvería al
leer las bases, guardado para que la demo corra sin API. Con una clave de API ese archivo no se
usa; los requisitos se extraen de las bases.
