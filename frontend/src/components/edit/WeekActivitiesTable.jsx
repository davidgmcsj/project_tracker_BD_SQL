// WeekActivitiesTable.jsx — Tabla de solo lectura: actividad, inicio, fin y
// su situación en la semana (vence / inicia / continúa / en demora /
// completada). Clic en el nombre abre su tarjeta.
//
// Usada por EngineerRow y NextWeekPlanningSection.

import { formatDateDMY } from "../../utils/formulas";
import { ROW_STATUS_LABEL } from "./shared";

export default function WeekActivitiesTable({ rows, onOpenActivity }) {
  return (
    <table className="week-auto-table">
      <thead>
        <tr>
          <th>Actividad</th>
          <th>Inicio</th>
          <th>Fin</th>
          <th>Situación</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(({ activity, situation }) => (
          <tr key={activity.id}>
            <td className="week-auto-table__name">
              {onOpenActivity ? (
                <button type="button" className="week-auto-table__name-link" onClick={() => onOpenActivity(activity.id)}>
                  {activity.text || "(sin nombre)"}
                </button>
              ) : (activity.text || "(sin nombre)")}
            </td>
            <td>{formatDateDMY(activity.start_date)}</td>
            <td>{formatDateDMY(activity.due_date)}</td>
            <td>
              <span className={`week-auto-table__situation week-auto-table__situation--${situation}`}>
                {ROW_STATUS_LABEL[situation]}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
