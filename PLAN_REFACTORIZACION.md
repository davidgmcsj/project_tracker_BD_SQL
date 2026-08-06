# Plan de Refactorización — Project Tracker

> Documento de trabajo. Fecha de auditoría: 6 de agosto de 2026.
> Basado en medición directa del código, no en estimaciones.

---

## 0. Resumen ejecutivo

El proyecto tiene **~26.400 líneas** repartidas así:

| Capa | Líneas | Estado |
|---|---:|---|
| Frontend (JS/JSX, sin tests) | 13.226 | 3 archivos concentran el 27 % |
| CSS (`App.css`, archivo único) | 6.082 | ~993 líneas muertas medidas |
| Backend (`.cjs`, sin tests) | 4.545 | 2 archivos concentran el 49 % |
| Migraciones SQL (19 archivos) | 857 | Sanas, no requieren cambio |
| Tests (frontend + backend) | 1.669 | **Cobertura solo de módulos puros** |

### La respuesta directa a "¿13 mil líneas es demasiado?"

**Parcialmente sí, pero no tanto como parece.** La medición real:

| Causa | Líneas recuperables | Confianza |
|---|---:|---|
| CSS muerto (clases sin ningún uso en JSX) | ~993 | **Alta** — medido cruzando 943 selectores contra 870 clases usadas |
| Duplicación backend (try/catch, guardias, INSERTs) | ~330 | **Alta** — 20+14+8 ocurrencias contadas |
| Cadena de fallback de IA triplicada | ~130 | Alta |
| Vocabulario de estados repetido en 10 archivos | ~60 | Alta |
| Config de conexión SQL duplicada | ~20 | Alta |
| **Total realista** | **~1.530** | |

**Esto es ~6 % del total, no el 50 % que sugiere la intuición.** Las otras ~24.900 líneas son funcionalidad legítima: 40 componentes React, 24 rutas HTTP, 19 migraciones, exportación a PDF/Excel, integración con 3 proveedores de IA, importación de Planner, Gantt, control de acceso por roles.

**La conclusión honesta: el problema no es el número total de líneas, es su distribución.** Un archivo de 2.244 líneas es difícil de mantener aunque cada línea esté justificada. El objetivo de esta refactorización debe ser **reducir el tamaño del archivo más grande de 2.244 a ~250**, no reducir el total de 13.000 a 8.000 — ese segundo objetivo solo se lograría borrando funcionalidad.

### El riesgo que condiciona todo el plan

**Los archivos que hay que refactorizar son exactamente los que no tienen tests.**

- `server.cjs` (1.303 líneas) y `db-operations.cjs` (911) → **0 % de cobertura**
- Componentes React (9.561 líneas, 40 archivos) → **0 tests** (`*.test.jsx` = 0 archivos)
- Los 1.669 líneas de test cubren solo utilidades puras ya extraídas

Refactorizar sin red de seguridad es cómo se rompe un sistema en producción. **La Fase 0 no es opcional.**

---

## 1. Backend — estado actual

### 1.1 Distribución

| Archivo | Líneas | Contenido |
|---|---:|---|
| `server.cjs` | **1.303** | Config + middlewares + migraciones legadas + 24 rutas + arranque |
| `db-operations.cjs` | **911** | Pool `mssql` + 14 funciones exportadas + 10 internas |
| `gemini-report.cjs` | 677 | Prompts de IA + cadena de fallback triple |
| `reports/` (8 archivos) | 793 | Ya bien estructurado |
| `activity-events.cjs` | 161 | Event-log con diff y deduplicación |
| `run-migration.cjs` | 123 | Runner de migraciones con checksum |
| `utils.cjs` | 100 | Funciones puras compartidas |
| `auth.cjs` | 94 | scrypt + sesiones |
| `quarter-reset.cjs` | 76 | Lógica pura de cierre trimestral |
| `scripts/` (2 archivos) | 307 | Backfill + creación de admin |

### 1.2 Anatomía de `server.cjs`

**500 líneas (38 %) no son rutas** — son configuración, middlewares y migraciones legadas mezcladas con los handlers:

