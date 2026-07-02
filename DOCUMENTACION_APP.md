# Documentación del Sistema de Seguimiento Semanal de Proyectos

**Institución:** Corte Suprema de Justicia — Oficina de Tecnología  
**Versión del documento:** Julio 2026  
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

### ¿Quiénes lo usan?

El sistema está dirigido al **líder o coordinador de la Oficina de Tecnología**, que actúa como único editor y administrador. No tiene múltiples roles de acceso: la persona que opera la aplicación tiene acceso completo a todas las funciones.

### Arquitectura general

El sistema es una **SPA (Single Page Application)** construida con:

- **Frontend:** React (Vite), que corre en el navegador del usuario.
- **Backend:** Node.js con Express, que expone una API REST y gestiona la escritura en los archivos de datos.
- **Base de datos:** Azure SQL Server (Microsoft SQL Server), usada como respaldo estructurado y para trazabilidad histórica.
- **Despliegue:** Azure App Service (Linux), con el frontend servido como archivos estáticos y el backend como proceso Node.js.

---

## 2. Módulos y vistas del sistema

El sistema tiene cinco vistas principales accesibles desde la barra de navegación superior:

| Vista | Nombre en la UI | Propósito |
|-------|----------------|-----------|
| `dashboard` | Dashboard | Vista general de todos los proyectos en tarjetas |
| `edit` | Editar | Formulario detallado de edición de un proyecto |
| `report` | Reporte | Generación y previsualización del reporte semanal |
| `engineers` | Ingenieros | Catálogo del equipo y detalle de actividades por persona |
| `quarters` | Trimestres | Consulta del histórico de trimestres archivados |

### 2.1 Dashboard

Vista de inicio del sistema. Muestra una cuadrícula con una tarjeta por cada proyecto registrado. En la parte superior presenta:

- Un **anillo de progreso** con el avance promedio global (porcentaje).
- Cuatro **tarjetas de estadísticas**: actividades completadas, en proceso, no iniciadas y número total de proyectos.
- Una **tabla de métricas globales** con los totales consolidados de todos los proyectos.
- Botones de **análisis con IA** (Status Ejecutivo y Análisis Completo).
- La barra de **trimestre activo** con opción de iniciar un nuevo trimestre o limpiar estadísticas.

### 2.2 Editar

Formulario completo de un proyecto individual. Se accede haciendo clic en cualquier tarjeta del Dashboard. Incluye todos los campos editables del proyecto: nombre, estado, métricas, actividades, ingenieros asignados, impedimentos, plan semanal, indicadores y más. También contiene el tablero Kanban de estado de actividades y el panel de asignación masiva de responsables.

### 2.3 Reporte

Vista de solo lectura que genera el texto del reporte semanal. Puede mostrar el reporte completo de todos los proyectos o el reporte individual de un proyecto seleccionado desde el Dashboard. Permite copiar el texto al portapapeles o generar un documento Word (.docx) con análisis de IA.

### 2.4 Ingenieros

Catálogo del equipo de ingenieros. Muestra una tarjeta por persona con su nombre, cargo, estado (activo/inactivo) y un resumen de proyectos vinculados. Al hacer clic en un ingeniero se entra al **panel de detalle**, que muestra todas las actividades que tiene asignadas organizadas por proyecto, con sus fechas de registro, inicio en proceso y completado. También gestiona tareas adicionales del ingeniero que no están vinculadas a ningún proyecto específico.

### 2.5 Trimestres

Vista de consulta histórica de solo lectura. Lista todos los trimestres que han sido archivados mediante el proceso de reinicio trimestral. Al seleccionar un trimestre se pueden ver todos los proyectos y sus actividades tal como estaban al momento del cierre, con un buscador de texto para filtrar por actividad o nombre de proyecto.

---

## 3. Estructura de datos

### 3.1 Proyecto

La entidad central del sistema. Cada proyecto tiene los siguientes campos:

| Campo | Tipo | Descripción |
|-------|------|-------------|
| `id` | string | Identificador único generado al crear el proyecto (formato `base36 + random`). Nunca cambia. |
| `project_name` | string | Nombre del proyecto. |
| `status` | string | Estado general: `on-track` (En curso), `at-risk` (En riesgo), `blocked` (Bloqueado), `completed` (Completado), `mejora-continua` (Mejora Continua). |
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
| `status_history` | objeto `{actId: {added, in_progress, completed}}` | Fechas de cada transición de estado por actividad. |
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
| `priority` | string | Prioridad: `alta`, `media`, `baja`. |
| `start_date` | string | Fecha de inicio planificada (formato `YYYY-MM-DD`). |
| `due_date` | string | Fecha de vencimiento planificada (formato `YYYY-MM-DD`). |
| `description` | string | Descripción detallada de la actividad. |
| `checklist` | array | Sub-actividades con estado de completado: `[{id, text, done}]`. |
| `notes` | array | Notas fechadas asociadas a la actividad: `[{id, date, text}]`. |
| `key_dates` | array | Fechas clave o hitos de la actividad: `[{id, date, label}]`. |

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
| `tasks` | array | Tareas adicionales no asociadas a ningún proyecto: `[{id, description, status, date}]`. |
| `sql_id` | número | ID correspondiente en la tabla `Ingenieros` de Azure SQL. Se asigna automáticamente al sincronizar. |

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

El reset trimestral es una operación irreversible que cierra el trimestre en curso e inicia uno nuevo. El flujo incluye una doble confirmación para evitar ejecuciones accidentales:

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

### 4.4 Estrategia de persistencia (escritura dual)

El sistema usa un patrón de **escritura dual** para garantizar que no se pierden datos:

1. **localStorage del navegador** actúa como caché inmediata. Toda operación de guardado escribe en localStorage primero, de forma síncrona.
2. **El servidor Node.js** recibe la misma escritura de forma asíncrona. Si falla, el error se silencia y el dato queda protegido en localStorage.
3. **Azure SQL Server** recibe los datos en segundo plano (fire-and-forget). Si SQL falla, hay un reintento automático a los 5 segundos. Si vuelve a fallar, el dato queda en el JSON del servidor como respaldo.

En caso de pérdida de datos, el botón **"Restaurar respaldo"** de la cabecera consulta directamente a Azure SQL y sobreescribe el estado local con la última versión guardada en la base de datos.

---

## 5. Funcionalidades detalladas por módulo

### 5.1 Cabecera global (siempre visible)

- **Selector de fecha del reporte:** Cambia la fecha del reporte activo. Si la nueva fecha es de la misma semana, solo actualiza el dato. Si es de una semana diferente, advierte que se limpiarán los campos semanales.
- **Guardar reporte:** Guarda un snapshot del estado actual en el historial (history.json + SQL).
- **Navegación entre vistas:** Pestañas Dashboard, Editar, Reporte, Ingenieros, Trimestres.
- **Nueva semana:** Inicia el ciclo de la semana siguiente, limpiando campos semanales y guardando el historial.
- **Restaurar respaldo:** Recupera el último estado guardado en Azure SQL, sobrescribiendo el estado local.

### 5.2 Dashboard

- **Anillo de progreso global:** Muestra el porcentaje de avance promedio de todos los proyectos incluidos en el cálculo.
- **Tarjetas de estadísticas:** Completadas, En proceso, No iniciados, Proyectos totales.
- **Tabla de métricas globales:** Resumen consolidado por proyecto con porcentajes de avance, totales y estados.
- **Toggle "Incluir en promedio":** Cada tarjeta tiene un checkbox para excluir proyectos del cálculo del promedio global (útil para proyectos de mejora continua o suspendidos).
- **Status Ejecutivo (IA):** Genera un párrafo ejecutivo resumido con el estado global de todos los proyectos activos.
- **Análisis Completo (IA):** Genera un análisis estructurado con resumen ejecutivo, proyectos destacados, alertas y próximos pasos.
- **Copiar análisis:** Botón para copiar el texto del análisis al portapapeles.
- **Por cada tarjeta de proyecto:**
  - Ver reporte individual del proyecto.
  - Copiar reporte del proyecto al portapapeles.
  - Generar Informe de Gestión (.docx) con IA.
  - Copiar asignaciones por ingeniero.
