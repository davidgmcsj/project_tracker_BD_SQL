# Plan de ejecución por fases — Módulo de Reportería

## Context

El archivo `plan-modulo-reportes.md` (raíz del repo) propone construir una sección **Reportes** con filtros acumulativos estilo QueueMetrics, catálogo de consultas predefinidas sin SQL manual, exportación a Excel/PDF, más mejoras estilo Planner (§9) y cierre de riesgos de producción (§10).

Auditamos ese documento contra el código real. **El diseño es correcto, pero tiene 6 supuestos falsos** que harían fallar la implementación si se ejecuta literalmente (detalle al final). Este plan corrige esos supuestos y organiza el alcance completo en 15 fases.

**Decisiones del usuario ya tomadas:** event log y motor de consultas en paralelo; Excel y PDF en la misma entrega; alcance completo del documento (backend + frontend + base de datos).

**Resultado esperado:** una pestaña Reportes donde el coordinador arma consultas por facetas sobre datos históricos reales, las ve en pantalla y las exporta — más el cierre de los riesgos de pérdida de datos que hoy existen.

---

## Tabla resumen de fases

| # | Fase | Objetivo verificable | Días | Depende de |
|---|---|---|---|---|
| **0** | Cimientos compartidos | `utils.cjs` con helpers ISO; `npm run migrate` aplica pendientes; `npm test` verde | 2 | — |
| **1** | Event log operativo | Cada guardado inserta filas en `Actividad_Eventos` | 5 | 0 |
| **1B** | Backfill histórico | Eventos retroactivos desde `RawDataJSON` + `status_history` | 3 | 1 |
| **2** | Motor de consultas *(‖ Fase 1)* | `POST /api/reports/query` responde con datos reales | 5 | 0 |
| **3** | Notas de proyecto + dimensiones | `Proyecto_Notas` operativa; Prioridad 1-3 y Grupo de trabajo filtrables | 4 | 1, 2 |
| **4** | Pestaña Reportes en pantalla | Séptima pestaña con facetas, chips, contador y tabla | 6 | 2 |
| **5** | Exportación Excel + PDF | Botones descargan el mismo dato que está en pantalla | 4 | 4 |
| **6** | Reportes guardados | Plantillas persistidas y recargables | 2 | 4 |
| **7** | Riesgo 10.3 — SQL fuente de verdad | Reinicio de App Service ya no pierde datos | 5 | 1 |
| **8** | Riesgo 10.1 — Concurrencia | Dos ediciones simultáneas avisan en vez de pisarse | 5 | 7 |
| **9** | Riesgo 10.2 — EntraID | Login real; `Autor` deja de ser texto libre | 8 | 3, 8 |
| **10** | Riesgo 10.4 — Blob Storage | Adjuntos salen de `VARBINARY(MAX)` | 4 | 0 |
| **11** | Riesgo 10.5 — Pruebas | Suite que cubre reset trimestral y motor de consultas | 4 | 1, 2 |
| **12** | Planner A — Tablero global + carga | Kanban cross-proyecto y matriz ingeniero × semana | 6 | 2 |
| **13** | Planner B — Filtros en URL + edición en línea | Enlace compartible reproduce la vista filtrada | 5 | 4, 12 |
| **14** | Planner C — Ctrl+K | Salto a proyecto/ingeniero/actividad escribiendo | 2 | 12 |

**Total secuencial:** ~64 días hábiles ≈ 13 semanas. **Con paralelismos (1‖2, 10 flotante):** ~9-10 semanas.

**Ruta crítica:** 0 → 2 → 4 → 5 → 6 → 13
**Ruta de riesgo (cerrar antes de producción):** 1 → 7 → 8 → 9

---

## Detalle por fase

### Fase 0 — Cimientos compartidos (2 días)

Existe porque las Fases 1 y 2 corren en paralelo y ambas necesitan lo mismo. Sin esta fase, se pisarían en `utils.cjs` y `run-migration.cjs`.

| Archivo | Cambio |
|---|---|
| `backend/utils.cjs` | Agregar `isoWeek(d) → "2026-W32"`, `isoWeekNumber(d)`, `isoWeekStart/End(d)`, `todayISO()`. Reusa la lógica de `getWeekNumber` (`db-operations.cjs:39`, ya es ISO 8601 correcta) y le agrega el **año ISO**, que hoy falta: el 1-ene-2027 (viernes) pertenece a `2026-W53`, no a `2027-W53`. |
| `backend/db-operations.cjs:39` | Borrar `getWeekNumber` local, importar de `utils.cjs`. `saveProject:319` usa `isoWeekNumber` — mismo resultado, cero cambio de comportamiento. |
| `frontend/src/utils/isoWeek.js` **(nuevo)** | Copia ESM de las 4 funciones. Frontend (ESM) y backend (CJS) no comparten bundler; se duplican 12 líneas y se blindan con test de paridad en Fase 11. |
| `frontend/src/utils/formulas.js:12` | `getWeekLabel()` pasa a ISO. **Cambia el número de semana del header** (±1) — es la corrección esperada, documentarla. |
| `backend/migrations/012_migration_control.sql` **(nuevo)** | `Migraciones_Aplicadas (Nombre PK, AplicadaEn, Checksum)`. |
| `backend/run-migration.cjs` | Sin argumento corre todas las pendientes en orden; envuelve cada script en `BEGIN TRAN/COMMIT`; registra al terminar. Mantiene el modo un-archivo-por-argumento. **Sin splitter de `GO`** — ninguna migración lo usa. |
| `backend/package.json` | `"migrate"` y `"test"` (runner nativo `node:test`). |
| `backend/tests/iso-week.test.cjs` **(nuevo)** | Fronteras: `2026-01-01`, `2027-01-01`, `2025-12-29`. |

