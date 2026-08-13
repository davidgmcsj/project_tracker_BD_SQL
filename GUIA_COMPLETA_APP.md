# Guía completa — Sistema de Seguimiento Semanal de Proyectos

> Documento de referencia integral: qué hace la aplicación, cómo funciona por dentro,
> qué flujos soporta y qué reglas de negocio la gobiernan.
>
> Escrito para que una persona nueva (o un modelo de lenguaje) pueda entender el
> sistema completo sin leer el código. Auditado directamente contra el código fuente.
>
> **Organización**: Oficina de Tecnología — Corte Suprema de Justicia (Colombia)
> **Última auditoría del código**: 12 de agosto de 2026
> **Estado de pruebas**: 306 tests frontend + 98 tests backend, todos en verde

---

## Tabla de contenido

1. [Qué es y para qué sirve](#1-qué-es-y-para-qué-sirve)
2. [Arquitectura general](#2-arquitectura-general)
3. [Stack tecnológico](#3-stack-tecnológico)
4. [Roles y control de acceso](#4-roles-y-control-de-acceso)
5. [Modelo de datos](#5-modelo-de-datos)
6. [Módulos y tableros](#6-módulos-y-tableros)
7. [Motores de reglas de negocio](#7-motores-de-reglas-de-negocio)
8. [Flujos de trabajo](#8-flujos-de-trabajo)
9. [Persistencia y base de datos](#9-persistencia-y-base-de-datos)
10. [API REST](#10-api-rest)
11. [Módulo de reportes y consultas](#11-módulo-de-reportes-y-consultas)
12. [Integración con inteligencia artificial](#12-integración-con-inteligencia-artificial)
13. [Importación desde Microsoft Planner](#13-importación-desde-microsoft-planner)
14. [Seguridad](#14-seguridad)
15. [Cómo correr el proyecto](#15-cómo-correr-el-proyecto)
16. [Mapa de archivos](#16-mapa-de-archivos)
17. [Glosario](#17-glosario)

---

## 1. Qué es y para qué sirve

### El problema que resuelve

La Oficina de Tecnología gestiona simultáneamente varios proyectos de desarrollo de
software, cada uno con decenas de actividades repartidas entre un equipo de ingenieros.
Antes de este sistema, el seguimiento se hacía en hojas de cálculo dispersas y en
Microsoft Planner, lo que producía tres problemas:

- **Sin visión consolidada**: nadie podía responder "¿cómo va el portafolio completo?"
  sin abrir cinco archivos y sumar a mano.
- **Reporte semanal manual**: armar el informe de cada viernes consumía horas de copiar,
  pegar y redactar.
- **Historial perdido**: al actualizar una hoja se sobreescribía el estado anterior, así
  que no quedaba registro de la evolución real.

### Qué hace el sistema

Es una aplicación web interna que centraliza:

- **Planificación jerárquica** de actividades por proyecto (tareas, subtareas, sub-subtareas
  sin límite de profundidad).
- **Seguimiento del estado** de cada actividad mediante un tablero Kanban con flujo de
  despliegue (desarrollo → pruebas → producción).
- **Cronograma visual (Gantt)** con filtros acumulativos, exportación a PDF e imagen.
- **Cierre semanal automatizado**: deduce qué se hizo y qué viene, archiva el snapshot,
  limpia los campos semanales.
- **Cierre trimestral**: archiva el trimestre completo y transfiere lo pendiente al siguiente.
- **Reportes ejecutivos** generados con inteligencia artificial (documento Word descargable).
- **Consultas parametrizadas** sobre la base de datos histórica, exportables a Excel y PDF.
- **Dashboard individual por ingeniero**: cada uno ve solo su carga de trabajo.

### Quiénes lo usan

| Perfil | Qué hace en el sistema |
|---|---|
| **Gestor de proyectos (admin)** | Ve todo el portafolio, edita proyectos, asigna actividades, cierra la semana y el trimestre, genera informes |
| **Director** | Consume el Dashboard Dirección: resumen ejecutivo con capacidad de profundizar hasta la actividad individual |
| **Ingeniero** | Ve únicamente su propio dashboard: sus actividades de la semana, su historial y las notas de los proyectos donde participa |

---

## 2. Arquitectura general

```
┌──────────────────────────────────────────────────────────────────┐
│                         NAVEGADOR                                │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  React 19 (SPA)  —  Vite 8                                 │  │
│  │  Estado central en App.jsx  →  props hacia abajo           │  │
│  │  localStorage = respaldo síncrono del cliente              │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬────────────────────────────────────┘
                              │  HTTPS + X-API-Key + cookie de sesión
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                    BACKEND — Express 5 (Node)                    │
│  Middlewares: helmet → CORS → API key → body parser →            │
│               rate limits → resolución de sesión                 │
│  Routers: diagnostics, ai, users, attachments, engineers,        │
│           history, quarters, maintenance, projects, auth,        │
│           reports                                                │
└──────────┬──────────────────────────────────┬────────────────────┘
           │                                  │
           ▼  ESCRITURA DUAL                  ▼
┌────────────────────────┐        ┌──────────────────────────────┐
│  Archivos JSON         │        │  Azure SQL Server            │
│  data.json (estado)    │        │  Proyectos, Actividades,     │
│  history.json (histór.)│        │  Ingenieros, Usuarios,       │
│  → respaldo ante caída │        │  Eventos, Notas, Adjuntos…   │
└────────────────────────┘        └──────────────────────────────┘
                              │
                              ▼
                  ┌───────────────────────────┐
                  │  Proveedores de IA        │
                  │  Gemini → OpenRouter →    │
                  │  Groq (cascada de fallo)  │
                  └───────────────────────────┘
```

### Principio arquitectónico central: escritura dual

Cada guardado escribe en **dos destinos en paralelo**:

1. **localStorage / archivos JSON** — síncrono, inmediato, nunca falla.
2. **Azure SQL Server** — asíncrono, en modo *fire-and-forget*.

Si SQL Server está caído, el error se registra en el log pero **no interrumpe la respuesta
al usuario**. El dato sobrevive en JSON hasta el siguiente guardado exitoso. Existe además
un endpoint `POST /api/restore-from-db` que reconstruye `data.json` desde SQL cuando el
JSON se corrompe o se pierde.

Esta decisión prioriza que **el usuario nunca pierda trabajo** por un problema de
infraestructura, a costa de aceptar ventanas breves de inconsistencia entre ambos destinos.

---

## 3. Stack tecnológico

### Frontend

| Componente | Versión | Rol |
|---|---|---|
| React | 19.2 | Librería de interfaz — solo componentes de función, sin clases |
| Vite | 8.0 | Servidor de desarrollo y empaquetador de producción |
| ESLint | 10.8 | Análisis estático, con `eslint-plugin-react-hooks` |
| html2canvas | 1.4 | Captura del Gantt como imagen PNG |
| xlsx (SheetJS) | 0.20.3 | Lectura del Excel de Planner — **carga dinámica**, no entra en el bundle inicial |
| jszip | 3.10 | Construcción del archivo .docx del informe de gestión |

**Sin TypeScript**: el proyecto usa JavaScript puro (`.jsx` / `.js`).
**Sin librería de estado global**: el estado vive en `App.jsx` y baja por props.
**Sin router**: la navegación es un `useState` sincronizado con la URL (`useUrlState`).
**Sin framework de CSS**: hojas de estilo propias organizadas por dominio en `src/styles/`.

### Backend

| Componente | Versión | Rol |
|---|---|---|
| Express | 5.2 | Servidor HTTP y enrutamiento |
| mssql | 12.5 | Cliente de SQL Server / Azure SQL |
| helmet | 8.3 | Cabeceras HTTP de seguridad |
| express-rate-limit | 8.6 | Limitación de tasa por endpoint |
| exceljs | 4.4 | Generación de archivos Excel |
| pdfmake | 0.3 | Generación de archivos PDF |
| @google/generative-ai | 0.24 | Cliente de Gemini |
| groq-sdk | 1.2 | Cliente de Groq |
| dotenv | 17.4 | Variables de entorno |

**CommonJS**: todos los archivos del backend usan extensión `.cjs` y `require()`.
**Sin ORM**: consultas SQL escritas a mano, siempre parametrizadas.
**Sin framework de tests**: se usa el runner nativo `node --test`.

---

## 4. Roles y control de acceso

El sistema distingue **dos niveles** mediante el bit `EsAdmin` en la tabla `Usuarios`
(migración 019). No es un enum de roles: hoy solo hace falta separar "ve todo" de
"ve solo lo suyo".

### Administrador (`EsAdmin = 1`)

Acceso completo. Ve estas pestañas:

- **Dashboard Dirección** — resumen ejecutivo
- **Dashboard** — tarjetas de proyecto
- **Ingenieros** → Equipo y mi semana / Historial por ingeniero
- **Reportes** → Reporte semanal / Consultas / Trimestres
- **Administración** — gestión de usuarios

Además dispone de las acciones destructivas globales: *Nueva semana*, *Restaurar respaldo*,
*Guardar reporte* y el cambio de fecha del reporte.

### Ingeniero (`EsAdmin = 0`)

Ve **un solo botón**: "Mi dashboard". Queda restringido a las vistas `engineers` y
`engineer-report`, con su identidad fijada mediante `lockedEngineerId` — no puede
cambiar el selector de ingeniero para ver la carga de un compañero.

### Las tres capas de la restricción

La restricción no depende de ocultar botones. Se aplica en tres niveles independientes:

1. **Interfaz** (`appNav.js` → `buildTabs`): un no-admin no ve los botones. Evita el clic
   accidental, pero por sí solo no es seguridad.
2. **Enrutamiento** (`App.jsx`, efecto de restricción): si un no-admin llega a otra vista
   por URL compartida (`?view=dashboard`) o por el valor por defecto, se le fuerza de vuelta
   a `engineers`. Cubre el intento deliberado de saltarse la interfaz.
3. **Backend** (`requireApiKey` + `requireAdmin`): los endpoints sensibles rechazan la
   petición sin importar qué muestre el navegador. Es la única capa que realmente protege.

### Autenticación

- **Contraseñas**: hash `scrypt` del módulo `crypto` nativo de Node — 64 bytes de hash
  (128 hex) + 16 bytes de sal (32 hex) únicos por usuario. Sin dependencias externas.
- **Sesiones**: token aleatorio de 32 bytes usado como clave primaria, entregado en cookie
  `httpOnly` + `secure` + `SameSite=Lax`. Expiran a los 7 días. Borrar la fila cierra la
  sesión de inmediato.
- **API key compartida**: header `X-API-Key` exigido en todo `/api/*`. Convive con las
  sesiones — no las reemplaza. La API key es el candado general del backend; la sesión
  agrega identidad individual encima.

---

## 5. Modelo de datos

### Proyecto

```js
{
  id: "abc123xyz",              // generado en cliente, estable
  project_name: "PRO-10-GTH",
  status: "on-track",           // on-track | at-risk | blocked | …
  priority: false,              // marca de estrella para filtrar
  version: 1,                   // control optimista de concurrencia
  planner_url: "",
  report_date: "2026-08-06",

  manual_metrics: {             // recalculadas automáticamente
    total_tasks: 0,
    completed_tasks: 0,
    in_progress_tasks: 0,
    shared_tasks_discount: 0,
  },

  activities_identified: [ /* actividades — ver abajo */ ],

  task_status: {                // 5 buckets del Kanban
    completed: [],              // arrays de IDs de actividad
    in_progress: [],
    not_started: [],
    ambiente_pruebas: [],
    ambiente_produccion: [],
    completed_dates: {},        // id → fecha de completado
    status_history: {},         // id → { added, in_progress, completed, … }
    completed_by: {},           // id → [{ engineer_id, engineer_name }]
  },

  weekly_achievements: [],      // logros de la semana (se limpia al cerrar)
  next_week_plan: [],           // plan de la próxima semana
  show_closing_fields: false,
  milestones: [],
  comments: [],
  engineers: [],                // participación por ingeniero en ESTE proyecto
  indicators: [],               // indicadores de desempeño
  impediments: [],              // bloqueantes, riesgos, salidas no conformes
}
```

### Actividad

Es la unidad de trabajo. El modelo se basa en **IDs estables**: el `id` se genera una sola
vez y nunca cambia, de modo que borrar o reordenar actividades no rompe las referencias
(estados, comentarios, fechas clave apuntan al `id`, no a la posición ni al texto).

```js
{
  id: "act_m3k2j1",
  parent_id: null,              // null = raíz; si no, id de la actividad madre
  sequence_order: 0,            // orden entre hermanas del mismo padre
  text: "Definición estructura formato permisos",

  assigned_engineers: [],       // ingenieros y/o colaboradores externos
  assigned_date: null,
  start_date: "2026-08-06",
  due_date: "2026-08-14",

  description: "",
  objectives: "",
  solution: "",
  progress: 0,                  // 0-100, manual
  planned_hours: 0,

  checklist: [],
  notes: [],
  key_dates: [],
  attachments: [],              // metadatos; los bytes viven en SQL

  planner_task_number: null,    // clave de sincronización con Planner
  archived: false,              // desapareció de Planner — oculta, recuperable
  archived_reason: "",

  es_desarrollo: false,         // habilita el flujo de ambientes de despliegue
  deployment_role: null,        // "test_deploy" | "prod_deploy" | null
}
```

**Jerarquía**: `parent_id` + `sequence_order` forman un árbol de profundidad ilimitada.
La numeración visible (1, 1.1, 1.2.3) se calcula recorriendo el árbol en preorden.

**Actividades archivadas**: cuando una tarea desaparece de Planner, no se borra — se marca
`archived: true`. Queda oculta de listas, métricas y reportes, pero sigue en el array y es
recuperable.

### Otros modelos

| Entidad | Descripción |
|---|---|
| **Ingeniero (catálogo global)** | Nombre, rol, grupo de trabajo, activo/inactivo, `sql_id`, tareas adicionales propias |
| **Colaborador externo** | Nombre y empresa — se puede asignar a actividades igual que un ingeniero |
| **Indicador de desempeño** | Nombre, total, completadas, en proceso |
| **Impedimento** | Categoría (`blocker` / `risk` / `non_conformity`), descripción, impacto |
| **Trimestre archivado** | Snapshot completo del trimestre cerrado |
| **Usuario** | Credenciales, `EsAdmin`, `IngenieroID` vinculado |

---

## 6. Módulos y tableros

### 6.1 Dashboard Dirección (`director`)

Tabla ejecutiva de todos los proyectos con capacidad de profundizar. Cada fila resume un
proyecto; al expandirla aparece el panel de actividades. Diseñada para responder de un
vistazo "¿cómo va el portafolio?" sin entrar a editar nada. Incluye el tablero Kanban
embebido para consulta.

### 6.2 Dashboard (`dashboard`)

Rejilla de tarjetas, una por proyecto. Cada tarjeta muestra el anillo de avance, el
semáforo de estado, la marca de prioridad y accesos directos a:

- **Editar** el proyecto
- **Planificación** (tabla jerárquica), **Kanban** y **Gantt** en superposición a pantalla completa
- **Ver reporte** individual
- **Generar informe** con IA
- **Exportar** el reporte al portapapeles

Arriba se muestra la franja de KPIs: avance promedio del portafolio y conteo de proyectos
En curso / En riesgo / Bloqueados / Otros.

### 6.3 Editar (`edit`)

Formulario completo del proyecto. No tiene botón propio en la navegación — se llega desde
las tarjetas del dashboard, porque llegar "en blanco" obligaba a elegir proyecto dos veces.

Contiene: datos generales, métricas, lista de actividades con jerarquía, asignación masiva,
participación de ingenieros, indicadores, impedimentos, logros de la semana, plan de la
próxima semana y notas del proyecto.

### 6.4 Planificación — Tabla jerárquica (`HierarchyTable`)

Vista de árbol de todas las actividades. Permite crear subtareas, reordenar, editar fechas
en línea, cambiar estado y filtrar por estado y por texto. Es la vista principal para
estructurar el trabajo.

### 6.5 Kanban — Tablero de estados (`TaskStatusSelector`)

Cinco columnas: **No iniciadas**, **En proceso**, **Ambiente Pruebas**, **Ambiente
Producción**, **Completadas**. Las actividades se mueven arrastrando o desde el selector.

Las columnas de ambiente solo aceptan actividades marcadas como `es_desarrollo`.

### 6.6 Cronograma — Gantt (`GanttChart`)

Calendario de celdas donde cada fila es una actividad y cada columna una unidad de tiempo.
No es un eje continuo de píxeles: cada celda representa un día, semana o mes exacto según
el rango activo.

**Características**:

- **Atajos de período**: Semana actual (con navegación ◀▶), Mes actual, T1–T4, S1–S2, Año, Todo
- **Rango manual**: campos Desde / Hasta con calendario emergente propio en formato dd/mm/aaaa
- **Búsqueda** por nombre de actividad
- **Filtros acumulativos estilo GitLab** (`TokenFilterBar`): fichas removibles por Tarea padre,
  Mostrar, Niveles y Estado, combinables entre sí
- **Columna "Actividad" redimensionable** arrastrando desde cualquier fila, con ancho
  automático que se adapta al contenido hasta que el usuario la ajusta a mano
- **Tipografía jerárquica**: nivel 0 en negrilla y tamaño mayor; nivel 1 en negrilla
- **Barra de filtros fija** (`sticky`) que permanece visible al desplazarse
- **Barra de scroll horizontal flotante** sincronizada con la tabla, siempre alcanzable sin
  bajar al final del listado
- **Exportación** a PDF (tabla de actividades con fechas) y a imagen PNG

### 6.7 Ingenieros (`engineers` / `engineer-report`)

Dos sub-pestañas:

- **Equipo y mi semana**: carga de trabajo del ingeniero seleccionado en la semana actual,
  sus tareas adicionales, y las notas de los proyectos donde participa (solo lectura).
- **Historial por ingeniero**: evolución semana a semana.

Para un usuario no-admin, el selector queda fijado a su propia identidad.

### 6.8 Reporte semanal (`report`)

Vista consolidada del reporte de la semana: por proyecto o del portafolio completo. Incluye
la sección de estado generado con IA y el botón para producir el informe de gestión en Word.

### 6.9 Consultas (`reportes`)

Módulo de reportería parametrizada sobre la base de datos. Ver [sección 11](#11-módulo-de-reportes-y-consultas).

### 6.10 Trimestres (`quarters`)

Gestión del cierre trimestral: muestra el trimestre en curso, permite ejecutar el reinicio
(con doble confirmación) y consultar los trimestres ya archivados.

### 6.11 Administración (`admin-users`)

Alta de usuarios, asignación del rol admin y vínculo con una ficha de ingeniero.

### 6.12 Paleta de comandos (Ctrl + K)

Buscador universal que salta a cualquier proyecto o vista sin usar el ratón.

---

## 7. Motores de reglas de negocio

Esta es la parte del sistema donde vive la lógica que no es evidente desde la interfaz.
Todos los motores son **funciones puras**: reciben datos, devuelven datos, nunca mutan la
entrada. Eso los hace comprobables de forma aislada — y de hecho concentran la mayor parte
de los 306 tests del frontend.

### 7.1 Cálculo de avance (`utils/formulas/progress.js`)

**Por proyecto**:

```
avance = ((completadas + en_proceso × 0.5) / total) × 100
```

Las tareas en proceso valen medio punto porque están iniciadas pero no terminadas. Da un
avance más realista que contar solo las completadas.

**Global**: promedio simple de los proyectos que tienen tareas definidas. Los proyectos con
`total_tasks = 0` se excluyen para no distorsionar el promedio.

**Qué se cuenta**: solo actividades **visibles** (las archivadas no inflan el total) y solo
**hojas** del árbol. Una tarea padre con subtareas es un contenedor organizativo, no una
unidad de trabajo medible — contarla duplicaría el trabajo de sus hijas.

**Progreso agregado de un nodo padre**: promedio simple de sus hijos directos, recursivo.
Es un valor derivado para presentación — nunca se persiste.

### 7.2 Máquina de estados y flujo de despliegue (`components/edit/shared.js`)

Todos los cambios de estado pasan por un **punto de entrada único**,
`transitionActivityStatus`, usado por los tres caminos de la interfaz (Kanban, selector del
modal de detalle y desplegable de la tabla jerárquica). Así el comportamiento es idéntico
sin importar desde dónde se dispare.

**Reglas de transición** (`canTransitionTo`):

- No se puede completar una actividad padre si tiene subtareas pendientes.
- No se puede completar **a mano** una actividad que está en un ambiente de despliegue —
  debe avanzar por el flujo.
- Solo las actividades marcadas `es_desarrollo` pueden entrar a los ambientes.

**Flujo automático de despliegue** — la parte más singular del sistema:

```
Usuario mueve una actividad de desarrollo a "Ambiente Pruebas"
   └→ el sistema CREA automáticamente la subtarea "Paso a servidor de pruebas"
      (deployment_role: "test_deploy") y la abre para que se le pongan fechas

Al completar esa subtarea de pruebas
   └→ el PADRE pasa solo a "Ambiente Producción"
   └→ el sistema CREA "Paso a servidor de producción" (deployment_role: "prod_deploy")

Al completar la subtarea de producción
   └→ el PADRE pasa solo a "Completada" con progreso 100%
```

Las transiciones automáticas del padre **omiten deliberadamente** la validación
`canTransitionTo`: el padre solo llega ahí como efecto de completar su propia subtarea de
despliegue, nunca por acción directa del usuario.

El vínculo se guarda en `deployment_role`, un campo opaco que el sistema asigna al crear la
subtarea. **Nunca se detecta por el texto** de la actividad, porque el texto es editable por
el usuario y por lo tanto poco confiable.

### 7.3 Auto-avance de actividades vencidas

Al cargar la aplicación, toda actividad "No iniciada" cuya `start_date` ya llegó o pasó se
mueve sola a "En proceso". Responde a un pedido explícito: *"si una actividad arranca hoy el
mismo sistema debe cambiarla a en proceso para que no sea enredado para el equipo"*.

Reutiliza el mismo motor `transitionActivityStatus`, de modo que el resultado es idéntico a
que un humano lo hubiera hecho a mano — registra `status_history.in_progress` con la fecha
de hoy y se refleja igual en Kanban, Gantt y Planificación. Corre **una sola vez** por carga.
Las actividades sin `start_date` nunca se tocan.

### 7.4 Deducción de la semana (`utils/weekPlanning.js`)

Reemplaza la selección manual de "actividades de esta semana". La regla central:

> Una actividad pertenece a una semana si su rango `[start_date, due_date]` **se solapa**
> con el rango `[lunes, domingo]` de esa semana.

Esto hace que una tarea de varias semanas aparezca en todas las que atraviesa, sin duplicar
el dato ni pedirle nada al usuario.

Cada actividad recibe además una **situación** dentro de esa semana, evaluada de más urgente
a menos:

| Situación | Significado |
|---|---|
| `overdue` — En demora | Venció antes de esta semana y sigue sin completarse |
| `due` — Vence esta semana | Su fecha de entrega cae dentro de la semana |
| `starts` — Inicia esta semana | Arranca en esta semana y termina después |
| `continues` — Continúa | Venía de antes y sigue después: semana intermedia |

### 7.5 Recálculo en cascada jerárquico (`utils/scheduling.js`)

Cuando se **atrasa** la fecha de fin de una actividad:

1. **Efecto dominó entre hermanas**: si el atraso hace que se solape con la siguiente
   hermana (mismo padre, por `sequence_order`), esa hermana se corre completa —conservando
   su duración— y así encadenado hasta la última afectada.
2. **Auto-extensión de la madre**: la fecha de fin del padre pasa a ser el máximo de sus
   hijas directas, recursivamente hacia arriba.
3. **El adelanto NO propaga**: si una tarea termina antes de lo previsto, no corre a las
   hermanas ni acorta a la madre. Es deliberado — evita que las fechas se muevan solas sin
   que el usuario lo pida.
4. **Sin solape, sin corrimiento**: si la siguiente hermana ya empezaba después, no pasa nada.

Los días de atraso son **días hábiles reales**, según el calendario de festivos de Colombia.

> **Nota**: la fecha de **inicio** del padre no se recalcula desde la primera fecha de sus
> hijas. Solo se toca si el padre no tenía inicio propio.

### 7.6 Retraso en cascada cronológico (`utils/delayCascade.js`)

Motor **distinto** al anterior. Mientras `scheduling.js` solo mueve parientes, este propone
mover **todas** las actividades del proyecto —sin importar el parentesco— cuya fecha de fin
caiga en o después de la de la actividad que se atrasó.

- **Candidatas**: cualquier actividad con `due_date >= due_date original` de la referencia.
- **Se excluyen**: la propia actividad de referencia, las que no tienen fecha de fin, y las
  **completadas**. Ambiente Pruebas y Producción sí son candidatas (siguen siendo trabajo activo).
- **Desplazamiento**: N días hábiles, calculados desde la fecha original de cada candidata —
  no se encadena candidata sobre candidata.
- **La fecha de inicio** se recalcula solo si la actividad tenía ambas fechas, preservando
  la duración.

El usuario revisa una pantalla de vista previa, desmarca lo que no quiera mover, aplica, y
dispone de un botón **Deshacer** mientras la pantalla siga abierta.

### 7.7 Protección contra ciclos

`wouldCreateCycle` impide asignar como padre a un descendiente propio, lo que rompería el
árbol. Tolera ciclos preexistentes ajenos al movimiento sin agravarlos.

---

## 8. Flujos de trabajo

### 8.1 Ciclo semanal

```
LUNES A JUEVES
  El equipo trabaja. Las actividades se mueven en el Kanban, se marcan avances,
  se registran notas e impedimentos. Todo se guarda solo (autoguardado cada 5 min).

VIERNES — CIERRE
  1. El gestor revisa cada proyecto en el Dashboard.
  2. El sistema ya dedujo los logros de la semana y el plan de la próxima
     a partir de las fechas (weekPlanning.js) — el gestor solo ajusta.
  3. Opcional: genera el informe de gestión con IA (documento Word).
  4. Pulsa "Guardar reporte" → snapshot archivado en history.json + SQL.
  5. Pulsa "Nueva semana" → confirma → se limpian los campos semanales
     de TODOS los proyectos y la fecha avanza al viernes siguiente.
```

**Qué se limpia al iniciar semana**: logros, plan de la próxima semana, bloqueantes
(los riesgos y salidas no conformes se conservan) y las actividades semanales de cada
ingeniero.

**Garantía de integridad**: antes de archivar, el sistema recalcula los campos semanales de
**todos** los proyectos, no solo de los que alguien abrió durante la semana. Sin esto, un
proyecto que nadie tocó llegaría al snapshot con datos de la semana anterior.

### 8.2 Cierre trimestral

Con doble confirmación, el reinicio trimestral:

1. Calcula las estadísticas del trimestre que se cierra.
2. Archiva el estado completo en la tabla `Trimestres_Archivo` y en un JSON de respaldo.
3. **Archiva** las actividades completadas.
4. **Transfiere** las pendientes al trimestre nuevo.
5. Reescribe `data.json` y el cliente recarga estado limpio desde el servidor.

Existe también *Limpiar estadísticas*, para corregir un reinicio que quedó a medias sin
volver a archivar.

### 8.3 Guardado y concurrencia

**Autoguardado**: cada 5 minutos, si hay cambios pendientes y no hay un conflicto sin
resolver. Usa exactamente el mismo camino que el botón manual, así que respeta las mismas
comprobaciones.

**Control optimista de versión**: cada proyecto tiene un campo `version`. Al pulsar
*Guardar cambios*, el cliente envía la versión que tenía. Si el servidor detecta que otra
persona guardó primero, responde con conflicto y aparece un modal que ofrece:

- **Sobreescribir** — reintenta sin la comprobación de versión
- **Descartar** — adopta la versión del servidor

El conflicto **solo se activa desde el botón manual**: es el único punto donde dos personas
realistamente editan el mismo proyecto a la vez. Los autoguardados de modales y los
interruptores del dashboard no envían versión y por tanto nunca disparan el modal.

### 8.4 Asignación de actividades

Se puede asignar de tres formas:

1. **Individual**: desde el modal de detalle de la actividad.
2. **Masiva**: panel de asignación por lotes en la vista de edición.
3. **Automática**: al importar desde Planner, según la columna "Asignado a".

Se puede asignar tanto a **ingenieros del catálogo** como a **colaboradores externos**
(personas de otras entidades o proveedores).

---

## 9. Persistencia y base de datos

### Archivos JSON del servidor

| Archivo | Contenido | Comportamiento |
|---|---|---|
| `data.json` | Estado actual de todos los proyectos | Se sobreescribe en cada guardado |
| `history.json` | Snapshots semanales | Solo se acumula, nunca se borra |
| `project-catalog.json` | Contexto de proyectos para los prompts de IA | Manual |
| `archive/quarter_*.json` | Respaldo de cada trimestre cerrado | Uno por trimestre |

### Tablas de Azure SQL Server

| Tabla | Contenido |
|---|---|
| `Proyectos` | Ficha maestra de cada proyecto |
| `ReportesSemanales` | Un registro por proyecto y semana |
| `Estado_Actividades_Reporte` | Estado y asignación de cada actividad por reporte semanal |
| `Actividades_Detalle` | Estado operacional **vivo** de cada actividad |
| `Actividad_Eventos` | Bitácora de cambios (registro de auditoría) |
| `Actividad_Checklist` | Elementos de lista de verificación |
| `Actividad_FechasClave` | Fechas clave por actividad |
| `Actividad_Notas` | Notas por actividad |
| `Actividad_Adjuntos` | Archivos adjuntos (bytes) |
| `Ingenieros` | Catálogo global del equipo |
| `Colaboradores_Externos` | Personas externas asignables |
| `Proyecto_Notas` | Notas fechadas de proyecto, con autor real |
| `Trimestres_Archivo` | Snapshots trimestrales |
| `Reportes_Guardados` | Combinaciones de consulta guardadas |
| `Usuarios` | Credenciales y roles |
| `Sesiones` | Sesiones activas |
| `Migraciones_Aplicadas` | Control de migraciones ejecutadas |

### Migraciones

Veinte migraciones numeradas en `backend/migrations/`, todas **idempotentes** (comprueban
si el objeto existe antes de crearlo). Se ejecutan con `npm run migrate`.

Hitos: `003` detalle de actividad · `007` adjuntos · `010` fechas de tarea ·
`013` bitácora de eventos · `016` reportes guardados · `017` versión de proyecto ·
`018` usuarios y sesiones · `019` roles.

---

## 10. API REST

Todos los endpoints cuelgan de `/api` y exigen el header `X-API-Key`.

### Proyectos y datos

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/projects` | Estado completo (proyectos, ingenieros, externos) |
| `POST` | `/api/projects` | Guardar — admite `changedProjectId` y `expectedVersion` |
| `POST` | `/api/report` | Archivar snapshot semanal |
| `GET` | `/api/history` | Lista de snapshots |
| `GET` | `/api/history/:date` | Snapshot de una fecha |

### Autenticación y usuarios

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/auth/login` | Iniciar sesión |
| `POST` | `/api/auth/logout` | Cerrar sesión |
| `GET` | `/api/auth/me` | Usuario de la sesión actual |
| `GET` | `/api/users` | Listar usuarios *(solo admin)* |
| `POST` | `/api/users` | Crear usuario *(solo admin)* |
| `POST` | `/api/users/:id` | Actualizar usuario *(solo admin)* |

### Catálogos

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/engineers/sync-one` | Sincronizar un ingeniero a SQL |
| `POST` | `/api/engineers/tasks/sync-one` | Sincronizar tarea adicional |
| `POST` | `/api/engineers/tasks/delete-one` | Borrar tarea adicional |
| `POST` | `/api/external-contacts/sync-one` | Sincronizar colaborador externo |

### Notas y adjuntos

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/notes/:proyectoAppID` | Notas de un proyecto |
| `POST` | `/api/notes` | Crear nota (autor tomado de la sesión) |
| `POST` | `/api/notes/delete` | Borrar nota |
| `POST` | `/api/attachments/upload` | Subir archivo (límite ampliado a 14 MB) |
| `GET` | `/api/attachments/:id` | Descargar |
| `POST` | `/api/attachments/delete` | Borrar |

### Trimestres y mantenimiento

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/quarter-reset` | Ejecutar cierre trimestral |
| `GET` | `/api/quarters` | Trimestres archivados |
| `GET` | `/api/quarters/:id` | Detalle de un trimestre |
| `POST` | `/api/clean-stats` | Limpiar estadísticas sin archivar |
| `POST` | `/api/restore-from-db` | Reconstruir `data.json` desde SQL |
| `GET` | `/api/db-ping` | Diagnóstico de conexión |

### Inteligencia artificial

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/generate-report` | Informe de gestión de un proyecto |
| `POST` | `/api/generate-global-status` | Estado ejecutivo del portafolio |
| `POST` | `/api/project-status` | Resumen de estado de un proyecto |

### Reportes

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/reports/registry` | Consultas, filtros y columnas disponibles |
| `POST` | `/api/reports/query` | Ejecutar consulta parametrizada |
| `POST` | `/api/reports/export` | Exportar resultado a Excel o PDF |
| `POST` | `/api/reports/export-planning` | Exportar Gantt/Planificación |
| `GET` | `/api/reports/saved` | Combinaciones guardadas |
| `POST` | `/api/reports/saved` | Guardar combinación |
| `POST` | `/api/reports/saved/delete` | Borrar combinación |

---

## 11. Módulo de reportes y consultas

Permite armar consultas sobre la base de datos histórica sin escribir SQL.

### Diseño de seguridad

El punto crítico: **el usuario nunca construye SQL**. El backend mantiene un *registro* de
consultas (`query-registry.cjs`) donde cada vista tiene su cláusula `FROM` y sus `JOIN`
escritos a mano. Lo único que el cliente elige es:

- **qué filtros** aplicar, de una lista cerrada
- **qué columnas** proyectar, de otra lista cerrada

`query-builder.cjs` valida ambas contra el registro antes de tocar la base de datos, y todos
los valores viajan como **parámetros tipados** (`sql.NVarChar`, `sql.Date`, `sql.Int`).
Es inmune a inyección SQL por construcción, no por saneamiento.

### Consultas disponibles

| Consulta | Responde a | Fuente |
|---|---|---|
| `actividades` | ¿Qué actividades se movieron esta semana? | Bitácora de eventos |
| `ingenieros` | ¿Qué está haciendo cada ingeniero? | Estado por reporte semanal |
| `proyectos` | ¿Cuáles son los proyectos y en qué estado están? | Último reporte de cada uno |
| `notas` | Notas y comentarios fechados | `Proyecto_Notas` |
| `vencidas` | ¿Qué actividades están vencidas? | Estado operacional vivo |
| `actividades_estado` | ¿Qué se trabaja / qué falta por empezar? | Estado operacional vivo |

### Funcionalidades

- **Plantillas** predefinidas para las preguntas más frecuentes
- **Combinaciones guardadas**: se guarda la configuración de filtros con un nombre
- **Exportación** a Excel (exceljs) y PDF (pdfmake), con traducción de los estados a
  etiquetas legibles
- **Estado en la URL**: un enlace compartido reproduce la consulta exacta

---

## 12. Integración con inteligencia artificial

### Cadena de proveedores con relevo automático

```
Gemini  →  OpenRouter  →  Groq
```

Dentro de cada proveedor se recorre además una lista de modelos en orden de preferencia. Si
un modelo falla (cuota agotada, error de red, respuesta vacía), se pasa al siguiente sin
interrumpir al usuario. Solo si **todos** fallan se devuelve error.

- **Gemini**: 7 modelos, desde `gemini-3.5-flash` hasta `gemini-2.0-flash` como último recurso
- **OpenRouter**: 8 modelos gratuitos, encabezados por `openai/gpt-oss-120b:free`
- **Groq**: `llama-3.3-70b-versatile`

Todos se invocan con `temperature: 0.3` (baja, para privilegiar consistencia sobre
creatividad) y forzando respuesta en formato JSON. El parser tolera que el modelo envuelva
el JSON en texto: si `JSON.parse` falla, extrae el primer bloque `{…}` de la respuesta.

### Funciones que usan IA

| Función | Qué produce |
|---|---|
| **Informe de gestión** | Documento Word (.docx) descargable, con análisis del proyecto por secciones |
| **Estado ejecutivo global** | Análisis del portafolio completo, mostrado en el dashboard |
| **Estado de proyecto** | Resumen breve del estado de un proyecto |

Las claves son **opcionales**: si no hay ninguna configurada, el sistema funciona con
normalidad y solo se desactivan estas funciones.

---

## 13. Importación desde Microsoft Planner

Permite sincronizar un plan de Planner exportado a Excel (hoja "Tareas de proyecto").

### Política de sincronización

| Regla | Detalle |
|---|---|
| **El Excel manda** | Nombre, responsable, fechas, % avance, esfuerzo y depósito se sobreescriben |
| **La app conserva** | Objetivos, solución, lista de verificación, notas, fechas clave y adjuntos nunca se tocan |
| **Clave de emparejamiento** | "Número de tarea" de Planner (`planner_task_number`) |
| **Tarea que desapareció** | Se **archiva**, no se borra — recuperable |
| **Tarea creada a mano** | Sin número de Planner: intacta, nunca se archiva |

### Traducción de depósitos

| Depósito de Planner | Estado en la app |
|---|---|
| Tareas Identificadas | No iniciada |
| Tareas en Ejecución | En proceso |
| Tareas Completadas | Completada |

Se conservan las variantes de nombres antiguos por compatibilidad con exportaciones previas.

La columna opcional "Tarea padre" permite importar la jerarquía de subtareas.

> **Nota técnica**: la librería SheetJS (~590 KB) se carga **dinámicamente** solo cuando el
> usuario importa un archivo, para no engordar el paquete inicial.

---

## 14. Seguridad

### Cadena de middlewares

El orden en que se montan es parte del contrato de seguridad:

```
helmet  →  CORS  →  X-API-Key  →  body parser  →  rate limits  →  sesión  →  routers
```

### Medidas implementadas

| Medida | Implementación |
|---|---|
| **Cabeceras HTTP** | `helmet()` |
| **CORS** | Origen restringido por `FRONTEND_URL`; obligatorio en producción |
| **Clave de API** | `X-API-Key` en todo `/api/*` |
| **Sesiones** | Cookie `httpOnly` + `secure` + `SameSite=Lax`, expiración a 7 días |
| **Contraseñas** | `scrypt` con sal única por usuario |
| **Inyección SQL** | Imposible por diseño: consultas del registro + parámetros tipados |
| **Límite de tasa** | Limitadores propios y más estrictos para IA y operaciones destructivas |
| **Límite de cuerpo** | 2 MB general; 14 MB solo en la ruta de adjuntos |
| **Fallo cerrado** | En producción el servidor **no arranca** sin `FRONTEND_URL` ni `API_KEY` |
| **Registro de seguridad** | Eventos de autenticación registrados |

### Por qué límites de cuerpo distintos

El analizador general se limita a 2 MB porque el resto de la API solo mueve JSON de
proyectos (unos 80 KB). La ruta de adjuntos necesita 14 MB (10 MB de archivo más la
sobrecarga de base64). La exclusión usa la ruta exacta y está cubierta por un test de
contrato, porque si esa ruta se montara bajo otro prefijo la exclusión dejaría de aplicar
en silencio y las subidas fallarían con error 413.

---

## 15. Cómo correr el proyecto

### Requisitos

- Node.js 18 o superior
- Acceso a SQL Server o Azure SQL *(opcional para desarrollo — sin él funciona solo con JSON)*

### Instalación

```bash
cd backend  && npm install
cd frontend && npm install
```

### Configuración

Copiar `backend/.env.example` a `backend/.env` y completar:

```bash
NODE_ENV=development
PORT=3002
FRONTEND_URL=http://localhost:5173   # obligatorio en producción
API_KEY=                              # obligatorio en producción

DB_SERVER=localhost
DB_USER=
DB_PASSWORD=
DB_NAME=

# Opcionales — sin ellas solo se desactivan las funciones de IA
GEMINI_API_KEY=
OPENROUTER_API_KEY=
GROQ_API_KEY=
```

> **Aviso sobre Azure SQL**: si la contraseña contiene `#`, debe ir entre comillas en el
> `.env`. La conexión requiere además `encrypt: true`.

### Desarrollo — dos terminales

```bash
# Terminal 1
cd backend && npm start          # Express en http://localhost:3002

# Terminal 2
cd frontend && npm run dev       # Vite en http://localhost:5173
```

### Migraciones y primer usuario

```bash
cd backend
npm run migrate                  # aplica las migraciones pendientes
node scripts/create-user.cjs     # crea el primer usuario
```

El primer administrador debe marcarse con un `UPDATE` directo sobre `Usuarios.EsAdmin`,
porque la pantalla de administración solo es accesible para un admin ya existente.

### Pruebas

```bash
cd frontend && npm test          # 306 tests
cd backend  && npm test          # 98 tests
```

### Compilación de producción

```bash
cd frontend && npm run build     # genera dist/
```

---

## 16. Mapa de archivos

### Frontend

```
frontend/src/
├── App.jsx                    Estado central y composición de vistas
├── appNav.js                  Navegación, pestañas por rol, KPIs
│
├── components/
│   ├── Dashboard.jsx              Tarjetas de proyecto
│   ├── EditView.jsx               Formulario completo
│   ├── GanttChart.jsx             Cronograma
│   ├── HierarchyTable.jsx         Tabla jerárquica
│   ├── ActivityDetailModal.jsx    Ficha de actividad
│   ├── EngineerHub.jsx            Vistas de ingeniero
│   ├── ReportesView.jsx           Consultas
│   ├── QuartersView.jsx           Trimestres
│   ├── UsersAdminView.jsx         Administración
│   ├── CommandPalette.jsx         Buscador Ctrl+K
│   │
│   ├── gantt/                 Ayudantes y ganchos del Gantt
│   ├── edit/                  Piezas de la vista de edición
│   ├── activity-detail/       Piezas de la ficha de actividad
│   ├── activity-form/         Secciones del formulario
│   ├── engineer/              Tablas de ingeniero
│   ├── director/              Vistas ejecutivas
│   ├── report/                Secciones del reporte
│   └── common/                DateInput (calendario dd/mm/aaaa)
│
├── utils/
│   ├── formulas.js            Punto de entrada agregador
│   ├── formulas/
│   │   ├── progress.js            Cálculo de avance
│   │   ├── activityHierarchy.js   Árbol y transiciones válidas
│   │   ├── activityModel.js       Estructuras por defecto
│   │   ├── businessDays.js        Días hábiles
│   │   ├── dateHelpers.js         Fechas
│   │   ├── engineerModel.js       Modelo de ingeniero
│   │   └── reportText.js          Generación de texto
│   │
│   ├── scheduling.js          Cascada jerárquica
│   ├── delayCascade.js        Cascada cronológica
│   ├── weekPlanning.js        Deducción de la semana
│   ├── plannerImport.js       Importación de Planner
│   ├── storage.js             Cliente de la API
│   ├── search.js              Búsqueda por texto
│   └── isoWeek.js             Semana ISO
│
├── hooks/                     useUrlState, useClickOutside
└── styles/                    Hojas de estilo por dominio
```

### Backend

```
backend/
├── server.cjs                 Composición de la aplicación Express
│
├── routes/                    Un router por dominio
│   ├── projects.routes.cjs        Guardado con control de versión
│   ├── auth.routes.cjs            Login / logout / sesión
│   ├── users.routes.cjs           Administración de usuarios
│   ├── ai.routes.cjs              Endpoints de IA
│   ├── attachments.routes.cjs     Adjuntos
│   ├── engineers.routes.cjs       Catálogos
│   ├── history.routes.cjs         Snapshots
│   ├── quarters.routes.cjs        Trimestres
│   ├── maintenance.routes.cjs     Restauración
│   └── diagnostics.routes.cjs     Diagnóstico
│
├── db/                        Repositorios por entidad
│   ├── pool.cjs                   Pool de conexiones
│   ├── projects.repo.cjs
│   ├── activity-detail.repo.cjs
│   ├── engineers.repo.cjs
│   ├── users.repo.cjs
│   ├── attachments.repo.cjs
│   ├── weekly-report.repo.cjs
│   └── recovery.repo.cjs
│
├── reports/
│   ├── query-registry.cjs         Consultas permitidas
│   ├── query-builder.cjs          Constructor validado
│   ├── export-excel.cjs           Generación Excel
│   ├── export-pdf.cjs             Generación PDF
│   └── saved-reports.cjs          Combinaciones guardadas
│
├── ai/
│   ├── providers.cjs              Clientes y cascada de relevo
│   ├── prompts.cjs                Plantillas de instrucciones
│   └── report-generator.cjs       Orquestación del informe
│
├── middleware/                api-key, session, rate-limits, error-handler
├── lib/                       bootstrap, json-store, migraciones legadas
├── migrations/                001 a 020
├── scripts/                   create-user, backfill-events
└── tests/                     98 tests
```

---

## 17. Glosario

| Término | Significado |
|---|---|
| **Actividad** | Unidad de trabajo dentro de un proyecto. Puede tener subtareas sin límite de profundidad |
| **Actividad archivada** | Desapareció de Planner. Oculta de listas y métricas, pero recuperable |
| **Actividad hoja** | Sin subtareas. Es la única que cuenta para las métricas de avance |
| **Ambiente Pruebas / Producción** | Estados del flujo de despliegue, solo para actividades de desarrollo |
| **Bloqueante** | Impedimento que detiene el trabajo. Se limpia al iniciar semana |
| **Cascada cronológica** | Motor que desplaza todas las actividades posteriores a una fecha |
| **Cascada jerárquica** | Motor que desplaza hermanas y extiende ancestros |
| **Depósito (bucket)** | Columna de Planner que se traduce a un estado de la aplicación |
| **Escritura dual** | Guardar en JSON y en SQL en paralelo |
| **`es_desarrollo`** | Marca que habilita el flujo de ambientes de despliegue |
| **Ficha (token) de filtro** | Elemento removible de la barra de filtros acumulativos del Gantt |
| **Semáforo** | Estado del proyecto: En curso / En riesgo / Bloqueado |
| **Situación** | Posición de una actividad dentro de una semana: En demora, Vence, Inicia, Continúa |
| **Snapshot** | Fotografía del estado de todos los proyectos en una semana dada |
| **`task_status`** | Objeto con los cinco grupos de estado y su historial |
| **Versión optimista** | Contador que detecta ediciones simultáneas del mismo proyecto |

---

*Documento generado a partir de una auditoría directa del código fuente.*
*Para el detalle de decisiones de refactorización, ver `PLAN_REFACTORIZACION.md`.*
*Para infraestructura y despliegue, ver `INFRAESTRUCTURA_Y_DESPLIEGUE.md`.*