- **Barra de trimestre:** Muestra el trimestre activo con opciones de "Nuevo trimestre" y "Limpiar estadísticas".

### 5.3 Editar

Es la vista más completa del sistema. Tiene dos paneles: un sidebar con la lista de proyectos y el formulario del proyecto seleccionado.

**Sidebar de proyectos:**
- Lista todos los proyectos con nombre y estado.
- Permite reordenar por arrastrar y soltar (drag & drop).
- Botones para agregar, ver reporte o exportar reporte de cada proyecto.

**Formulario del proyecto (campos editables):**
- Nombre del proyecto.
- Estado (En curso, En riesgo, Bloqueado, Completado, Mejora Continua).
- URL de Planner.
- Métricas manuales: total, completadas, en proceso, descuento por compartidas.
- Estado actual del proyecto (campo de texto largo con modo lectura/edición).
- Actividades identificadas con asignación de responsables y estado.
- Tablero Kanban de estado de actividades (tres columnas: Completadas, En proceso, No iniciadas).
- Panel de asignación masiva de responsables.
- Ingenieros del proyecto: estadísticas globales y actividades de la semana.
- Indicadores de desempeño.
- Impedimentos: bloqueantes, riesgos, salidas no conformes.
- Logros de la semana (selector de actividades con búsqueda).
- Plan para la próxima semana (selector de actividades con búsqueda).
- Eliminación del proyecto (con doble confirmación modal).

**Tablero Kanban de actividades:**
- Muestra actividades sin clasificar en un panel superior y luego tres columnas de estado.
- Cada tarjeta de actividad muestra: nombre, prioridad (Alta/Media/Baja), fechas de inicio y fin, días restantes o alerta de demora, responsables asignados.
- Las actividades se pueden mover entre columnas con botones o arrastrando.
- Al hacer clic en una actividad se abre el **Modal de Detalle de Actividad**.

### 5.4 Modal de Detalle de Actividad

Modal de edición profunda de una actividad individual. Se accede haciendo clic en una actividad del tablero Kanban.

Campos editables en el modal:
- **Nombre de la actividad** (textarea auto-expandible).
- **Prioridad:** Alta, Media, Baja.
- **Fecha de inicio** y **Fecha de fin**.
- **Responsables:** muestra chips de los asignados, permite agregar o quitar.
- **Descripción:** texto libre detallado.
- **Subactividades (Checklist):** lista de pasos con checkbox de completado. Muestra barra de progreso.
- **Fechas clave:** hitos con fecha y etiqueta.
- **Notas:** anotaciones fechadas.

Comportamiento:
- Detecta cambios sin guardar y muestra badge "Sin guardar".
- Al cerrar con cambios pendientes, pregunta si descartar, guardar y cerrar o seguir editando.
- El botón de eliminar actividad requiere confirmación adicional.

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
- Sección de tareas adicionales: tareas no asociadas a proyectos con descripción, estado y fecha.

### 5.6 Reporte

- Muestra el reporte de todos los proyectos o de un proyecto específico.
- El reporte incluye: resumen global, métricas por proyecto, estado de actividades, impedimentos, logros y plan de la semana, indicadores.
- Botón para copiar todo el reporte al portapapeles.
- Por proyecto: botón para generar Informe de Gestión (.docx) con IA.

### 5.7 Trimestres

**Vista de lista:**
- Lista de trimestres archivados ordenados del más reciente al más antiguo.
- Por cada trimestre: etiqueta (ej: Q2 2026), fecha de cierre, número de proyectos, actividades archivadas y transferidas.

**Vista de detalle de trimestre:**
- Modo solo lectura — no se pueden editar datos históricos.
- Lista de proyectos del trimestre con contador de actividades completadas, en proceso y no iniciadas.
- Al expandir un proyecto: lista de actividades con estado, prioridad, fechas, checklist, notas y fechas clave.
- Buscador de texto que filtra actividades y proyectos en tiempo real.

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
| `Actividades_Detalle` | Estado operacional vivo de cada actividad: prioridad, fechas, descripción, estado actual, historial de fechas de estado. Se sobreescribe en cada guardado del proyecto. |
| `Actividad_Checklist` | Subactividades (checklist) de cada actividad con estado de completado. |
| `Actividad_Notas` | Notas fechadas por actividad. |
| `Actividad_FechasClave` | Hitos o fechas clave por actividad. |
| `Tareas_Sueltas_Ingeniero` | Tareas adicionales de ingenieros no asociadas a proyectos. |