**Verificar:** `npm run migrate` dos veces (segunda dice "0 pendientes"); `npm test` verde; `SELECT * FROM Migraciones_Aplicadas`.

---

### Fase 1 — Event log operativo (5 días) *— en paralelo con Fase 2*

| Archivo | Cambio |
|---|---|
| `backend/migrations/013_add_activity_events.sql` **(nuevo)** | `Actividad_Eventos` según §3.1, patrón `IF NOT EXISTS`. Ajustes: `Origen NVARCHAR(30)` (el backfill necesita distinguir `migracion-rawjson` de `migracion-history`); `HashCambio CHAR(64)` con índice único filtrado para idempotencia. |
| `backend/activity-events.cjs` **(nuevo, ~200 líneas)** | `snapshotFromRows(rows)`, `snapshotFromProject(project)`, `diffSnapshots(prev, next, ctx) → Evento[]` (**función pura, sin SQL — el corazón testeable**), `insertEvents(pool, eventos)`. |
| `backend/db-operations.cjs:556` | **Única línea de contacto con archivo compartido:** inyectar SELECT previo + llamada al diff dentro de `syncActividadesDetalle`. |

**Diseño del SELECT previo** (resuelve el supuesto falso #1):

```js
// al inicio de syncActividadesDetalle, antes del try de escritura
let prevSnapshot = null;
try {
  const prevRes = await pool.request()
    .input("proyId", sql.NVarChar(60), proyectoAppID)
    .query(`SELECT AppActividadID, Estado, Progreso, FechaInicio, FechaFin, HorasPlaneadas
            FROM Actividades_Detalle WHERE ProyectoAppID = @proyId`);
  prevSnapshot = snapshotFromRows(prevRes.recordset);
} catch (e) {
  console.warn(`[EVENTOS] ⚠ SELECT previo falló para ${proyectoAppID}:`, e.message);
  prevSnapshot = null;   // degradación explícita, NO throw
}

// después del try de escritura exitosa
if (prevSnapshot) {
  const eventos = diffSnapshots(prevSnapshot, snapshotFromProject(project), {
    proyectoAppID, fechaEvento: todayISO(),
  });
  if (eventos.length) insertEvents(pool, eventos).catch(e => console.warn("[EVENTOS] ⚠", e.message));
}
```

- **Si el SELECT falla:** se salta el diff, el guardado procede idéntico a hoy. Se pierde el evento, no el dato.
- **Si el INSERT de eventos falla:** `.catch()` colgado, sin `await`. El log es efecto secundario, no dependencia.
- **Costo:** +1 query (~15-40 ms) sobre 8 existentes (+12%), en camino fire-and-forget posterior a `res.json({ok:true})` (`server.cjs:415`) → **cero latencia percibida**.
- **Reintento a 5s (`server.cjs:430`):** si falló antes de escribir, el diff da los mismos eventos; si falló después del INSERT de detalle, el diff sale vacío. Comportamiento correcto sin trabajo extra.

**Tipos de evento:** `estado` (vía `statusOf()`, ya existe en `db-operations.cjs:564`), `progreso` (`act.progress`), `fecha` (`start_date`/`due_date`), `asignacion` (un evento por ingeniero agregado/quitado, con `AppIngenieroID` poblado), `nota` (ids nuevos en `act.notes[]`).

**No colisión con Fase 2:** Fase 1 toca `migrations/013`, `activity-events.cjs` (nuevo) y un bloque localizado de `db-operations.cjs:556-697`. Fase 2 toca `reports/*` (todos nuevos) y solo *consume* `getPool` por `require`, sin editar `db-operations.cjs`. Único archivo compartido: `package.json` (conflicto trivial).

**Verificar:** cambiar una actividad a "en proceso", guardar, luego `SELECT TOP 20 Tipo, ValorAnterior, ValorNuevo, SemanaISO, Origen FROM Actividad_Eventos ORDER BY EventoID DESC`. Prueba de degradación: renombrar `Actividades_Detalle` en entorno de prueba → el guardado sigue respondiendo `{ok:true}`.

---

### Fase 1B — Backfill del histórico (3 días)

**Corrección al documento:** §3.1 solo menciona `history.json`. Hay una fuente mejor: **`ReportesSemanales.RawDataJSON`** guarda `JSON.stringify(project)` completo por semana (`db-operations.cjs:327/397`) — histórico real ya acumulado que ninguna vista lee.

`backend/scripts/backfill-events.cjs` **(nuevo)** con `--dry-run` obligatorio en la primera corrida. Tres pasadas en orden de calidad de dato:

1. **`migracion-rawjson`** — por proyecto, `ReportesSemanales` ordenados por `(Anio, NumeroSemana)`, deserializar `RawDataJSON`, aplicar `diffSnapshots(semanaN, semanaN+1)` **reutilizando la función pura de Fase 1**, sin código de diff nuevo.
2. **`migracion-history`** — `status_history[actId] = {added, in_progress, completed}`, hasta 3 eventos por actividad. Solo los no cubiertos por la pasada 1 (dedupe por `AppActividadID + Tipo + ValorNuevo + FechaEvento`).
3. **`migracion-historyjson`** — `backend/history.json` (1.4 MB), solo si la pasada 1 deja huecos.

**Limitación a documentar:** `RawDataJSON` hace UPDATE al reguardar la misma semana → solo sobrevive el último guardado semanal. El histórico reconstruido tiene **granularidad semanal, no por cambio**. Por eso existe la separación `FechaEvento` / `FechaRegistro`. La pestaña Reportes debe avisar cuando el rango consultado incluya semanas previas al arranque del log.

**Verificar:** `--dry-run` primero; luego `SELECT Origen, SemanaISO, COUNT(*) ... GROUP BY`. Correrlo dos veces debe dejar el mismo conteo (idempotencia por hash).

---

### Fase 2 — Motor de consultas (5 días) *— en paralelo con Fase 1*

**Renombre necesario:** el plan llama `catalog.cjs` al registro de consultas, pero ya existe `backend/project-catalog.json` (descripciones para prompts de IA, `gemini-report.cjs:11`), sin relación. Dos "catálogos" en el mismo backend es trampa de mantenimiento → **`backend/reports/query-registry.cjs`**, endpoint `/api/reports/registry` con `/catalog` como alias.

| Archivo | Contenido |
|---|---|
| `backend/reports/query-registry.cjs` **(nuevo)** | Las 5 consultas de §4.1. Además de `tipo`/`operador`, cada campo declara **`columna`** (nombre SQL real) y **`sqlType`** (`sql.NVarChar(60)`, `sql.Int`…). Sin tipo explícito, `mssql` lo infiere del valor del usuario — justo el borde donde aparecen problemas. Cada consulta declara `from` (texto constante, nunca derivado de input) y `columnasPermitidas` (allowlist de proyección y ORDER BY). |
| `backend/reports/query-builder.cjs` **(nuevo)** | `buildQuery({consulta, filtros, columnas, orden, limite, offset}) → {sql, bind(request)}`. Lanza `ReportQueryError` ante campo/operador no permitido. `bind` recibe un `mssql.Request` → el builder es testeable sin BD. Límite duro: 5000 filas en `/query`, 50000 en `/export`. |
| `backend/reports/index.cjs` **(nuevo)** | `express.Router()` con `GET /registry`, `GET /catalog` (alias), `POST /query`. |
| `backend/server.cjs` | **Dos líneas**, colocadas **después** de `app.use("/api", generalLimiter)` (línea 378) para heredar auth y rate limit. |
| `backend/tests/query-builder.test.cjs` **(nuevo)** | Rechazos: campo inexistente, operador no permitido, `columnas` con `"1; DROP TABLE"`, dirección de orden arbitraria, `in` con array vacío. |

**Router sí, aquí:** `server.cjs` tiene 1121 líneas y 21 rutas directas sobre `app`. El Router hereda `requireApiKey` (`:325`), `generalLimiter` (`:378`) y el body parser (`:331-334`) por prefijo, sin configuración. No obliga a tocar nada existente. **Migrar las 21 rutas actuales queda explícitamente fuera de alcance** — refactor grande, sin valor funcional, con riesgo de romper el orden de middleware.

**Por qué puede correr en paralelo con Fase 1** — 3 de las 5 consultas ya tienen datos:

| Consulta | Tablas | ¿Disponible en Fase 2? |
|---|---|---|
| `proyectos` | `Proyectos` + `ReportesSemanales` | Sí |
| `vencidas` | `Actividades_Detalle` | Sí |
| `ingenieros` | `Actividades_Detalle` | Sí (versión "estado actual") |
| `actividades` | `Actividad_Eventos` | Requiere Fase 1 |
| `notas` | `Proyecto_Notas` | Requiere Fase 3 |

El registro es un objeto literal: agregar una consulta es agregar una clave, sin tocar el builder.

**Verificar:** `curl` a `/api/reports/query` con `vencidas`; luego con `{"campo":"nombre; DROP TABLE Proyectos"}` → 400; sin API key → 401. Acumulatividad: agregar un filtro nunca sube el `total`.

---

### Fase 3 — Notas de proyecto y dimensiones (4 días)

| Archivo | Cambio |
|---|---|
| `migrations/014_add_project_notes.sql` **(nuevo)** | `Proyecto_Notas` según §3.2 **+ `AppNotaID NVARCHAR(60) UNIQUE`** — sin id estable del lado app, la nota no se puede editar ni borrar desde el frontend (mismo problema que `DetalleID`). |
| `migrations/015_add_project_dimensions.sql` **(nuevo)** | `Proyectos ADD Prioridad TINYINT DEFAULT 2, GrupoTrabajo NVARCHAR(100)` **y `Ingenieros ADD GrupoTrabajo`** — §3.4 dice "cada **ingeniero** pertenece a un grupo", y §4.1 lo lista como filtro de la consulta `ingenieros`. Van en ambas tablas. |
| `backend/reports/project-notes.cjs` **(nuevo)** | `listNotes`, `upsertNote`, `deleteNote`. |
| `backend/reports/index.cjs` | `GET /notes/:proyectoAppID`, `POST /notes`, `POST /notes/delete`. |
| `frontend/src/utils/storage.js` | Agregar `loadProjectNotes`, `saveProjectNote`, `deleteProjectNote`. **No exportar `apiFetch`** — mantiene storage.js como única frontera con el backend. |
| `frontend/src/components/ProjectNotesPanel.jsx` **(nuevo)** | Modelo visual de `NotesSection` (`ActivityFormSections.jsx:321-337`), extendido con `Tipo` e `IncluirEnReporte`. |
| `frontend/src/components/EditView.jsx` | Montar junto a `ProjectPulseField` (`:1379+`). |
| `Dashboard.jsx`, `EditView.jsx` | Selector prioridad 1-3 reemplaza el toggle ★. Mapeo inicial: `p.priority ? 1 : 2`. |

**`status_notes` NO se elimina.** §3.2 dice "reemplaza", pero está enganchado a `ReportesSemanales.StatusNotes`, `gemini-report.cjs` y el informe Word. Convivencia: `status_notes` sigue siendo el "pulso" de una línea; las notas fechadas son un canal nuevo al lado.

**Autor sin EntraID** (el sistema no tiene identidad de usuario hoy):
1. **Fases 3-8:** campo de texto libre "Registrado por", precargado desde `localStorage["wt-author"]`, guardado con sufijo `(manual)`. Vacío → `NULL`, nunca `"Anónimo"` (un string falso contamina el reporte). UI marca: *"Campo informativo — no verificado."* Defendible porque hay un solo usuario editor.
2. **Fase 9:** el backend toma el autor del token e **ignora lo que mande el cliente**. Se agrega `AutorUPN` (migración 018).
3. **`Actividad_Eventos` NO lleva columna de autor hasta la Fase 9** — un log de auditoría con autores no verificados es peor que sin autores.

---

### Fase 4 — Pestaña Reportes en pantalla (6 días)

| Archivo | Cambio |
|---|---|
| `ReportesView.jsx` **(nuevo, ~350 líneas)** | Vista autónoma. **Sigue el patrón de `QuartersView.jsx:2`**: importa de `storage.js` y consulta al backend por su cuenta, sin recibir estado por props. Recibe `projects` y `engineers` solo para etiquetas legibles. |
| `ReportesFilterPanel.jsx` **(nuevo)** | Panel de facetas construido a partir de `GET /api/reports/registry` — sin campos hardcodeados (§5.3). |
| `ReportesTable.jsx` **(nuevo)** | Tabla de vista previa. Ver decisión sobre TanStack abajo. |
| `ReportesTemplates.jsx` **(nuevo)** | Las 5 tarjetas de §8.3. |
| `storage.js` | `loadReportRegistry()`, `runReportQuery(body)`. |
| `App.jsx:516` | Agregar `"reportes"` al array de pestañas. |
| `App.jsx:522-527` | Agregar `: v === "reportes" ? "Reportes"` **antes del último ternario** — el último es el fallback sin condición para `"quarters"`. Si se agrega después, **se rompe la pestaña Trimestres**. |
| `App.jsx:540` | `{view !== "edit" && view !== "reportes" && (` — la barra de KPIs globales no aplica sobre una tabla filtrada y roba media pantalla. |
| `App.jsx:585-661` | Bloque `{view === "reportes" && <ReportesView .../>}`. |
| `App.css` | **Reutilizar** `report-filters`, `report-filters__search/select/count/clear` de `ReportView.jsx:656-696`. Solo los chips son estilo nuevo. |

**Corrección de bug transversal aprovechando esta fase** — 3 llamadas `fetch` crudas que **no envían `X-API-Key`**: `App.jsx:346-351`, `App.jsx:451-452`, `ReportView.jsx:250-254` (esta además duplica `API_BASE` en `:235`). Pasan a usar `storage.js`. Sin esto, endurecer la auth rompe tres funciones de la app.

**TanStack Table: implementación propia primero.** La tabla necesaria (ordenar, ocultar columnas, paginar) son ~200 líneas sobre `useState`/`useMemo`, cero dependencias. Punto de reevaluación fijado en Fase 13: si la edición en línea lo justifica, se migra — migrar una tabla de 200 líneas es barato; arrastrar una dependencia infrautilizada no.

**Verificar:** tarjeta "Actividades vencidas" → tabla con filas → agregar filtro → el contador baja y aparece chip removible → ✕ en la chip → vuelve al conteo anterior.

---

### Fase 5 — Exportación Excel + PDF (4 días)

| Archivo | Cambio |
|---|---|
| `backend/package.json` | `npm i exceljs pdfmake`. **date-fns NO** (ver decisiones). |
| `reports/export-excel.cjs` **(nuevo)** | `toXlsxBuffer({titulo, columnas, filas, filtrosAplicados})`. Hoja 1 = datos con encabezado congelado + autofiltro. Hoja 2 = "Parámetros": consulta, filtros, fecha, total — así un Excel que circula por correo dice de dónde salió. |
| `reports/export-pdf.cjs` **(nuevo)** | `toPdfBuffer(...)`. Fuentes VFS de Roboto que trae el paquete, **sin descargas externas** — crítico para App Service Linux. |
| `reports/index.cjs` | `POST /export`: mismo body + `formato`. Ejecuta **el mismo `buildQuery`**, cumpliendo §7 (Excel y PDF nunca pueden diferir de lo visto). |
| `storage.js` | `exportReport(body, formato)` con el patrón de `apiFetchBlob` (`:203`) y el disparo de descarga de `downloadAttachment` (`:210`) — **la mecánica binaria con API key ya existe**. |

**Topes:** PDF hasta 10 000 filas (error explicativo sugiriendo Excel), Excel hasta 50 000. Generar un PDF gigante consume memoria y decenas de segundos.

**Despliegue:** `pdfmake` +7 MB, `exceljs` +5 MB en `node_modules`. Verificar que `backend/deploy.sh` no tenga `--production` que salte deps.

---

### Fase 6 — Reportes guardados (2 días)

`migrations/016_add_saved_reports.sql` (`Reportes_Guardados` + `Autor` + `EsPlantillaSistema BIT` para que las 5 plantillas de §8.3 vivan en la tabla y no hardcodeadas), `reports/saved-reports.cjs`, rutas `GET/POST /saved`, 3 funciones en `storage.js`, botón "Guardar combinación" + lista lateral en `ReportesView`.

**Seguridad:** `Config` es JSON del usuario que vuelve al builder. Al recargar, pasa por **la misma validación** contra el registro. Un `Config` manipulado en BD no puede inyectar nada.

---

### Fase 7 — Riesgo 10.3: SQL como fuente de verdad (5 días)

La de mayor valor entre las de riesgo: es el único cuyo peor caso es **pérdida total del estado actual**, no de una edición.

- `db-operations.cjs` — `rebuildDataJsonFromSQL()` desde `Proyectos` + `RawDataJSON` (última semana) + `Actividades_Detalle` + hijas. Consolida la lógica que hoy duplica `POST /api/restore-from-db`.
- `server.cjs` — al arrancar: si `data.json` falta o está corrupto, reconstruir desde SQL antes de aceptar tráfico. Si existe, comparar `saved_at` contra el máximo de SQL y advertir.
- `server.cjs:412-441` — `POST /api/projects` deja de responder antes de escribir en SQL: `data.json` → **await** del sync con timeout 8s → `{ok:true, synced:true|false}`. **Cambia la latencia percibida** — medir antes y después; con `changedProjectId` (un solo proyecto) debería quedar en 200-500 ms.
- `App.jsx`/`storage.js` — indicador de estado de sincronización en el header.

**Verificar:** renombrar `data.json`, arrancar → la app carga completa. Guardar con la BD caída → avisa "pendiente de sincronizar" en vez de mentir con un ✓.

---

### Fase 8 — Riesgo 10.1: Concurrencia (5 días)

`migrations/017_add_project_version.sql` (`Proyectos ADD Version INT DEFAULT 1, ActualizadoEn`), `POST /api/projects` acepta `expectedVersion` → `409 Conflict` con el estado del servidor, `UPDATE ... WHERE Version=@expected` (si `rowsAffected===0` es conflicto), modal en `App.jsx` al recibir 409.

**Corrección a §10.1:** dice "escritura por entidad + control de versión optimista". La escritura por entidad es un rediseño del contrato que toca `App.jsx`, `EditView.jsx` y `storage.js`, con riesgo alto. **Solo se implementa el control de versión.** Con `changedProjectId` ya presente (`storage.js:79`), el backend valida la versión solo del proyecto que cambió: 95% del beneficio, 20% del riesgo.

---

### Fase 9 — Riesgo 10.2: EntraID (8 días)

`backend/auth/entra.cjs` (validación JWT contra JWKS del tenant con `jose`), `requireApiKey` pasa a *fallback* (permite despliegue gradual sin cortar nada), `migrations/018_add_author_identity.sql` (`AutorUPN` en las 3 tablas), `frontend/src/utils/msal.js` (`@azure/msal-browser`), login en `App.jsx`, quitar el campo libre "Registrado por".

**8 días por coordinación, no por código:** registrar la app en el tenant, obtener client ID / redirect URIs, coordinar con quien administre EntraID en la Oficina. Programación ≈ 3 días.

---

### Fase 10 — Riesgo 10.4: Blob Storage (4 días) *— flotante*

`@azure/storage-blob`, `backend/blob-storage.cjs`, `migrations/019` (`Actividad_Adjuntos ADD BlobUrl`, `Contenido` pasa a nullable pero **se conserva**), script de migración con `--dry-run`, ruta de descarga lee de `BlobUrl` o de `Contenido` (compatibilidad total). El `VARBINARY` se borra en una migración 020 semanas después, ya verificado. Container privado con el backend de proxy → **el frontend no cambia**.

**No depende de nada salvo Fase 0** — se mete en cualquier hueco, incluso en paralelo con 4 o 5.

---

### Fase 11 — Riesgo 10.5: Pruebas (4 días)

**Se extiende `node:test`, no se instala Vitest.** Ya hay suite funcionando (`plannerImport.test.js`, script en `frontend/package.json:11`); backend es CommonJS y frontend ESM (serían dos configuraciones de Vitest); y todo lo que se va a testear son **funciones puras** (`diffSnapshots`, `buildQuery`, `formulas.js`, `isoWeek`). Vitest gana cuando hay que renderizar componentes — ese día no es hoy, y la migración posterior es mecánica (API casi idéntica).

Tests: `activity-events.test.cjs` (diff: estado, progreso, fecha, asignación, nota, snapshot vacío, sin cambios → array vacío), `query-builder.test.cjs` (completado con acumulatividad), `export.test.cjs` (firma `PK`/`%PDF` y conteo), `formulas.test.js` (`projectProgress` con división por cero y tope 100, `globalProgress`, `businessDaysBetween` con festivos de Colombia `:177-193`), `isoWeek.test.js` (**paridad backend/frontend con 200 fechas** — blinda la duplicación consciente), y **`quarter-reset.test.cjs`** con fixtures: se archiva lo completado, se transfiere lo pendiente, conteo antes = archivadas + transferidas. **Es la prueba más urgente de §10.5** — el reset es la única operación irreversible del sistema.

`package.json` raíz con `"test": "npm --prefix backend test && npm --prefix frontend test"`.

---

### Fase 12 — Planner A: Tablero global + carga (6 días)

`GlobalBoardView.jsx` (Kanban cross-proyecto agrupable por ingeniero/proyecto/estado/vencimiento), `WorkloadMatrix.jsx` (ingeniero × semana ISO, `SUM(planned_hours)`, rojo si >40h, reutiliza `getAllAssignedActivitiesInProject` de `utils/engineers.js`), nueva consulta `carga_trabajo` en el registro.

**Entran como sub-vistas dentro de la pestaña Reportes** (selector "Tabla / Tablero / Carga"), **no como pestañas nuevas** — la barra ya tendría 7.

---

### Fase 13 — Planner B: Filtros en URL + edición en línea (5 días)

`hooks/useUrlState.js` (~40 líneas sobre History API — **sin react-router**: la app no tiene rutas, solo una pestaña activa en un `useState`), serialización de `consulta`/`filtros`/`columnas` a la URL, edición en línea de estado y responsable en la tabla.

**TanStack Query: no.** `storage.js` ya implementa escritura optimista con fallback a localStorage, y la Fase 8 resuelve el conflicto en el servidor. Introducirlo obligaría a reescribir el modelo de estado de `App.jsx` (16-17 props por componente, cero contexto): **el cambio de arquitectura más grande del plan con el menor retorno**. Si se quiere estado global, esa es una conversación aparte, no un contrabando dentro de una mejora de UI.

Aquí se reevalúa TanStack Table.

---

### Fase 14 — Planner C: Ctrl+K (2 días)

`CommandPalette.jsx` (~120 líneas, reutiliza `matchesSearch` de `EditView.jsx:57`) **sin `cmdk`** — se instala solo si la gestión de foco/ARIA resulta problemática. Índice desde el estado vivo, sin llamada al backend.

Última fase deliberadamente: máxima visibilidad, mínimo riesgo → el mejor lugar para absorber retrasos acumulados.

---

## Cierre de cada fase (obligatorio, en el mismo commit)

1. **`README.md`** — endpoints nuevos, `npm run migrate`, cómo correr tests, variables de entorno nuevas.
2. **`DOCUMENTACION_APP.md`** — esquema de cada tabla nueva con el porqué de cada columna, contrato de `/api/reports/*` con ejemplos, **cómo agregar una consulta al registro** (el procedimiento que más se va a necesitar), y limitaciones del backfill.
3. **`plan-modulo-reportes.md`** — marcar fase completada con fecha y anotar desviaciones.

---

## Decisiones técnicas y por qué

| # | Decisión | Razón |
|---|---|---|
| 1 | **Semana ISO: extraer a `utils.cjs`, no instalar date-fns** | `getWeekNumber` (`db-operations.cjs:39`) ya es ISO 8601 correcta. Instalar una dependencia para reemplazar 7 líneas probadas en producción no se justifica. Sí falta el **año ISO**, que se agrega. Frontend duplica 12 líneas (paquetes CJS/ESM distintos, sin bundler compartido) blindadas con test de paridad — las alternativas (monorepo, paquete interno) son desproporcionadas para 4 funciones de fecha. |
| 2 | **`express.Router()` sí, para reportes; no para el resto** | Hereda auth, rate limit y body parser por prefijo sin configuración. No obliga a tocar nada existente. Migrar las 21 rutas actuales: fuera de alcance. |
| 3 | **`node:test`, no Vitest** | Suite ya funcionando; backend CJS + frontend ESM = dos configs; todo lo testeable son funciones puras. Migración posterior es mecánica. |
| 4 | **Autor: campo libre ahora, EntraID en Fase 9** | Un solo usuario editor hoy. Vacío → `NULL`, nunca `"Anónimo"`. `Actividad_Eventos` **sin autor hasta Fase 9**: un log de auditoría con autores no verificados es peor que sin autores. |
| 5 | **TanStack Table: propia primero, reevaluar en Fase 13** | ~200 líneas cubren ordenar/ocultar/paginar. Migrar después es barato; arrastrar dependencia infrautilizada no. |
| 6 | **TanStack Query: no** | Ver Fase 13. Mayor cambio arquitectónico del plan, menor retorno. |
| 7 | **react-router y cmdk: no, hooks propios** | ~40 y ~120 líneas respectivamente, sin importar modelos que la app no usa. |
| 8 | **Tabla de control de migraciones: sí** | El plan lleva de 11 a ~19 migraciones con despliegue manual en App Service. Costo: una tabla + 40 líneas. La idempotencia `IF NOT EXISTS` se conserva como segunda red. |
| 9 | **"catálogo" → "registro" de consultas** | `project-catalog.json` ya existe y es otra cosa. |
| 10 | **Orden de riesgos: 10.3 → 10.1 → 10.2, con 10.4 flotante** | Por severidad del peor caso: pérdida de *todo* el estado > pérdida de *una* edición > trazabilidad. Todas antes de Ctrl+K. |

---

## Correcciones a supuestos del documento original

| # | Dice `plan-modulo-reportes.md` | Hay en el código | Corrección |
|---|---|---|---|
| 1 | §3.1: *"comparar el valor nuevo contra el guardado antes de sobreescribir"* | `syncActividadesDetalle` (`db-operations.cjs:556`) hace **DELETE + INSERT bulk** (`:658-668`). **Nunca lee el estado previo.** | SELECT explícito con `try/catch` propio y degradación a `null`. +15-40 ms en camino fire-and-forget. **Fase 1** |
| 2 | §3.1: referencia por identidad de actividad | `Actividades_Detalle.DetalleID` es `IDENTITY` y **se regenera en cada guardado** | `AppActividadID` (`act_xxx`) como única referencia. Sin FK real. **Fase 1** |
| 3 | §7: instalar `date-fns` para ISO | `getWeekNumber:39` **ya es ISO correcta**; `formulas.js:12` **no lo es** | No instalar. Extraer y corregir el frontend. **Fase 0** |
| 4 | §3.1 backfill: *"`history.json` y `status_history`"* | Existe **`ReportesSemanales.RawDataJSON`**: proyecto completo por semana, ya acumulado | Backfill de 3 pasadas priorizando `RawDataJSON`. **Fase 1B** |
| 5 | Implícito: el backfill recupera el histórico fielmente | `RawDataJSON` hace UPDATE por semana; `status_history` tiene 3 hitos sin autor y se pisa en reaperturas | Granularidad **semanal, no por cambio**. Aviso en la UI. **Fase 1B** |
| 6 | §3.2: `Proyecto_Notas` *"reemplaza `status_notes`"* | `status_notes` engancha con `ReportesSemanales.StatusNotes`, `gemini-report.cjs` y el informe Word | **Convivencia, no reemplazo.** **Fase 3** |
| 7 | §3.2: tabla sin id estable del lado app | El resto del modelo usa `act_xxx`, `note_xxx` para editar/borrar | Agregar `AppNotaID UNIQUE`. **Fase 3** |
| 8 | §3.4: `GrupoTrabajo` solo en `Proyectos` | El propio texto dice "cada **ingeniero** pertenece a un grupo" | Columna en **ambas** tablas. **Fase 3** |
| 9 | §4.1: `backend/reports/catalog.cjs` | Ya existe `project-catalog.json`, sin relación | `query-registry.cjs` + `/registry` con `/catalog` como alias. **Fase 2** |
| 10 | §4.2: liga parámetros sin declarar tipo SQL | El repo siempre declara tipo: `.input(n, sql.NVarChar(60), v)` | Cada campo declara `sqlType`. **Fase 2** |
| 11 | §5: endpoints nuevos sin mención de auth | `requireApiKey:325` y `generalLimiter:378` aplican por prefijo | Router montado **después** de `:378` hereda ambos. **Fase 2** |
| 12 | §6: TanStack Table de entrada | Frontend con 3 deps; `xlsx` se carga dinámicamente por peso | Tabla propia; reevaluación en Fase 13. **Fase 4** |
| 13 | §8.1: chips como patrón nuevo | `ReportView.jsx:532-572` ya tiene 6 filtros acumulativos, `clearFilters()`, contador y clases CSS | Reutilizar lógica y CSS. Nuevo: solo el chip visual y la multi-selección. **Fase 4** |
| 14 | §8: "nueva séptima pestaña", sin detalle | `App.jsx:522-527` termina en un **ternario fallback sin condición**; `:540` renderiza KPIs en toda vista salvo `edit` | Insertar **antes** del fallback (si no, se rompe Trimestres) y extender `:540`. **Fase 4** |
| 15 | §10.1: *"escritura por entidad + versión optimista"* | El contrato envía el array completo, pero ya trae `changedProjectId` (`storage.js:79`) | Solo versión optimista: 95% del beneficio, 20% del riesgo. **Fase 8** |
| 16 | §10.5: *"pruebas con Vitest"* | Ya hay suite con `node:test`; backend CJS, frontend ESM | Extender `node:test`. **Fase 11** |
| 17 | §11: sección 10 entera en un "Sprint 6+" | Contiene riesgos de severidad muy distinta | Desagregada en 5 fases ordenadas por peor caso. |
| 18 | No mencionado | **3 `fetch` crudos sin `X-API-Key`**: `App.jsx:346-351`, `App.jsx:451-452`, `ReportView.jsx:250-254` | Corregir en Fase 4. Sin esto, endurecer la auth rompe 3 funciones. |
| 19 | No mencionado | `UltimaActualizacion` se escribe con `GETDATE()` literal (`db-operations.cjs:608`) → **toda fila parece actualizada ahora** | Inservible como dimensión temporal. No se usa en ninguna consulta del registro. |
| 20 | No mencionado | `GET /api/history` (`server.cjs:658`) y `/:date` (`:673`) **que ninguna vista consume** | Insumo de la pasada 3 del backfill. No se borran. **Fase 1B** |

---

## Archivos críticos

- [backend/db-operations.cjs](backend/db-operations.cjs) — `syncActividadesDetalle:556` (SELECT previo + diff), `getWeekNumber:39` (se extrae), `getPool:23` (se reutiliza), `saveProject:316-409` (fuente del backfill)
- [backend/server.cjs](backend/server.cjs) — `requireApiKey:325` y `generalLimiter:378` (montar Router después), `POST /api/projects:412-441` (Fases 7 y 8)
- [backend/utils.cjs](backend/utils.cjs) — destino de `isoWeek`, contacto compartido entre Fases 0, 1 y 2
- [frontend/src/App.jsx](frontend/src/App.jsx) — pestañas `:516`, ternarios `:522-527`, KPIs `:540`, vistas `:585-661`
- [frontend/src/utils/storage.js](frontend/src/utils/storage.js) — `apiFetch:26`, `apiFetchBlob:203`
- [frontend/src/components/ReportView.jsx](frontend/src/components/ReportView.jsx) — `:532-572` y `:654-697` (filtros y CSS a reutilizar)
- [backend/run-migration.cjs](backend/run-migration.cjs) — se extiende con control y transacción

---

## Verificación end-to-end

Al cerrar las Fases 0-6 (el módulo de reportería completo):

```bash
cd backend && npm run migrate && npm test      # migraciones aplicadas, suite verde
cd backend && npm run server                   # :3001
cd frontend && npm run dev                     # :5173
```

1. **Event log:** cambiar una actividad de estado, guardar → `SELECT TOP 5 * FROM Actividad_Eventos ORDER BY EventoID DESC` muestra la transición.
2. **Backfill:** `SELECT Origen, SemanaISO, COUNT(*) FROM Actividad_Eventos GROUP BY Origen, SemanaISO` muestra semanas anteriores a hoy.
3. **Motor:** `curl` con filtro inválido → 400; sin API key → 401; agregar filtro nunca sube el `total`.
4. **Pantalla:** pestaña Reportes → plantilla "Actividades vencidas" → agregar filtro → contador baja, chip aparece → ✕ → vuelve.
5. **Exportación:** exportar Excel con N filas en pantalla → hoja 1 tiene N filas, hoja 2 lista los filtros. PDF → conteo del pie coincide.
6. **Guardados:** 3 filtros → guardar plantilla → recargar página → clic → los 3 chips reaparecen con el mismo conteo.
7. **Degradación:** con la BD caída, guardar un proyecto → la app responde y avisa, no rompe.