| Líneas | Bloque |
|---|---|
| 26–75 | 4 IIFE try/catch idénticos que cargan módulos con fallback a nulls |
| 79–109 | `getDataDir()`, constantes de ruta, `readJson`/`writeJson`, `errorBody` |
| 118–240 | Dos migraciones de datos legados (string→array, comments→notes) |
| 249–327 | `recoverDataFileFromSQL`, `warnIfDataFileStale`, `init()` |
| 331–503 | App Express, helmet, CORS, `API_KEY`, 4 rate limiters, sesión, `requireAdmin` |
| 779–790 | `sanitizeFilename` **perdido en medio de las rutas** |
| 860–866 | `getMondayOf` **perdido en medio de las rutas** |

Las 24 rutas por dominio: auth (4), diagnóstico (1), proyectos (2), ingenieros/contactos (4), usuarios (3), adjuntos (3), historial (3), IA (3), trimestre/mantenimiento (5). Más 9 rutas en `reports/index.cjs`.

### 1.3 Duplicación medida (backend)

| # | Patrón | Ocurrencias | Ejemplos | Ahorro |
|---|---|---:|---|---:|
| **P1** | `try/catch` + `console.error` + `res.status(500).json(errorBody(...))` | **20** | `server.cjs:666`, `686`, `709`, `724`, `740`, `810`… | 60–80 |
| **P2** | `if (!fn) return res.status(503).json({error:"Módulo de BD no disponible"})` | **14** | `server.cjs:659`, `679`, `700`, `717`, `737`… (texto idéntico) | ~28 |
| **P3** | IIFE de carga defensiva de módulos | 4 | `server.cjs:35-48`, `50-57`, `59-66`, `68-75` | ~20 |
| **P4** | Validación por regex sobre `e.message` | 2 | `server.cjs:755`, `768` (idénticos) | — |
| **P5** | INSERT multi-row construido a mano | **8** | `db-operations.cjs:496-526`, `531-539`, `545-552`, `561-569`, `700-718`… | ~120 |
| **P6** | `const pool = await getPool()` | **32** | Casi todas las exportadas | — |
| **P7** | `require()` dentro de handlers | 7 | `server.cjs:513`, `655`, `1056`, `1067`, `1216`… | — |
| **P8** | `humanize`/`formatCell` duplicados | 2 | `reports/export-excel.cjs:11,15` vs `export-pdf.cjs:30,34` | ~25 |
| **P9** | Cadena de fallback Gemini→OpenRouter→Groq | **3** | `gemini-report.cjs:445-489`, `527-556`, `640-676` | ~130 |

**SQL casi-duplicado:**

- `syncEngineerToSQL` (99–121) vs `syncExternalContactToSQL` (194–216) — **~90 % isomorfas**, 23 líneas cada una
- INSERT vs UPDATE de `ReportesSemanales` (411–435 vs 445–472) — **los mismos 17 `.input()` escritos dos veces**, ~55 líneas
- `resolveProject` (326–353) vs `syncProjectMeta` (627–645) — dos implementaciones del mismo invariante
- Config `mssql` copiada literal: `db-operations.cjs:11-21` vs `run-migration.cjs:11-20`

**Bug latente detectado (P3):** el primer IIFE (`server.cjs:35`) enumera 13 nulls a mano y **ya divergió** — `syncExternalContactToSQL` no está en la lista, y por eso el handler de la línea 655 lo re-requiere inline en cada request.

---

## 2. Frontend — estado actual

### 2.1 Distribución

| Grupo | Líneas | Archivos |
|---|---:|---:|
| Componentes `.jsx` | 9.561 | 40 |
| Utils `.js` | 2.711 | 10 |
| `App.jsx` | 889 | 1 |
| Hooks | 55 | 2 |
| **CSS** (`App.css`) | **6.082** | 1 |

**Los 5 mayores:** `EditView.jsx` (2.244), `ReportView.jsx` (722), `ActivityDetailModal.jsx` (657), `GanttChart.jsx` (632), `ActivityFormSections.jsx` (461).

### 2.2 Anatomía de `EditView.jsx` — prioridad #1

**Un solo archivo con 16 componentes distintos:**

