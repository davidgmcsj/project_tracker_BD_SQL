// EngineerActivitiesTable.jsx — tabla de 6 columnas (#, Actividad, Estado,
// Inscrita, En proceso, Completada) para las actividades de un ingeniero en
// un proyecto. Antes existían dos implementaciones idénticas: EngineersView
// (ActivitiesTable, vía completedSet/inProgressSet) y EngineerReportView
// (ProjectBlock, vía activity.status) — unificadas aquí.
//
// Cada actividad puede traer status ya resuelto (a.status) o resolverse desde
// completedSet/inProgressSet — lo que ya tenga cada caller.
//
// onOpenActivity recibe solo el activityId (no projectId como
// EngineerWeekTable): esta tabla vive SIEMPRE dentro de un bloque de un
// único proyecto ya conocido por quien la usa (ProjectActivitiesCard,
// ProjectBlock) — pedirle el projectId por fila sería redundante.

import StatusBadge, { statusFromSets } from "./StatusBadge";
import DatesCell from "./DatesCell";

export default function EngineerActivitiesTable({ activities, completedSet, inProgressSet, onOpenActivity }) {
  return (
    <div className="metrics-container" style={{ overflowX: "auto" }}>
      <table className="metrics-table metrics-table--project">
        <thead>
          <tr>
            <th style={{ width: "40px", textAlign: "center" }}>#</th>
            <th>Actividad</th>
            <th style={{ width: "120px" }}>Estado</th>
            <th style={{ width: "110px" }}>Inscrita</th>
            <th style={{ width: "110px" }}>En proceso</th>
            <th style={{ width: "110px" }}>Completada</th>
          </tr>
        </thead>
        <tbody>
          {activities.map(a => {
            const status = a.status || statusFromSets(a.id, completedSet, inProgressSet);
            return (
              <tr
                key={a.id}
                onClick={onOpenActivity ? () => onOpenActivity(a.id) : undefined}
                style={onOpenActivity ? { cursor: "pointer" } : undefined}
              >
                <td style={{ textAlign: "center", fontWeight: 700 }}>{a.position}</td>
                <td>{a.text}</td>
                <td><StatusBadge status={status} /></td>
                <DatesCell history={a.history} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
