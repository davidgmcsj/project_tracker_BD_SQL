// HierarchyTable.jsx — Tabla jerárquica de tareas (tipo MS Project), con
// subtareas ilimitadas, numeración "1.1.13.3.1" derivada en render, y motor
// de recálculo en cascada al editar fechas (ver utils/scheduling.js).
//
// Vive dentro de EditView, abierta desde el botón "Ver planificación completa"
// (FullscreenOverlay). Opera sobre activities_identified del proyecto activo,
// el mismo array plano que usan el Gantt, el Kanban y los reportes — el
// árbol se reconstruye en memoria aquí, sin cambiar la forma de los datos.
//
// De solo lectura salvo fechas de inicio/fin, estado (columna "Estado", vía
// onChangeStatus — mismo mecanismo que transitionActivityStatus/el selector
// de ActivityDetailModal, para no tener tres implementaciones divergentes de
// "mover una actividad entre buckets de task_status", incluida la cadena
// automática de despliegue — ver canTransitionTo/isDesarrollo) y el orden de
// las filas (drag & drop entre hermanas — ver reorderSiblings). Asignado y
// progreso siguen editándose solo desde ActivityDetailModal (clic en el nombre).
//
// El número "1.1, 1.2…" es puramente posicional (deriva de sequence_order,
// no se guarda como tal) — antes solo reflejaba el orden de creación, sin
// forma de cambiarlo salvo borrar y recrear. Arrastrar una fila sobre otra
// hermana (mismo parent_id) renumera todo ese grupo; soltar sobre una fila
// de otro padre no hace nada (reorderSiblings devuelve null).

import { useMemo, useState } from "react";
import {
  buildActivityTree, flattenTree, formatHierarchyNumber, formatDateDMY,
  aggregatedProgress, getActivityStatus, shortEngineerName, canTransitionTo, isDesarrollo, reorderSiblings,
} from "../utils/formulas";
import { rescheduleAfterChange } from "../utils/scheduling";
import { ESTADO_ACTIVIDAD_LABEL, estadoActividadKey } from "../utils/filtroOpciones";
import { matchesSearch } from "../utils/search";
import { exportPlanning } from "../utils/storage";
import DateInput from "./common/DateInput";

// getActivityStatus (formulas.js) devuelve labels en ESPAÑOL ("Completada",
// "En proceso", "No iniciada") porque así los consumen los reportes de texto.
// Este componente necesita las claves internas en inglés (not_started/
// in_progress/completed) para sus propios estilos y filtros — la traducción
// vive en utils/filtroOpciones.js (estadoActividadKey), fuente única para
// toda la app, y evita el bug de comparar español contra inglés.

// Filtro de la vista (no toca el dato, solo qué filas se muestran).
const STATUS_FILTERS = [
  { value: "all",          label: "Todas" },
  { value: "not_started",  label: "No iniciadas" },
  { value: "in_progress",  label: "En proceso" },
  { value: "completed",    label: "Completadas" },
];

const STATUS_CLASS = {
  not_started:          "htable__status-pill--not-started",
  in_progress:          "htable__status-pill--in-progress",
  ambiente_pruebas:     "htable__status-pill--ambiente-pruebas",
  ambiente_produccion:  "htable__status-pill--ambiente-produccion",
  completed:            "htable__status-pill--completed",
};

// Mismo orden que las columnas del Kanban (TaskStatusSelector) — claves
// internas en inglés, label vía ESTADO_ACTIVIDAD_LABEL (fuente única).
const STATUS_SELECT_KEYS = ["not_started", "in_progress", "ambiente_pruebas", "ambiente_produccion", "completed"];

function statusKey(taskStatus, actId) {
  return estadoActividadKey(getActivityStatus(taskStatus, actId));
}

const EXPORT_COLUMNS = ["numero", "actividad", "asignado", "inicio", "fin", "progreso", "estado"];