| Línea | Componente | Líneas aprox. | Responsabilidad |
|---|---|---:|---|
| 43–64 | `safeArr`, `safeActs`, `buildAssignables` | 22 | Helpers puros |
| 67 | `AssigneeDropdown` | 75 | Popover de asignación con creación de externos |
| 142 | `useDragSort` | 15 | Hook de reordenamiento |
| 159 | `DeleteConfirmModal` | 36 | Modal de confirmación |
| **197** | **`ActivitiesList`** | **324** | Lista numerada de actividades — el bloque mayor |
| 523 | `ImpedimentRow` | 38 | Fila de impedimento |
| 563 | `IndicatorRow` | 59 | Fila de indicador |
| 626 | `EngineerRow` | 110 | Fila de ingeniero |
| 736 | `WeekActivitiesTable` | 35 | Tabla semanal |
| 780 | `NextWeekPlanningSection` | 64 | Cierre semanal automático |
| 859 | `StatusDateBadge` | 26 | Badge de fecha |
| **885** | **`TaskStatusSelector`** | **253** | Selector de estado (exportado) |
| **1141** | **`BulkAssignPanel`** | **186** | Asignación masiva |
| 1340 | `ProjectPulseField` | 89 | Panel "Pulso del proyecto" |
| **1431** | **`EditView`** (default) | **813** | Orquestador principal |

### 2.3 Duplicación medida (frontend)

**El hallazgo más grave: el vocabulario de estados está redefinido en 10 archivos.**

```
ActivityDetailModal.jsx:9-10      { value: "not_started", label: "No iniciada" }
ActivityFormSections.jsx:16       { key: "in_progress", label: "En proceso", icon: "🔄" }
ActivityFormSections.jsx:234      SUBTASK_STATUS_LABEL = { not_started: "No iniciada", ... }
EditView.jsx:596                  { lbl: "En proceso", field: "in_progress" }
EditView.jsx:848-849              { key: "in_progress", label: "En proceso", variant: "amber" }
EditView.jsx:1285                 ternario inline con los 3 labels
engineer/StatusBadge.jsx:6-7      { in_progress: { label: "En proceso", cls: "eng-badge--wip" } }
EngineerTaskModal.jsx:11-12       { value: "not_started", label: "No iniciada" }
GanttChart.jsx:36-37              { value: "not_started", label: "No iniciadas" }   ← plural, inconsistente
GlobalBoardView.jsx:24-25         { key: "not_started", label: "No iniciada" }
GlobalBoardView.jsx:74            STATUS_LABEL_TO_KEY  ← mapa INVERSO
HierarchyTable.jsx:28-29          "No iniciada": "not_started"  ← segundo mapa INVERSO
```

Los dos mapas inversos (`GlobalBoardView.jsx:74`, `HierarchyTable.jsx:28`) son **riesgo real de bug**: convierten label→key por texto literal. Si alguien cambia "No iniciada" por "Sin iniciar" en un sitio, esos mapas fallan en silencio y devuelven `not_started` por defecto. Nota además la inconsistencia ya existente: `GanttChart.jsx` usa "No iniciadas" (plural) mientras el resto usa singular.

**Configuración de API dispersa en 5 archivos:**

```
App.jsx:498, App.jsx:603, ReportView.jsx:235,
utils/generateQuarterlyReport.js:15, utils/storage.js:20
→ const API_BASE = import.meta.env.VITE_API_URL || "";
```

Hay `fetch(` en 4 archivos (13 llamadas) aunque existe `utils/storage.js` como capa de acceso — `App.jsx` y `ReportView.jsx` la evitan y llaman directo.

**Otros:** `toISOString().slice(0,10)` aparece **29 veces** sin helper compartido.

### 2.4 CSS — 993 líneas muertas medidas

Método: extraje los 943 selectores de clase únicos de `App.css`, los crucé contra las 870 clases realmente usadas en JSX (incluyendo template literals y expresiones condicionales).

- **175 clases sin ningún uso** → **~993 líneas** (16 % de `App.css`)
- Verificado manualmente: `act-assign-chip`, `act-entry-select` y sus ~25 modificadores no aparecen en ningún `.jsx` — son restos de una versión anterior del panel de asignación

Esta es la **eliminación más segura y rentable de todo el plan**: ~1.000 líneas, riesgo casi nulo, sin tocar lógica.

### 2.5 `App.jsx` y prop drilling

889 líneas, 31 hooks (`useState`/`useMemo`/`useEffect`/`useCallback`), 7 handlers. Las props `engineers`/`projects` llegan a 8 componentes distintos.

**Recomendación honesta: NO introducir Redux/Zustand ni router ahora.** Argumentos concretos:

