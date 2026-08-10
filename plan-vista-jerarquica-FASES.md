# Plan: Vista jerárquica de tareas (tipo MS Project) + mejoras de Gantt

## Context

El usuario pidió una vista nueva tipo "Excel/MS Project": tabla jerárquica de tareas con subtareas anidadas **sin límite de nivel** (número "1.1.13.3.1", nombre, asignado a, fecha inicio, fecha fin, progreso %, estado, nivel), más una línea de tiempo (Gantt) mejorada con zoom Mes/Trimestre/Semestre/Año/Todo (hoy el Gantt solo tiene Mes/Semana/Día), resaltado de la fecha de **entrega** (hoy solo resalta "hoy"), y modo pantalla completa (hoy no existe fullscreen en ningún componente).

**Decisiones ya tomadas por el usuario:** jerarquía ilimitada (árbol real, no solo 2 niveles); es una vista nueva independiente que convive con el Gantt/Kanban/lista actuales, no los reemplaza.

**Nota de coordinación:** el módulo de reportería (`plan-modulo-reportes-FASES.md`) ya está implementado completo (fases 0-14, commits hasta `41e28e4`) y reservó las migraciones 012-018. Esta iniciativa es independiente y numera su migración **019**.

---

## Resumen de decisiones de modelo de datos

**1. Forma de datos: lista plana con `parent_id`, NO árbol anidado.**

Hoy existen múltiples estructuras que referencian actividades por `id` en un mapa plano indexado por posición del array: `buildActivityIndex()` (`formulas.js:246-252`), `task_status.{completed,in_progress,not_started}` (arrays de `id`), la numeración por posición en `GanttChart.jsx:43-47` y `EditView.jsx:408`, y `syncActividadesDetalle` (`db-operations.cjs:556+`) que hace DELETE+INSERT de una fila plana por actividad en SQL.

Un árbol anidado (`children: []` recursivo) obligaría a reescribir todas esas funciones para recorrer recursivamente. Una lista plana con `parent_id: string|null` es **aditiva**: se agrega un campo a `createActivity()`, todo lo demás sigue funcionando igual porque sigue viendo el mismo array plano con los mismos `id`. El árbol se reconstruye en memoria, on-demand, solo donde se necesita (la vista nueva), vía un índice `id → children[]`.

**2. Progreso del padre: calculado (solo lectura) cuando el nodo tiene hijos. Fechas del padre: contenedoras, con auto-extensión — ver punto 2B.**

`act.progress` es hoy manual en todas las actividades. Si una actividad tiene hijos, la vista jerárquica **muestra** el progreso calculado (promedio de hijos, recursivo), pero no lo persiste — se recalcula en cada render. El campo `act.progress` del padre queda en el dato sin usarse por esta vista, para no romper otras vistas que lo lean.

**2B. Motor de fechas: dependencias secuenciales entre hermanas + contención jerárquica con auto-extensión (decisión explícita del usuario, distinta del diseño original del agente Plan).**

El usuario pidió un comportamiento específico de programación de tareas, tipo MS Project real:

- **Las subtareas de un mismo padre tienen un orden secuencial explícito** (`sequence_order`, ver campo nuevo abajo). Si una subtarea se atrasa (su `due_date` real/proyectada se corre más allá de lo planeado), **empuja hacia adelante a la siguiente en el orden** — como fichas de dominó — y así sucesivamente hasta la última hermana.
- **La tarea madre se auto-extiende silenciosamente** para seguir conteniendo a todas sus hijas: `due_date` de la madre = `max(due_date)` de sus hijas directas (recursivo hacia arriba, nivel por nivel), sin pedir confirmación.
- **Contención hacia abajo:** si alguien intenta guardar una subtarea con fechas fuera del rango de la madre, **no se bloquea** — la madre se extiende sola para cubrirla (mismo mecanismo que el punto anterior, es la misma regla vista desde dos direcciones).

