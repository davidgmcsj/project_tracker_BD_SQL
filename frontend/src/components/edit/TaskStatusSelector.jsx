// TaskStatusSelector.jsx — Clasificador de estado de actividades (Kanban de
// 3 columnas: no iniciadas / en proceso / completadas).
//
// EXPORTADO desde fuera de components/edit/: App.jsx lo importa con
// `import { TaskStatusSelector } from "./components/EditView"` y lo inyecta
// en ProjectPlanningOverlays como StatusBoard. EditView.jsx re-exporta este
// archivo tal cual para no romper ese import (ver comentario ahí).

import { buildActivityIndex, activityLabel, canMarkCompleted, getToday } from "../../utils/formulas";
import { safeArr, safeActs } from "./shared";
import { useDragSort } from "./useDragSort";

const TASK_STATUS_COLS = [
  { key: "completed",   label: "Completadas",  icon: "✅", variant: "green"  },
  { key: "in_progress", label: "En proceso",   icon: "🔄", variant: "amber"  },
  { key: "not_started", label: "No iniciadas", icon: "○",  variant: "gray"   },
];

// Fechas que se registran automáticamente por columna
const STATUS_DATE_FIELD = {
  not_started: null,
  in_progress: "in_progress",
  completed:   "completed",
};

export default function TaskStatusSelector({ taskStatus, activities, onChange, onOpenDetail }) {
  const ts   = taskStatus && typeof taskStatus === "object" ? taskStatus : {};
  const acts = safeActs(activities);
  const actIndex  = buildActivityIndex(acts);
  const actByIdMap = new Map(acts.map(a => [a.id, a]));

  // Ids válidos: solo los que existen en activities_identified
  const validIds     = new Set(acts.map(act => act.id));
  const filterValid   = (arr) => safeArr(arr).filter(id => validIds.has(id));

  // Todas las actividades ya asignadas en cualquier columna (solo válidas)
  const assigned = new Set([
    ...filterValid(ts.completed),
    ...filterValid(ts.in_progress),
    ...filterValid(ts.not_started),
  ]);

  const today = () => getToday();

  // Actualiza completed_dates (para filtrado semanal) y status_history (para mostrar fechas)
  const updateDates = (next, item, toKey, fromKey) => {
    // completed_dates: sigue igual (para el filtro semanal)
    const cDates = { ...(ts.completed_dates || {}) };
    if (toKey === "completed") cDates[item] = today();
    else if (fromKey === "completed") delete cDates[item];
    next.completed_dates = cDates;

    // status_history: registra fecha por campo
    const hist = { ...(ts.status_history || {}) };
    if (!hist[item]) hist[item] = { added: today() };
    const dateField = STATUS_DATE_FIELD[toKey];
    if (dateField) hist[item] = { ...hist[item], [dateField]: today() };
    // Si se mueve de in_progress a otro lado, borra in_progress date
    if (fromKey === "in_progress" && toKey !== "in_progress") delete hist[item].in_progress;
    // Si se mueve de completed a otro lado, borra completed date
    if (fromKey === "completed"   && toKey !== "completed")   delete hist[item].completed;
    next.status_history = hist;
  };

  // Índice rápido id → lista de ingenieros asignados [{engineer_id, engineer_name}]
  const actAssignIndex = new Map(
    acts.filter(a => (a.assigned_engineers || []).length > 0)
        .map(a => [a.id, a.assigned_engineers.map(e => ({ engineer_id: e.id, engineer_name: e.name }))])
  );

  const update = (colKey, newArr) => onChange({ ...ts, [colKey]: newArr });

  // Un padre con subtareas pendientes no puede marcarse como completado — ver
  // canMarkCompleted (formulas.js). El botón que dispara esto ya queda
  // deshabilitado en la UI (más abajo), esta es la defensa real por si move()
  // se invoca desde cualquier otro punto (drag & drop, atajo de teclado futuro).
  const move = (item, toKey) => {
    if (toKey === "completed" && !canMarkCompleted(item, acts, ts)) return;
    const fromKey = ["completed", "in_progress", "not_started"].find(k => safeArr(ts[k]).includes(item));
    const next = {
      completed:   safeArr(ts.completed).filter(s => s !== item),
      in_progress: safeArr(ts.in_progress).filter(s => s !== item),
      not_started: safeArr(ts.not_started).filter(s => s !== item),
    };
    next[toKey] = [...next[toKey], item];
    updateDates(next, item, toKey, fromKey);

    // Registra quiénes completaron la actividad (puede haber varios ingenieros asignados)
    const completedBy = { ...(ts.completed_by || {}) };
    if (toKey === "completed" && actAssignIndex.has(item)) {
      completedBy[item] = actAssignIndex.get(item); // array de {engineer_id, engineer_name}
    } else if (fromKey === "completed") {
      delete completedBy[item];
    }
    next.completed_by = completedBy;

    onChange(next);
  };

  const remove = (item) => {
    const next = {
      completed:   safeArr(ts.completed).filter(s => s !== item),
      in_progress: safeArr(ts.in_progress).filter(s => s !== item),
      not_started: safeArr(ts.not_started).filter(s => s !== item),
    };
    const cDates = { ...(ts.completed_dates || {}) };
    delete cDates[item];
    next.completed_dates = cDates;
    const hist = { ...(ts.status_history || {}) };
    delete hist[item];
    next.status_history = hist;
    const completedBy = { ...(ts.completed_by || {}) };
    delete completedBy[item];
    next.completed_by = completedBy;
    onChange(next);
  };

  const add = (item, toKey) => {
    if (assigned.has(item)) return;
    if (toKey === "completed" && !canMarkCompleted(item, acts, ts)) return;
    const next = { ...ts, [toKey]: [...safeArr(ts[toKey]), item] };
    updateDates(next, item, toKey, null);
    onChange(next);
  };

  // Actividades sin asignar aún (ids), con su label numerado para mostrar
  const unassigned = acts.map(act => act.id).filter(id => !assigned.has(id));

  return (
    <div className="task-status-board">
      {/* Panel de actividades disponibles */}
      {unassigned.length > 0 && (
        <div className="task-status-unassigned">
          <div className="task-status-unassigned__label">Actividades sin clasificar</div>
          {unassigned.map((id) => (
            <div key={id} className="task-status-unassigned__item">
              <span className="task-status-unassigned__text">{activityLabel(actIndex, id)}</span>
              <div className="task-status-unassigned__actions">
                {TASK_STATUS_COLS.map(col => {
                  const bloqueado = col.key === "completed" && !canMarkCompleted(id, acts, ts);
                  return (
                    <button
                      key={col.key} type="button"
                      className={`task-status-unassigned__btn task-status-unassigned__btn--${col.variant}`}
                      title={bloqueado
                        ? "No se puede completar: tiene subtareas pendientes"
                        : `Mover a ${col.label}`}
                      disabled={bloqueado}
                      onClick={() => add(id, col.key)}
                    >
                      {col.icon}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Tres columnas */}
      <div className="task-status-cols">
        {TASK_STATUS_COLS.map(col => {
          const items = filterValid(ts[col.key]);
          const { onDragStart: colDragStart, onDrop: colDrop } = useDragSort(items, (reordered) => update(col.key, reordered));
          return (
            <div key={col.key} className={`task-status-col task-status-col--${col.variant}`}>
              <div className="task-status-col__header">
                <span className="task-status-col__icon">{col.icon}</span>
                <span className="task-status-col__label">{col.label}</span>
                <span className="task-status-col__count">{items.length}</span>
              </div>
              {items.length === 0 ? (
                <p className="task-status-col__empty">Sin actividades</p>
              ) : (
                <ul className="task-status-col__list">
                  {items.map((item, i) => {
                    const otherCols = TASK_STATUS_COLS.filter(c => c.key !== col.key);
                    const hist    = ts.status_history?.[item] || {};
                    const act     = actByIdMap.get(item);
                    const fmtKanbanDate = (d) => {
                      if (!d) return null;
                      const [y, m, day] = d.split("-");
                      return `${day}/${m}/${y}`;
                    };
                    // Calcular días restantes y estado de demora
                    const isCompleted = col.key === "completed";
                    const today = new Date(); today.setHours(0,0,0,0);
                    const dueDate = act?.due_date ? new Date(act.due_date) : null;
                    const diffDays = dueDate ? Math.ceil((dueDate - today) / 86400000) : null;
                    const isOverdue = !isCompleted && dueDate && diffDays < 0;
                    let daysLabel = null;
                    let daysClass = "task-status-col__days-badge";
                    if (!isCompleted && diffDays !== null) {
                      if (diffDays < 0) {
                        daysLabel = `⚠ En demora (${Math.abs(diffDays)} días)`;
                        daysClass += " task-status-col__days-badge--overdue";
                      } else if (diffDays === 0) {
                        daysLabel = "⏰ Vence hoy";
                        daysClass += " task-status-col__days-badge--today";
                      } else {
                        daysLabel = `${diffDays} día${diffDays !== 1 ? "s" : ""} restante${diffDays !== 1 ? "s" : ""}`;
                        daysClass += diffDays <= 3 ? " task-status-col__days-badge--soon" : " task-status-col__days-badge--ok";
                      }
                    }
                    return (
                      <li
                        key={item}
                        className={`task-status-col__item${isOverdue ? " task-status-col__item--overdue" : ""}`}
                        draggable
                        onDragStart={() => colDragStart(i)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => colDrop(i)}
                        title="Arrastra para reordenar"
                        onClick={onOpenDetail ? () => onOpenDetail(item) : undefined}
                        style={onOpenDetail ? { cursor: "pointer" } : undefined}
                      >
                        <div className="task-status-col__item-main">
                          <span className="task-status-col__item__grip">⠿</span>
                          <span className="task-status-col__item-text">{activityLabel(actIndex, item)}</span>
                          <div className="task-status-col__item-actions">
                            {otherCols.map(other => {
                              const bloqueado = other.key === "completed" && !canMarkCompleted(item, acts, ts);
                              return (
                                <button
                                  key={other.key} type="button"
                                  className="task-status-col__move-btn"
                                  title={bloqueado
                                    ? "No se puede completar: tiene subtareas pendientes"
                                    : `Mover a ${other.label}`}
                                  disabled={bloqueado}
                                  onClick={e => { e.stopPropagation(); move(item, other.key); }}
                                >
                                  {other.icon}
                                </button>
                              );
                            })}
                            <button
                              type="button" className="task-status-col__remove-btn"
                              title="Quitar de la lista"
                              onClick={e => { e.stopPropagation(); remove(item); }}
                            >✕</button>
                          </div>
                        </div>
                        <div className="task-status-col__dates">
                          <span className={`task-status-col__date-chip${act?.start_date ? "" : " task-status-col__date-chip--nodate"}`}>
                            Inicio: {fmtKanbanDate(act?.start_date) || "Sin fecha"}
                          </span>
                          <span className={`task-status-col__date-chip task-status-col__date-chip--end${act?.due_date ? "" : " task-status-col__date-chip--nodate"}`}>
                            Fin: {fmtKanbanDate(act?.due_date) || "Sin fecha"}
                          </span>
                          {daysLabel && (
                            <span className={daysClass}>{daysLabel}</span>
                          )}
                        </div>
                        {/* Responsables */}
                        {act?.assigned_engineers?.length > 0 ? (
                          <div className="task-status-col__assignees">
                            <span className="task-status-col__assignees-icon">👤</span>
                            {act.assigned_engineers.map(e => (
                              <span key={e.id} className="task-status-col__assignee-chip">{e.name}</span>
                            ))}
                          </div>
                        ) : (
                          <div className="task-status-col__assignees task-status-col__assignees--empty">
                            <span className="task-status-col__assignees-icon">👤</span>
                            <span className="task-status-col__assignee-none">Sin responsable</span>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