- El prop drilling actual es de **2 niveles como máximo** (`App` → `EngineerHub` → `EngineersView`), no de 5. No es el caso patológico que justifica Context.
- Introducir un router obligaría a reescribir `useUrlState` (43 líneas que ya funcionan) y toda la navegación por estado.
- El coste sería alto y el beneficio, marginal.

**Sí vale la pena** un `AuthContext` mínimo para `currentUser` (lo consumen `App`, `EngineerHub`, `UsersAdminView` y el header), porque ahí sí hay un valor global genuino. Eso es ~30 líneas, no una migración de arquitectura.

---

## 3. Fase 0 — Red de seguridad (BLOQUEANTE)

**Ninguna fase posterior debe empezar antes de completar esta.**

| Tarea | Detalle | Esfuerzo |
|---|---|---|
| **0.1** Separar `app` de `listen` | Extraer `app.cjs` que exporte la app configurada sin llamar a `listen()`. Prerequisito técnico para poder testear rutas. | 1 h |
| **0.2** Tests de contrato HTTP | `node:test` + `fetch` contra la app levantada. Para las 24 rutas: status code y forma de respuesta. No hace falta BD real en todas. | 1–2 días |
| **0.3** Tests de los utils sin cobertura | `utils/storage.js` (480 líneas), `utils/scheduling.js` (187), `utils/generateQuarterlyReport.js` (250) — hoy **sin ningún test**. | 1 día |
| **0.4** Snapshot de datos reales | Copia de `data.json` + `history.json` antes de tocar nada. Son 42.000 líneas de datos de producción. | 10 min |

**Criterio de salida:** `npm test` verde en backend y frontend, cubriendo las 24 rutas y los 3 utils críticos.

---

## 4. Fase 1 — Eliminación de código muerto (bajo riesgo, alto retorno)

Ordenada por relación beneficio/riesgo. **Todo esto es borrar, no reestructurar.**

| # | Tarea | Líneas | Riesgo |
|---|---|---:|---|
| **1.1** | Eliminar las 175 clases CSS sin uso de `App.css` | **−993** | Muy bajo |
| **1.2** | Unificar vocabulario de estados en `utils/estados.js` (fuente única) y eliminar los 2 mapas inversos | **−60** | Bajo |
| **1.3** | Centralizar `API_BASE` en `utils/api.js`; `App.jsx` y `ReportView.jsx` pasan a usar `storage.js` | **−15** | Bajo |
| **1.4** | Helper `toISODate()` para las 29 repeticiones de `toISOString().slice(0,10)` | **−20** | Muy bajo |
| **1.5** | Extraer `reports/format-cell.cjs` (dedupe P8) | **−25** | Muy bajo |
| **1.6** | `db/pool.cjs` compartido entre `db-operations.cjs` y `run-migration.cjs` | **−20** | Bajo |

**Subtotal Fase 1: ~1.130 líneas eliminadas.** Es el 74 % de todo lo recuperable, con el riesgo más bajo del plan.

> **Verificación de 1.1:** aunque la medición cruzó template literals y condicionales, antes de borrar cada bloque confirmar con `grep -rn "<nombre-clase>" --include="*.jsx"`. Una clase construida dinámicamente (`` `eng-badge--${variante}` ``) puede escapar al análisis estático.

---

## 5. Fase 2 — Backend: `server.cjs` 1.303 → ~45 líneas

### Estructura destino

```
backend/
├── server.cjs                  ~45   Solo: init() → http.listen
├── app.cjs                     ~55   Crea la app, monta middlewares y routers
├── config/
│   ├── env.cjs                 ~45   PORT, DATA_DIR, API_KEY, FRONTEND_URL + exit(1) de prod
│   └── modules.cjs             ~40   Carga defensiva ÚNICA (elimina P3 y su bug latente)
├── middleware/
│   ├── api-key.cjs             ~30   requireApiKey + timingSafeEqual
│   ├── session.cjs             ~35   Resolución de req.user + requireAdmin
│   ├── rate-limits.cjs         ~60   Los 4 limiters
│   ├── security-log.cjs        ~15   logSecurityEvent
│   └── error-handler.cjs       ~40   errorBody + asyncHandler  ← elimina P1 y P2
├── lib/
│   ├── json-store.cjs          ~35   readJson, writeJson, getDataDir
│   ├── legacy-migrations.cjs   ~130  Aislado para poder BORRARLO en el futuro
│   └── bootstrap.cjs           ~85   init(), recoverDataFileFromSQL
├── services/
│   ├── clean-stats.cjs         ~55   Función pura extraída del handler (+ test)
│   └── quarter-archive.cjs     ~60   Escritura de archive/*.json + INSERT
└── routes/
    ├── diagnostics.routes.cjs  ~25
    ├── ai.routes.cjs           ~55
    ├── users.routes.cjs        ~50
    ├── attachments.routes.cjs  ~80
    ├── engineers.routes.cjs    ~85
    ├── history.routes.cjs      ~80
    ├── quarters.routes.cjs     ~120
    ├── maintenance.routes.cjs  ~50
    ├── projects.routes.cjs     ~85
    └── auth.routes.cjs         ~70
```