// Arma las filas exportables a partir de las mismas filas ya visibles en
// pantalla (`rows`, tras el filtro de estado/texto activo) — lo que exporta
// el usuario es exactamente lo que está viendo. childrenOf se necesita para
// el % agregado de los padres (aggregatedProgress), igual que ya usa la tabla.
function buildHierarchyExportRows(rows, taskStatus, childrenOf) {
  return rows.map(({ activity: a, path }) => {
    const hasChildren = (childrenOf.get(a.id) || []).length > 0;
    const firstAssignee = (a.assigned_engineers || [])[0];
    return {
      numero:    formatHierarchyNumber(path),
      actividad: a.text || "(sin nombre)",
      asignado:  firstAssignee ? shortEngineerName(firstAssignee.name) : "Sin asignar",
      inicio:    a.start_date ? formatDateDMY(a.start_date) : "",
      fin:       a.due_date ? formatDateDMY(a.due_date) : "",
      progreso:  `${hasChildren ? aggregatedProgress(a, childrenOf) : (a.progress || 0)}%`,
      estado:    getActivityStatus(taskStatus, a.id),
    };
  });
}

// ── Helpers de presentación ───────────────────────────────────────────────────

function nextSequenceOrder(activities, parentId) {
  const siblings = activities.filter(a => (a.parent_id ?? null) === parentId);
  if (!siblings.length) return 0;
  return Math.max(...siblings.map(a => Number(a.sequence_order) || 0)) + 1;
}

// ── Fila individual ───────────────────────────────────────────────────────────

