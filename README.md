# Seguimiento Semanal de Proyectos — Oficina de Tecnología

Aplicación web para registrar y reportar el avance semanal de proyectos de ingeniería.
Desarrollada internamente por la Oficina de Tecnología de la Corte Suprema de Justicia.

---

## ¿Qué hace la aplicación?

- **Dashboard**: tarjetas por proyecto con estado, avance y accesos rápidos a Gantt/Kanban/Jerarquía. Solo admin.
- **Editar**: formulario completo por proyecto — actividades (con jerarquía de subtareas), ingenieros asignados, indicadores, impedimentos, planificación semanal. Solo admin.
- **Ingenieros**: "Mi semana" e "Historial por ingeniero" en un mismo hub (`EngineerHub`). Un usuario sin rol admin solo ve su propio dashboard, bloqueado a su ingeniero vinculado.
- **Reportes**: agrupa tres subvistas — **Reporte semanal** (consolidado o por proyecto, con "Copiar reporte" e informe IA), **Consultas** (BI ad-hoc sobre SQL, ver [Reportería / Consultas](#reportería--consultas)) y **Trimestres** (cierre/reset trimestral).
- **Administración**: alta de usuarios, vínculo a ingeniero y asignación del rol admin. Solo visible para admins.
- **Importar desde Planner**: carga un `.xlsx` exportado de Microsoft Planner y sincroniza actividades sin perder lo que solo vive en la app (ver [Import desde Planner](#import-desde-planner)).
- **Informe de gestión con IA**: informe ejecutivo trimestral (logros, indicadores, riesgos, plan de mejora) generado con un proveedor de IA en cascada (ver [Generación de informes con IA](#generación-de-informes-con-ia)).
- **Nueva semana**: limpia los campos semanales y guarda un snapshot en el historial antes de borrar. Solo admin.

---

## Roles y acceso

Desde la migración `019_add_user_roles.sql`, `Usuarios` tiene `EsAdmin BIT` (default `0`) e `IngenieroID INT NULL` (vínculo opcional a `Ingenieros`).

- **Admin**: ve las 4 pestañas completas y los controles globales del header (fecha de reporte, guardar reporte, nueva semana, restaurar respaldo).
- **Ingeniero sin rol admin**: solo ve "Mi dashboard" (`EngineerHub` bloqueado a su propio `ingenieroId`) — sin acceso al portafolio completo ni a datos de otros ingenieros.

El login (`POST /api/auth/login`) valida contra `Usuarios` (contraseña con scrypt) y crea una sesión con cookie httpOnly de 7 días. La sesión convive con `API_KEY` (header `X-API-Key`, obligatorio en todo `/api/*`) — la sesión agrega identidad real encima, no la reemplaza. El backend impone la restricción real vía `requireAdmin`; el ocultamiento de pestañas en el frontend es solo una segunda capa de UX, no de seguridad.

---

## Estructura del proyecto

```
project_tracker_BD/
│
├── backend/                              ← Servidor Node.js + Azure SQL
│   ├── server.cjs                        ← Arma Express, monta middlewares y routes/*.cjs
│   ├── auth.cjs                          ← Login, sesiones (scrypt + cookie httpOnly)
│   ├── db-operations.cjs                 ← Fachada: reexporta db/*.repo.cjs (no tocar require()s)
│   ├── gemini-report.cjs                 ← Fachada: reexporta ai/report-generator.cjs
│   ├── quarter-reset.cjs                 ← Cálculo de reset trimestral
│   ├── data.json / history.json          ← Estado actual e historial semanal (ignorados en git)
│   ├── .env                              ← Credenciales y API keys (ignorado en git — ver .env.example)
│   │
│   ├── config/
│   │   ├── env.cjs                       ← Valida variables de entorno al arrancar (fail-closed en prod)
│   │   └── modules.cjs                   ← Carga defensiva de db/ai/auth/reports (503 si falla, no tumba el proceso)
│   │
│   ├── middleware/
│   │   ├── api-key.cjs                   ← Exige X-API-Key en todo /api/*
│   │   ├── session.cjs                   ← resolverSesion (no bloqueante) + requireAdmin (bloqueante)
│   │   ├── rate-limits.cjs
│   │   ├── security-log.cjs
│   │   └── error-handler.cjs
│   │
│   ├── routes/                           ← Un router por dominio, montados en server.cjs
│   │   ├── auth.routes.cjs               ← /api/auth — login, logout, me (montado último: de él depende req.user)
│   │   ├── users.routes.cjs              ← /api/users — admin de usuarios (requireAdmin)
│   │   ├── projects.routes.cjs           ← /api/projects
│   │   ├── engineers.routes.cjs          ← /api — ingenieros, tareas sueltas, contactos externos
│   │   ├── history.routes.cjs            ← /api — snapshot semanal + historial
│   │   ├── quarters.routes.cjs           ← /api — reset e histórico de trimestres
│   │   ├── attachments.routes.cjs        ← /api/attachments — adjuntos en SQL
│   │   ├── ai.routes.cjs                 ← /api — informes/status con IA
│   │   ├── maintenance.routes.cjs        ← /api — restaurar desde BD
│   │   └── diagnostics.routes.cjs        ← /api — db-ping (deshabilitado en producción)
│   │
│   ├── db/                               ← Un repositorio por dominio, todos sobre Azure SQL
│   │   ├── pool.cjs                      ← Conexión compartida
│   │   ├── users.repo.cjs
│   │   ├── engineers.repo.cjs
│   │   ├── engineer-tasks.repo.cjs
│   │   ├── projects.repo.cjs
│   │   ├── weekly-report.repo.cjs
│   │   ├── activity-detail.repo.cjs
│   │   ├── attachments.repo.cjs
│   │   └── recovery.repo.cjs
│   │
│   ├── ai/                               ← Generación de informes con IA
│   │   ├── providers.cjs                 ← Clientes Gemini/OpenRouter/Groq
│   │   ├── project-catalog.cjs           ← Descripciones de proyecto (contexto anti-alucinación)
│   │   ├── project-summary.cjs           ← Arma el resumen de datos para el prompt
│   │   ├── prompts.cjs                   ← Plantillas de prompt
│   │   └── report-generator.cjs          ← Orquesta cada tipo de informe con fallback en cascada
│   │
│   ├── reports/                          ← Módulo de Consultas (BI ad-hoc), ver sección propia
│   │   ├── index.cjs                     ← Router /api/reports
│   │   ├── query-registry.cjs            ← Catálogo cerrado de consultas permitidas
│   │   ├── query-builder.cjs             ← Valida filtros/columnas contra el registro
│   │   ├── export-excel.cjs / export-pdf.cjs
│   │   ├── project-notes.cjs
│   │   └── saved-reports.cjs
│   │
│   ├── migrations/                       ← SQL idempotente, numerado (019_add_user_roles.sql es el más reciente relevante)
│   └── package.json
│
├── frontend/                             ← Aplicación React (Vite)
│   ├── src/
│   │   ├── App.jsx                       ← Raíz: sesión, estado central, layout y navegación
│   │   ├── appNav.js                     ← Constantes/helpers puros de navegación (BASE_TABS, buildTabs, KPIs)
│   │   ├── App.css                       ← @import de frontend/src/styles/*.css (ver más abajo)
│   │   ├── index.css                     ← Reset global y variables CSS
│   │   │
│   │   ├── components/
│   │   │   ├── Dashboard.jsx             ← Tarjetas del portafolio + KPIs
│   │   │   ├── EditView.jsx              ← Orquestador del editor de proyecto (ver components/edit/)
│   │   │   ├── ReportView.jsx            ← Reporte semanal (ver components/report/)
│   │   │   ├── EngineerHub.jsx           ← "Mi semana" + "Historial por ingeniero"
│   │   │   ├── QuartersView.jsx          ← Cierre/reset de trimestre
│   │   │   ├── ReportesView.jsx          ← Módulo de Consultas (tabla / tablero / carga)
│   │   │   ├── UsersAdminView.jsx        ← Administración de usuarios
│   │   │   ├── GanttChart.jsx            ← Cronograma (ver components/gantt/)
│   │   │   ├── HierarchyTable.jsx        ← Tabla jerárquica de actividades/subtareas
│   │   │   ├── ActivityDetailModal.jsx   ← Detalle de una actividad (ver components/activity-detail/)
│   │   │   ├── ActivityFormSections.jsx  ← Barrel de components/activity-form/
│   │   │   ├── ProjectPlanningOverlays.jsx ← Orquesta overlays de Gantt/Kanban/Jerarquía desde el Dashboard
│   │   │   ├── PlannerImportModal.jsx    ← Modal de importación desde Excel de Planner
│   │   │   ├── GlobalBoardView.jsx / WorkloadMatrix.jsx ← Modos de ReportesView
│   │   │   └── … (LoginScreen, CommandPalette, NavGroup, UserMenu, modales varios)
│   │   │
│   │   │   Subcarpetas de piezas internas (no son vistas de nav propias):
│   │   │   ├── edit/       ← Piezas de EditView (lista de actividades, asignación, indicadores…)
│   │   │   ├── report/     ← Piezas de ReportView (status IA, cuerpo del reporte por proyecto)
│   │   │   ├── gantt/      ← Piezas de GanttChart (filtros, hooks de resize/ancho)
│   │   │   ├── activity-detail/ ← Piezas de ActivityDetailModal (adjuntos, diálogos)
│   │   │   ├── activity-form/   ← Secciones reutilizables del formulario de actividad
│   │   │   └── engineer/   ← Piezas de EngineerHub (tablas, badges, notas de proyecto)
│   │   │
│   │   ├── styles/                       ← CSS dividido por dominio, importado desde App.css en orden
│   │   │   ├── base.css                  ← :root, tokens de tema (claro/oscuro)
│   │   │   ├── layout.css, buttons.css, dashboard.css, edit-view.css
│   │   │   ├── activity-detail.css, activities-list.css, bulk-assign.css
│   │   │   ├── gantt.css, hierarchy-table.css
│   │   │   ├── report.css, report-content.css, report-status-board.css, report-saved.css
│   │   │   ├── quarters.css, engineers.css, planner-import.css, pulse-notes.css, misc.css
│   │   │
│   │   └── utils/
│   │       ├── formulas.js               ← Barrel: reexporta utils/formulas/* (ver abajo)
│   │       ├── formulas/
│   │       │   ├── dateHelpers.js, progress.js, activityModel.js, businessDays.js
│   │       │   ├── activityHierarchy.js  ← Árbol de subtareas (parent_id), numeración jerárquica
│   │       │   ├── engineerModel.js, reportText.js
│   │       ├── storage.js                ← Persistencia: localStorage + API
│   │       ├── plannerImport.js          ← Motor de importación desde Planner (sin React/DOM)
│   │       └── weekPlanning.js
│   │
│   ├── vite.config.js                    ← Proxy /api → :3002 en desarrollo
│   └── package.json
│
├── .gitignore
├── .deployment / deploy.sh               ← Despliegue en Azure App Service
├── PLAN_REFACTORIZACION.md               ← Historial de las fases de refactorización de código
└── README.md
```

---

## Modelo de actividades

- **Jerarquía de subtareas**: las actividades viven en un array plano (`activities_identified`); `parent_id` (`null` = raíz) es la única adición para modelar el árbol. `buildActivityTree`/`flattenTree` (`utils/formulas/activityHierarchy.js`) lo reconstruyen en memoria bajo demanda — la numeración tipo "1.1.2" nunca se persiste. `sequence_order` fija el orden entre hermanas del mismo padre. Solo las actividades **hoja** (sin hijos) cuentan en métricas — un padre con subtareas es un contenedor organizativo. Un padre no puede marcarse completado si alguna descendencia (directa o indirecta) sigue pendiente.
- **`task_status`**: Kanban de 3 columnas — `{ completed: [], in_progress: [], not_started: [] }`, cada una un array de IDs de actividad. Es la fuente de verdad del estado operacional, independiente de `progress` (el % manual 0-100 de cada actividad).

---

## Dónde hacer cada tipo de cambio

| Quiero cambiar… | Archivo |
|---|---|
| La fórmula de avance (cómo se calcula el %) | `frontend/src/utils/formulas/progress.js` → `projectProgress()` |
| El texto del reporte que se copia | `frontend/src/utils/formulas/reportText.js` → `projectBlock()` |
| Los campos de un proyecto nuevo | `frontend/src/utils/formulas/activityModel.js` → `createDefaultProject()` |
| Los estados de proyecto (En curso, Bloqueado…) | `frontend/src/components/EditView.jsx` → constante `STATUS_OPTIONS` |
| Las pestañas de navegación / qué ve un admin vs. no-admin | `frontend/src/appNav.js` |
| Los estilos visuales | `frontend/src/styles/*.css` (dividido por dominio — ver estructura arriba) |
| El logo o nombre en el encabezado | `frontend/src/App.jsx` → sección `<header>` |
| Las rutas de la API | `backend/routes/*.cjs` (un archivo por dominio) |
| La conexión a la base de datos | `backend/.env` (credenciales) + `backend/db/pool.cjs` |
| El puerto del servidor | `backend/.env` → variable `PORT` |
| El prompt o tono del informe de IA | `backend/ai/prompts.cjs` → `SYSTEM_PROMPT` y `buildPrompt()` |
| El catálogo de descripciones de proyectos (contexto para la IA) | `backend/ai/project-catalog.cjs` |
| El orden de proveedores de IA (Gemini → OpenRouter → Groq) | `backend/ai/report-generator.cjs` |
| Roles y permisos de administración | `backend/migrations/019_add_user_roles.sql`, `backend/middleware/session.cjs` → `requireAdmin` |

---

## Correr el proyecto localmente

### Instalación (primera vez)

```bash
cd backend && npm install
cd ../frontend && npm install
```

### Modo desarrollo (dos terminales)

```bash
# Terminal 1 — desde backend/
npm run server
# → Express arranca en http://localhost:3002

# Terminal 2 — desde frontend/
npm run dev
# → Vite arranca en http://localhost:5173
```

Abrir `http://localhost:5173`. Las llamadas a `/api/*` se redirigen automáticamente a `:3002` por el proxy de Vite.

### Modo producción (un solo proceso)

```bash
cd frontend && npm run build   # genera frontend/dist/
cd ../backend && npm start     # sirve la app completa en http://localhost:3002
```

### Tests

```bash
cd backend && npm test                    # node --test, suite de contrato HTTP + repos
cd frontend && node --test src/utils/*.test.js
```

---

## Conexión a SQL Server / Azure SQL

Los datos se guardan **siempre** en `backend/data.json` y `backend/history.json`. Azure SQL es un destino adicional en paralelo — si la BD no responde, la app sigue funcionando con el JSON como respaldo.

### Archivo `backend/.env`

Copiar `backend/.env.example` a `backend/.env` y completar:

```env
NODE_ENV=development
PORT=3002
FRONTEND_URL=http://localhost:5173
API_KEY=

DB_SERVER=localhost
DB_USER=
DB_PASSWORD=
DB_NAME=

GEMINI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
```

⚠️ `.env` contiene credenciales y API keys reales — nunca debe subirse al repositorio ni compartirse. Si una clave quedó expuesta accidentalmente, rótala de inmediato en el panel del proveedor correspondiente.

`FRONTEND_URL` y `API_KEY` son **obligatorias en producción** (`NODE_ENV=production`) — el servidor no arranca si faltan. En desarrollo, su ausencia solo genera un warning.

### Diferencia local vs Azure SQL

| Configuración | SQL Server local | Azure SQL |
|---|---|---|
| `DB_SERVER` | `localhost` | `xxx.database.windows.net` |
| `encrypt` en `db/pool.cjs` | `false` | `true` (ya configurado) |
| Firewall | No aplica | Agregar tu IP en el portal de Azure |

---

## Rutas de la API

Todas exigen el header `X-API-Key`. Las que dependen de sesión (`req.user`) además exigen la cookie `sid`; las marcadas **admin** además exigen `EsAdmin=1`.

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Inicia sesión |
| POST | `/api/auth/logout` | Cierra sesión |
| GET | `/api/auth/me` | Usuario de la sesión actual |
| GET | `/api/users` · POST `/api/users` · POST `/api/users/:id` | Administración de usuarios (**admin**) |
| GET | `/api/projects` · POST `/api/projects` | Estado actual de todos los proyectos (`data.json`) |
| POST | `/api/report` | Guarda snapshot semanal (`history.json` + Azure SQL en paralelo) |
| GET | `/api/history` · GET `/api/history/:date` | Historial de reportes guardados |
| POST | `/api/engineers/sync-one` · POST `/api/external-contacts/sync-one` | Sincroniza catálogo de ingenieros/externos a SQL |
| POST | `/api/engineers/tasks/sync-one` · POST `/api/engineers/tasks/delete-one` | Tareas sueltas de ingeniero |
| POST | `/api/quarter-reset` · POST `/api/clean-stats` · GET `/api/quarters` · GET `/api/quarters/:id` | Cierre y consulta de trimestres |
| POST | `/api/attachments/upload` · GET `/api/attachments/:id` · POST `/api/attachments/delete` | Adjuntos de actividad |
| POST | `/api/generate-report` · POST `/api/project-status` · POST `/api/generate-global-status` | Informes/status con IA |
| POST | `/api/restore-from-db` | Restaura `data.json` desde el último snapshot en Azure SQL |
| GET | `/api/db-ping` | Diagnóstico de conexión a BD (solo desarrollo) |
| GET | `/api/reports/registry` · POST `/api/reports/query` · POST `/api/reports/export` | Consultas predefinidas del módulo de Reportería (ver abajo) |
| GET | `/api/reports/notes/:proyectoAppID` · POST `/api/reports/notes` · POST `/api/reports/notes/delete` | Notas de proyecto |
| GET | `/api/reports/saved` · POST `/api/reports/saved` · POST `/api/reports/saved/delete` | Consultas guardadas/favoritas |

---

## Generación de informes con IA

El botón **"Informe de gestión con IA"** llama a `backend/ai/report-generator.cjs`, que arma un prompt (`ai/prompts.cjs` + `ai/project-summary.cjs`) con todos los datos del proyecto (métricas, actividades, impedimentos, hitos, comentarios) y lo envía a un proveedor de IA para producir un informe ejecutivo estructurado en JSON.

### Cadena de proveedores (failover automático)
1. **Gemini** (principal) — prueba varios modelos en orden hasta obtener respuesta.
2. **OpenRouter** (respaldo) — varios modelos gratuitos en orden.
3. **Groq** (último respaldo) — `llama-3.3-70b-versatile`.

Si una API key no está en `.env`, ese proveedor se omite y continúa con el siguiente. Si ninguno está configurado, la ruta responde con error.

### Dónde ajustar el comportamiento
- **Tono y reglas de redacción**: `SYSTEM_PROMPT` y `buildPrompt()` en `backend/ai/prompts.cjs`.
- **Lista de modelos por proveedor**: `GEMINI_MODELS`/`OPENROUTER_MODELS` en `backend/ai/providers.cjs`.
- **Descripciones de proyectos** (contexto anti-alucinación): `backend/ai/project-catalog.cjs`.
- **Resumen de estado semanal** (más corto, usado en el dashboard): `buildStatusPrompt()`/`generateStatusSummaryWithAI()` en `prompts.cjs`/`report-generator.cjs`.

---

## Reportería / Consultas

Distinto del reporte semanal tradicional: es un módulo de **BI ad-hoc sobre Azure SQL**, montado en `backend/reports/` bajo `/api/reports`. El cliente nunca manda SQL libre — elige filtros y columnas de un **registro cerrado de consultas predefinidas** (`query-registry.cjs`), validados por `query-builder.cjs` contra ese mismo registro. Soporta exportar a Excel/PDF, notas de proyecto y consultas guardadas/favoritas.

En el frontend, `ReportesView.jsx` ofrece tres modos: **tabla**, **tablero** (`GlobalBoardView.jsx`, vista cross-proyecto) y **carga de trabajo** (`WorkloadMatrix.jsx`).

---

## Import desde Planner

`utils/plannerImport.js` (motor puro) + `PlannerImportModal.jsx` (UI) permiten cargar un `.xlsx` exportado de Microsoft Planner (hoja "Tareas de proyecto", parseado con SheetJS cargado bajo demanda). Mapea columnas en español (Número de tarea, Nombre, Asignado a, Inicio, Finalización, Esfuerzo, Depósito, % Completado, Notas, y opcionalmente "Tarea padre" para jerarquía) y sincroniza contra las actividades existentes por `planner_task_number`:

- El Excel manda en los campos que vienen de Planner.
- La app conserva lo que solo vive en ella (objetivos, solución, checklist, adjuntos).
- Una tarea que desaparece del Excel se **archiva**, nunca se borra.
- Una actividad creada a mano en la app nunca se archiva por una importación.

---

## Fórmulas de avance

### Por proyecto
```
Avance = (Completadas + En_Proceso × 0.5) / Total × 100
```
Las tareas en proceso valen 0.5 porque están iniciadas pero no terminadas. Para cambiar este peso, editar el `0.5` en `frontend/src/utils/formulas/progress.js → projectProgress()`.

### Avance global
```
Avance Global = Promedio de avance de todos los proyectos con tareas definidas
```
Los proyectos sin tareas (Total = 0) se excluyen del promedio.

---

## Flujo semanal de uso

1. **Durante la semana**: actualizar métricas, estado de actividades e impedimentos.
2. **Viernes**: revisar logros y plan de próxima semana (se calculan automáticamente desde las fechas de las actividades).
3. **Al cerrar**: botón **"💾 Guardar reporte"** → guarda snapshot en historial.
4. **Inicio nueva semana**: botón **"↻ Nueva semana"** → limpia campos semanales y avanza la fecha.
5. **Compartir**: pestaña **Reporte** → **"Copiar reporte ✎"** → pegar en correo o Teams.

---

## Diseño de tableros (dashboards)

Dos audiencias con necesidades distintas comparten la misma app, así que se diseñan como **dos rutas separadas, no dos apps**: el director no necesita login distinto ni datos distintos — necesita una landing page distinta sobre los mismos datos.

### Tablero del Gestor de Proyectos (vista actual — `Dashboard` + `Editar` + `Ingenieros` + `Reportes`)

Es quien necesita saberlo todo y poder entrar a todo. Ya cubierto por lo que existe hoy:

- Edición directa de proyectos y actividades (`EditView`).
- Vista por ingeniero con carga de trabajo (`EngineerHub`, `WorkloadMatrix`).
- Reportes con filtros y exportación (`ReportesView`).
- Cierre trimestral (`QuartersView`).
- Detalle de actividad con checklist/adjuntos/notas (`ActivityDetailModal`).

No requiere cambios de estructura — es la vista "todo visible, todo editable".

### Tablero del Director (nuevo — resumen ejecutivo con drill-down)

Objetivo: responder en menos de 10 segundos "¿este proyecto X, quién está ahí, qué están haciendo, cómo va, para cuándo hay entregas, qué está atrasado?" — y dar botones para profundizar solo si hace falta, sin abrumar con todo el detalle del gestor.

**Estructura: una tarjeta grande por proyecto activo**, no una tabla larga. Cada tarjeta:

| Campo | Fuente en el modelo actual |
|---|---|
| Nombre del proyecto + responsable/equipo | `project_name`, `engineers[]` (vía `buildEngineerIndex`) |
| Qué se está haciendo ahora | Última actividad en `task_status.in_progress`, resuelta con `activityLabel` |
| Semáforo + % avance | `status` (on-track/at-risk/blocked/completed/mejora-continua) + `projectProgress()` |
| Próxima entrega: fecha y días restantes | `due_date` más próxima entre actividades no completadas |
| Tareas vencidas (si hay, resaltado) | Actividades con `due_date` pasada y `task_status` ≠ completed |

**Debajo de cada tarjeta, 3 botones de profundidad** — todos ya existen como componentes, solo hace falta exponerlos desde esta vista nueva:
- **Ver Gantt** → `GanttChart.jsx` (ya usado por `ProjectPlanningOverlays`)
- **Ver actividades** → Kanban de 3 columnas, ya modelado 1:1 por `task_status` (no iniciada/en proceso/completada) — mismo componente que usa `EditView` internamente
- **Ver estadísticas** → `MetricsTable.jsx` / `ProjectMetricsTable`, ya usado en `ReportView`

**Implementación recomendada**: nueva vista `view: "director"` en `appNav.js`, visible solo para usuarios con un flag futuro (o reutilizando `EsAdmin` si no hace falta separar "director" de "gestor" como roles distintos), que renderiza un componente nuevo `DirectorDashboard.jsx` con las tarjetas descritas arriba, reutilizando `ProjectPlanningOverlays` para los 3 botones de profundidad (mismo mecanismo que ya usa el `Dashboard` del gestor para abrir Gantt/Kanban/Jerarquía en overlay).

**Qué NO llevar a esta vista** (para no duplicar el tablero del gestor): edición de campos, alta de actividades/ingenieros, exportación de Excel/PDF, administración de usuarios. Si el director necesita algo de eso, cambia a la vista de gestor (mismo login, sin fricción).

**Pendiente de decidir**: si "director" es un tercer rol explícito en `Usuarios` (columna nueva o valor de `EsAdmin` de 3 estados) o simplemente una landing page alternativa que cualquier admin puede abrir — la tabla de arriba no depende de esa decisión, solo cambia quién ve el botón para llegar a `/director`.