### Orden de extracción (cada paso deja el sistema arrancable)

**2.1 — Sin dependencias entrantes:** `json-store` → `security-log` → `error-handler` (+ `asyncHandler`) → `services/clean-stats` (extraer como función pura y **añadirle test**: hoy es lógica destructiva sin cobertura).

**2.2 — Configuración:** `config/env.cjs` + `config/modules.cjs`. **Aquí se corrige el bug de P3**: incluir `syncExternalContactToSQL` en la carga central y borrar el `require` inline de la línea 655.

**2.3 — Middlewares:** `api-key` → `session` → `rate-limits`.

**2.4 — Separar app de servidor** (ya hecho en Fase 0.1).

**2.5 — Routers, uno por commit, en este orden exacto:**

```
diagnostics → ai → users → attachments → engineers
→ history → quarters → maintenance → projects → auth
```

`diagnostics` y `ai` no tocan estado. **`auth` va última** porque de ella depende `req.user`, que consume `reports/index.cjs:145` — moverla temprano haría que un fallo se manifestara en un módulo distinto.

**Verificación tras cada paso:** `npm test` + `node server.cjs` + smoke de `GET /api/db-ping`, `GET /api/projects`, `POST /api/auth/login`.

---

## 6. Fase 3 — Backend: `db-operations.cjs` 911 → fachada + 9 repos

```
backend/db/
├── pool.cjs                  ~45   (ya hecho en 1.6)
├── sql-helpers.cjs           ~70   bulkInsert() → colapsa los 8 INSERT manuales
│                                   upsertByOptionalId() → colapsa engineer/contact
├── users.repo.cjs            ~75
├── engineers.repo.cjs        ~70
├── engineer-tasks.repo.cjs   ~110
├── projects.repo.cjs         ~75   Unificar resolveProject + syncProjectMeta
├── weekly-report.repo.cjs    ~200  saveProject: 218 → ~130 con bulkInsert
├── activity-detail.repo.cjs  ~120  syncActividadesDetalle: 169 → ~90
├── attachments.repo.cjs      ~50
└── recovery.repo.cjs         ~45
```

**Clave para no romper nada:** mantener `db-operations.cjs` como **fachada de ~25 líneas** que re-exporta todo. Así `server.cjs`, `reports/index.cjs` y `scripts/backfill-events.cjs` no cambian ni un import mientras dura la migración.

**Introducir `bulkInsert` con cuidado:** aplicarlo primero a **un solo bloque** — los indicadores (`db-operations.cjs:531-539`, el más simple: 3 columnas, sin condicionales) — verificar contra la BD real, y solo entonces propagar a los 7 restantes.

Orden de extracción: `users` → `attachments` → `recovery` → `engineers` → `engineer-tasks` → `projects` → `activity-detail` → `weekly-report`.

---

## 7. Fase 4 — Frontend: `EditView.jsx` 2.244 → ~250

```
components/edit/
├── EditView.jsx                  ~250  Orquestador: estado del proyecto + layout
├── ActivitiesList.jsx            ~330  Lista numerada (el bloque mayor)
├── TaskStatusSelector.jsx        ~255  Ya exportado — solo mover
├── BulkAssignPanel.jsx           ~190
├── EngineerRow.jsx               ~115
├── ProjectPulseField.jsx         ~90
├── AssigneeDropdown.jsx          ~80
├── NextWeekPlanningSection.jsx   ~70
├── IndicatorRow.jsx              ~60
├── ImpedimentRow.jsx             ~40
├── DeleteConfirmModal.jsx        ~40
├── WeekActivitiesTable.jsx       ~35
├── StatusDateBadge.jsx           ~30
└── hooks/useDragSort.js          ~20
```

