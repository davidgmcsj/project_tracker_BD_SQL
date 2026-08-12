// TaskStatusSelector.jsx — Clasificador de estado de actividades, en 2 filas:
// fila 1 (no iniciadas / en proceso / completadas, orden de siempre) y
// fila 2 (ambiente pruebas / ambiente producción — solo alcanzables para
// actividades marcadas "es_desarrollo", ver isDesarrollo).
//
// EXPORTADO desde fuera de components/edit/: App.jsx lo importa con
// `import { TaskStatusSelector } from "./components/EditView"` y lo inyecta
// en ProjectPlanningOverlays como StatusBoard. EditView.jsx re-exporta este
// archivo tal cual para no romper ese import (ver comentario ahí).

import { useState } from "react";
import { buildActivityIndex, activityLabel, canTransitionTo, isDesarrollo, flattenTree, formatDateDMY } from "../../utils/formulas";
import { matchesSearch } from "../../utils/search";
import { safeArr, safeActs, transitionActivityStatus } from "./shared";

const TASK_STATUS_COLS_ROW1 = [
  { key: "completed",   label: "Completadas",  icon: "✅", variant: "green"  },
  { key: "in_progress", label: "En proceso",   icon: "🔄", variant: "amber"  },
  { key: "not_started", label: "No iniciadas", icon: "○",  variant: "gray"   },
];
const TASK_STATUS_COLS_ROW2 = [
  { key: "ambiente_pruebas",    label: "Ambiente Pruebas",    icon: "🧪", variant: "blue"   },
  { key: "ambiente_produccion", label: "Ambiente Producción", icon: "🚀", variant: "purple" },
];
// Combinado — usado para los botones "mover a" de cada tarjeta (pueden
// apuntar a cualquier columna, de cualquier fila).
const TASK_STATUS_COLS = [...TASK_STATUS_COLS_ROW1, ...TASK_STATUS_COLS_ROW2];

// Motivo del bloqueo de un botón "mover a" — distingue entre las 3 causas
// posibles para que el title del botón sea útil, no un genérico "no se puede".
function blockedReason(destKey, act, acts, ts) {
  if (["ambiente_pruebas", "ambiente_produccion"].includes(destKey) && !isDesarrollo(act)) {
    return "Esta actividad no está marcada como \"Es de desarrollo\"";
  }
  if (destKey === "completed" && ["ambiente_pruebas", "ambiente_produccion"].some(k => (ts[k] || []).includes(act.id))) {
    return "No se puede completar manualmente mientras está en un ambiente — se completa automáticamente al terminar el paso de producción";
  }
  return "No se puede completar: tiene subtareas pendientes";
}