Esto es una **capa de negocio nueva**, no solo presentación: a diferencia del progreso (que es puramente derivado y no se guarda), el recálculo en cascada de fechas **sí escribe** `start_date`/`due_date` en las actividades afectadas (la madre, y las hermanas siguientes en la cadena), porque esas fechas siguen siendo el campo real que usan el Gantt, el Kanban y los reportes existentes. Ver Fase 2B para el diseño del motor.

**3. Numeración jerárquica: derivada en render, nunca almacenada.** Mismo patrón que ya usa `buildActivityIndex` (comentario explícito en `formulas.js:245`: la posición nunca se guarda). Persistir "1.1.13.3.1" se desincronizaría en el primer reorden o cambio de padre. El **orden secuencial entre hermanas** (`sequence_order`) es distinto de la numeración: la numeración es 100% derivada de la posición en el árbol; `sequence_order` si se persiste, porque es la base de la que depende el motor de cascada (no se puede derivar de "la posición en el array" sin más, porque el usuario puede querer reordenar sin que eso dispare recálculo de fechas hasta que él lo confirme — ver Fase 2B).

**4. Checklist existente: se queda como concepto separado.** `checklist` (`{id,text,done}`) no tiene fechas/asignado/progreso — no se migra automáticamente. Se ofrece una acción manual opcional por ítem: "Convertir en subtarea" (Fase 7), explícita, uno por uno.

**5. Compatibilidad confirmada:** nada existente se rompe. El Gantt actual sigue recibiendo el array plano completo sin cambios de props; las subtareas aparecen como filas más, igual que cualquier actividad hoy. Kanban, modal de detalle, lista de EditView y reportes siguen operando sobre el mismo array sin cambios.

---

## Tabla de fases

| # | Fase | Objetivo verificable | Archivos | Duración | Depende de |
|---|---|---|---|---|---|
| **1** | Modelo de datos + utilidades de árbol (solo frontend) | `createActivity()` acepta `parent_id`/`sequence_order`; `buildActivityTree()`/`flattenTree()`/`computeHierarchicalNumbers()` con tests unitarios pasan | `formulas.js`, `formulas.test.js` | 2 días | — |
| **2** | Motor de dependencias y recálculo en cascada | Atrasar una subtarea empuja a la siguiente hermana en orden y a la madre; tests cubren cadenas de 3+ hermanas y 3+ niveles | `formulas.js` (o `scheduling.js` nuevo), `scheduling.test.js` | 4 días | 1 |
| **3** | Componente de tabla jerárquica (grilla editable) + doble depósito Kanban (raíz vs. todas) | Vista renderiza árbol ilimitado, indenta, colapsa/expande, edita inline; al editar una fecha dispara el motor de la Fase 2 y refleja los cambios en cascada; `GlobalBoardView` gana un modo con dos tableros apilados | `HierarchyTable.jsx` (nuevo), `GlobalBoardView.jsx` | 7 días | 2 |
| **4** | Overlay fullscreen + entrada desde Editar | Botón "Ver planificación completa" abre overlay `position:fixed;inset:0` | `EditView.jsx`, `FullscreenOverlay.jsx` (nuevo) | 2 días | 3 |
| **5** | Zoom de Gantt: Mes/Trimestre/Semestre/Año/Todo | 5 niveles, "Año" agrega por mes (no por día), legible | `GanttChart.jsx`, `App.css` | 3 días | — (paralelo a 1-4) |
| **6** | Resaltado de `due_date` en Gantt | Marca de vencimiento visible junto a "hoy", con leyenda | `GanttChart.jsx`, `App.css` | 1 día | 5 |
| **7** | Persistencia a SQL de `parent_id`/`sequence_order` | Migración 019 aplicada; sync sin perder jerarquía ni orden en reinicio | `backend/migrations/019_add_activity_hierarchy.sql`, `db-operations.cjs` | 3 días | 1, 2 |
| **8** | Conversión manual "checklist → subtarea" | Botón en modal crea actividad-hija desde un ítem de checklist | `ActivityDetailModal.jsx` | 1 día | 1, 7 |
| **9** | Pulido, teclado, documentación | Navegación por teclado en la grilla, `DOCUMENTACION_APP.md` actualizado | `HierarchyTable.jsx`, `DOCUMENTACION_APP.md` | 2 días | 3, 4 |