**Orden seguro (de hoja a raíz — mover primero lo que nada importa):**

1. `useDragSort`, `StatusDateBadge`, `DeleteConfirmModal` — sin dependencias
2. `ImpedimentRow`, `IndicatorRow`, `WeekActivitiesTable` — filas aisladas
3. `AssigneeDropdown`, `EngineerRow` — dependen de `buildAssignables`
4. `ProjectPulseField`, `NextWeekPlanningSection`
5. `BulkAssignPanel`, `TaskStatusSelector` (ojo: es **exportado**, `App.jsx:3` lo importa — mantener el re-export desde `EditView.jsx` o actualizar el import)
6. `ActivitiesList` — el último y el mayor

**Verificación:** `npm run build` tras cada paso. Sin tests de componentes, el build y la revisión visual son la única red — por eso Fase 0.2 importa.

### Los otros 4 grandes (fase posterior, menor urgencia)

| Archivo | Actual | Propuesta |
|---|---:|---|
| `ReportView.jsx` | 722 | Extraer secciones de informe a `report/` (~4 archivos) |
| `ActivityDetailModal.jsx` | 657 | Separar pestañas del modal (~3 archivos) |
| `GanttChart.jsx` | 632 | Extraer cálculo de escala temporal a `utils/ganttScale.js` (+ test) |
| `ActivityFormSections.jsx` | 461 | Ya es "secciones" — dividir por sección real |

---

## 8. Fase 5 — Backend: `gemini-report.cjs` 677 → ~545

```
backend/ai/
├── providers.cjs        ~130  callWithFallback() unificado  ← elimina P9 (−130)
├── project-summary.cjs  ~110
├── prompts/report.cjs   ~145
├── prompts/status.cjs   ~35
├── prompts/global.cjs   ~80
└── index.cjs            ~45   Las 3 exportadas = prompt + callWithFallback
```

Independiente del resto — se puede hacer en paralelo a las Fases 2–4 sin conflicto.

---

## 9. Riesgos críticos

### 🔴 CRÍTICO — Orden de middlewares en `server.cjs`

La secuencia 406 → 412 → 468 → 479 → 496 es semánticamente frágil:

- `requireApiKey` (406) va **antes** del body parser (412). Si se invierte, el parser gasta ciclos en peticiones no autorizadas y el límite de 14 MB queda expuesto sin auth.
- El middleware de sesión (479) puebla `req.user`, que `requireAdmin` (496) lee. Invertirlos convierte a **todo admin en 401 permanente**.
- **El más sutil:** el middleware de la línea 412 excluye `/api/attachments/upload` comparando `req.path` exacto. Al mover esa ruta a un router montado bajo prefijo, **`req.path` deja de incluir el prefijo y la exclusión falla en silencio** — los uploads pasarían por el parser de 2 MB y morirían con 413. Hay que reescribirlo con `req.originalUrl` o montar el parser en la propia ruta.

### 🔴 CRÍTICO — Cero tests sobre lo que se refactoriza

Ya cubierto en Fase 0. Se repite aquí porque es la razón #1 por la que este tipo de refactorización falla.

### 🟠 ALTO — Escrituras fire-and-forget

`server.cjs:628-645` (`POST /api/projects`) y `server.cjs:891-904` (`POST /api/report`) responden al cliente **antes** de escribir a SQL, con reintento a 5 s vía `setTimeout`. Esas promesas no tienen owner: si el proceso muere en esa ventana, el dato se pierde en silencio.

Al mover estos handlers, **preservar la posición exacta del `res.json()`** respecto al bloque de sync. Adelantarlo o retrasarlo cambia la semántica de durabilidad.

### 🟠 ALTO — `saveProject` no es transaccional

`db-operations.cjs:410-443` ejecuta un UPDATE y **5 DELETE** en `Promise.all`, y después (597) los INSERT de detalle. **No hay `BEGIN TRANSACTION`.** Si falla entre el DELETE y el INSERT, el reporte queda con cabecera pero sin detalle.

La refactorización no debe introducir un `await` extra entre esos pasos sin envolverlos en transacción. Envolverlos es recomendable, pero **es un cambio de comportamiento que necesita su propio commit y prueba** — no colarlo dentro de un commit de refactorización.

