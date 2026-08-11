// ProjectActivitiesPanel.jsx — Overlay de "Actividades" del tablero de
// Dirección: en proceso esta semana, próxima semana y fechas clave, todo
// calculado en vivo por fecha (mismo motor que EditView/EngineerHub —
// utils/weekPlanning.js) en vez de depender de next_week_plan, que solo se
// recalcula cuando alguien abre el proyecto en pantalla.

import { activitiesForWeek } from "../../utils/weekPlanning";
import { visibleActivities, formatDateDMY } from "../../utils/formulas";
import { CURRENT_WEEK, NEXT_WEEK } from "../edit/shared";
import FullscreenOverlay from "../FullscreenOverlay";
import WeekActivitiesTable from "../edit/WeekActivitiesTable";

// Fechas clave = todas las actividades PRINCIPALES (parent_id null — sin
// subtareas), tengan fecha o no y sin importar su estado. Es la vista global
// de entregas del proyecto, no un recorte de "lo próximo" — las sin fecha se
// muestran igual con "Fecha por definir" en vez de ocultarse.
function keyDatesForMains(activities) {
  return activities
    .filter(a => a.parent_id == null)
    .sort((a, b) => {
      if (!a.due_date && !b.due_date) return 0;
      if (!a.due_date) return 1;  // sin fecha van al final
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
}

export default function ProjectActivitiesPanel({ project, onClose, onOpenActivity }) {
  if (!project) return null;

  const activities = visibleActivities(project.activities_identified);
  const taskStatus = project.task_status || {};

  const inProgressRows = activitiesForWeek(activities, CURRENT_WEEK, taskStatus);
  const nextWeekRows   = activitiesForWeek(activities, NEXT_WEEK, taskStatus, { includeOverdue: false });
  const keyDates        = keyDatesForMains(activities);

  return (
    <FullscreenOverlay
      open
      onClose={onClose}
      title={`Actividades — ${project.project_name || "Proyecto"}`}
    >
      <div className="director-activities">
        <section className="director-activities__section">
          <h3 className="director-activities__title">🔄 En proceso esta semana</h3>
          {inProgressRows.length === 0 ? (
            <p className="director-activities__empty">Sin actividades esta semana.</p>
          ) : (
            <WeekActivitiesTable rows={inProgressRows} onOpenActivity={onOpenActivity} />
          )}
        </section>

        <section className="director-activities__section">
          <h3 className="director-activities__title">→ Próxima semana</h3>
          {nextWeekRows.length === 0 ? (
            <p className="director-activities__empty">Sin actividades planificadas para la próxima semana.</p>
          ) : (
            <WeekActivitiesTable rows={nextWeekRows} onOpenActivity={onOpenActivity} />
          )}
        </section>

        <section className="director-activities__section">
          <h3 className="director-activities__title">📅 Fechas clave</h3>
          {keyDates.length === 0 ? (
            <p className="director-activities__empty">Sin actividades principales registradas.</p>
          ) : (
            <ul className="director-activities__keydates">
              {keyDates.map(a => (
                <li key={a.id} className="director-activities__keydate">
                  {onOpenActivity ? (
                    <button type="button" className="director-activities__keydate-link" onClick={() => onOpenActivity(a.id)}>
                      {a.text || "(sin nombre)"}
                    </button>
                  ) : (
                    <span>{a.text || "(sin nombre)"}</span>
                  )}
                  <span className={`director-activities__keydate-date${a.due_date ? "" : " director-activities__keydate-date--pending"}`}>
                    {a.due_date ? formatDateDMY(a.due_date) : "Fecha por definir"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </FullscreenOverlay>
  );
}
