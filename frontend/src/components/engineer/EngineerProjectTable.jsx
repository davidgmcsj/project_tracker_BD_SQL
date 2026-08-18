// EngineerProjectTable.jsx — tabla jerárquica de solo lectura con las tareas
// de UN proyecto para un ingeniero (ver utils/engineers.js:
// buildEngineerProjectQueue). La tarea global/padre, el nivel intermedio y
// la hoja aparecen como filas propias con su propia tipografía — mismo
// criterio que HierarchyTable/el Gantt (solo nivel 0 destacado), extendido a
// 3 niveles porque el usuario pidió poder distinguir a simple vista de qué
// tarea padre viene cada pendiente.
//
// Las 3 secciones (Esta semana / Próxima semana / Más adelante) se muestran
// como UNA sola tabla continua con filas de separador (mismo patrón que
// MetricsTable.jsx: <tr><td colSpan></td></tr> con banda de color) — no como
// tablas independientes, confirmado con el usuario.

import { Fragment, useState } from "react";
import { QUEUE_SECTION, QUEUE_SECTION_LABEL } from "../../utils/engineers";
import { SITUATION_LABEL } from "../../utils/weekPlanning";
import { formatDateDMY } from "../../utils/formulas";

const SECTIONS_IN_ORDER = [QUEUE_SECTION.THIS_WEEK, QUEUE_SECTION.NEXT_WEEK, QUEUE_SECTION.LATER];

// Solo el nivel 0 (tarea global) va en negrilla + letra más grande; nivel 1
// letra grande sin negrilla; nivel 2+ letra más pequeña — pedido explícito
// del usuario para poder distinguir "objetivo" / "tarea intermedia" / "tarea
// de tercer nivel" de un vistazo, sin abrir cada fila.
function levelClass(level) {
  if (level === 0) return "eng-ptable__name--level-0";
  if (level === 1) return "eng-ptable__name--level-1";
  return "eng-ptable__name--level-2plus";
}

export default function EngineerProjectTable({ queue, onOpenActivity, onToggleUrgent, onReorderSection }) {
  const [draggedId, setDraggedId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);

  const sectionsWithRows = SECTIONS_IN_ORDER.filter(s => (queue[s] || []).length > 0);
  if (!sectionsWithRows.length) {
    return <p style={{ color: "var(--text-2)", fontSize: "13px" }}>Sin actividades pendientes en este proyecto.</p>;
  }

  const handleDrop = (section, rows, targetId) => {
    if (draggedId && draggedId !== targetId) {
      const ids = rows.filter(r => r.isLeaf).map(r => r.activity.id);
      const fromIdx = ids.indexOf(draggedId);
      const toIdx = ids.indexOf(targetId);
      if (fromIdx !== -1 && toIdx !== -1) {
        const next = [...ids];
        const [moved] = next.splice(fromIdx, 1);
        next.splice(toIdx, 0, moved);
        onReorderSection?.(section, next);
      }
    }
    setDraggedId(null);
    setDropTargetId(null);
  };

  return (
    <div className="eng-ptable-wrap">
      <table className="week-auto-table eng-ptable">
        <thead>
          <tr>
            <th className="eng-ptable__drag-col" aria-hidden="true" />
            <th>N°</th>
            <th>Actividad</th>
            <th>Inicio</th>
            <th>Fin</th>
            <th>Situación</th>
            {onToggleUrgent && <th>Urgente</th>}
          </tr>
        </thead>
        <tbody>
          {SECTIONS_IN_ORDER.map(section => {
            const rows = queue[section] || [];
            if (!rows.length) return null;
            const canDrag = !!onReorderSection;

            return (
              <Fragment key={section}>
                <tr className="eng-ptable__section-header">
                  <td colSpan={onToggleUrgent ? 7 : 6}>{QUEUE_SECTION_LABEL[section]} ({rows.filter(r => r.isLeaf).length})</td>
                </tr>
                {rows.map(row => {
                  const { activity, level, number, isLeaf, situation } = row;
                  const isUrgent = isLeaf && activity.es_urgente === true;
                  const isDragging = isLeaf && draggedId === activity.id;
                  const isDropTarget = isLeaf && canDrag && dropTargetId === activity.id && draggedId !== activity.id;

                  return (
                    <tr
                      key={`${section}-${activity.id}`}
                      className={[
                        "eng-ptable__row",
                        !isLeaf && "eng-ptable__row--ancestor",
                        isLeaf && `eng-ptable__row--${situation}`,
                        isUrgent && "eng-ptable__row--urgent",
                        isDragging && "eng-ptable__row--dragging",
                        isDropTarget && "eng-ptable__row--drop-target",
                      ].filter(Boolean).join(" ")}
                      draggable={isLeaf && canDrag}
                      onDragStart={isLeaf && canDrag ? () => setDraggedId(activity.id) : undefined}
                      onDragOver={isLeaf && canDrag ? (e) => { e.preventDefault(); setDropTargetId(activity.id); } : undefined}
                      onDragLeave={isLeaf && canDrag ? () => setDropTargetId(prev => (prev === activity.id ? null : prev)) : undefined}
                      onDrop={isLeaf && canDrag ? (e) => { e.preventDefault(); handleDrop(section, rows, activity.id); } : undefined}
                      onDragEnd={isLeaf && canDrag ? () => { setDraggedId(null); setDropTargetId(null); } : undefined}
                    >
                      <td className="eng-ptable__drag-col">
                        {isLeaf && canDrag && <span title="Arrastra para cambiar el orden">⠿</span>}
                      </td>
                      <td className="eng-ptable__number">{number}</td>
                      <td className="week-auto-table__name" style={{ paddingLeft: level * 18 }}>
                        {onOpenActivity ? (
                          <button
                            type="button"
                            className={`week-auto-table__name-link ${levelClass(level)}`}
                            onClick={() => onOpenActivity(activity.id)}
                          >
                            {activity.text || "(sin nombre)"}
                          </button>
                        ) : (
                          <span className={levelClass(level)}>{activity.text || "(sin nombre)"}</span>
                        )}
                      </td>
                      <td>{isLeaf ? formatDateDMY(activity.start_date) : ""}</td>
                      <td>{isLeaf ? formatDateDMY(activity.due_date) : ""}</td>
                      <td>
                        {isLeaf && (
                          <span className={`week-auto-table__situation week-auto-table__situation--${situation}`}>
                            {SITUATION_LABEL[situation]}
                          </span>
                        )}
                      </td>
                      {onToggleUrgent && (
                        <td>
                          {isLeaf && (
                            <button
                              type="button"
                              className={`eng-ptable__urgent-btn ${isUrgent ? "eng-ptable__urgent-btn--active" : ""}`}
                              onClick={() => onToggleUrgent(activity.id)}
                              title={isUrgent ? "Quitar urgente" : "Marcar urgente"}
                            >
                              🔥
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
