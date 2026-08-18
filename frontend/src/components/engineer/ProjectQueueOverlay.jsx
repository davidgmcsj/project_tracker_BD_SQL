// ProjectQueueOverlay.jsx — vista en línea de las tareas del ingeniero en UN
// proyecto (Esta semana / Próxima semana / Más adelante, con jerarquía
// completa — ver EngineerProjectTable), en vez de reabrir el módulo de
// Planificación completo solo para ver unos pocos pendientes propios.
// "📂 Abrir Plan de Trabajo" (ProjectQueueCard) sigue abriendo Planificación
// aparte — este overlay es una vista adicional, no lo reemplaza.
//
// Si viene con un `filterKey` activo (desde el chip de la tarjeta —
// vencidas/vence hoy), la cola ya llega recortada por
// filterEngineerProjectQueue: un proyecto sin coincidencias simplemente
// muestra sus secciones vacías, no se oculta.

import FullscreenOverlay from "../FullscreenOverlay";
import EngineerProjectTable from "./EngineerProjectTable";

const FILTER_LABEL = {
  overdue:  "En demora",
  dueToday: "Vence hoy",
};

export default function ProjectQueueOverlay({
  open, onClose, project, queue, filterKey,
  onOpenActivity, onToggleUrgent, onReorderSection, onExportMarkdown,
}) {
  if (!open || !project) return null;

  return (
    <FullscreenOverlay open={open} onClose={onClose} title={`Tareas — ${project.project_name || "Proyecto"}`}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        {filterKey ? (
          <span className="eng-ptable__filter-hint">Filtrando por: <strong>{FILTER_LABEL[filterKey] || filterKey}</strong></span>
        ) : <span />}
        <button type="button" className="btn" onClick={() => onExportMarkdown?.(project)}>
          ⬇ Descargar tareas
        </button>
      </div>

      <EngineerProjectTable
        queue={queue}
        onOpenActivity={activityId => onOpenActivity?.(project.id, activityId)}
        onToggleUrgent={onToggleUrgent ? (activityId => onToggleUrgent(project.id, activityId)) : undefined}
        onReorderSection={onReorderSection}
      />
    </FullscreenOverlay>
  );
}
