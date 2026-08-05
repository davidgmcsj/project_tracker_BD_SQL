# Documentación del Sistema de Seguimiento Semanal de Proyectos

**Institución:** Corte Suprema de Justicia — Oficina de Tecnología  
**Versión del documento:** 4 de agosto de 2026  
**Elaborado a partir de:** análisis completo del código fuente (frontend React + backend Node.js + Azure SQL)

---

## Tabla de contenido

1. [Resumen ejecutivo](#1-resumen-ejecutivo)
2. [Módulos y vistas del sistema](#2-módulos-y-vistas-del-sistema)
3. [Estructura de datos](#3-estructura-de-datos)
4. [Flujos principales](#4-flujos-principales)
5. [Funcionalidades detalladas por módulo](#5-funcionalidades-detalladas-por-módulo)
6. [Persistencia y base de datos](#6-persistencia-y-base-de-datos)
7. [Integraciones de inteligencia artificial](#7-integraciones-de-inteligencia-artificial)
8. [Glosario](#8-glosario)

---

## 1. Resumen ejecutivo

### ¿Qué es este sistema?

El **Sistema de Seguimiento Semanal de Proyectos** es una aplicación web desarrollada internamente por la Oficina de Tecnología de la Corte Suprema de Justicia. Permite registrar, monitorear y reportar el avance de los proyectos tecnológicos que gestiona el equipo de ingenieros de la oficina.

### ¿Para qué sirve?

- Centraliza en un único lugar el estado de todos los proyectos activos, con sus actividades, responsables, métricas de avance, impedimentos y planes semanales.
- Genera automáticamente reportes de texto estructurado (para compartir por correo o mensajería) y reportes de gestión en formato Word (.docx) asistidos por inteligencia artificial.
- Mantiene un historial semanal y trimestral de cada proyecto, permitiendo consultar el estado de cualquier periodo anterior.
- Facilita la asignación de actividades a los ingenieros del equipo y a colaboradores externos.
- Importa el plan de tareas directamente desde el Excel exportado de Microsoft Planner, sin perder el trabajo hecho a mano en la app.
- Visualiza la planificación de cada proyecto como una línea de tiempo (diagrama de Gantt) y como reporte consolidado por ingeniero.

### ¿Quiénes lo usan?

El sistema está dirigido al **líder o coordinador de la Oficina de Tecnología**, que actúa como único editor y administrador. No tiene múltiples roles de acceso: la persona que opera la aplicación tiene acceso completo a todas las funciones.

### Arquitectura general

El sistema es una **SPA (Single Page Application)** construida con:

- **Frontend:** React (Vite), que corre en el navegador del usuario.
- **Backend:** Node.js con Express, que expone una API REST y gestiona la escritura en los archivos de datos.
- **Base de datos:** Azure SQL Server (Microsoft SQL Server), usada como respaldo estructurado y para trazabilidad histórica.
- **Despliegue:** Azure App Service (Linux), con el frontend servido como archivos estáticos y el backend como proceso Node.js.
- **Seguridad de la API:** todas las rutas `/api/*` exigen una clave compartida (`X-API-Key`), y las operaciones más sensibles (IA y trimestre) tienen límites de frecuencia de uso (ver sección 6.4).

---

## 2. Módulos y vistas del sistema

El sistema tiene **seis** vistas principales accesibles desde la barra de navegación superior:

| Vista | Nombre en la UI | Propósito |
|-------|----------------|-----------|
| `dashboard` | Dashboard | Vista general de todos los proyectos en tarjetas |
| `edit` | Editar | Formulario detallado de edición de un proyecto |
| `report` | Reporte | Generación y previsualización del reporte semanal |
| `engineers` | Ingenieros | Catálogo del equipo y detalle de actividades por persona |
| `engineer-report` | Rep. Ingenieros | Reporte consolidado de un ingeniero: sus actividades en todos los proyectos + sus tareas adicionales |
| `quarters` | Trimestres | Consulta del histórico de trimestres archivados y administración del cierre trimestral |

### 2.1 Dashboard

Vista de inicio del sistema. Muestra una cuadrícula con una tarjeta por cada proyecto registrado. En la parte superior presenta:

- Un **anillo de progreso** con el avance promedio global (porcentaje).
- Cuatro **tarjetas de estadísticas**: actividades completadas, en proceso, no iniciadas y número total de proyectos.
- Una **tabla de métricas globales** con los totales consolidados de todos los proyectos.
- Botones de **análisis con IA** (Status Ejecutivo y Análisis Completo).
- Un **buscador de proyectos** por nombre.

> Nota de cambio reciente: la barra de acciones de trimestre (Nuevo trimestre / Limpiar estadísticas) que antes vivía en el Dashboard **se trasladó a la vista Trimestres** (sección 2.6), por ser una operación de mantenimiento periódico y no de uso diario.

### 2.2 Editar

Formulario completo de un proyecto individual. Se accede haciendo clic en cualquier tarjeta del Dashboard. Incluye todos los campos editables del proyecto: nombre, estado, métricas, actividades, ingenieros asignados, impedimentos, plan semanal, indicadores y más. También contiene el tablero Kanban de estado de actividades, la línea de tiempo (Gantt) del proyecto, el panel de asignación masiva de responsables y la importación de actividades desde Planner.

### 2.3 Reporte

Vista de solo lectura que genera el texto del reporte semanal. Puede mostrar el reporte completo de todos los proyectos (con filtros y ordenamiento) o el reporte individual de un proyecto seleccionado desde el Dashboard. Permite copiar el texto al portapapeles o generar un documento Word (.docx) con análisis de IA.

### 2.4 Ingenieros

Catálogo del equipo de ingenieros. Muestra una tarjeta por persona con su nombre, cargo, estado (activo/inactivo) y un resumen de proyectos vinculados. Al hacer clic en un ingeniero se entra al **panel de detalle**, que muestra todas las actividades que tiene asignadas organizadas por proyecto, con sus fechas de registro, inicio en proceso y completado. También gestiona tareas adicionales del ingeniero que no están vinculadas a ningún proyecto específico, ahora con el mismo nivel de detalle que una actividad de proyecto (objetivos, solución, checklist, fechas clave, notas, horas planeadas).

### 2.5 Rep. Ingenieros (nueva)

Vista dedicada a generar un reporte consolidado por ingeniero, pensada como insumo para reuniones de seguimiento y para el informe trimestral. Se documenta en detalle en la sección 5.8.

### 2.6 Trimestres

Vista de consulta histórica **y de administración del cierre de trimestre**. Lista todos los trimestres que han sido archivados mediante el proceso de reinicio trimestral, y en la parte superior de la lista incluye la barra de trimestre activo (antes ubicada en el Dashboard) con las acciones "Nuevo trimestre" y "Limpiar estadísticas". Al seleccionar un trimestre archivado se pueden ver todos los proyectos y sus actividades tal como estaban al momento del cierre, con un buscador de texto para filtrar por actividad o nombre de proyecto.

---

## 3. Estructura de datos

### 3.1 Proyecto

La entidad central del sistema. Cada proyecto tiene los siguientes campos:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único generado al crear el proyecto (formato `base36 + random`). Nunca cambia. |
| `project_name` | string | Nombre del proyecto. |
| `status` | string | Estado general: `on-track` (En curso), `at-risk` (En riesgo), `blocked` (Bloqueado), `completed` (Completado), `mejora-continua` (Mejora Continua). |
| `priority` | boolean | Marca de "proyecto prioritario" (★). Se usa para resaltar el proyecto en el Dashboard y para el filtro "Solo prioritarios" de la vista Reporte. |
| `planner_url` | string | URL opcional al tablero de Microsoft Planner del proyecto. |
| `report_date` | string | Fecha del reporte activo (formato `YYYY-MM-DD`). Se actualiza al cambiar de semana. |
| `show_closing_fields` | boolean | Controla si se muestran los campos de cierre semanal (logros y plan) en el reporte. |
| `status_notes` | string | Notas libres sobre el estado actual del proyecto. Campo de texto largo, visible solo en modo edición. |
| `manual_metrics` | objeto | Métricas de avance del proyecto (ver detalle abajo). |
| `activities_identified` | array | Lista de actividades identificadas (ver entidad Actividad). |
| `task_status` | objeto | Clasificación de actividades por estado (completadas, en proceso, no iniciadas) con historial de fechas. |
| `weekly_achievements` | array de IDs | IDs de actividades que se completaron durante la semana actual. Se limpia al iniciar nueva semana. |
| `next_week_plan` | array de IDs | IDs de actividades planificadas para la semana siguiente. Se limpia al iniciar nueva semana. |
| `engineers` | array | Ingenieros asignados al proyecto con sus métricas (ver entidad Ingeniero en Proyecto). |
| `indicators` | array | Indicadores de desempeño del proyecto (ver entidad Indicador). |
| `impediments` | array | Impedimentos activos: bloqueantes, riesgos, salidas no conformes (ver entidad Impedimento). |

#### Sub-objeto: `manual_metrics`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `total_tasks` | número | Total de actividades identificadas en el proyecto. |
| `completed_tasks` | número | Cantidad de actividades completadas. |
| `in_progress_tasks` | número | Cantidad de actividades en proceso. |
| `shared_tasks_discount` | número | Descuento por tareas compartidas entre ingenieros (evita doble conteo). |

**Fórmula de avance:** `(completadas + en_proceso × 0.5) / total × 100`  
Las tareas en proceso cuentan como 0.5 porque están iniciadas pero no terminadas.

#### Sub-objeto: `task_status`

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `completed` | array de IDs | IDs de actividades marcadas como completadas. |
| `in_progress` | array de IDs | IDs de actividades marcadas como en proceso. |
| `not_started` | array de IDs | IDs de actividades marcadas como no iniciadas. |
| `completed_dates` | objeto `{actId: fecha}` | Fecha en que cada actividad fue marcada como completada (para filtros semanales). |
| `status_history` | objeto `{actId: {added, in_progress, completed}}` | Fechas de cada transición de estado por actividad. **Ahora son editables a mano** desde el Modal de Detalle de Actividad (útil cuando la fecha real no coincide con la fecha del cambio de estado en la app, por ejemplo al importar de Planner). |
| `completed_by` | objeto `{actId: [{engineer_id, engineer_name}]}` | Quién completó cada actividad (uno o varios ingenieros). |

---

### 3.2 Actividad

Cada elemento de `activities_identified` dentro de un proyecto:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único estable (formato `act_xxx`). Nunca cambia aunque se edite el texto. |
| `text` | string | Descripción de la actividad. |
| `assigned_engineers` | array | Lista de responsables asignados: `[{id, name}]`. Puede incluir ingenieros internos (prefijo `eng_`) y externos (prefijo `ext_`). |
| `assigned_date` | string | Fecha en que se asignó el primer responsable (formato `YYYY-MM-DD`). |
| `start_date` | string | Fecha de inicio planificada (formato `YYYY-MM-DD`). |
| `due_date` | string | Fecha de vencimiento planificada (formato `YYYY-MM-DD`). |
| `description` | string | Descripción detallada de la actividad. |
| `objectives` | string | **(migración 008)** Objetivos de la actividad: qué se busca cumplir con ella. |
| `solution` | string | **(migración 005)** Solución aplicada o propuesta para la actividad. |
| `progress` | número | **(migración 006)** % de cumplimiento manual (0-100), independiente del estado (completada/en proceso/no iniciada). Se puede ajustar manualmente o adoptar la sugerencia calculada según el checklist. |
| `planned_hours` | número | **(migración 006)** Horas planeadas para la actividad. Editable manualmente; el sistema sugiere un valor calculado como días hábiles (sin fines de semana ni festivos colombianos) entre `start_date` y `due_date`, multiplicado por 8 horas/día. |
| `checklist` | array | Sub-actividades con estado de completado: `[{id, text, done}]`. Reordenables por arrastre o por botones ▲▼. |
| `notes` | array | Notas fechadas asociadas a la actividad: `[{id, date, text}]`. |
| `key_dates` | array | Fechas clave o hitos de la actividad: `[{id, date, label}]`. |
| `attachments` | array | **(migración 007)** Metadata de archivos adjuntos: `[{id, filename, mime, size, uploaded_at}]`. El contenido binario del archivo se guarda solo en Azure SQL (tabla `Actividad_Adjuntos`); en el JSON del proyecto solo vive la metadata. Límite de 10 MB por archivo. |
| `planner_task_number` | string o null | Número de tarea de Microsoft Planner. Es la clave estable que usa la importación de Planner para reconocer si una fila del Excel corresponde a una actividad ya existente o es nueva. `null` si la actividad se creó a mano en la app. |
| `archived` | boolean | `true` si la actividad desapareció del tablero de Planner en una importación posterior. No se borra: queda oculta de listas, métricas y reportes, pero recuperable. |
| `archived_reason` | string | Motivo del archivado (por ejemplo, la fecha de la importación que la retiró). |

**Campo eliminado:** `priority` (Alta/Media/Baja) **ya NO existe a nivel de actividad** — fue retirado del modelo de datos y de la base SQL (ver migración 009). El campo `priority` que sí sigue existiendo es el de **proyecto** (marca de prioritario ★, sección 3.1), un concepto distinto y no relacionado.

**Principio de diseño:** Los IDs de actividad son estables y sirven como referencia en `task_status`, `weekly_achievements`, `next_week_plan` y en las estadísticas de ingenieros. Reordenar o eliminar actividades no rompe las referencias de las demás.

---

### 3.3 Ingeniero en Proyecto

Cada elemento del array `engineers` dentro de un proyecto (distinto del catálogo global de ingenieros):

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `engineer_id` | string | ID del ingeniero en el catálogo global (prefijo `eng_`). |
| `assigned` | número | Total de actividades asignadas a este ingeniero en el proyecto. |
| `completed` | número | Total de actividades completadas por este ingeniero en el proyecto. |
| `in_progress` | número | Total de actividades en proceso del ingeniero en el proyecto. |
| `weekly_total` | número | Cantidad de actividades trabajadas por el ingeniero en la semana actual. Se resetea cada semana. |
| `weekly_detail` | array de IDs | IDs de las actividades específicas trabajadas en la semana actual. Se resetea cada semana. |

---

### 3.4 Ingeniero (Catálogo Global)

Entidad que vive en el catálogo global `engineers` (no dentro de ningún proyecto):

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único estable (formato `eng_xxx`). |
| `name` | string | Nombre completo del ingeniero. |
| `role` | string | Cargo o rol (ej: "Desarrollador Senior"). |
| `active` | boolean | Si está activo, aparece en los dropdowns de asignación. Si está inactivo, se oculta pero sus referencias históricas se conservan. |
| `created_at` | string | Fecha de creación en el catálogo. |
| `tasks` | array | Tareas adicionales no asociadas a ningún proyecto (ver entidad Tarea Adicional, 3.4.1). |
| `sql_id` | número | ID correspondiente en la tabla `Ingenieros` de Azure SQL. Se asigna automáticamente al sincronizar. |

#### 3.4.1 Tarea Adicional del Ingeniero (modelo "rico", desde migración 011)

Cada elemento del array `tasks` de un ingeniero. Antes era un objeto simple (`{id, description, status, date}`); ahora tiene el mismo nivel de detalle que una Actividad de proyecto:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador estable (formato `etask_xxx`). |
| `description` | string | Descripción de la tarea (equivalente al `text` de una actividad). |
| `status` | string | `not_started`, `in_progress` o `completed`. |
| `date` | string | Fecha de creación/inscripción (se conserva por compatibilidad con tareas antiguas). |
| `history` | objeto `{added, in_progress, completed}` | Fechas de transición de estado, análogas a `task_status.status_history` de las actividades de proyecto. Se auto-registran al cambiar el estado y también son editables a mano. |
| `detail` | string | Descripción detallada (campo "Descripción" en el modal). |
| `objectives` | string | Objetivos de la tarea. |
| `solution` | string | Solución o resultado obtenido. |
| `start_date` / `due_date` | string | Fechas de plan (`YYYY-MM-DD`). |
| `progress` | número | % de cumplimiento manual (0-100). |
| `planned_hours` | número | Horas planeadas, con la misma sugerencia automática por días hábiles que las actividades de proyecto. |
| `checklist` | array | Subactividades `[{id, text, done}]`. |
| `notes` | array | Notas fechadas `[{id, date, text}]`. |
| `key_dates` | array | Fechas clave `[{id, date, label}]`. |

Se edita desde el **Modal de Tarea de Ingeniero** (`EngineerTaskModal`, ver sección 5.5.1).

---

### 3.5 Colaborador Externo

Personas externas a la oficina que pueden ser asignadas a actividades:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único estable (formato `ext_xxx`). |
| `name` | string | Nombre completo del colaborador. |
| `company` | string | Empresa o entidad de la que proviene. |
| `active` | boolean | Si está activo, aparece en los dropdowns de asignación. |
| `created_at` | string | Fecha de creación. |
| `sql_id` | número | ID correspondiente en la tabla `Colaboradores_Externos` de Azure SQL. |

---

### 3.6 Indicador de Desempeño

Cada elemento del array `indicators` dentro de un proyecto:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `name` | string | Nombre del indicador (ej: "Implementación de módulos"). |
| `total` | número | Total de elementos del indicador. |
| `completed` | número | Elementos completados. |
| `in_progress` | número | Elementos en proceso. |

El porcentaje de avance del indicador se calcula con la misma fórmula que el avance de proyecto.

---

### 3.7 Impedimento

Cada elemento del array `impediments` dentro de un proyecto:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `category` | string | Tipo: `blocker` (Bloqueante), `risk` (Riesgo), `non_conformity` (Salida no conforme). |
| `description` | string | Descripción del impedimento. |
| `impact` | string | Descripción del impacto (solo para bloqueantes y riesgos). |

Los bloqueantes se eliminan automáticamente al iniciar una nueva semana. Los riesgos y salidas no conformes persisten.

---

### 3.8 Trimestre Archivado

Snapshot completo guardado al cierre de un trimestre:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `quarterLabel` | string | Etiqueta del trimestre que se cierra (ej: "Q2 2026"). |
| `archivedAt` | string | Timestamp ISO del momento del archivo. |
| `projects` | array | Copia completa de todos los proyectos al momento del reset. |
| `engineers` | array | Copia del catálogo de ingenieros al momento del reset. |
| `externalContacts` | array | Copia del catálogo de externos al momento del reset. |
| `weekLabel` | string | Etiqueta de la última semana del trimestre. |

---

### 3.9 Adjunto de Actividad (nuevo)

Metadata que vive en `activity.attachments`. El archivo en sí (bytes) se guarda únicamente en la tabla SQL `Actividad_Adjuntos`.

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador estable (formato `att_xxx`). |
| `filename` | string | Nombre original del archivo. |
| `mime` | string | Tipo MIME del archivo. |
| `size` | número | Tamaño en bytes. |
| `uploaded_at` | string | Timestamp ISO de la subida. |

---

## 4. Flujos principales

### 4.1 Ciclo semanal

El ciclo de trabajo semanal sigue este patrón:

```
LUNES — VIERNES (semana activa)
 │
 ├── El coordinador abre la app
 ├── Edita el estado de las actividades en los proyectos (Editar)
 ├── Registra logros de la semana y plan para la siguiente
 ├── Actualiza métricas e impedimentos
 ├── Registra actividades semanales por ingeniero
 │
VIERNES (cierre de semana)
 │
 ├── Guarda un snapshot haciendo clic en "Guardar reporte" (cabecera)
 │    └── POST /api/report → escribe en history.json y en Azure SQL
 │
SIGUIENTE SEMANA (lunes o cuando corresponda)
 │
 ├── El coordinador hace clic en "↻ Nueva semana"
 │    ├── Se confirma el cambio (ventana de diálogo)
 │    ├── Se guarda un snapshot automático (saveWeekReport)
 │    └── Se limpian los campos semanales de todos los proyectos:
 │         • weekly_achievements → []
 │         • next_week_plan → []
 │         • Bloqueantes (impediments con category = "blocker") → eliminados
 │         • weekly_total y weekly_detail de cada ingeniero → 0 / []
 │         • show_closing_fields → false
 │         • report_date → próximo viernes
```

### 4.2 Cómo se asignan actividades

Existen tres mecanismos para asignar responsables a actividades:

**Asignación individual (por actividad):**
1. En la vista Editar, en la lista de Actividades Identificadas, cada actividad tiene un dropdown de asignación.
2. Se selecciona un ingeniero del equipo interno o un colaborador externo.
3. Pueden asignarse múltiples responsables por actividad (chips).
4. Al completar la actividad, el sistema registra automáticamente quién la completó en `task_status.completed_by`.

**Asignación masiva (panel colapsable en Editar):**
1. Se expande el panel "Asignación Masiva de Responsables".
2. Se selecciona un ingeniero o externo en el dropdown.
3. Se marcan varias actividades con checkboxes (con filtros de búsqueda y "solo sin responsable").
4. Se hace clic en "Asignar N actividades → [Nombre]".
5. El sistema asigna el ingeniero seleccionado a todas las actividades marcadas de una sola vez.

**Asignación al crear la actividad:**
Al agregar una nueva actividad desde el campo de texto, se puede seleccionar inmediatamente un responsable y el estado inicial.

### 4.3 Cómo funciona el reset trimestral

El reset trimestral es una operación irreversible que cierra el trimestre en curso e inicia uno nuevo. Se ejecuta ahora desde la vista **Trimestres** (antes desde el Dashboard). El flujo incluye una doble confirmación para evitar ejecuciones accidentales:

```
PASO 1 — Información previa
 │  El modal muestra cuántas actividades se archivarán (completadas)
 │  y cuántas continúan (en proceso + no iniciadas).
 │  Botones: Cancelar | Sí, entiendo — continuar
 │
PASO 2 — Confirmación de texto
 │  El usuario debe escribir exactamente "NUEVO TRIMESTRE"
 │  para habilitar el botón de confirmación final.
 │
PASO 3 — Ejecución (bloqueante, con spinner)
 │  El backend ejecuta en orden:
 │   1. Calcula estadísticas finales del trimestre.
 │   2. Guarda snapshot JSON en backend/archive/quarter_Q#_YYYY.json
 │   3. Guarda snapshot en tabla SQL Trimestres_Archivo.
 │   4. Construye el nuevo estado limpio:
 │       - Conserva solo actividades NO completadas (en proceso + no iniciadas)
 │       - task_status.completed → vacío
 │       - manual_metrics recalculadas desde cero
 │       - engineers[].assigned/completed/in_progress/weekly_total → 0
 │       - weekly_achievements, next_week_plan, impediments → vacíos
 │       - Checklist, notas y fechas clave de las actividades → se conservan
 │   5. Sobreescribe data.json con el nuevo estado limpio.
 │
PASO 4 — Resultado
 │  El modal muestra resumen: actividades archivadas, transferidas, proyectos.
 │  La app recarga automáticamente el estado limpio desde el servidor.
```

También existe la opción **"Limpiar estadísticas"** (mismo lugar), que reinicia las estadísticas del trimestre en curso (estado, indicadores, logros, plan, impedimentos, actividades completadas, estadísticas semanales de ingenieros) **sin archivar** nada, conservando las actividades en proceso y no iniciadas con su detalle.

### 4.4 Estrategia de persistencia (escritura dual)

El sistema usa un patrón de **escritura dual** para garantizar que no se pierden datos:

1. **localStorage del navegador** actúa como caché inmediata. Toda operación de guardado escribe en localStorage primero, de forma síncrona.
2. **El servidor Node.js** recibe la misma escritura de forma asíncrona. Si falla, el error se silencia y el dato queda protegido en localStorage.
3. **Azure SQL Server** recibe los datos en segundo plano (fire-and-forget). Si SQL falla, hay un reintento automático a los 5 segundos. Si vuelve a fallar, el dato queda en el JSON del servidor como respaldo.

En caso de pérdida de datos, el botón **"Restaurar respaldo"** de la cabecera consulta directamente a Azure SQL y sobreescribe el estado local con la última versión guardada en la base de datos.

Excepción a la regla: los **adjuntos de actividad** (sección 3.9) no siguen este patrón — sus bytes se guardan directamente en Azure SQL y no tienen respaldo en `data.json` ni en localStorage; solo la metadata queda en el JSON del proyecto.

### 4.5 Importación de Excel de Planner (nuevo)

El sistema puede importar el plan de tareas exportado desde Microsoft Planner (.xlsx) directamente hacia las actividades de un proyecto, sin sobrescribir el trabajo hecho a mano en la app. Se detalla en la sección 5.4.

---

## 5. Funcionalidades detalladas por módulo

### 5.1 Cabecera global (siempre visible)

- **Selector de fecha del reporte:** Cambia la fecha del reporte activo. Si la nueva fecha es de la misma semana, solo actualiza el dato. Si es de una semana diferente, advierte que se limpiarán los campos semanales.
- **Guardar reporte:** Guarda un snapshot del estado actual en el historial (history.json + SQL).
- **Navegación entre vistas:** Pestañas Dashboard, Editar, Reporte, Ingenieros, Rep. Ingenieros, Trimestres.
- **Alternar modo claro/oscuro.**
- **Nueva semana:** Inicia el ciclo de la semana siguiente, limpiando campos semanales y guardando el historial.
- **Restaurar respaldo:** Recupera el último estado guardado en Azure SQL, sobrescribiendo el estado local.

### 5.2 Dashboard

- **Anillo de progreso global:** Muestra el porcentaje de avance promedio de todos los proyectos incluidos en el cálculo.
- **Tarjetas de estadísticas:** Completadas, En proceso, No iniciados, Proyectos totales.
- **Tabla de métricas globales:** Resumen consolidado por proyecto con porcentajes de avance, totales y estados.
- **Buscador de proyectos** por nombre.
- **Toggle "Incluir en promedio":** Cada tarjeta tiene un checkbox para excluir proyectos del cálculo del promedio global (útil para proyectos de mejora continua o suspendidos).
- **Status Ejecutivo (IA):** Genera un párrafo ejecutivo resumido con el estado global de todos los proyectos activos.
- **Análisis Completo (IA):** Genera un análisis estructurado con resumen ejecutivo, proyectos destacados, alertas y próximos pasos.
- **Copiar análisis:** Botón para copiar el texto del análisis al portapapeles.
- **Por cada tarjeta de proyecto:**
  - Ver reporte individual del proyecto.
  - Copiar reporte del proyecto al portapapeles.
  - Generar Informe de Gestión (.docx) con IA.
  - Copiar asignaciones por ingeniero.
  - Marcar/desmarcar como proyecto prioritario (★).

> Las acciones de trimestre (Nuevo trimestre / Limpiar estadísticas) ya no están en el Dashboard: se movieron a la vista Trimestres (sección 5.7).

### 5.3 Editar

Es la vista más completa del sistema. Tiene dos paneles: un sidebar con la lista de proyectos y el formulario del proyecto seleccionado.

**Sidebar de proyectos:**
- Lista todos los proyectos con nombre y estado.
- Permite reordenar por arrastrar y soltar (drag & drop).
- Botones para agregar, ver reporte o exportar reporte de cada proyecto.

**Formulario del proyecto (campos editables):**
- Nombre del proyecto.
- Estado (En curso, En riesgo, Bloqueado, Completado, Mejora Continua).
- Marca de proyecto prioritario (★).
- URL de Planner.
- Métricas manuales: total, completadas, en proceso, descuento por compartidas.
- Estado actual del proyecto (campo de texto largo con modo lectura/edición).
- Actividades identificadas con asignación de responsables, estado, e importación desde Planner.
- Tablero Kanban de estado de actividades (tres columnas: Completadas, En proceso, No iniciadas).
- Línea de tiempo (Gantt) de las actividades con fechas (sección 5.4.1).
- Panel de asignación masiva de responsables.
- Ingenieros del proyecto: estadísticas globales y actividades de la semana.
- Indicadores de desempeño.
- Impedimentos: bloqueantes, riesgos, salidas no conformes.
- Logros de la semana (selector de actividades con búsqueda).
- Plan para la próxima semana (selector de actividades con búsqueda).
- Eliminación del proyecto (con doble confirmación modal).

**Tablero Kanban de actividades:**
- Muestra actividades sin clasificar en un panel superior y luego tres columnas de estado.
- Cada tarjeta de actividad muestra: nombre, fechas de inicio y fin, días restantes o alerta de demora, responsables asignados. (El campo de prioridad Alta/Media/Baja ya no existe — ver sección 3.2).
- Las actividades se pueden mover entre columnas con botones o arrastrando.
- Al hacer clic en una actividad se abre el **Modal de Detalle de Actividad**.

**Lista de Actividades Identificadas — selección múltiple (nuevo):**
- Cada fila de la lista tiene un checkbox de selección.
- Una barra de acciones por lotes permite "Seleccionar todo" (con estado indeterminado cuando la selección es parcial) y, si hay actividades marcadas, "Limpiar" selección o "Eliminar N seleccionada(s)".
- El borrado por lotes pide confirmación explícita en un diálogo modal ("¿Eliminar N actividad(es)?") antes de aplicarse; es irreversible.
- La selección se guarda por ID de actividad (no por índice), así que no se desalinea si la lista cambia mientras hay elementos marcados.

### 5.4 Modal de Detalle de Actividad

Modal de edición profunda de una actividad individual (`ActivityDetailModal.jsx`). Se accede haciendo clic en una actividad del tablero Kanban o de la línea de tiempo (Gantt).

Campos editables en el modal:
- **Nombre de la actividad** (textarea auto-expandible).
- **Fecha de inicio** y **Fecha de fin**.
- **% Cumplimiento:** control deslizante (0-100) más campo numérico. Si la actividad tiene un checklist, el modal sugiere el % calculado según los ítems marcados ("usar X% (checklist)"), con un enlace para aplicarlo.
- **Horas planeadas:** selector (0, 0.5 y de 1 en 1 hasta 40). El sistema sugiere automáticamente las horas según los días hábiles entre fecha de inicio y fin (excluyendo fines de semana y festivos colombianos), con un enlace "usar Xh (Y días háb.)".
- **Responsables:** muestra chips de los asignados, permite agregar (ingenieros internos o externos) o quitar.
- **Objetivos:** texto libre — qué se busca cumplir con la actividad.
- **Descripción:** texto libre detallado.
- **Solución:** texto libre — solución aplicada o propuesta.
- **Subactividades (Checklist):** lista de pasos con checkbox de completado, reordenable por arrastre o por botones ▲▼. Muestra barra de progreso (X/Y).
- **Fechas clave:** hitos con fecha y etiqueta.
- **Notas:** anotaciones fechadas.
- **Adjuntos:** subir uno o varios archivos (máx. 10 MB c/u), descargarlos o eliminarlos. Los adjuntos se guardan/eliminan en SQL de inmediato (no esperan al botón "Guardar" del resto del formulario), para que su metadata no se pierda si el usuario descarta otros cambios.
- **Fechas de transición (Inscrita / En proceso / Completada):** ahora son **editables** con selector de fecha, no solo de solo-lectura. Esto permite registrar la fecha real de cada hito cuando no coincide con la fecha del cambio de estado en la app (por ejemplo, al importar actividades históricas desde Planner).

Comportamiento:
- Detecta cambios sin guardar y muestra badge "Sin guardar".
- Al cerrar (✕, tecla Escape o clic fuera) con cambios pendientes, pregunta si descartar, guardar y cerrar, o seguir editando.
- El botón de eliminar actividad requiere confirmación adicional dentro del propio modal.

Las secciones de Checklist, Fechas clave, Notas y las fechas de transición están implementadas como componentes reutilizables (`ActivityFormSections.jsx`: `ChecklistSection`, `KeyDatesSection`, `NotesSection`, `DateBadgesSection`), compartidos entre el Modal de Detalle de Actividad y el Modal de Tarea de Ingeniero (sección 5.5.1).

#### 5.4.1 Línea de tiempo (Gantt)

Diagrama de Gantt de las actividades del proyecto que tienen al menos una fecha (`GanttChart.jsx`), visible en la vista Editar debajo del tablero Kanban.

- **Zoom** en tres niveles: Mes, Semana, Día (cambia el ancho en píxeles por día de la escala).
- Cada fila muestra el número y nombre de la actividad, y una barra cuya posición y ancho representan el rango `start_date`–`due_date`. El relleno interno de la barra indica el % de cumplimiento (`progress`).
- Línea vertical que marca el día de "Hoy".
- Las actividades **completadas se ocultan por defecto** de la línea de tiempo; un toggle "Mostrar completadas (N)" las revela.
- Clic en una barra abre el Modal de Detalle de esa actividad.
- Si ninguna actividad tiene fechas, muestra un mensaje orientador en vez del diagrama vacío.

### 5.5 Ingenieros

**Vista de catálogo:**
- Buscador por nombre.
- Tarjeta por ingeniero: nombre, cargo, estado (activo/inactivo), tabla de proyectos vinculados con actividades de la semana y total asignadas.
- Botones: Editar nombre/cargo, Activar/Desactivar.
- Botón para agregar nuevo ingeniero con nombre y cargo.

**Vista de detalle de ingeniero:**
- Nombre, cargo, estado.
- Tabla resumen de proyectos vinculados.
- Por cada proyecto: tabla de actividades asignadas al ingeniero con estado y fechas de inscripción, inicio en proceso y completado.
- Sección de tareas adicionales: tareas no asociadas a proyectos, ahora editables con el mismo detalle que una actividad de proyecto (ver 5.5.1).

#### 5.5.1 Modal de Tarea de Ingeniero (nuevo)

`EngineerTaskModal.jsx` — análogo al Modal de Detalle de Actividad, pero para una tarea adicional del ingeniero (no asociada a proyecto). Reutiliza las mismas secciones (`ChecklistSection`, `KeyDatesSection`, `NotesSection`, `DateBadgesSection`).

Campos editables:
- Estado (No iniciada / En proceso / Completada) — al cambiarlo, se auto-registran las fechas de transición correspondientes en `history`.
- Fecha inicio / Fecha fin.
- % Cumplimiento y Horas planeadas (con la misma sugerencia automática por días hábiles que las actividades de proyecto).
- Objetivos, Descripción y Solución/Resultado (tres campos de texto libre).
- Subactividades (checklist), Fechas clave y Notas.

Igual que el modal de actividad, detecta cambios sin guardar y pide confirmación al cerrar; el botón de eliminar pide confirmación inline en el pie del modal.

### 5.6 Reporte

- Muestra el reporte de todos los proyectos o de un proyecto específico.
- El reporte incluye: resumen global, métricas por proyecto, estado de actividades, impedimentos, logros y plan de la semana, indicadores.
- Botón para copiar todo el reporte al portapapeles.
- Por proyecto: botón para generar Informe de Gestión (.docx) con IA.

**Filtros del reporte consolidado (nuevo):**
- Buscar proyecto por nombre.
- Filtrar por proyecto específico.
- Filtrar por estado.
- Filtrar por ingeniero (muestra solo proyectos donde ese ingeniero participa).
- Filtro **"Solo prioritarios"** (★): muestra únicamente los proyectos marcados como prioritarios.
- Ordenar por número de proyecto o por % de avance (ascendente).
- Contador "Mostrando X de Y" y botón "Limpiar" filtros cuando hay alguno activo.
- Copiar reporte y Resumen Global respetan los filtros aplicados.

### 5.7 Trimestres

**Barra de trimestre activo (trasladada desde el Dashboard):**
- Muestra el trimestre en curso con botones "🗂 Nuevo trimestre" y "🧹 Limpiar estadísticas" (ver flujo en sección 4.3).

**Vista de lista:**
- Lista de trimestres archivados ordenados del más reciente al más antiguo.
- Por cada trimestre: etiqueta (ej: Q2 2026), fecha de cierre, número de proyectos, actividades archivadas y transferidas.

**Vista de detalle de trimestre:**
- Modo solo lectura — no se pueden editar datos históricos.
- Lista de proyectos del trimestre con contador de actividades completadas, en proceso y no iniciadas.
- Al expandir un proyecto: lista de actividades con estado, fechas, checklist, notas y fechas clave.
- Buscador de texto que filtra actividades y proyectos en tiempo real.

### 5.8 Rep. Ingenieros (nuevo)

`EngineerReportView.jsx` — vista dedicada al reporte consolidado de un ingeniero, distinta del panel de detalle dentro de "Ingenieros" (aunque muestra información similar, aquí el foco es generar un texto de reporte listo para copiar).

- Selector desplegable para elegir el ingeniero (solo activos).
- **Encabezado ("hero") del ingeniero:** avatar con iniciales y color estable derivado del nombre, nombre, cargo, estado (Activo/Inactivo), barra de carga de trabajo (completadas/total) y tres insignias: completadas, en curso, pendientes.
- **Actividades por proyecto:** una tabla por cada proyecto donde el ingeniero tiene actividades asignadas, con columnas Nº, Actividad, Estado, y las tres fechas de transición (Inscrita, En proceso, Completada).
- **Tareas adicionales:** tabla con descripción, estado, % de avance y las tres fechas de transición.
- **Botón "Copiar reporte":** genera un texto plano estructurado (`generateEngineerReportText`, en `utils/engineers.js`) con todos los proyectos, actividades y tareas adicionales del ingeniero, listo para pegar en correo o mensajería.

---

## 6. Persistencia y base de datos

### 6.1 Archivos JSON del servidor

El backend mantiene dos archivos JSON en disco (en producción en `/home/data/` de Azure App Service):

| Archivo | Contenido | Comportamiento |
|---------|-----------|----------------|
| `data.json` | Estado activo de todos los proyectos, catálogo de ingenieros, colaboradores externos y label de semana. | Se sobreescribe en cada guardado. Es la fuente de verdad del servidor. |
| `history.json` | Historial de snapshots semanales. Cada entrada es el estado completo de todos los proyectos al momento del guardado. | Se acumula, nunca se borra. Una entrada por semana (upsert por clave de lunes de semana). |

### 6.2 Tablas de Azure SQL Server

La base de datos Azure SQL tiene las siguientes tablas:

#### Tablas principales

| Tabla | Propósito |
|-------|-----------|
| `Proyectos` | Catálogo de proyectos con nombre y URL de Planner. Clave de unión: `AppID` = campo `id` del JSON. |
| `Ingenieros` | Catálogo de ingenieros con nombre, cargo y estado (activo/inactivo). |
| `Actividades` | Actividades por proyecto. Se insertan nuevas conforme se agregan en la app. |
| `ReportesSemanales` | Un registro por proyecto por semana. Contiene métricas, logros, plan, estado y el JSON completo del proyecto (`RawDataJSON`). |
| `Colaboradores_Externos` | Catálogo de colaboradores externos. |
| `Trimestres_Archivo` | Un registro por trimestre archivado con el JSON completo del snapshot. |

#### Tablas de detalle del reporte semanal

| Tabla | Propósito |
|-------|-----------|
| `Estado_Actividades_Reporte` | Estado de cada actividad en el momento del reporte (completada, en proceso, no iniciada), con fechas y responsable. |
| `Indicadores` | Métricas de indicadores de desempeño por reporte. |
| `Riesgos_Impedimentos` | Impedimentos (bloqueantes, riesgos, salidas no conformes) por reporte. |
| `Eventos_Reporte` | Fechas clave y comentarios por reporte. |
| `Estadisticas_Ingeniero_Semana` | Actividades trabajadas por cada ingeniero en la semana del reporte. |

#### Tablas de detalle operacional de actividades (sincronización en tiempo real)

| Tabla | Propósito |
|-------|-----------|
| `Actividades_Detalle` | Estado operacional vivo de cada actividad: fechas, descripción, objetivos, solución, % de cumplimiento (`Progreso`), horas planeadas (`HorasPlaneadas`), estado actual, historial de fechas de estado. Se sobreescribe en cada guardado del proyecto. **La columna `Prioridad` (alta/media/baja) fue eliminada en la migración 009.** |
| `Actividad_Checklist` | Subactividades (checklist) de cada actividad con estado de completado. |
| `Actividad_Notas` | Notas fechadas por actividad. |
| `Actividad_FechasClave` | Hitos o fechas clave por actividad. |
| `Actividad_Adjuntos` | **(migración 007, nueva)** Archivos adjuntos de cada actividad, guardados como bytes (`VARBINARY(MAX)`) directamente en SQL: nombre, tipo MIME, tamaño y contenido. Clave estable `AppAdjuntoID` (`att_xxx`). |
| `Tareas_Sueltas_Ingeniero` | Tareas adicionales de ingenieros no asociadas a proyectos. Ampliada en las migraciones 010 y 011 (ver abajo). |

### 6.3 Historial de migraciones SQL (005 a 011)

La tabla `Actividades_Detalle` fue creada en la migración 003 (con columna `Prioridad` incluida en ese momento). Las migraciones posteriores la fueron ajustando al modelo de datos actual:

| Migración | Cambio |
|-----------|--------|
| **005 — `add_solucion`** | Agrega la columna `Solucion` (`NVARCHAR(MAX)`) a `Actividades_Detalle`. |
| **006 — `add_progress_hours`** | Agrega `Progreso` (`INT`, 0-100, default 0) y `HorasPlaneadas` (`DECIMAL(8,2)`, default 0) a `Actividades_Detalle`. |
| **007 — `add_attachments`** | Crea la tabla `Actividad_Adjuntos` (ver 6.2) para guardar archivos adjuntos como bytes en SQL. |
| **008 — `add_objetivos`** | Agrega la columna `Objetivos` (`NVARCHAR(MAX)`) a `Actividades_Detalle`. |
| **009 — `drop_prioridad`** | Elimina la columna `Prioridad` de `Actividades_Detalle` (con su `DEFAULT CONSTRAINT` asociado). La app ya no clasifica actividades por prioridad Alta/Media/Baja. |
| **010 — `add_task_dates`** | Agrega `FechaInscrita`, `FechaInicio` y `FechaCompletada` (todas `DATE`) a `Tareas_Sueltas_Ingeniero`, para poder consultar en SQL cuándo una tarea suelta pasó por cada estado. |
| **011 — `add_task_rich_fields`** | Amplía `Tareas_Sueltas_Ingeniero` con los mismos campos que una actividad de proyecto: `Detalle`, `Objetivos`, `Solucion` (todos `NVARCHAR(MAX)`), `FechaInicioPlan`/`FechaFinPlan` (`DATE`), `Progreso` (`INT`, default 0), `HorasPlaneadas` (`DECIMAL(8,2)`, default 0) y `DatosExtra` (`NVARCHAR(MAX)`) — este último guarda checklist, notas y fechas clave como JSON, evitando crear tablas relacionales adicionales para la tarea suelta. |

Todas las migraciones son seguras de re-ejecutar (usan `IF NOT EXISTS` / `IF EXISTS` antes de alterar el esquema).

### 6.4 API REST del backend

Todas las rutas bajo `/api/*` exigen el header **`X-API-Key`** con una clave compartida configurada en el servidor (`API_KEY` en `.env`). En producción el servidor no arranca si `API_KEY` no está definida; en desarrollo local, si falta, la API queda abierta con una advertencia en consola. Además existen límites de frecuencia de uso (*rate limiting*) por tipo de operación:

- **General:** 300 solicitudes / 15 min por IP, sobre toda la API.
- **IA** (`/api/generate-report`, `/api/project-status`, `/api/generate-global-status`): 20 solicitudes / 15 min.
- **Destructivas** (`/api/quarter-reset`, `/api/clean-stats`): 5 solicitudes / hora.

Los intentos de autenticación fallidos y los límites excedidos quedan registrados en un log de auditoría de seguridad (consola, formato JSON).

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/db-ping` | Diagnóstico de conexión a la base de datos (solo disponible fuera de producción). |
| GET | `/api/projects` | Devuelve el estado actual completo (data.json). |
| POST | `/api/projects` | Sobreescribe el estado actual y sincroniza actividades a SQL. |
| POST | `/api/external-contacts/sync-one` | Crea o actualiza un colaborador externo en SQL. |
| POST | `/api/engineers/sync-one` | Crea o actualiza un ingeniero en la tabla Ingenieros de SQL. |
| POST | `/api/engineers/tasks/sync-one` | Crea o actualiza una tarea suelta de ingeniero en SQL. |
| POST | `/api/engineers/tasks/delete-one` | Elimina una tarea suelta de ingeniero de SQL. |
| POST | `/api/attachments/upload` | **(nuevo)** Sube un adjunto de actividad: recibe el archivo en base64 y lo guarda en la tabla `Actividad_Adjuntos`. Usa un parser de body con límite ampliado (excluido del límite general por su tamaño). Límite de 10 MB por archivo. |
| GET | `/api/attachments/:id` | **(nuevo)** Descarga el archivo adjunto por su `AppAdjuntoID`, con las cabeceras `Content-Disposition`/`Content-Type` correspondientes. |
| POST | `/api/attachments/delete` | **(nuevo)** Elimina un adjunto de la tabla `Actividad_Adjuntos` por su ID. |
| POST | `/api/report` | Guarda snapshot semanal en history.json y en SQL (ReportesSemanales). |
| GET | `/api/history` | Lista de semanas guardadas (metadatos). |
| GET | `/api/history/:date` | Datos completos de un reporte por fecha. |
| POST | `/api/generate-report` | Genera informe de gestión con IA para un proyecto. *(limitada por el rate limit de IA)* |
| POST | `/api/project-status` | Genera resumen de status semanal con IA para un proyecto. *(limitada por el rate limit de IA)* |
| POST | `/api/generate-global-status` | Genera análisis global de todos los proyectos con IA. *(limitada por el rate limit de IA)* |
| POST | `/api/restore-from-db` | Restaura el estado desde el último backup en Azure SQL. |
| POST | `/api/quarter-reset` | Ejecuta el reset trimestral: archiva y limpia el estado. *(limitada por el rate limit destructivo)* |
| POST | `/api/clean-stats` | Limpia estadísticas del trimestre actual sin archivar. *(limitada por el rate limit destructivo)* |
| GET | `/api/quarters` | Lista de trimestres archivados (desde SQL o desde archivos físicos). |
| GET | `/api/quarters/:id` | Datos completos de un trimestre archivado por ID. |

> Nota: la importación de Excel de Planner **no tiene una ruta de API dedicada**. El archivo se procesa completamente en el navegador (parseo del `.xlsx` con la librería `xlsx` y fusión con las actividades existentes); solo el resultado final (actividades creadas/actualizadas e ingenieros nuevos) se guarda a través de las rutas ya existentes `POST /api/projects` y `POST /api/engineers/sync-one`.

### 6.5 `backend/utils.cjs`

Módulo de utilidades puras compartidas entre `server.cjs`, `db-operations.cjs` y `gemini-report.cjs`, sin dependencias externas:

- `toArray(val)` — normaliza cualquier valor a un array de strings no vacíos (admite `undefined`/`null`, arrays, o texto separado por saltos de línea).
- `buildActivityIndex(activities)` — construye un índice `id → { text, position }` a partir de `activities_identified`.
- `buildActivityIndexFlat(activities)` — versión simple `id → texto`, usada donde no se necesita la posición.
- `resolveActText(index, id)` / `resolveActArr(index, ids)` — resuelven uno o varios IDs de actividad a su texto usando el índice.
- `buildEngineerIndex(engineersCatalog)` — construye un índice `id → { name, sqlId }` a partir del catálogo de ingenieros.

Son las contrapartes en el backend de las funciones equivalentes en `frontend/src/utils/formulas.js` (mismo propósito: resolver IDs estables a texto legible).

---

## 7. Integraciones de inteligencia artificial

El sistema integra un módulo de IA (archivo `backend/gemini-report.cjs`) que ofrece tres funcionalidades. Las tres rutas de IA están sujetas al límite de frecuencia de 20 solicitudes / 15 minutos (sección 6.4).

### 7.1 Informe de Gestión (.docx)

**Ruta de activación:** Dashboard o Reporte > botón "Informe"/"Generar Informe" por proyecto.

**Qué hace:** Genera un documento Word (.docx) descargable con el informe de gestión trimestral del proyecto, a partir de una plantilla institucional (`MODELO INFORME DE GESTIÓN.docx`) con marcadores de texto que se reemplazan con el análisis de la IA. El análisis incluye:
- Narrativa de avance y estado general del proyecto.
- Análisis de las actividades completadas, en proceso y pendientes.
- Detalle de indicadores de desempeño.
- Análisis de impedimentos y riesgos.
- Logros del periodo y plan para el siguiente.
- Contexto del equipo de ingenieros.

**Flujo técnico:**
1. El frontend envía el proyecto completo (JSON) al endpoint `POST /api/generate-report`.
2. El backend llama a la API de IA con un prompt estructurado que incluye todos los datos del proyecto.
3. La respuesta es un JSON con el análisis, dividido en 6 secciones (`seccion1`...`seccion6`).
4. El frontend (`utils/generateQuarterlyReport.js`) descarga la plantilla `.docx`, la desempaqueta con la librería `JSZip`, reemplaza cada marcador (`[Nombre]`, `[%]`, etc.) del XML interno por el texto correspondiente del análisis, y reempaqueta el archivo.
5. Se descarga el archivo resultante con nombre `informetrimestral_<proyecto>_<fecha>.docx`.
6. El proceso puede cancelarse con el botón "Cancelar" (AbortController).

### 7.2 Status Ejecutivo

**Ruta de activación:** Dashboard > botón "Status Ejecutivo".

**Qué hace:** Genera un párrafo corto y conciso que resume el estado global de todos los proyectos activos. Diseñado para compartir rápidamente el estado del portafolio en reuniones ejecutivas.

**Respuesta:** Objeto con campo `parrafo` (texto plano).

### 7.3 Análisis Completo

**Ruta de activación:** Dashboard > botón "Análisis Completo".

**Qué hace:** Genera un análisis estructurado con múltiples secciones:
- `resumen_ejecutivo`: párrafo de síntesis general.
- `proyectos_destacados`: lista de proyectos con buen avance, con porcentaje y nota explicativa.
- `alertas`: proyectos en riesgo o retrasados con motivo de la alerta.
- `proximos_pasos`: lista de acciones recomendadas.

**Nota sobre los proyectos analizados:** Solo se incluyen en el análisis los proyectos que tienen actividades definidas (total_tasks > 0) y que están marcados con "Incluir en promedio" en el Dashboard.

---

## 8. Glosario

| Término | Definición |
|---------|-----------|
| **Actividad** | Unidad de trabajo dentro de un proyecto. Tiene ID estable, texto descriptivo, responsables, estado y fechas. Es la entidad más granular del sistema. |
| **Adjunto** | Archivo (documento, imagen, etc.) asociado a una actividad. El archivo se guarda en Azure SQL; solo su metadata vive en el JSON del proyecto. Límite de 10 MB por archivo. |
| **Bloqueante** | Tipo de impedimento que paraliza el avance del proyecto. Se limpia automáticamente al iniciar nueva semana. |
| **Colaborador externo** | Persona ajena a la Oficina de Tecnología que puede ser asignada a actividades (proveedores, personal de otras dependencias). Registrado con nombre y empresa. |
| **Cuarteto / Trimestre** | Periodo de tres meses (Q1: enero-marzo, Q2: abril-junio, Q3: julio-septiembre, Q4: octubre-diciembre). Al final de cada trimestre se ejecuta el reset trimestral. |
| **Dashboard** | Vista principal del sistema con las tarjetas de todos los proyectos y el resumen global. |
| **Dual-write** | Estrategia de persistencia que escribe simultáneamente en localStorage (inmediato) y en el servidor (asíncrono), garantizando que los datos no se pierdan ante fallos de red. No aplica a los adjuntos, que solo viven en SQL. |
| **Fire-and-forget** | Patrón de programación donde una operación se lanza en segundo plano sin esperar su resultado. Usado en las sincronizaciones a SQL para no bloquear la UI. |
| **Gantt (línea de tiempo)** | Diagrama que representa cada actividad con fechas como una barra horizontal en una escala de tiempo, con zoom por mes/semana/día. El relleno de la barra indica el % de cumplimiento. |
| **Historial semanal** | Archivo `history.json` que acumula snapshots del estado de los proyectos, uno por semana. |
| **Impedimento** | Elemento que dificulta o bloquea el avance de un proyecto. Puede ser un Bloqueante, un Riesgo o una Salida no conforme. |
| **Importación de Planner** | Proceso de cargar el Excel exportado de Microsoft Planner (.xlsx) para crear y actualizar actividades del proyecto automáticamente, sin sobrescribir el trabajo hecho a mano en la app. |
| **Indicador** | Métrica de desempeño específica de un proyecto, con total, completadas y en proceso. Funciona como un sub-proyecto con su propia barra de avance. |
| **Ingeniero** | Miembro del equipo técnico de la Oficina de Tecnología. Registrado en el catálogo global con nombre, cargo y estado. |
| **Kanban** | Tablero visual de tres columnas (Completadas, En proceso, No iniciadas) para gestionar el estado de las actividades de un proyecto. |
| **Modal de Detalle** | Ventana flotante (modal) que muestra y permite editar todos los campos de una actividad individual o de una tarea de ingeniero. |
| **Nueva semana** | Operación que limpia los campos semanales de todos los proyectos (logros, plan, bloqueantes, estadísticas de ingenieros) e inicia el ciclo de la semana siguiente. |
| **Objetivos** | Campo de texto libre de una actividad o tarea que describe qué se busca cumplir con ella (agregado en la migración 008). |
| **Plan para la próxima semana** | Campo semanal que registra cuáles actividades se planifican trabajar en la semana siguiente. Se selecciona desde la lista de actividades del proyecto. |
| **Planner** | Microsoft Planner, herramienta de gestión de tareas de Microsoft 365. La app permite registrar la URL del tablero de Planner de cada proyecto y, además, importar directamente su Excel exportado. |
| **Proyecto prioritario** | Marca (★) que un proyecto puede tener para resaltarlo y para filtrarlo específicamente en la vista Reporte. No debe confundirse con la antigua prioridad de actividad (Alta/Media/Baja), que fue eliminada del sistema. |
| **Q (Quarter)** | Abreviatura de trimestre en inglés, numerado del 1 al 4. Ejemplo: Q2 2026 = segundo trimestre de 2026 (abril-junio). |
| **Rate limiting** | Límite de cantidad de solicitudes que la API acepta en una ventana de tiempo, para proteger operaciones costosas (IA) o destructivas (trimestre) de uso excesivo o abuso. |
| **Rep. Ingenieros** | Vista dedicada a generar el reporte consolidado de un ingeniero (actividades por proyecto + tareas adicionales), listo para copiar como texto. |
| **Reset trimestral** | Operación que archiva el estado completo del trimestre en curso y limpia los proyectos para iniciar el siguiente trimestre, conservando solo las actividades no completadas. Se ejecuta desde la vista Trimestres. |
| **Reporte semanal** | Documento de texto estructurado generado automáticamente con el estado de todos los proyectos en la semana activa. |
| **Responsable** | Persona asignada a una actividad. Puede ser un ingeniero interno o un colaborador externo. |
| **Riesgo** | Tipo de impedimento que podría afectar el proyecto pero no lo bloquea actualmente. Persiste entre semanas. |
| **Salida no conforme** | Tipo de impedimento que indica una desviación del proceso o estándar. Persiste entre semanas. |
| **Snapshot** | Copia completa del estado del sistema en un momento específico. Se guarda en el historial semanal o en el archivo trimestral. |
| **Solución** | Campo de texto libre de una actividad o tarea que describe la solución aplicada o propuesta (agregado en la migración 005). |
| **sql_id** | Campo que guarda el ID de Azure SQL correspondiente a un ingeniero o colaborador externo en el catálogo local. Permite actualizar el registro SQL directamente sin necesitar búsquedas por nombre. |
| **Status Ejecutivo** | Análisis de IA en formato de párrafo corto que resume el estado global del portafolio de proyectos. |
| **Tarea adicional (suelta)** | Tarea de un ingeniero que no está asociada a ningún proyecto específico. Se gestiona en la vista de Ingenieros con el Modal de Tarea de Ingeniero, y tiene el mismo nivel de detalle que una actividad de proyecto (objetivos, solución, checklist, fechas clave, notas, horas). |
| **task_status** | Objeto JSON que clasifica cada actividad de un proyecto en una de tres columnas: completadas, en proceso, no iniciadas. |
| **Trimestres_Archivo** | Tabla de Azure SQL que almacena el snapshot JSON completo de cada trimestre archivado. |
| **X-API-Key** | Cabecera HTTP que toda solicitud a `/api/*` debe incluir con la clave compartida configurada en el servidor. Sin ella (o con una clave incorrecta), el servidor responde 401 No autorizado. |
| **weekly_detail** | Lista de IDs de actividades que un ingeniero trabajó durante la semana actual. Se resetea al iniciar nueva semana. |
| **weekly_total** | Número de actividades trabajadas por un ingeniero en la semana actual. Se resetea al iniciar nueva semana. |