**Total estimado:** ~25 días hábiles (~5 semanas), con Fases 5-6 en paralelo a 1-4.
**Se puede entregar sin tocar SQL** completando fases 1-6, 8 (parcial) y 9 — la persistencia (Fase 7) es la única con migración de base de datos.

**Por qué creció el plan respecto a la primera versión:** las decisiones de "encadenar hermanas secuencialmente" + "auto-extender la madre" introducen una fase de motor de negocio (Fase 2) que no estaba en el diseño original — el diseño original solo calculaba progreso/fechas del padre como derivado de solo lectura, sin escribir nada ni propagar entre hermanas. Ahora hay un algoritmo con estado que sí escribe fechas en cascada, y necesita su propia batería de pruebas antes de exponerse en la UI (Fase 3 depende de la Fase 2 terminada y probada, no en paralelo).

---

## Detalle por fase

### Fase 1 — Modelo de datos y utilidades de árbol

`frontend/src/utils/formulas.js` — ampliar `createActivity()`:

```js
export function createActivity(text = "", parentId = null, sequenceOrder = 0) {
  return {
    id: genActivityId(),
    parent_id: parentId,        // id de otra actividad, o null = nivel raíz
    sequence_order: sequenceOrder, // orden entre hermanas del mismo padre — base del motor de cascada (Fase 2)
    text,
    // ...resto de campos sin cambios
  };
}
```

Dos campos nuevos: `parent_id` y `sequence_order`. Actividades existentes sin `parent_id` se tratan como `null` (raíz); sin `sequence_order`, se ordenan por posición actual en el array la primera vez que se abre la vista jerárquica (asignación perezosa, una sola vez).

Funciones nuevas, junto a `buildActivityIndex`:

```js
// Construye children[] por id, ordenados por sequence_order, ignorando huérfanas/ciclos.
export function buildActivityTree(activities) { ... } // { rootIds, childrenOf: Map }

// Recorre en preorden (respetando sequence_order), array plano de { activity, level, path }.
// path = [1,1,13,3,1] — números 1-based por nivel, level = path.length - 1.
export function flattenTree(activities, { collapsedIds } = {}) { ... }

export function formatHierarchyNumber(path) { return path.join("."); }

// Progreso agregado (recursivo, no persistido — solo lectura).
export function aggregatedProgress(activity, childrenOf) { ... }

// Obligatoria: protege contra mover una tarea a un descendiente suyo.
export function wouldCreateCycle(activities, activityId, newParentId) { ... }
```

**Nota:** `aggregatedDateRange` de la primera versión de este plan se retira de aquí — las fechas del padre ya no son un simple min/max de solo lectura, son el resultado del motor de la Fase 2 (que sí escribe). Ver Fase 2.

**Verificar:** tests unitarios — árbol de 5 niveles, nodo sin hijos, ciclo detectado, `parent_id` huérfano tratado como raíz, `sequence_order` asignado correctamente en la migración perezosa de datos existentes.

### Fase 2 — Motor de dependencias y recálculo en cascada

Este es el núcleo nuevo que no existía en el diseño original. Implementa la decisión del usuario: **las hermanas están encadenadas en orden secuencial; si una se atrasa, empuja a la siguiente; la madre se auto-extiende para seguir conteniendo a todas sus hijas, en cascada hacia arriba por cada nivel.**

`frontend/src/utils/scheduling.js` (nuevo, funciones puras, sin React ni SQL — se puede testear aislado):

