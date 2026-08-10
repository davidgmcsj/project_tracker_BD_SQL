# Plan de mejora — Módulo de Reportería
**Sistema de Seguimiento Semanal de Proyectos — Oficina de Tecnología, Corte Suprema de Justicia**

Versión: 4 de agosto de 2026
Referencia de diseño: filtros acumulativos estilo QueueMetrics (call center) — panel de facetas + catálogo de consultas predefinidas, sin escribir SQL manual desde el frontend.

---

## Tabla de contenido

1. [Objetivo y principio de diseño](#1-objetivo-y-principio-de-diseño)
2. [Diagnóstico del estado actual](#2-diagnóstico-del-estado-actual)
3. [Arquitectura de datos nueva](#3-arquitectura-de-datos-nueva)
4. [Motor de reportería: catálogo de consultas + filtros acumulativos](#4-motor-de-reportería-catálogo-de-consultas--filtros-acumulativos)
5. [Contrato de API](#5-contrato-de-api)
6. [Vista en pantalla](#6-vista-en-pantalla)
7. [Exportación a Excel y PDF](#7-exportación-a-excel-y-pdf)
8. [UI del módulo de reportes](#8-ui-del-módulo-de-reportes)
9. [Mejoras estilo Planner (fuera del módulo de reportes)](#9-mejoras-estilo-planner-fuera-del-módulo-de-reportes)
10. [Riesgos a cerrar antes de producción](#10-riesgos-a-cerrar-antes-de-producción)
11. [Roadmap por sprints](#11-roadmap-por-sprints)
12. [Glosario de esta propuesta](#12-glosario-de-esta-propuesta)

---

## 1. Objetivo y principio de diseño

Construir una sección **Reportes** donde:

- Los filtros son **acumulativos** (facetados): cada filtro que agregas reduce el conjunto de resultados del anterior, no lo reemplaza. Igual que en QueueMetrics: eliges cola, luego agente, luego rango de fechas, y cada paso reduce el universo de llamadas.
- El usuario **nunca escribe SQL**. Elige una **consulta base** de un catálogo fijo (ej. "Actividades", "Ingenieros", "Proyectos") y le aplica filtros de una lista controlada de campos permitidos para esa consulta. El backend traduce eso a SQL parametrizado de forma segura.
- El resultado se ve primero **en pantalla** (tabla real, no un resumen). Solo cuando el usuario confirma que es lo que quiere, exporta a **Excel** o **PDF** con el mismo dato, sin volver a consultar.

Este documento es la referencia para todo el trabajo de este módulo. Antes de programar cualquier pieza, se revisa con vos paso a paso — ninguna migración de base de datos ni archivo nuevo se ejecuta sin tu aprobación explícita.

---

## 2. Diagnóstico del estado actual

**Lo que ya funciona bien (no se toca):**

1. IDs estables de actividad (`act_xxx`) e ingeniero (`eng_xxx`).
2. `planner_task_number` como clave de reconciliación con la importación de Planner.
3. Modelo rico de actividad: checklist, notas, fechas clave, adjuntos, progreso, horas.
4. Snapshot trimestral con doble confirmación.
5. Migraciones SQL idempotentes (005 a 011), seguras de re-ejecutar.

**Lo que falta para el módulo de reportes que pediste:**

| # | Problema | Por qué bloquea la reportería |
|---|---|---|
| 1 | No hay histórico de cambios por evento | `status_history` vive dentro del JSON de la actividad y se sobreescribe en cada guardado. No hay de dónde sacar "qué pasó esta semana" sin cargar fotos completas de `history.json`. |
| 2 | No existen endpoints de consulta agregada | Toda la agregación de hoy se hace en el navegador sobre el estado vivo, no sobre históricos filtrables. |
| 3 | La "semana" es implícita | Depende de `report_date`. Para filtrar por semana se necesita una dimensión explícita y consultable. |
| 4 | No hay exportación a Excel ni PDF real | Hoy solo hay texto plano y un `.docx` armado por reemplazo de marcadores. No sirve para tablas dinámicas. |
| 5 | No hay notas de proyecto fechadas ni con autor | `status_notes` es un solo campo que se pisa a sí mismo en cada edición. |

---

## 3. Arquitectura de datos nueva

Tres tablas nuevas en Azure SQL Server y dos columnas agregadas a `Proyectos`. Todo bajo el mismo patrón de migración idempotente que ya usa el proyecto (`IF NOT EXISTS`).

### 3.1 `Actividad_Eventos` (la pieza central — tabla de solo inserción)

Es un **log de auditoría / event log**: nunca se actualiza ni se borra una fila, solo se agregan filas nuevas. Cada cambio relevante en una actividad (cambio de estado, de responsable, de progreso, de fecha) genera una fila. Esta tabla es la que hace posible responder "¿qué pasó en la semana X?" con una sola consulta filtrada, en vez de recorrer fotos completas del historial.

```sql
-- migración 012 — add_activity_events
CREATE TABLE Actividad_Eventos (
  EventoID          BIGINT IDENTITY(1,1) PRIMARY KEY,
  AppActividadID    NVARCHAR(50)  NOT NULL,   -- act_xxx  o  etask_xxx
  AppProyectoID     NVARCHAR(50)  NULL,       -- NULL = tarea suelta de ingeniero
  AppIngenieroID    NVARCHAR(50)  NULL,       -- eng_xxx / ext_xxx
  Tipo              NVARCHAR(30)  NOT NULL,   -- estado | asignacion | progreso | fecha | nota
  ValorAnterior     NVARCHAR(MAX) NULL,
  ValorNuevo        NVARCHAR(MAX) NULL,
  FechaEvento       DATE          NOT NULL,   -- cuándo ocurrió en la realidad (editable a mano)
  FechaRegistro     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(), -- cuándo lo grabó la app
  SemanaISO         CHAR(8)       NOT NULL,   -- ej. '2026-W32'
  Origen            NVARCHAR(20)  NOT NULL    -- app | planner-import | migracion
);
CREATE INDEX IX_Eventos_Semana    ON Actividad_Eventos (SemanaISO);
CREATE INDEX IX_Eventos_Ingeniero ON Actividad_Eventos (AppIngenieroID, FechaEvento);
CREATE INDEX IX_Eventos_Proyecto  ON Actividad_Eventos (AppProyectoID, FechaEvento);
```

**Por qué dos fechas.** `FechaEvento` es la fecha real de cuando ocurrió el cambio (la que el usuario puede corregir a mano al importar histórico de Planner). `FechaRegistro` es cuándo se guardó en la app. Sin las dos no se puede distinguir "se completó tarde" de "se registró tarde" en un informe de gestión.

**Cómo se llena, sin tocar el frontend.** En `backend/db-operations.cjs` ya existe la función que sincroniza `Actividades_Detalle` en cada guardado. Se le agrega: antes de sobreescribir una fila, comparar el valor nuevo contra el guardado; si difieren, insertar un evento. El frontend no cambia nada. Si la inserción de evento falla, el guardado normal de la actividad sigue funcionando igual que hoy — el evento es un efecto secundario, no una dependencia bloqueante.

**Backfill.** Un script de una sola ejecución recorre `history.json` y el `status_history` actual de cada actividad, y genera eventos retroactivos marcados con `Origen='migracion'`. Así se recupera el histórico que ya existe antes de que la tabla nueva empiece a funcionar hacia adelante.

### 3.2 `Proyecto_Notas`

Reemplaza el campo único `status_notes` por notas fechadas y con autor — lo que pediste como "poner notas o comentarios en los proyectos".

```sql
CREATE TABLE Proyecto_Notas (
  NotaID           BIGINT IDENTITY(1,1) PRIMARY KEY,
  AppProyectoID    NVARCHAR(50)  NOT NULL,
  Fecha            DATE          NOT NULL,
  Autor            NVARCHAR(150) NULL,
  Tipo             NVARCHAR(20)  NOT NULL DEFAULT 'comentario', -- comentario|decision|riesgo|compromiso
  Texto            NVARCHAR(MAX) NOT NULL,
  IncluirEnReporte BIT           NOT NULL DEFAULT 1
);
```

### 3.3 `Reportes_Guardados`

Guarda combinaciones de filtros ya armadas para no reconfigurar cada vez — el equivalente a "colas guardadas" en QueueMetrics.

```sql
CREATE TABLE Reportes_Guardados (
  ReporteID   INT IDENTITY(1,1) PRIMARY KEY,
  Nombre      NVARCHAR(150) NOT NULL,
  Config      NVARCHAR(MAX) NOT NULL,  -- JSON con {consulta, filtros, columnas, orden}
  CreadoEn    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
```

### 3.4 Columnas nuevas en `Proyectos`

| Columna | Tipo | Motivo |
|---|---|---|
| `Prioridad` | `TINYINT` (1=alta, 2=media, 3=baja) | El booleano ★ actual solo distingue prioritario/no prioritario; para ordenar un reporte por prioridad se necesita una escala. |
| `GrupoTrabajo` | `NVARCHAR(100)` | Mencionaste que cada ingeniero pertenece a un grupo de trabajo — es un filtro natural del módulo de reportes. |

---

## 4. Motor de reportería: catálogo de consultas + filtros acumulativos

Esta es la respuesta directa a "no quiero consultar la base de datos, quiero que existan los query asociados a los filtros". El patrón tiene dos piezas:

### 4.1 Catálogo de consultas (`backend/reports/catalog.cjs`)

Un archivo que define, para cada "consulta base", qué tabla(s) usa y qué campos se pueden filtrar. No es SQL libre — es una lista cerrada de opciones seguras.

| Consulta | Base de datos | Para qué sirve |
|---|---|---|
| `actividades` | `Actividad_Eventos` + `Actividades_Detalle` | "¿Qué actividades se movieron esta semana / este proyecto / este ingeniero?" |
| `ingenieros` | `Actividad_Eventos` agrupado por `AppIngenieroID` | "¿Qué está haciendo cada ingeniero?" — tu ejemplo del reporte por persona. |
| `proyectos` | `Proyectos` + `ReportesSemanales` | "¿Cuáles son los proyectos prioritarios / en curso ahora?" |
| `vencidas` | `Actividades_Detalle` filtrado por `FechaFin < hoy` y estado ≠ completada | Alertas de vencimiento. |
| `notas` | `Proyecto_Notas` | Notas y comentarios de proyecto por periodo. |

Cada consulta declara su lista de **campos filtrables** con tipo y operador permitido:

```js
// backend/reports/catalog.cjs
module.exports = {
  actividades: {
    tabla: 'Actividad_Eventos',
    filtros: {
      semana_iso:    { tipo: 'texto',   operador: ['='] },
      proyecto_id:   { tipo: 'lista',   operador: ['=', 'in'] },
      ingeniero_id:  { tipo: 'lista',   operador: ['=', 'in'] },
      grupo_trabajo: { tipo: 'lista',   operador: ['=', 'in'] },
      estado:        { tipo: 'lista',   operador: ['=', 'in'] },
      prioritario:   { tipo: 'booleano',operador: ['='] },
      fecha_evento:  { tipo: 'rango_fecha', operador: ['between'] }
    },
    columnas_default: ['proyecto', 'ingeniero', 'actividad', 'estado', 'fecha_evento']
  }
  // ... ingenieros, proyectos, vencidas, notas
};
```

### 4.2 Constructor de SQL parametrizado (`backend/reports/queryBuilder.cjs`)

Recibe `{ consulta, filtros[] }`, valida cada filtro contra el catálogo (rechaza cualquier campo u operador que no esté en la lista) y arma la sentencia SQL usando parámetros con la librería `mssql` (la misma que ya usa el backend para Azure SQL) — nunca concatenación de texto, así que no hay riesgo de inyección SQL aunque los filtros vengan del usuario.

Los filtros son **acumulativos por diseño**: cada uno se agrega con `AND` al `WHERE`. Agregar un filtro nunca amplía el resultado, siempre lo reduce — igual que ir marcando facetas en un buscador.

```js
// Ejemplo simplificado de lo que arma queryBuilder.cjs
function construirWhere(filtros, catalogoConsulta) {
  const condiciones = [];
  const parametros = {};
  filtros.forEach((f, i) => {
    validarContraCatalogo(f, catalogoConsulta); // lanza error si el campo/operador no está permitido
    const nombreParam = `p${i}`;
    condiciones.push(`${f.campo} ${traducirOperador(f.operador)} @${nombreParam}`);
    parametros[nombreParam] = f.valor;
  });
  return { where: condiciones.join(' AND '), parametros };
}
```

---

## 5. Contrato de API

Un solo endpoint para consultar, uno para exportar. Cuando mañana necesites un reporte nuevo, se agrega una entrada al catálogo (paso 4.1) — no una pantalla ni una ruta nueva.

### 5.1 Consultar (vista previa en pantalla)

```
POST /api/reports/query
```

```json
{
  "consulta": "ingenieros",
  "filtros": [
    { "campo": "semana_iso",   "operador": "=",  "valor": "2026-W32" },
    { "campo": "ingeniero_id", "operador": "=",  "valor": "eng_a1b2c" },
    { "campo": "estado",       "operador": "in", "valor": ["in_progress", "completed"] }
  ],
  "columnas": ["proyecto", "actividad", "estado", "fecha_evento"],
  "orden": [{ "campo": "fecha_evento", "direccion": "desc" }]
}
```

Respuesta: `{ "total": 14, "filas": [ {...}, {...} ] }` — el `total` es lo que alimenta el contador "Mostrando 14 registros" en pantalla mientras se van agregando filtros.

### 5.2 Exportar (mismo filtro, otro formato)

```
POST /api/reports/export
```

Mismo cuerpo que `/query`, más `"formato": "xlsx"` o `"formato": "pdf"`. Internamente llama al mismo `queryBuilder`, así que el Excel y el PDF nunca pueden mostrar datos distintos a lo que ya viste en pantalla.

### 5.3 Metadatos del catálogo (para armar la UI de filtros)

```
GET /api/reports/catalog
```

Devuelve la lista de consultas disponibles y, por cada una, sus campos filtrables con tipo — el frontend usa esto para dibujar el panel de filtros sin tener hardcodeado qué campos existen.

---

## 6. Vista en pantalla

**Librería: TanStack Table v8** (`npm i @tanstack/react-table`).

Es *headless*: da ordenamiento, filtrado y paginación sin imponer ningún estilo propio, así que la tabla se ve con el diseño (navy/blanco/dorado) que ya tiene la app, sin pelear contra un componente ajeno. Es el estándar de facto para tablas de reportería en React.

La vista previa muestra exactamente las columnas y filas que se exportarán — no es un resumen aparte. Si algo se ve mal ahí, se corrige el filtro antes de gastar tiempo generando el Excel o el PDF.

---

## 7. Exportación a Excel y PDF

Ambos exportadores viven en `backend/reports/` y son funciones puras: reciben el JSON del resultado, devuelven un buffer de archivo. No repiten la lógica de consulta — reciben el dato ya armado.

| Formato | Librería | Instalación | Por qué esa y no otra |
|---|---|---|---|
| Excel | **ExcelJS** | `npm i exceljs` | Permite varias hojas, encabezado congelado, autofiltro y formato condicional. La librería `xlsx` que ya usa la app es muy buena para *leer* el Excel de Planner, pero no está pensada para *escribir* con estilo. |
| PDF | **pdfmake** | `npm i pdfmake` | Declarativo: se define el documento como un objeto JavaScript (títulos, tablas, pie de página con numeración). Se descarta **Puppeteer** a propósito — arrastra Chromium (~300 MB) y complica el despliegue en Azure App Service Linux. |
| Semanas ISO | **date-fns** | `npm i date-fns` | Funciones `getISOWeek`, `startOfISOWeek`, `endOfISOWeek` para calcular `SemanaISO` de forma consistente. Más liviana que Moment.js. |

---

## 8. UI del módulo de reportes

Nueva séptima pestaña en la barra de navegación: **Reportes**.

### 8.1 Panel de filtros acumulativos (estilo QueueMetrics)

- Se elige primero la **consulta base** (Actividades / Ingenieros / Proyectos / Vencidas / Notas) con un selector.
- Debajo, un panel de facetas: cada filtro disponible para esa consulta aparece como un control (lista desplegable, rango de fechas, casillas). Al aplicar un filtro, aparece como una "chip" removible arriba de la tabla.
- Cada chip agregada reduce el contador "Mostrando X de Y registros" en vivo — igual que en QueueMetrics, donde cada faceta que marcás reduce el universo de llamadas mostradas.
- Botón "Limpiar filtros" y botón "Guardar esta combinación como plantilla" (usa `Reportes_Guardados`).

### 8.2 Flujo completo

1. Elegir consulta base.
2. Agregar filtros uno a uno (acumulativos).
3. Ver el resultado en la tabla (TanStack Table) — sección 6.
4. Ajustar columnas visibles si hace falta.
5. Exportar a Excel, exportar a PDF, o copiar como texto — los tres usan el mismo filtro ya aplicado.

### 8.3 Cinco plantillas de arranque rápido

Tarjetas grandes al entrar a la pestaña, cada una preconfigura consulta + filtros:

1. **Prioritarios de la semana** — `proyectos` + `prioritario=true` + `semana_iso=actual`.
2. **Qué hace cada ingeniero** — `ingenieros` + selector de ingeniero + `semana_iso=actual`.
3. **Estado del portafolio** — `proyectos` + `estado in (on-track, at-risk, blocked)`.
4. **Detalle de un proyecto** — `actividades` + `proyecto_id=<seleccionado>`.
5. **Actividades vencidas** — `vencidas` sin filtros adicionales.

---

## 9. Mejoras estilo Planner (fuera del módulo de reportes)

Estas no son parte de la reportería, pero acercan la app a la experiencia visual de Microsoft Planner que mencionaste:

1. **Tablero global de actividades** — Kanban que cruza todos los proyectos, agrupable por ingeniero, proyecto, estado o vencimiento (hoy el Kanban existe solo por proyecto individual).
2. **Vista de carga de trabajo** — matriz ingeniero × semana con conteo de actividades y suma de `planned_hours`, resaltando en rojo quien supere 40h.
3. **Edición en línea** — cambiar estado o responsable sin abrir modal, usando **TanStack Query** (`@tanstack/react-query`) para manejar caché y reintentos.
4. **Filtros en la URL** — para compartir un enlace directo a una vista filtrada por Teams o correo.
5. **Barra de comandos (Ctrl+K)** — con la librería **cmdk**, para saltar a cualquier proyecto o ingeniero escribiendo, útil cuando la cantidad de proyectos crezca.

---

## 10. Riesgos a cerrar antes de producción

1. **Concurrencia** — `POST /api/projects` sobreescribe el estado completo; con dos personas editando a la vez, la última escritura borra a la primera en silencio. Arreglo: escritura por entidad + control de versión optimista.
2. **Identidad** — `X-API-Key` autentica al aplicativo, no a la persona. Sin usuario real no se puede llenar el campo `Autor` de `Proyecto_Notas`. Arreglo: integrar EntraID, como ya se usa en otras apps de la Oficina.
3. **`data.json` como fuente de verdad** — un reinicio de Azure App Service se lo puede llevar. SQL debería ser la verdad y el JSON, la caché.
4. **Adjuntos en `VARBINARY(MAX)`** — infla la base de datos. Mover a Azure Blob Storage y dejar solo la URL en SQL.
5. **Sin pruebas sobre el reset trimestral** — operación irreversible sin cobertura. Mínimo: pruebas con Vitest sobre `utils/formulas.js` y una prueba de integración del reset con datos de ejemplo.

---

## 11. Roadmap por sprints

| Sprint | Duración | Entregable | Depende de |
|---|---|---|---|
| 1 | 1 semana | Migración 012 (`Actividad_Eventos`) + captura de eventos en cada guardado + backfill del histórico existente | — |
| 2 | 1 semana | `Proyecto_Notas`, columnas nuevas en `Proyectos`, catálogo de consultas (`catalog.cjs`) + `queryBuilder.cjs` + endpoint `POST /api/reports/query` | Sprint 1 |
| 3 | 1 semana | Exportadores ExcelJS y pdfmake + endpoint `POST /api/reports/export` | Sprint 2 |
| 4 | 1 semana | Pestaña Reportes: panel de filtros acumulativos, tabla de vista previa (TanStack Table), 5 plantillas de arranque, `Reportes_Guardados` | Sprint 3 |
| 5 | 2 semanas | Tablero global de actividades + vista de carga de trabajo + filtros en URL (sección 9) | Sprint 2 |
| 6+ | — | Concurrencia, EntraID, Blob Storage, pruebas con Vitest (sección 10) — **antes** de producción, no después | Sprints 1-5 |

Al cerrar cada sprint se actualiza `README.md` y `DOCUMENTACION_APP.md`, ambos en español.

---

## 12. Glosario de esta propuesta

| Término | Definición |
|---|---|
| **Consulta base** | Una de las opciones fijas del catálogo (`actividades`, `ingenieros`, `proyectos`, `vencidas`, `notas`) sobre la que se aplican filtros. |
| **Filtro acumulativo** | Condición que se suma a las anteriores con `AND`, reduciendo el resultado en cada paso — patrón de panel de facetas. |
| **Event log / tabla append-only** | Tabla a la que solo se insertan filas nuevas, nunca se actualizan ni se borran; permite reconstruir "qué pasó" en cualquier periodo pasado. |
| **SemanaISO** | Identificador de semana en formato `AAAA-Www` (ej. `2026-W32`), calculado con la librería date-fns, usado como dimensión de filtro en vez de derivar la semana de una fecha cada vez. |
| **Catálogo de campos filtrables** | Lista cerrada, definida en el backend, de qué campos y operadores puede usar el frontend por cada consulta base — evita SQL libre desde la UI. |