### 🟠 ALTO — Autenticación en dos capas ortogonales

`API_KEY` (compartida, obligatoria en todo `/api`) y sesión por cookie (solo puebla `req.user`) son independientes. Tres modos de fallo al mover:

1. Perder `timingSafeEqual` → introduce timing attack
2. Perder `credentials: true` del CORS (354–357) → rompe la cookie cross-origin
3. Perder `secure: isProduction` en `res.cookie` (523–525) → expone la sesión en HTTP

### 🟠 ALTO — Los dos `process.exit(1)` de arranque

`server.cjs:352` (`FRONTEND_URL`) y `388` (`API_KEY`) hacen fallar el arranque en producción a propósito. Al mover a `config/env.cjs`, ese módulo debe evaluarse **antes** de crear la app. Si queda en una función lazy, **el servidor arrancaría sin auth en producción**.

### 🟡 MEDIO — `getDataDir()` vs `archive/`

`server.cjs:82` devuelve `/home/data` en Azure, pero las líneas 1052, 1217 y 1272 usan `path.join(__dirname, "archive")` — **directorio distinto y no persistente en Azure App Service**.

Es una inconsistencia **preexistente**. No la introduzcas ni la "arregles" durante la refactorización sin decidirlo explícitamente: al mover el código a `routes/quarters.routes.cjs`, `__dirname` cambia de valor y rompería la ruta.

### 🟡 MEDIO — `resolveEngineer` inserta filas

`db-operations.cjs:71-92` hace fuzzy-match por ≥2 tokens del nombre y, si no encuentra, **crea un ingeniero nuevo en SQL**. Cualquier cambio en la normalización del nombre genera duplicados en `Ingenieros`.

### 🟡 MEDIO — Validación por regex sobre mensajes de error

`server.cjs:755` y `768` acoplan la capa HTTP a los strings literales de `db-operations.cjs:145,146,169,181`. Reescribir esos mensajes convierte un 400 en un 500.

### 🟡 MEDIO — Path traversal en `GET /api/quarters/:id`

`server.cjs:1276-1285` tiene doble defensa (regex `^[\w.\-]+$` + verificación de prefijo tras `path.join`). **Ambas deben sobrevivir intactas** al mover el handler.

---

## 10. Cronograma y resultado esperado

| Fase | Contenido | Riesgo | Esfuerzo |
|---|---|---|---|
| **0** | Red de seguridad (tests) | — | 2–3 días |
| **1** | Código muerto (−1.130 líneas) | Muy bajo | 1 día |
| **2** | `server.cjs` → 24 archivos | Alto | 3–4 días |
| **3** | `db-operations.cjs` → 9 repos | Alto | 2–3 días |
| **4** | `EditView.jsx` → 14 archivos | Medio | 2–3 días |
| **5** | `gemini-report.cjs` → 6 archivos | Bajo | 1 día |
| **6** | Los otros 4 componentes grandes | Medio | 2–3 días |

**Total: ~3 semanas de trabajo enfocado.**

### Antes / después

| Métrica | Antes | Después |
|---|---:|---:|
| Archivo más grande (backend) | 1.303 | ~200 |
| Archivo más grande (frontend) | 2.244 | ~330 |
| Archivos > 800 líneas | 4 | **0** |
| CSS muerto | ~993 | 0 |
| Cobertura de rutas HTTP | 0 % | ~100 % |
| Total de líneas | ~26.400 | **~25.300** |

**El total baja solo un 4 %.** Ese es el punto honesto de todo este documento: la refactorización no va de escribir menos código, va de que ningún archivo sea inabarcable y de que exista una red de tests. Reducir 13.000 líneas de frontend a 8.000 solo sería posible eliminando funcionalidad que hoy se usa.

---

## 11. Reglas de ejecución

1. **Un commit por paso**, nunca agrupar movimientos de archivos distintos.
2. **`npm test` verde antes y después** de cada commit.
3. **Refactorización ≠ corrección.** Si aparece un bug (como el de P3 o la falta de transacción en `saveProject`), va en un commit propio y etiquetado como `fix:`, no escondido en un `refactor:`.
4. **No tocar `migrations/`.** Las 19 migraciones están aplicadas en producción; son historia inmutable.
5. **Respaldo de `data.json` e `history.json`** antes de empezar (42.000 líneas de datos reales, fuera de git).