```js
// Recalcula fechas tras un cambio en UNA actividad. Devuelve la lista de
// TODAS las actividades cuyas fechas cambiaron como efecto de la cascada
// (la propia, sus hermanas siguientes, y sus ancestros), lista para aplicar
// con un solo onChangeActivity por cada una — nunca muta el array de entrada.
export function rescheduleAfterChange(activities, changedActivityId) {
  // 1. Ubicar la actividad cambiada y sus hermanas (mismo parent_id),
  //    ordenadas por sequence_order.
  // 2. Si su due_date real supera lo que tenía antes del cambio (atraso):
  //    - la siguiente hermana en sequence_order, si empieza antes de que
  //      la actual termine, se recorre: su start_date pasa a ser
  //      due_date_actual + 1 día hábil, conservando su propia duración
  //      (due_date_nueva = start_date_nueva + duración_original).
  //    - se repite en cadena para cada hermana siguiente que quede solapada.
  // 3. Con las hermanas ya resueltas, el due_date de la MADRE se recalcula
  //    como max(due_date) de todas sus hijas directas — auto-extensión
  //    silenciosa, sin pedir confirmación (decisión del usuario).
  // 4. Se repite el paso 3 recursivamente hacia arriba: si la madre creció,
  //    puede a su vez empujar a SUS hermanas y afectar a SU madre — mismo
  //    algoritmo aplicado un nivel más arriba.
  // 5. Se detiene cuando se llega a la raíz o cuando un nivel no produce
  //    cambios (idempotencia — una segunda pasada sobre el mismo estado
  //    no debe seguir generando cambios).
  return [{ id, start_date, due_date }, ...]; // solo las que realmente cambiaron
}

// Usa businessDaysBetween/festivos de Colombia ya existentes en formulas.js
// para que "un día hábil de atraso" sea consistente con el resto de la app.
```

**Reglas explícitas que fija esta fase (para que la UI de la Fase 3 no tenga que inventarlas):**
- El adelanto (una tarea termina ANTES de lo previsto) **no** empuja a las hermanas hacia atrás automáticamente — solo el atraso empuja hacia adelante. Adelantar fechas manualmente es una acción explícita del usuario en cada tarea, no una propagación automática (evita sorpresas de fechas moviéndose solas hacia atrás sin que el usuario lo pidiera).
- Si dos hermanas no están solapadas en el tiempo (la siguiente ya empezaba después de que la actual, atrasada, termine), no se produce ningún corrimiento — el atraso "cabía" sin chocar con nadie.
- El motor **no** conoce de fines de semana/festivos por sí mismo — reutiliza `businessDaysBetween`/el calendario de festivos colombianos ya existente en `formulas.js:177-205` para que el corrimiento de "un día" sea un día hábil real, consistente con el resto de la app.
- Este motor es **puro**: recibe el array completo y el id que cambió, devuelve la lista de parches a aplicar. Quien lo llama (`HierarchyTable`, Fase 3) decide cómo aplicar esos parches (uno o varios `onChangeActivity`) y puede mostrar un resumen tipo "Este cambio también movió 3 tareas más" antes o después de aplicar.

**Verificar (batería de tests, `scheduling.test.js`):** cadena de 3 hermanas donde la primera se atrasa 5 días hábiles → las 3 se recorren, la madre se extiende; cadena de 3 hermanas sin solape → atraso de la primera no mueve a las demás; 3 niveles de profundidad → el atraso de una nieta llega hasta la abuela; caso de adelanto → no dispara cascada; ejecutar el motor dos veces seguidas sobre el mismo resultado → segunda pasada no produce cambios (idempotencia).

### Fase 3 — Tabla jerárquica

`frontend/src/components/HierarchyTable.jsx` (nuevo):

```js
export default function HierarchyTable({
  activities, taskStatus, engineerCatalog,
  onChangeActivity,   // (id, patch) => void — aplica un solo parche
  onBulkChange,       // (patches[]) => void — aplica varios a la vez (resultado del motor de Fase 2)
  onAddChild,         // (parentId|null) => void
  onDeleteActivity,   // (id) => void
  onReparent,         // (id, newParentId) => void
  onOpenActivity,     // (id) => void
}) { ... }
```

Columnas: `#` (número jerárquico calculado), Nombre (indentado `level*20px` + toggle expandir/colapsar), Asignado a, Inicio, Fin, Progreso %, Estado, Nivel. Colapso: `useState(new Set())` local, no persistido. Edición inline por celda (mismo patrón que `TaskStatusSelector`/`StatusDateBadge` en `EditView.jsx`).

