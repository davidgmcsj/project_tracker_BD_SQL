// NextWeekPlanningSection.jsx — Cierre semanal automático (reemplaza
// selección manual). "Qué se hizo esta semana" y "plan próxima semana" ya no
// se seleccionan a mano: se derivan de completed_dates y de las fechas de
// cada actividad (mismo motor que EngineerRow — ver utils/weekPlanning.js).
// El resultado se escribe en next_week_plan/weekly_achievements para que
// ReportView y el resto de consumidores del reporte sigan funcionando sin
// cambios.

import { useEffect, useMemo } from "react";
import { completedInWeek, activitiesForWeek } from "../../utils/weekPlanning";
import { safeArr, CURRENT_WEEK, NEXT_WEEK } from "./shared";
import WeekActivitiesTable from "./WeekActivitiesTable";

export default function NextWeekPlanningSection({ activities, taskStatus, project, onUpdateProject, onOpenActivity }) {
  const completedRows = useMemo(
    () => completedInWeek(activities, CURRENT_WEEK, taskStatus),
    [activities, taskStatus]
  );
  const nextWeekRows = useMemo(
    () => activitiesForWeek(activities, NEXT_WEEK, taskStatus, { includeOverdue: false }),
    [activities, taskStatus]
  );

  const completedIds = completedRows.map(a => a.id);
  const nextWeekIds  = nextWeekRows.map(r => r.activity.id);
  const completedKey = completedIds.join(",");
  const nextWeekKey  = nextWeekIds.join(",");

  useEffect(() => {
    const current = safeArr(project.weekly_achievements);
    if (current.join(",") === completedKey) return;
    onUpdateProject({ ...project, weekly_achievements: completedIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula por completedKey (contenido)
  }, [completedKey]);

  useEffect(() => {
    const current = safeArr(project.next_week_plan);
    if (current.join(",") === nextWeekKey) return;
    onUpdateProject({ ...project, next_week_plan: nextWeekIds });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula por nextWeekKey (contenido)
  }, [nextWeekKey]);

  return (
    <div className="field field--optional">
      <div className="field__header">
        <label className="field__label" style={{ marginBottom: 0 }}>
          Cierre semanal
          <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>
            Calculado automáticamente desde las fechas de cada actividad
          </span>
        </label>
      </div>
      <div className="edit-row edit-row--2col" style={{ marginTop: 12 }}>
        <div className="field">
          <label className="field__label">✓ Qué se hizo esta semana</label>
          {completedRows.length === 0 ? (
            <p className="engineer-selected__empty">Sin actividades completadas esta semana.</p>
          ) : (
            <WeekActivitiesTable
              rows={completedRows.map(activity => ({ activity, situation: "completed" }))}
              onOpenActivity={onOpenActivity}
            />
          )}
        </div>
        <div className="field">
          <label className="field__label">→ Plan para la próxima semana</label>
          {nextWeekRows.length === 0 ? (
            <p className="engineer-selected__empty">Sin actividades planificadas para la próxima semana.</p>
          ) : (
            <WeekActivitiesTable rows={nextWeekRows} onOpenActivity={onOpenActivity} />
          )}
        </div>
      </div>
    </div>
  );
}