### 6.3 API REST del backend

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/projects` | Devuelve el estado actual completo (data.json). |
| POST | `/api/projects` | Sobreescribe el estado actual y sincroniza actividades a SQL. |
| POST | `/api/report` | Guarda snapshot semanal en history.json y en SQL (ReportesSemanales). |
| GET | `/api/history` | Lista de semanas guardadas (metadatos). |
| GET | `/api/history/:date` | Datos completos de un reporte por fecha. |
| POST | `/api/engineers/sync-one` | Crea o actualiza un ingeniero en la tabla Ingenieros de SQL. |
| POST | `/api/engineers/tasks/sync-one` | Crea o actualiza una tarea suelta de ingeniero en SQL. |
| POST | `/api/engineers/tasks/delete-one` | Elimina una tarea suelta de ingeniero de SQL. |
| POST | `/api/external-contacts/sync-one` | Crea o actualiza un colaborador externo en SQL. |
| POST | `/api/quarter-reset` | Ejecuta el reset trimestral: archiva y limpia el estado. |
| POST | `/api/clean-stats` | Limpia estadísticas del trimestre actual sin archivar. |
| GET | `/api/quarters` | Lista de trimestres archivados (desde SQL o desde archivos físicos). |
| GET | `/api/quarters/:id` | Datos completos de un trimestre archivado por ID. |
| POST | `/api/generate-report` | Genera informe de gestión con IA para un proyecto. |
| POST | `/api/project-status` | Genera resumen de status semanal con IA para un proyecto. |
| POST | `/api/generate-global-status` | Genera análisis global de todos los proyectos con IA. |
| POST | `/api/restore-from-db` | Restaura el estado desde el último backup en Azure SQL. |
| GET | `/api/db-ping` | Diagnóstico de conexión a la base de datos (solo desarrollo). |

---

## 7. Integraciones de inteligencia artificial

El sistema integra un módulo de IA (archivo `backend/gemini-report.cjs`) que ofrece tres funcionalidades:

### 7.1 Informe de Gestión (.docx)

**Ruta de activación:** Dashboard o Reporte > botón "Informe" por proyecto.

**Qué hace:** Genera un documento Word (.docx) descargable con el informe de gestión trimestral del proyecto. El análisis incluye:
- Narrativa de avance y estado general del proyecto.
- Análisis de las actividades completadas, en proceso y pendientes.
- Detalle de indicadores de desempeño.
- Análisis de impedimentos y riesgos.
- Logros del periodo y plan para el siguiente.
- Contexto del equipo de ingenieros.

**Flujo técnico:**
1. El frontend envía el proyecto completo (JSON) al endpoint `POST /api/generate-report`.
2. El backend llama a la API de IA con un prompt estructurado que incluye todos los datos del proyecto.
3. La respuesta es un JSON con el análisis.
4. El frontend usa la librería `docx` para construir y descargar el archivo Word.
5. El proceso puede cancelarse con el botón "Cancelar" (AbortController).

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
| **Actividad** | Unidad de trabajo dentro de un proyecto. Tiene ID estable, texto descriptivo, responsables, estado, prioridad y fechas. Es la entidad más granular del sistema. |
| **Bloqueante** | Tipo de impedimento que paraliza el avance del proyecto. Se limpia automáticamente al iniciar nueva semana. |
| **Colaborador externo** | Persona ajena a la Oficina de Tecnología que puede ser asignada a actividades (proveedores, personal de otras dependencias). Registrado con nombre y empresa. |
| **Cuarteto / Trimestre** | Periodo de tres meses (Q1: enero-marzo, Q2: abril-junio, Q3: julio-septiembre, Q4: octubre-diciembre). Al final de cada trimestre se ejecuta el reset trimestral. |
| **Dashboard** | Vista principal del sistema con las tarjetas de todos los proyectos y el resumen global. |
| **Dual-write** | Estrategia de persistencia que escribe simultáneamente en localStorage (inmediato) y en el servidor (asíncrono), garantizando que los datos no se pierdan ante fallos de red. |
| **Fire-and-forget** | Patrón de programación donde una operación se lanza en segundo plano sin esperar su resultado. Usado en las sincronizaciones a SQL para no bloquear la UI. |
| **Historial semanal** | Archivo `history.json` que acumula snapshots del estado de los proyectos, uno por semana. |
| **Impedimento** | Elemento que dificulta o bloquea el avance de un proyecto. Puede ser un Bloqueante, un Riesgo o una Salida no conforme. |
| **Indicador** | Métrica de desempeño específica de un proyecto, con total, completadas y en proceso. Funciona como un sub-proyecto con su propia barra de avance. |
| **Ingeniero** | Miembro del equipo técnico de la Oficina de Tecnología. Registrado en el catálogo global con nombre, cargo y estado. |
| **Kanban** | Tablero visual de tres columnas (Completadas, En proceso, No iniciadas) para gestionar el estado de las actividades de un proyecto. |
| **Modal de Detalle** | Ventana flotante (modal) que muestra y permite editar todos los campos de una actividad individual. |
| **Nueva semana** | Operación que limpia los campos semanales de todos los proyectos (logros, plan, bloqueantes, estadísticas de ingenieros) e inicia el ciclo de la semana siguiente. |
| **Plan para la próxima semana** | Campo semanal que registra cuáles actividades se planifican trabajar en la semana siguiente. Se selecciona desde la lista de actividades del proyecto. |
| **Planner** | Microsoft Planner, herramienta de gestión de tareas de Microsoft 365. La app permite registrar la URL del tablero de Planner de cada proyecto. |
| **Prioridad** | Nivel de urgencia de una actividad: Alta, Media o Baja. Se muestra con colores en el tablero Kanban. |
| **Q (Quarter)** | Abreviatura de trimestre en inglés, numerado del 1 al 4. Ejemplo: Q2 2026 = segundo trimestre de 2026 (abril-junio). |
| **Reset trimestral** | Operación que archiva el estado completo del trimestre en curso y limpia los proyectos para iniciar el siguiente trimestre, conservando solo las actividades no completadas. |
| **Reporte semanal** | Documento de texto estructurado generado automáticamente con el estado de todos los proyectos en la semana activa. |
| **Responsable** | Persona asignada a una actividad. Puede ser un ingeniero interno o un colaborador externo. |
| **Riesgo** | Tipo de impedimento que podría afectar el proyecto pero no lo bloquea actualmente. Persiste entre semanas. |
| **Salida no conforme** | Tipo de impedimento que indica una desviación del proceso o estándar. Persiste entre semanas. |
| **Snapshot** | Copia completa del estado del sistema en un momento específico. Se guarda en el historial semanal o en el archivo trimestral. |
| **sql_id** | Campo que guarda el ID de Azure SQL correspondiente a un ingeniero o colaborador externo en el catálogo local. Permite actualizar el registro SQL directamente sin necesitar búsquedas por nombre. |
| **Status Ejecutivo** | Análisis de IA en formato de párrafo corto que resume el estado global del portafolio de proyectos. |
| **Tarea suelta** | Tarea de un ingeniero que no está asociada a ningún proyecto específico. Se gestiona en la vista de Ingenieros. |
| **task_status** | Objeto JSON que clasifica cada actividad de un proyecto en una de tres columnas: completadas, en proceso, no iniciadas. |
| **Trimestres_Archivo** | Tabla de Azure SQL que almacena el snapshot JSON completo de cada trimestre archivado. |
| **weekly_detail** | Lista de IDs de actividades que un ingeniero trabajó durante la semana actual. Se resetea al iniciar nueva semana. |
| **weekly_total** | Número de actividades trabajadas por un ingeniero en la semana actual. Se resetea al iniciar nueva semana. |