**Al editar `start_date`/`due_date` de cualquier fila:** se guarda el cambio con `onChangeActivity`, y a continuación se llama `rescheduleAfterChange` (Fase 2) sobre el estado resultante; si devuelve parches adicionales, se aplican con `onBulkChange` y se muestra un aviso breve no bloqueante: *"Este cambio también ajustó N tarea(s) más"* (con detalle desplegable, sin modal de confirmación — la extensión es automática por decisión del usuario, el aviso es solo informativo). **Si el nodo tiene hijos**, la celda de Progreso se muestra de solo lectura (calculada, tooltip "calculado de N subtareas"); las celdas de Inicio/Fin del padre siguen siendo visualmente fechas reales (ya no "calculadas aparte" como en el diseño original, sino el resultado ya escrito por el motor) pero con un indicador visual sutil (ej. ícono de candado o itálica) de que están gobernadas por sus hijas y se auto-ajustarán si estas cambian.

Botón "+ Agregar subtarea" on-hover por fila (nueva subtarea recibe `sequence_order` = última + 1 entre sus hermanas). Mover de padre: menú contextual simple (no drag-and-drop en esta entrega). Reordenar entre hermanas (cambiar `sequence_order`): botones ↑/↓ por fila — mover una tarea en el orden dispara el mismo motor de recálculo por si el nuevo orden genera un solape.

**Verificar:** árbol de 4+ niveles con 20+ nodos; atrasar una subtarea intermedia y confirmar visualmente que las siguientes y la madre se corrieron; deshacer manualmente y confirmar que no queda en un estado inconsistente.

#### Fase 3B — Doble depósito Kanban: tareas principales vs. todas las actividades

Pedido adicional del usuario, una vez visto el diseño de jerarquía: además de la tabla, quiere ver el mismo concepto en formato Kanban con **dos tableros apilados**, uno debajo del otro:
- **Depósito 1 — Tareas principales:** solo actividades raíz (`parent_id === null`), agrupadas por Estado (No iniciada/En proceso/Completada). Es la vista de "panorama" — cuántos objetivos grandes hay y en qué estado.
- **Depósito 2 — Todas las actividades:** raíz + subtareas de cualquier nivel, mismas 3 columnas. Es la vista de detalle operativo completo.

**Ya existe la base para esto: `GlobalBoardView.jsx`.** Hoy agrupa "por Estado" usando `flattenActivities()` (`:53-69`), que aplana **todas** las actividades de todos los proyectos sin distinguir nivel jerárquico (porque hoy no existe jerarquía). Con `parent_id` ya disponible (Fase 1), el cambio es acotado:

```js
// GlobalBoardView.jsx — flattenActivities() gana un flag por actividad
function flattenActivities(projects) {
  const out = [];
  (projects || []).forEach(p => {
    visibleActivities(p.activities_identified).forEach(a => {
      out.push({
        id: `${p.id}:${a.id}`,
        // ...campos existentes sin cambios...
        isRoot: !a.parent_id,   // NUEVO — true si no tiene padre
      });
    });
  });
  return out;
}
```

Y el render, cuando `agrupar === "estado"`, en vez de una sola grilla de columnas pinta dos:

```jsx
{agrupar === "estado" ? (
  <>
    <h3 className="global-board__deposito-title">Depósito 1 — Tareas principales</h3>
    <BoardColumns columnas={ESTADO_COLS} actividades={actividades.filter(a => a.isRoot)} />

    <h3 className="global-board__deposito-title">Depósito 2 — Todas las actividades</h3>
    <BoardColumns columnas={ESTADO_COLS} actividades={actividades} />
  </>
) : (
  <BoardColumns columnas={columnas} actividades={actividades} />
)}
```

