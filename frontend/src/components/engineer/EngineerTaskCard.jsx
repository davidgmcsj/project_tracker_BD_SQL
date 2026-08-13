// EngineerTaskCard.jsx — una tarjeta de actividad para "Mi semana" (dashboard
// del ingeniero). Reemplaza la fila de tabla plana: muestra el número
// jerárquico + la cadena de tareas padre (mismo formato que Planificación,
// ver utils/formulas/activityHierarchy.js) para que una subtarea no se vea
// como un elemento suelto sin relación con su tarea principal.
//
// variant="focus" es la MISMA tarjeta, más grande y destacada — no hay dos
// componentes ni dos fuentes de verdad, solo una clase CSS distinta.

import { SITUATION_LABEL } from "../../utils/weekPlanning";
import { formatDateDMY } from "../../utils/formulas";

export default function EngineerTaskCard({
  row, variant = "normal", onOpenActivity, onToggleUrgent,
  // Reordenar a mano (drag & drop) — todos opcionales: sin ellos la tarjeta
  // simplemente no es arrastrable (ver EngineerWeekTable, que es quien
  // decide si esta lista admite reordenar).
  canDrag, isDragging, isDropTarget,
  onDragStart, onDragOverCard, onDragLeaveCard, onDropCard, onDragEnd,
}) {
  const { activity, situation, projectName, projectId, number, ancestors } = row;
  const isUrgent = activity.es_urgente === true;
  const isFocus = variant === "focus";

  const handleOpen = () => onOpenActivity?.(projectId, activity.id);

  const handleToggleUrgent = (e) => {
    e.stopPropagation(); // no abrir el detalle al tocar el botón de urgente
    onToggleUrgent?.(projectId, activity.id);
  };

  return (
    <article
      className={[
        "eng-task-card",
        `eng-task-card--${situation}`,
        isFocus && "eng-task-card--focus",
        isUrgent && "eng-task-card--urgent",
        isDragging && "eng-task-card--dragging",
        isDropTarget && "eng-task-card--drop-target",
      ].filter(Boolean).join(" ")}
      onClick={onOpenActivity ? handleOpen : undefined}
      role={onOpenActivity ? "button" : undefined}
      tabIndex={onOpenActivity ? 0 : undefined}
      draggable={canDrag}
      onDragStart={canDrag ? onDragStart : undefined}
      onDragOver={canDrag ? (e) => { e.preventDefault(); onDragOverCard?.(); } : undefined}
      onDragLeave={canDrag ? onDragLeaveCard : undefined}
      onDrop={canDrag ? (e) => { e.preventDefault(); onDropCard?.(); } : undefined}
      onDragEnd={canDrag ? onDragEnd : undefined}
    >
      {canDrag && (
        <div
          className="eng-task-card__drag-handle"
          title="Arrastra para cambiar el orden"
          onClick={e => e.stopPropagation()}
        >
          ⠿
        </div>
      )}

      {isFocus && <div className="eng-task-card__eyebrow">{isUrgent ? "🔥 Urgente — siguiente" : "Siguiente en tu cola"}</div>}

      {ancestors.length > 0 && (
        <div className="eng-task-card__breadcrumb" title={ancestors.map(a => a.text).join(" › ")}>
          {ancestors.map(a => a.text).join(" › ")}
        </div>
      )}

      <div className="eng-task-card__main">
        <span className="eng-task-card__number">{number}</span>
        <span className="eng-task-card__text">{activity.text || "(sin nombre)"}</span>
      </div>

      <div className="eng-task-card__meta">
        <span className="eng-task-card__project">{projectName}</span>
        <span className="eng-task-card__dates">
          {formatDateDMY(activity.start_date)} → {formatDateDMY(activity.due_date)}
        </span>
        <span className={`week-auto-table__situation week-auto-table__situation--${situation}`}>
          {SITUATION_LABEL[situation]}
        </span>
      </div>

      {onToggleUrgent && (
        <button
          type="button"
          className={`eng-task-card__urgent-btn ${isUrgent ? "eng-task-card__urgent-btn--active" : ""}`}
          onClick={handleToggleUrgent}
        >
          {isUrgent ? "🔥 Quitar urgente" : "🔥 Marcar urgente"}
        </button>
      )}
    </article>
  );
}
