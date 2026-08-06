// HierarchyTable.jsx — Tabla jerárquica de tareas (tipo MS Project), con
// subtareas ilimitadas, numeración "1.1.13.3.1" derivada en render, y motor
// de recálculo en cascada al editar fechas (ver utils/scheduling.js).
//
// Vive dentro de EditView, abierta desde el botón "Ver planificación completa"
// (FullscreenOverlay). Opera sobre activities_identified del proyecto activo,
// el mismo array plano que usan el Gantt, el Kanban y los reportes — el
// árbol se reconstruye en memoria aquí, sin cambiar la forma de los datos.
//
// De solo lectura salvo las fechas de inicio/fin: asignado, progreso y estado
// se editan desde las tarjetas (TaskStatusSelector/GlobalBoardView) y desde
// ActivityDetailModal (clic en el nombre de la fila). Esto evita que la misma
// actividad tenga dos caminos de edición divergentes para el mismo campo.

import { useMemo, useState } from "react";
import {
  buildActivityTree, flattenTree, formatHierarchyNumber,
  aggregatedProgress, getActivityStatus, shortEngineerName,
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
  taskStatus,
  onAddChild, onDeleteActivity, onDateChange, onOpenActivity,
  aggProgress,
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
      className={`htable__row${hasChildren ? " htable__row--parent" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <td className="htable__cell htable__cell--num">{number}</td>
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
        <span className={`htable__status-pill ${STATUS_CLASS[status]}`}>{ESTADO_ACTIVIDAD_LABEL[status]}</span>
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
}) {
  const [collapsedIds, setCollapsedIds] = useState(() => new Set());
  const [cascadeNotice, setCascadeNotice] = useState(null); // { count } — aviso no bloqueante tras un recálculo
  const [statusFilter, setStatusFilter] = useState("all");

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
      </div>

      {cascadeNotice && (
        <div className="htable__cascade-notice">
          Este cambio también ajustó {cascadeNotice.count} tarea{cascadeNotice.count !== 1 ? "s" : ""} más.
        </div>
      )}
      <div className="htable-scroll">
        <table className="htable">
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
                onAddChild={handleAddChild}
                onDeleteActivity={onDeleteActivity}
                onDateChange={handleDateChange}
                onOpenActivity={onOpenActivity}
                aggProgress={aggregatedProgress(row.activity, childrenOf)}
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