(`BoardColumns` es una extracción del bloque `.global-board__columns` que ya existe en `:121-143`, parametrizado por lista de actividades — refactor mínimo, no un componente nuevo desde cero.) Los otros modos de agrupación (Ingeniero/Proyecto/Vencimiento) **no** se duplican en dos depósitos — el pedido del usuario es específicamente sobre el agrupador "Estado", que es donde tiene sentido distinguir "objetivo" de "detalle". Se agrega un contador en cada título: *"Depósito 1 — Tareas principales (N)"* para que sea evidente que son universos distintos, no dos copias del mismo dato.

**Sigue siendo de solo lectura**, igual que el resto de `GlobalBoardView` hoy (comentario de cabecera `:6-11`) — no se agrega edición inline aquí, eso ya lo cubre la tabla jerárquica de la Fase 3 principal.

**Verificar:** con un proyecto que tenga 5 tareas raíz y 15 subtareas repartidas entre ellas, el Depósito 1 muestra 5 tarjetas en total repartidas en las 3 columnas, el Depósito 2 muestra 20.

### Fase 4 — Overlay fullscreen

**Decisión: overlay `position:fixed;inset:0`, no Fullscreen API.** La API nativa requiere gesto de usuario, tiene comportamiento inconsistente entre navegadores y complica z-index/scroll. Un overlay fijo da el mismo resultado visual con control total y es consistente con `ActivityDetailModal` (ya usa `position:fixed`).

`frontend/src/components/FullscreenOverlay.jsx` (nuevo, genérico):

```js
export default function FullscreenOverlay({ open, onClose, title, children }) { ... }
// position:fixed; inset:0; z-index alto; Escape cierra; scroll interno propio.
```

`EditView.jsx`: botón "Ver planificación completa" cerca del Gantt (`~:2008-2044`) que abre `<FullscreenOverlay><HierarchyTable .../></FullscreenOverlay>`.

**Navegación:** acción dentro de Editar, no pestaña nueva — con la pestaña Reportes ya sumada, una 8ª pestaña dedicada a una función que aplica a un solo proyecto sería excesivo (igual criterio que ya aplican el Gantt y el Kanban actuales).

### Fase 5 — Zoom de Gantt ampliado

`GanttChart.jsx` — reemplazar `ZOOM_LEVELS` (`:10-14`) por 5-6 niveles con cambio de **unidad de agregación**, no solo más zoom-out:

```js
const ZOOM_LEVELS = [
  { label: "Semana",    unit: "day",   pxPerUnit: 14 },
  { label: "Mes",       unit: "day",   pxPerUnit: 4  },
  { label: "Trimestre", unit: "week",  pxPerUnit: 10 },
  { label: "Semestre",  unit: "week",  pxPerUnit: 5  },
  { label: "Año",       unit: "month", pxPerUnit: 30 },
  { label: "Todo",      unit: "month", pxPerUnit: "auto" },
];
```

Se conservan Semana/Mes actuales y se agregan Trimestre/Semestre/Año/Todo. Cuando `unit !== "day"`, el eje de ticks y el offset/span de barras se calculan en semanas o meses — requiere generalizar los helpers locales (`toDate`, `dayDiff`, `:21-25`) a `unitDiff(start, date, unit)`. **Es la parte técnicamente más delicada**: no es un ajuste de `pxPerDay`, es una segunda vía de cálculo de posición para que a nivel "Año" una barra de 2 semanas siga siendo visible. "Todo": `pxPerUnit` se calcula dinámicamente (`containerWidth / totalMonths`).

**Verificar:** proyecto con actividades en 18+ meses, confirmar en "Año" que las etiquetas no se solapan y las barras siguen siendo clicables.

### Fase 6 — Resaltado de vencimiento

Junto a `.gantt__today` (`:112-116, 167-173`), agregar marca en el extremo derecho de la barra cuando está vencida:

```js
const isOverdue = st !== "completed" && toDate(a.due_date) && toDate(a.due_date) < today;
// className `gantt__bar--overdue` → borde rojo (#c0392b) + ⚠ al final de la barra
```

Distinto de la línea de "hoy" (marca el momento actual en el eje): esto marca la barra individual vencida. Agregar entrada a la leyenda existente.

### Fase 7 — Persistencia a SQL

