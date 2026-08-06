// EngineerWeekTable.jsx — tabla "mi semana" / "próxima semana": actividad +
// proyecto de origen + fechas + situación, cruzando TODOS los proyectos del
// ingeniero (motor: utils/weekPlanning.js vía utils/engineers.js).

import { SITUATION_LABEL } from "../../utils/weekPlanning";
import { formatDateDMY } from "../../utils/formulas";

export default function EngineerWeekTable({ rows, onOpenActivity }) {
  if (rows.length === 0) {
    return <p style={{ color: "var(--text-2)", fontSize: "13px" }}>Sin actividades en este rango.</p>;
  }
  return (
    <div className="metrics-container" style={{ overflowX: "auto" }}>
      <table className="metrics-table metrics-table--project">
        <thead>
          <tr>
            <th>Actividad</th>
            <th style={{ width: "160px" }}>Proyecto</th>
            <th style={{ width: "100px" }}>Inicio</th>
            <th style={{ width: "100px" }}>Fin</th>
            <th style={{ width: "140px" }}>Situación</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ activity, situation, projectName, projectId }) => (
            <tr
              key={`${projectId}-${activity.id}`}
              onClick={onOpenActivity ? () => onOpenActivity(projectId, activity.id) : undefined}
              style={onOpenActivity ? { cursor: "pointer" } : undefined}
            >
              <td>{activity.text || "(sin nombre)"}</td>
              <td style={{ color: "var(--text-2)", fontSize: "12px" }}>{projectName}</td>
              <td style={{ fontSize: "12px" }}>{formatDateDMY(activity.start_date)}</td>
              <td style={{ fontSize: "12px" }}>{formatDateDMY(activity.due_date)}</td>
              <td><span className={`week-auto-table__situation week-auto-table__situation--${situation}`}>{SITUATION_LABEL[situation]}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
