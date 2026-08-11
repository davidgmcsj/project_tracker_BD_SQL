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
// onChangeStatus — mismo mecanismo que TaskStatusSelector.move()/el selector
// de ActivityDetailModal, para no tener tres implementaciones divergentes de
// "mover una actividad entre buckets de task_status") y el orden de las filas
// (drag & drop entre hermanas — ver reorderSiblings). Asignado y progreso
// siguen editándose solo desde ActivityDetailModal (clic en el nombre).
//
// El número "1.1, 1.2…" es puramente posicional (deriva de sequence_order,
// no se guarda como tal) — antes solo reflejaba el orden de creación, sin
// forma de cambiarlo salvo borrar y recrear. Arrastrar una fila sobre otra
// hermana (mismo parent_id) renumera todo ese grupo; soltar sobre una fila
// de otro padre no hace nada (reorderSiblings devuelve null).

import { useMemo, useState } from "react";
import {
  buildActivityTree, flattenTree, formatHierarchyNumber,
  aggregatedProgress, getActivityStatus, shortEngineerName, canMarkCompleted, reorderSiblings,
} from "../utils/formulas";
import { rescheduleAfterChange } from "../utils/scheduling";
import { ESTADO_ACTIVIDAD_LABEL, estadoActividadKey } from "../utils/filtroOpciones";

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
  not_started: "htable__status-pill--not-started",
  in_progress: "htable__status-pill--in-progress",
  completed:   "htable__status-pill--completed",
};

// Mismo orden que las columnas del Kanban (TaskStatusSelector) — claves
// internas en inglés, label vía ESTADO_ACTIVIDAD_LABEL (fuente única).
const STATUS_SELECT_KEYS = ["not_started", "in_progress", "completed"];

function statusKey(taskStatus, actId) {
  return estadoActividadKey(getActivityStatus(taskStatus, actId));
}

// ── Helpers de presentación ───────────────────────────────────────────────────

function nextSequenceOrder(activities, parentId) {
  const siblings = activities.filter(a => (a.parent_id ?? null) === parentId);
  if (!siblings.length) return 0;
  return Math.max(...siblings.map(a => Number(a.sequence_order) || 0)) + 1;
}

// ── Fila individual ───────────────────────────────────────────────────────────

function Row({
  row, hasChildren, isCollapsed, onToggleCollapse,
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
  // Igual que el Kanban: no se puede marcar completada una actividad con
  // subtareas pendientes (ver canMarkCompleted, formulas.js).
  const completedBlocked = !canMarkCompleted(a.id, activities, taskStatus);

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
          {hasChildren ? (
            <button type="button" className="htable__toggle" onClick={() => onToggleCollapse(a.id)} title={isCollapsed ? "Expandir" : "Colapsar"}>
              {isCollapsed ? "▸" : "▾"}
            </button>
          ) : (
            <span className="htable__toggle htable__toggle--spacer" />
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
          <span className="htable__readonly" title="Calculado de sus subtareas">🔒 {a.start_date || "—"}</span>
        ) : (
          <input type="date" className="htable__date" value={a.start_date || ""} onChange={e => handleDateChange("start_date", e.target.value)} />
        )}
      </td>
      <td className="htable__cell htable__cell--date">
        {isReadOnlyDates ? (
          <span className="htable__readonly" title="Gobernada por sus subtareas — se auto-ajusta si estas cambian">🔒 {a.due_date || "—"}</span>
        ) : (
          <input type="date" className="htable__date" value={a.due_date || ""} onChange={e => handleDateChange("due_date", e.target.value)} />
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
          {STATUS_SELECT_KEYS.map(key => (
            <option key={key} value={key} disabled={key === "completed" && completedBlocked}>
              {ESTADO_ACTIVIDAD_LABEL[key]}
            </option>
          ))}
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
}) {
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [cascadeNotice, setCascadeNotice] = useState(null); // { count } — aviso no bloqueante tras un recálculo
  const [statusFilter, setStatusFilter] = useState("all");
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const acts = useMemo(() => (Array.isArray(activities) ? activities : []), [activities]);
  const { childrenOf } = useMemo(() => buildActivityTree(acts), [acts]);

  const allRows = useMemo(() => flattenTree(acts, { collapsedIds }), [acts, collapsedIds]);

  // El filtro no recorta el árbol en crudo: una fila se muestra si ELLA MISMA
  // matchea el filtro, o si alguno de sus descendientes lo hace (así una tarea
  // principal sigue visible mientras tenga subtareas en el estado buscado, en
  // vez de desaparecer y dejar huérfanas a sus hijas filtradas).
  const rows = useMemo(() => {
    if (statusFilter === "all") return allRows;
    const matches = new Set();
    allRows.forEach(({ activity }) => {
      if (statusKey(taskStatus, activity.id) === statusFilter) matches.add(activity.id);
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
  }, [allRows, statusFilter, taskStatus, acts]);

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

  if (!acts.length) {
    return <div className="htable-empty">No hay actividades registradas en este proyecto todavía.</div>;
  }

  return (
    <div className="htable-wrap">
      <div className="htable-toolbar">
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
        <span className="htable-toolbar__count">{rows.length} de {allRows.length}</span>
        {statusFilter !== "all" && (
          <span className="htable-toolbar__hint">Con un filtro activo no se puede reordenar — elige "Todas" primero.</span>
        )}
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
                canReorder={statusFilter === "all"}
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
