// EngineerReportBody.jsx — "Actividades por proyecto" + "Tareas adicionales"
// para un ingeniero ya seleccionado. Extraído de EngineerReportView (antes
// una pestaña propia) para reutilizarse como sub-pestaña "Historial" dentro
// de EngineerHub, sin duplicar el hero/selector que EngineerHub ya muestra.

import { getProjectsForEngineer, getAllAssignedActivitiesInProject } from "../utils/engineers";
import EngineerActivitiesTable from "./engineer/EngineerActivitiesTable";
import AdditionalTasksTable from "./engineer/AdditionalTasksTable";

function ProjectBlock({ project, engineerId }) {
  const acts = getAllAssignedActivitiesInProject(engineerId, project);
  return (
    <div className="project-card" style={{ marginBottom: 16 }}>
      <div className="project-card__header" style={{ marginBottom: 12 }}>
        <h3 className="project-card__name">{project.project_name}</h3>
        <span className="status-pill">{acts.length} actividad{acts.length !== 1 ? "es" : ""}</span>
      </div>
      {acts.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: "13px" }}>Sin actividades asignadas en este proyecto.</p>
      ) : (
        <EngineerActivitiesTable activities={acts} />
      )}
    </div>
  );
}

function AdditionalTasksBlock({ tasks }) {
  const list = tasks || [];
  return (
    <div className="project-card" style={{ marginBottom: 16 }}>
      <div className="project-card__header" style={{ marginBottom: 12 }}>
        <h3 className="project-card__name">Tareas adicionales</h3>
        <span className="status-pill">{list.length} tarea{list.length !== 1 ? "s" : ""}</span>
      </div>
      {list.length === 0 ? (
        <p style={{ color: "var(--text-2)", fontSize: "13px" }}>Sin tareas adicionales registradas.</p>
      ) : (
        <AdditionalTasksTable tasks={list} mode="read" />
      )}
    </div>
  );
}

export default function EngineerReportBody({ engineer, projects }) {
  const projs = getProjectsForEngineer(engineer.id, projects);

  return (
    <>
      <h3 className="report-section-title" style={{ marginBottom: 12 }}>
        Actividades por proyecto ({projs.length})
      </h3>
      {projs.length === 0 ? (
        <p style={{ color: "var(--text-2)" }}>Este ingeniero no está asignado a ningún proyecto.</p>
      ) : (
        projs.map(p => <ProjectBlock key={p.id} project={p} engineerId={engineer.id} />)
      )}

      <h3 className="report-section-title" style={{ margin: "20px 0 12px" }}>Tareas adicionales</h3>
      <AdditionalTasksBlock tasks={engineer.tasks} />
    </>
  );
}