`backend/migrations/019_add_activity_hierarchy.sql` (nuevo — siguiente número libre tras la 018 existente):

```sql
DECLARE @tbl SYSNAME = 'dbo.Actividades_Detalle';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'ParentAppActividadID')
BEGIN
  ALTER TABLE dbo.Actividades_Detalle ADD ParentAppActividadID NVARCHAR(60) NULL;
  PRINT 'Columna ParentAppActividadID agregada.';
END ELSE PRINT 'Columna ParentAppActividadID ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID(@tbl) AND name = 'SequenceOrder')
BEGIN
  ALTER TABLE dbo.Actividades_Detalle ADD SequenceOrder INT NOT NULL DEFAULT 0;
  PRINT 'Columna SequenceOrder agregada.';
END ELSE PRINT 'Columna SequenceOrder ya existe, se omite.';

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ActividadesDetalle_Parent' AND object_id = OBJECT_ID(@tbl))
BEGIN
  CREATE INDEX IX_ActividadesDetalle_Parent ON dbo.Actividades_Detalle(ParentAppActividadID);
  PRINT 'Índice IX_ActividadesDetalle_Parent creado.';
END ELSE PRINT 'Índice ya existe, se omite.';
```

Sin columna `Nivel` (no se persiste, se deriva). `SequenceOrder` sí se persiste porque el motor de la Fase 2 lo necesita para reconstruir el orden de hermanas tras un reinicio del backend. Sin FK dura (mismo patrón laxo del resto de la tabla).

`backend/db-operations.cjs` (`syncActividadesDetalle`, `~:608-616`): dos `input` más en el INSERT bulk existente, sin cambiar el patrón DELETE+INSERT:

```js
detReq.input(`dParentId${di}`, sql.NVarChar(60), act.parent_id || null);
detReq.input(`dSeqOrder${di}`, sql.Int, act.sequence_order || 0);
```

Agregar `ParentAppActividadID` y `SequenceOrder` a las columnas del INSERT. En la lectura simétrica (reconstrucción de `activities_identified` desde SQL), agregar `parent_id: row.ParentAppActividadID || null` y `sequence_order: row.SequenceOrder || 0`.

**Verificar:** guardar proyecto con 3 niveles de subtareas y un atraso ya propagado, reiniciar backend, recargar, confirmar que `parent_id`, `sequence_order` y las fechas ya recalculadas sobreviven idénticas.

### Fase 8 — Conversión checklist → subtarea

`ActivityDetailModal.jsx`: botón por ítem de checklist "Convertir en subtarea" → callback `onConvertChecklistItem(activityId, checklistItemId)` que crea `createActivity(item.text, activityId)` y remueve el ítem del checklist origen. Sin cambios de esquema.

### Fase 9 — Pulido y documentación

Navegación por teclado en `HierarchyTable` (flechas, Enter para expandir/colapsar), roles ARIA `treegrid`/`row`/`gridcell`, actualizar `DOCUMENTACION_APP.md` — incluyendo una explicación en lenguaje claro de la regla de cascada (para que quien use la app entienda por qué una fecha se movió sola).

---

## Compatibilidad — qué no se rompe y por qué

- **Gantt actual:** sigue recibiendo `activities` plano sin cambios de props (Fases 1-3). Subtareas aparecen como filas más, igual que cualquier actividad.
- **Kanban** (`TaskStatusSelector`, `GlobalBoardView.jsx`): siguen leyendo `task_status` como arrays de `id` — subtareas se clasifican igual, sin cambios de código.
- **`ActivityDetailModal.jsx`:** sigue editando por `id` sin necesitar saber de jerarquía (salvo la Fase 8, aditiva).
- **`ActivitiesList` de `EditView.jsx`:** numeración `i+1` sigue funcionando como posición plana.
- **`buildActivityIndex`/`activityLabel`, `ReportView.jsx`, `MetricsTable.jsx`, `engineers.js`:** operan sobre el array plano sin cambios.
- **`syncActividadesDetalle`:** mismo patrón DELETE+INSERT, dos campos más (`parent_id`, `sequence_order`).
- **Módulo de reportería** (`Actividad_Eventos`, motor de consultas): no se toca; las columnas `ParentAppActividadID`/`SequenceOrder` quedan disponibles si en el futuro se quiere loguear cambios de jerarquía o de fecha-en-cascada como evento.