function Row({
  row, hasChildren, expandable, isCollapsed, onToggleCollapse,
  taskStatus, activities,
  onAddChild, onDeleteActivity, onDateChange, onOpenActivity, onChangeStatus,
  aggProgress,
  canReorder, isDragging, isDropTarget, onRowDragStart, onRowDragOver, onRowDragLeave, onRowDrop, onRowDragEnd,
}) {
  const { activity: a, level, path } = row;
  const status = statusKey(taskStatus, a.id);
  const number = formatHierarchyNumber(path);
  const isReadOnlyDates = hasChildren; // fechas gobernadas por el motor de cascada cuando tiene hijos
  const firstAssignee = (a.assigned_engineers || [])[0];

  const [hover, setHover] = useState(false);

  const handleDateChange = (field, value) => {
    onDateChange(a.id, field, value);
  };

  return (
    <tr
      className={[
        "htable__row",
        hasChildren && "htable__row--parent",
        isDragging && "htable__row--dragging",
        isDropTarget && "htable__row--drop-target",
      ].filter(Boolean).join(" ")}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      draggable={canReorder}
      onDragStart={canReorder ? () => onRowDragStart(a.id) : undefined}
      onDragOver={canReorder ? (e) => { e.preventDefault(); onRowDragOver(a.id); } : undefined}
      onDragLeave={canReorder ? () => onRowDragLeave(a.id) : undefined}
      onDrop={canReorder ? (e) => { e.preventDefault(); onRowDrop(a.id); } : undefined}
      onDragEnd={canReorder ? onRowDragEnd : undefined}
    >
      <td className="htable__cell htable__cell--num">
        {canReorder && <span className="htable__drag-handle" title="Arrastra para reordenar entre hermanas">⠿</span>}
        {number}
      </td>
      <td className="htable__cell htable__cell--name">
        <div className="htable__indent" style={{ paddingLeft: level * 20 }}>
          {expandable ? (
            <button type="button" className="htable__toggle" onClick={() => onToggleCollapse(a.id)} title={isCollapsed ? "Expandir" : "Colapsar"}>
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : (
            <span
              className="htable__toggle htable__toggle--spacer"
              title={hasChildren && !expandable ? "Tiene subtareas ocultas — cambia a \"Ver todas\" para verlas" : undefined}
            >
              {hasChildren && !expandable ? "⋯" : ""}
            </span>
          )}
          {a.deployment_role && (
            <span className="htable__auto-badge" title="Subtarea creada automáticamente por la cadena de despliegue">⚙ Auto</span>
          )}
          <button type="button" className="htable__name-text htable__name-text--link" onClick={() => onOpenActivity?.(a.id)} title="Ver detalle completo">
            {a.text || "(sin nombre)"}
          </button>
          {hover && (
            <button type="button" className="htable__add-child" onClick={() => onAddChild(a.id)} title="Agregar subtarea">
              + Subtarea
            </button>
          )}
        </div>
      </td>
      <td className="htable__cell htable__cell--assignee">
        <span
          className="htable__readonly-text"
          title={(a.assigned_engineers || []).map(e => e.name).join(", ") || "Sin asignar"}
        >
          {firstAssignee ? shortEngineerName(firstAssignee.name) : "Sin asignar"}
        </span>
      </td>
      <td className="htable__cell htable__cell--date">
        {isReadOnlyDates ? (
          <span className="htable__readonly" title="Calculado de sus subtareas">🔒 {formatDateDMY(a.start_date)}</span>
        ) : (
          <DateInput className="htable__date" value={a.start_date || ""} onChange={iso => handleDateChange("start_date", iso)} />
        )}
      </td>
      <td className="htable__cell htable__cell--date">
        {isReadOnlyDates ? (
          <span className="htable__readonly" title="Gobernada por sus subtareas — se auto-ajusta si estas cambian">🔒 {formatDateDMY(a.due_date)}</span>
        ) : (
          <DateInput className="htable__date" value={a.due_date || ""} onChange={iso => handleDateChange("due_date", iso)} />
        )}
      </td>
      <td className="htable__cell htable__cell--progress">
        <span className="htable__readonly-text">{hasChildren ? aggProgress : (a.progress || 0)}%</span>
      </td>
      <td className="htable__cell htable__cell--status">
        <select
          className={`htable__status-pill htable__status-pill--select ${STATUS_CLASS[status]}`}
          value={status}
          onChange={e => onChangeStatus(a.id, e.target.value)}
          title="Cambiar estado"
        >
          {STATUS_SELECT_KEYS.map(key => {
            const esAmbiente = key === "ambiente_pruebas" || key === "ambiente_produccion";
            const disabled = (esAmbiente && !isDesarrollo(a)) || !canTransitionTo(a.id, activities, taskStatus, key);
            return (
              <option key={key} value={key} disabled={disabled}>
                {ESTADO_ACTIVIDAD_LABEL[key]}
              </option>
            );
          })}
        </select>
      </td>
      <td className="htable__cell htable__cell--actions">
        <button type="button" className="htable__icon-btn htable__icon-btn--danger" onClick={() => onDeleteActivity(a.id)} title="Eliminar">🗑</button>
      </td>
    </tr>
  );
}

// ── Componente principal ──────────────────────────────────────────────────────

export default function HierarchyTable({
  activities, taskStatus,
  onApplyDateChange, // (patches[]) => void — patch propio + cascada, en una sola actualización
  onAddChild,        // (parentId, sequenceOrder) => void
  onDeleteActivity,  // (id) => void
  onOpenActivity,    // (id) => void — abre ActivityDetailModal desde una fila
  onChangeStatus,    // (activityId, newStatusKey) => void — mueve entre buckets de task_status
  projectName,
}) {
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [cascadeNotice, setCascadeNotice] = useState(null); // { count } — aviso no bloqueante tras un recálculo
  const [statusFilter, setStatusFilter] = useState("all");
  const [textFilter, setTextFilter] = useState("");
  const [levelFilter, setLevelFilter] = useState(2); // 1-4 = profundidad máxima (1=solo raíces), null = todos
  const [exporting, setExporting] = useState(false);
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const acts = useMemo(() => (Array.isArray(activities) ? activities : []), [activities]);
  const { childrenOf } = useMemo(() => buildActivityTree(acts), [acts]);

  const allRowsFull = useMemo(() => flattenTree(acts, { collapsedIds }), [acts, collapsedIds]);

  // Filtro de profundidad máxima: nivel 1 = solo raíces (r.level === 0),
  // nivel 2 = +1er nivel de subtareas (r.level <= 1), etc. — techo fijo
  // recalculado en cada render, distinto de collapsedIds (que el usuario
  // controla fila por fila con el botón ▾/▸).
  const allRows = useMemo(
    () => (levelFilter ? allRowsFull.filter(r => r.level < levelFilter) : allRowsFull),
    [allRowsFull, levelFilter]
  );

  // El filtro no recorta el árbol en crudo: una fila se muestra si ELLA MISMA
  // matchea AMBOS filtros (estado + texto, combinados con AND), o si alguno
  // de sus DESCENDIENTES matchea ambos (así una tarea principal sigue visible
  // mientras tenga subtareas que coincidan, en vez de desaparecer y dejar
  // huérfanas a sus hijas filtradas). El texto vacío matchea siempre
  // (matchesSearch), así que sin escribir nada el comportamiento es idéntico
  // al filtro de estado solo.
  const rows = useMemo(() => {
    if (statusFilter === "all" && !textFilter.trim()) return allRows;
    const matches = new Set();
    allRows.forEach(({ activity }) => {
      const matchesStatus = statusFilter === "all" || statusKey(taskStatus, activity.id) === statusFilter;
      const matchesText = matchesSearch(activity.text || "", textFilter);
      if (matchesStatus && matchesText) matches.add(activity.id);
    });
    const descendantMatches = new Set(matches);
    let changed = true;
    while (changed) {
      changed = false;
      acts.forEach(a => {
        if (a.parent_id && descendantMatches.has(a.id) && !descendantMatches.has(a.parent_id)) {
          descendantMatches.add(a.parent_id);
          changed = true;
        }
      });
    }
    return allRows.filter(({ activity }) => descendantMatches.has(activity.id));
  }, [allRows, statusFilter, textFilter, taskStatus, acts]);

  const toggleCollapse = (id) => {
    setCollapsedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // onAddChild devuelve el id de la subtarea recién creada — se abre su
  // tarjeta de inmediato en vez de dejar que el usuario la busque en la
  // tabla (antes no se abría nada hasta salir y volver a entrar a la vista).
  const handleAddChild = (parentId) => {
    const newId = onAddChild(parentId, nextSequenceOrder(acts, parentId));
    if (newId && onOpenActivity) onOpenActivity(newId);
  };

  // Único punto de entrada para cambios de fecha. Calcula el patch propio Y
  // los patches de cascada ANTES de notificar al padre, y los entrega juntos
  // en una sola llamada — evita la doble escritura de estado que antes hacía
  // que la propia fila editada perdiera su valor nuevo (ver notas del bug en
  // el plan: dos setProjects en el mismo tick, cada uno leyendo el mismo
  // `activities` de closure desactualizado entre sí).
  const handleDateChange = (activityId, field, value) => {
    const previousDue = acts.find(a => a.id === activityId)?.due_date;
    const withOwnChange = acts.map(a => a.id === activityId ? { ...a, [field]: value } : a);
    const cascadePatches = field === "due_date"
      ? rescheduleAfterChange(withOwnChange, activityId, previousDue)
      : [];

    const ownPatch = { id: activityId, [field]: value };
    const allPatches = [ownPatch, ...cascadePatches.filter(p => p.id !== activityId)];

    onApplyDateChange(allPatches);
    if (cascadePatches.length) {
      setCascadeNotice({ count: cascadePatches.length });
      setTimeout(() => setCascadeNotice(null), 6000);
    }
  };

  // Reordenar cambia el número "1.1, 1.2…" (puramente posicional, ver
  // reorderSiblings) — no es un cambio de fecha, pero se persiste por el
  // mismo canal (onApplyDateChange acepta cualquier patch por id, no solo
  // fechas) para no abrir un segundo camino de escritura al proyecto.
  const handleRowDrop = (targetId) => {
    const patches = draggedId ? reorderSiblings(acts, draggedId, targetId) : null;
    if (patches) onApplyDateChange(patches);
    setDraggedId(null);
    setDropTargetId(null);
  };

  // Exporta exactamente las filas visibles en pantalla (mismo filtro de
  // estado/texto ya aplicado) — nunca datos ocultos por el propio filtro.
  const handleExportExcel = async () => {
    setExporting(true);
    try {
      const filas = buildHierarchyExportRows(rows, taskStatus, childrenOf);
      await exportPlanning({ titulo: `Planificacion - ${projectName || "Proyecto"}`, columnas: EXPORT_COLUMNS, filas }, "xlsx");
    } catch (e) {
      alert(`No se pudo exportar el Excel: ${e.message}`);
    } finally {
      setExporting(false);
    }
  };

  if (!acts.length) {
    return <div className="htable-empty">No hay actividades registradas en este proyecto todavía.</div>;
  }

  return (
    <div className="htable-wrap">
      <div className="htable-toolbar">
        <span className="htable-toolbar__label">Niveles:</span>
        <select
          className="htable-toolbar__level-select"
          value={levelFilter || ""}
          onChange={e => setLevelFilter(e.target.value ? Number(e.target.value) : null)}
          title="Profundidad máxima de subtareas a mostrar"
        >
          <option value="">Todos los niveles</option>
          <option value="1">Nivel 1 (solo principales)</option>
          <option value="2">Nivel 2</option>
          <option value="3">Nivel 3</option>
          <option value="4">Nivel 4</option>
        </select>
        <span className="htable-toolbar__sep" />
        <span className="htable-toolbar__label">Mostrar:</span>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value} type="button"
            className={`htable-toolbar__chip ${statusFilter === f.value ? "htable-toolbar__chip--on" : ""}`}
            onClick={() => setStatusFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <span className="htable-toolbar__sep" />
        <input
          type="text"
          className="htable-toolbar__search"
          placeholder="🔍 Buscar actividad…"
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
        />
        {textFilter.trim() && (
          <button type="button" className="htable-toolbar__chip" onClick={() => setTextFilter("")}>✕ Limpiar</button>
        )}
        <span className="htable-toolbar__count">{rows.length} de {allRowsFull.length}</span>
        {(statusFilter !== "all" || textFilter.trim()) && (
          <span className="htable-toolbar__hint">Con un filtro activo no se puede reordenar — quita el estado y la búsqueda primero.</span>
        )}
        <button type="button" className="htable-toolbar__chip" onClick={handleExportExcel} disabled={exporting}>
          {exporting ? "Generando…" : "📊 Exportar Excel"}
        </button>
      </div>

      {cascadeNotice && (
        <div className="htable__cascade-notice">
          Este cambio también ajustó {cascadeNotice.count} tarea{cascadeNotice.count !== 1 ? "s" : ""} más.
        </div>
      )}
      <div className="htable-scroll">
        <table className="htable">
          {/* table-layout:fixed necesita <colgroup> para que una columna sin
              width tome el espacio sobrante — sin esto (como antes), el
              ancho de "Nombre" salía del <th> de esa misma columna (una
              palabra corta) en vez de repartir el resto del 100% de la
              tabla, dejando un hueco en blanco a su lado. Con colgroup, la
              columna de Nombre (sin <col> propio) es la única que absorbe
              el espacio libre; el resto tiene su ancho fijo real. */}
          <colgroup>
            <col style={{ width: 44 }} />
            <col />
            <col style={{ width: 160 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 130 }} />
            <col style={{ width: 90 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 40 }} />
          </colgroup>
          <thead>
            <tr>
              <th className="htable__cell--num">#</th>
              <th className="htable__cell--name">Nombre</th>
              <th className="htable__cell--assignee">Asignado a</th>
              <th className="htable__cell--date">Inicio</th>
              <th className="htable__cell--date">Fin</th>
              <th className="htable__cell--progress">Progreso</th>
              <th className="htable__cell--status">Estado</th>
              <th className="htable__cell--actions"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <Row
                key={row.activity.id}
                row={row}
                hasChildren={(childrenOf.get(row.activity.id) || []).length > 0}
                expandable={(childrenOf.get(row.activity.id) || []).length > 0 && (!levelFilter || row.level < levelFilter - 1)}
                isCollapsed={collapsedIds.has(row.activity.id)}
                onToggleCollapse={toggleCollapse}
                taskStatus={taskStatus}
                activities={acts}
                onAddChild={handleAddChild}
                onDeleteActivity={onDeleteActivity}
                onDateChange={handleDateChange}
                onOpenActivity={onOpenActivity}
                onChangeStatus={onChangeStatus}
                aggProgress={aggregatedProgress(row.activity, childrenOf)}
                canReorder={statusFilter === "all" && !textFilter.trim()}
                isDragging={draggedId === row.activity.id}
                isDropTarget={dropTargetId === row.activity.id && draggedId !== row.activity.id}
                onRowDragStart={setDraggedId}
                onRowDragOver={setDropTargetId}
                onRowDragLeave={(id) => setDropTargetId(prev => (prev === id ? null : prev))}
                onRowDrop={handleRowDrop}
                onRowDragEnd={() => { setDraggedId(null); setDropTargetId(null); }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="htable-footer">
        <button type="button" className="btn btn--accent" onClick={() => handleAddChild(null)}>
          + Agregar tarea principal
        </button>
      </div>
    </div>
  );
}
