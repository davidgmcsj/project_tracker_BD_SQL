// ProjectQueueCard.jsx — tarjeta dinámica por proyecto (pantalla "mi semana"
// del ingeniero). Reemplaza el grupo de botones planos anterior
// (eng-project-btn-group): una tarjeta con nombre del proyecto, un resumen
// rápido de cuántas tareas propias están en demora/vencen hoy, y 3 acciones.
//
// Los chips "En demora"/"Vence hoy" duplican los antiguos KpiChip globales,
// pero ahora aplican SOLO a este proyecto y, al pulsarlos, abren la tabla de
// ESE proyecto ya filtrada — reemplazan el filtrado cross-proyecto de antes
// (confirmado con el usuario: los filtros pasan a vivir dentro de cada
// tarjeta/proyecto, no como controles globales sueltos).

export default function ProjectQueueCard({
  project, overdueCount, dueTodayCount,
  onOpenPlanning, onViewQueue, onDownload,
}) {
  return (
    <article className="eng-pcard">
      <div className="eng-pcard__header">
        <h4 className="eng-pcard__name">{project.project_name || "Proyecto"}</h4>
        {(overdueCount > 0 || dueTodayCount > 0) && (
          <div className="eng-pcard__badges">
            {overdueCount > 0 && (
              <button type="button" className="eng-pcard__badge eng-pcard__badge--overdue" onClick={() => onViewQueue?.("overdue")}>
                {overdueCount} en demora
              </button>
            )}
            {dueTodayCount > 0 && (
              <button type="button" className="eng-pcard__badge eng-pcard__badge--due-today" onClick={() => onViewQueue?.("dueToday")}>
                {dueTodayCount} vence hoy
              </button>
            )}
          </div>
        )}
      </div>

      <div className="eng-pcard__actions">
        <button type="button" className="eng-pcard__btn" onClick={onOpenPlanning} title="Abrir Planificación completa del proyecto">
          📂 Abrir Plan de Trabajo
        </button>
        <button type="button" className="eng-pcard__btn" onClick={() => onViewQueue?.(null)} title="Ver mis tareas de este proyecto en tabla">
          📋 Ver tareas
        </button>
        <button type="button" className="eng-pcard__btn eng-pcard__btn--ghost" onClick={onDownload} title="Descargar mis tareas de este proyecto en .md">
          ⬇ Descargar tareas
        </button>
      </div>
    </article>
  );
}