---

## Riesgos y observaciones antes de aprobar

1. **Jerarquía ilimitada exige proteger contra ciclos activamente** — `wouldCreateCycle()` (Fase 1) es obligatoria; sin ella, un árbol mal formado cuelga el render en bucle infinito.
2. **El motor de cascada (Fase 2) es la pieza de mayor riesgo técnico de todo el plan**, más que el propio árbol. Un algoritmo de recálculo con estado que se llama a sí mismo hacia arriba por niveles necesita, obligatoriamente: (a) una condición de parada verificada (idempotencia — correrlo dos veces sobre el mismo estado no debe seguir moviendo fechas), (b) protección para no entrar en bucle si por error existiera un ciclo en `parent_id` que `wouldCreateCycle` no haya atrapado a tiempo, y (c) una batería de pruebas que se escriba **antes** de conectarlo a la UI (por eso la Fase 3 depende de que la Fase 2 esté terminada y probada, no en paralelo). Recomiendo no subestimar esta fase por parecer "solo backend/lógica" — es donde puede aparecer el bug más difícil de diagnosticar del proyecto (fechas que se mueven solas de forma inesperada).
3. **El adelanto no propaga hacia atrás, por diseño** — si el usuario espera que adelantar una tarea también adelante a las siguientes automáticamente, se va a sorprender con que no ocurre. Es una decisión deliberada (ver Fase 2) para evitar que fechas se corran solas sin que el usuario lo pidiera, pero vale la pena confirmarla explícitamente la primera vez que se vea funcionando, antes de considerarla cerrada.
4. **Límite práctico de indentación visual** — a partir de ~8-10 niveles el nombre de la tarea queda con poco ancho horizontal. "1.1.13.3.1" (5 niveles, de tu imagen) es razonable; no bloqueante, pero conviene saberlo.
5. **Drag-and-drop se deja fuera de esta entrega** — Fase 3 usa menú contextual y botones ↑/↓ para reparentar/reordenar. Se puede agregar después si hace falta.
6. **La Fase 5 (zoom de Gantt) es la parte más delicada del lado puramente visual** — no es ajustar `pxPerDay`, es generalizar los helpers de fecha a 3 unidades distintas. Subestimarla produce un "Año" ilegible.
7. **El plan creció de ~19 a ~24 días hábiles** por el motor de cascada (Fase 2, 4 días) y la complejidad añadida a la tabla jerárquica (Fase 3, 6 días en vez de 5) — es el costo real y esperado de la funcionalidad de "programación de tareas" tipo MS Project que se pidió, no una desviación del alcance original.

---

## Archivos críticos

- [frontend/src/utils/formulas.js](frontend/src/utils/formulas.js) — `createActivity()`, `buildActivityIndex:246-252`, `businessDaysBetween:208-221` y festivos colombianos `:182-205` (reutilizados por el motor de cascada), nuevas funciones de árbol
- [frontend/src/utils/scheduling.js](frontend/src/utils/scheduling.js) — nuevo, motor de cascada (Fase 2), el archivo más crítico de todo el plan
- [frontend/src/components/GanttChart.jsx](frontend/src/components/GanttChart.jsx) — `ZOOM_LEVELS:10-14`, `.gantt__today:112-116,167-173`, helpers locales `:21-25`
- [frontend/src/components/EditView.jsx](frontend/src/components/EditView.jsx) — `ActivitiesList:189-504`, `TaskStatusSelector:919+`, sección Gantt `~:2008-2044`
- [backend/db-operations.cjs](backend/db-operations.cjs) — `syncActividadesDetalle:556+`, INSERT bulk `~:608-616`
- [backend/migrations/018_add_users_and_sessions.sql](backend/migrations/018_add_users_and_sessions.sql) — última migración existente; la nueva es 019