function TaskStatusColumn({ col, items, acts, ts, actByIdMap, actIndex, onOpenDetail, onMove, onRemove }) {
  const otherCols = TASK_STATUS_COLS.filter(c => c.key !== col.key);

  return (
    <div className={`task-status-col task-status-col--${col.variant}`}>
      <div className="task-status-col__header">
        <span className="task-status-col__icon">{col.icon}</span>
        <span className="task-status-col__label">{col.label}</span>
        <span className="task-status-col__count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="task-status-col__empty">Sin actividades</p>
      ) : (
        <ul className="task-status-col__list">
          {items.map((item) => {
            const act = actByIdMap.get(item);
            // Calcular días restantes y estado de demora. Una actividad ya
            // completada NO cuenta para demora — pero tampoco una que ya pasó
            // a Ambiente Pruebas/Producción: ahí la fecha de fin original ya
            // se cumplió en cuanto a DESARROLLO, lo que falta es el paso por
            // pruebas/producción, no "más tiempo de desarrollo" — mostrar
            // "en demora" ahí confunde (ver captura del usuario: una tarea ya
            // en Ambiente Pruebas se veía en rojo como si estuviera atrasada).
            const isCompleted = col.key === "completed";
            const isEnvironment = col.key === "ambiente_pruebas" || col.key === "ambiente_produccion";
            const today = new Date(); today.setHours(0,0,0,0);
            const dueDate = act?.due_date ? new Date(act.due_date) : null;
            const diffDays = dueDate ? Math.ceil((dueDate - today) / 86400000) : null;
            const isOverdue = !isCompleted && !isEnvironment && dueDate && diffDays < 0;
            let daysLabel = null;
            let daysClass = "task-status-col__days-badge";
            if (isEnvironment) {
              daysLabel = col.key === "ambiente_pruebas" ? "🧪 Pendiente pasar a pruebas" : "🚀 Pendiente pasar a producción";
              daysClass += " task-status-col__days-badge--pending-env";
            } else if (!isCompleted && diffDays !== null) {
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
                onClick={onOpenDetail ? () => onOpenDetail(item) : undefined}
                style={onOpenDetail ? { cursor: "pointer" } : undefined}
              >
                <div className="task-status-col__item-main">
                  {act?.deployment_role && (
                    <span
                      className="task-status-col__auto-badge"
                      title="Subtarea creada automáticamente por la cadena de despliegue"
                    >⚙ Auto</span>
                  )}
                  <span className="task-status-col__item-text">{activityLabel(actIndex, item)}</span>
                  <div className="task-status-col__item-actions">
                    {otherCols.map(other => {
                      const bloqueado = !canTransitionTo(item, acts, ts, other.key);
                      return (
                        <button
                          key={other.key} type="button"
                          className="task-status-col__move-btn"
                          title={bloqueado ? blockedReason(other.key, act, acts, ts) : `Mover a ${other.label}`}
                          disabled={bloqueado}
                          onClick={e => { e.stopPropagation(); onMove(item, other.key); }}
                        >
                          {other.icon}
                        </button>
                      );
                    })}
                    <button
                      type="button" className="task-status-col__remove-btn"
                      title="Quitar de la lista"
                      onClick={e => { e.stopPropagation(); onRemove(item); }}
                    >✕</button>
                  </div>
                </div>
                <div className="task-status-col__dates">
                  <span className={`task-status-col__date-chip${act?.start_date ? "" : " task-status-col__date-chip--nodate"}`}>
                    Inicio: {act?.start_date ? formatDateDMY(act.start_date) : "Sin fecha"}
                  </span>
                  <span className={`task-status-col__date-chip task-status-col__date-chip--end${act?.due_date ? "" : " task-status-col__date-chip--nodate"}`}>
                    Fin: {act?.due_date ? formatDateDMY(act.due_date) : "Sin fecha"}
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
}

export default function TaskStatusSelector({ taskStatus, activities, onChange, onOpenDetail }) {
  const [textFilter, setTextFilter] = useState("");
  const ts   = taskStatus && typeof taskStatus === "object" ? taskStatus : {};
  const acts = safeActs(activities);
  const actIndex  = buildActivityIndex(acts);
  const actByIdMap = new Map(acts.map(a => [a.id, a]));

  // Ids válidos: solo los que existen en activities_identified.
  const validIds     = new Set(acts.map(act => act.id));
  const filterValid   = (arr) => safeArr(arr).filter(id => validIds.has(id));

  // Orden jerárquico (1, 1.1, 1.3, 1.5.1, 2…) — mismo recorrido preorden que
  // ya usan Planificación y el Gantt (flattenTree), para que un depósito
  // nunca muestre las tarjetas en el orden crudo en que fueron movidas
  // (arrastre histórico), que es lo que el usuario reportó como "salpicón".
  const orderIndex = new Map(flattenTree(acts).map(({ activity }, i) => [activity.id, i]));
  const byHierarchyOrder = (a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0);

  // Igual que filterValid, pero además exige que matchee la búsqueda de
  // texto — usado SOLO para decidir qué se muestra en cada columna. assigned
  // (abajo) debe seguir usando filterValid a secas: si se calculara con el
  // filtro de texto, una actividad ya clasificada que no matchea el texto
  // "reaparecería" en el panel de sin clasificar, que es incorrecto (sigue
  // asignada, solo no se está mostrando en pantalla ahora mismo).
  const filterVisible = (arr) => filterValid(arr)
    .filter(id => matchesSearch(actByIdMap.get(id)?.text || "", textFilter))
    .sort(byHierarchyOrder);

  // Todas las actividades ya asignadas en cualquier columna (solo válidas)
  const assigned = new Set([
    ...filterValid(ts.completed),
    ...filterValid(ts.in_progress),
    ...filterValid(ts.not_started),
    ...filterValid(ts.ambiente_pruebas),
    ...filterValid(ts.ambiente_produccion),
  ]);

  // Único punto de cambio de estado — delega toda la lógica (incluida la
  // cadena automática de despliegue) a transitionActivityStatus. Si se creó
  // una subtarea de despliegue, se abre su tarjeta de inmediato (mismo
  // patrón que ya usa onOpenDetail para abrir al hacer clic en una tarjeta).
  const move = (item, toKey) => {
    const result = transitionActivityStatus(ts, acts, item, toKey);
    onChange(result.taskStatus, result.newActivities);
    if (result.openActivityId && onOpenDetail) onOpenDetail(result.openActivityId);
  };

  const remove = (item) => {
    const next = {
      completed:            safeArr(ts.completed).filter(s => s !== item),
      in_progress:          safeArr(ts.in_progress).filter(s => s !== item),
      not_started:          safeArr(ts.not_started).filter(s => s !== item),
      ambiente_pruebas:     safeArr(ts.ambiente_pruebas).filter(s => s !== item),
      ambiente_produccion:  safeArr(ts.ambiente_produccion).filter(s => s !== item),
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
    onChange(next, acts);
  };

  const add = (item, toKey) => {
    if (assigned.has(item)) return;
    move(item, toKey);
  };

  // Actividades sin asignar aún (ids), con su label numerado para mostrar —
  // mismo orden jerárquico que las columnas, no el orden crudo del array.
  const unassigned = acts.map(act => act.id).filter(id => !assigned.has(id)).sort(byHierarchyOrder);

  return (
    <div className="task-status-board">
      {/* Búsqueda por texto — filtra qué tarjetas se muestran en las 5
          columnas, sin tocar task_status (las que no matchean simplemente no
          se pintan). No filtra el panel "sin clasificar": ahí siempre
          conviene ver todo lo pendiente de clasificar sin importar el texto. */}
      <div className="task-status-search">
        <input
          type="text"
          className="task-status-search__input"
          placeholder="🔍 Buscar actividad…"
          value={textFilter}
          onChange={e => setTextFilter(e.target.value)}
        />
        {textFilter.trim() && (
          <button type="button" className="task-status-search__clear" onClick={() => setTextFilter("")}>✕</button>
        )}
      </div>

      {/* Panel de actividades disponibles — solo ofrece las 3 columnas de
          siempre: una actividad recién creada nunca debería saltar directo a
          un ambiente sin pasar por "en proceso" primero. */}
      {unassigned.length > 0 && (
        <div className="task-status-unassigned">
          <div className="task-status-unassigned__label">Actividades sin clasificar</div>
          {unassigned.map((id) => (
            <div key={id} className="task-status-unassigned__item">
              <span className="task-status-unassigned__text">{activityLabel(actIndex, id)}</span>
              <div className="task-status-unassigned__actions">
                {TASK_STATUS_COLS_ROW1.map(col => {
                  const bloqueado = !canTransitionTo(id, acts, ts, col.key);
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

      {/* Fila 1: flujo normal de cualquier actividad. */}
      <div className="task-status-cols task-status-cols--row1">
        {TASK_STATUS_COLS_ROW1.map(col => (
          <TaskStatusColumn
            key={col.key}
            col={col}
            items={filterVisible(ts[col.key])}
            acts={acts}
            ts={ts}
            actByIdMap={actByIdMap}
            actIndex={actIndex}
            onOpenDetail={onOpenDetail}
            onMove={move}
            onRemove={remove}
          />
        ))}
      </div>
      {/* Fila 2: ambientes de despliegue — solo alcanzables con es_desarrollo. */}
      <div className="task-status-cols task-status-cols--row2">
        {TASK_STATUS_COLS_ROW2.map(col => (
          <TaskStatusColumn
            key={col.key}
            col={col}
            items={filterVisible(ts[col.key])}
            acts={acts}
            ts={ts}
            actByIdMap={actByIdMap}
            actIndex={actIndex}
            onOpenDetail={onOpenDetail}
            onMove={move}
            onRemove={remove}
          />
        ))}
      </div>
    </div>
  );
}
