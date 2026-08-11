// ProjectOverviewTable.jsx — Tablero de Dirección: una fila por proyecto
// (nombre, encargado, avance) con 3 accesos a más detalle sin abrumar con
// todas las estadísticas de una — Gantt, Estados (Kanban de task_status) y
// Actividades (en proceso / próxima semana / fechas clave, ver
// ProjectActivitiesPanel). Comparte el mismo overlay de planificación que ya
// usa el Dashboard del gestor (ProjectPlanningOverlays), así Gantt/Estados se
// comportan idéntico en las dos pantallas.
//
// showEditButton agrega un 4º acceso directo a EditView — visible solo para
// quien gestiona el portafolio (el director no lo necesita).

import { useState } from "react";
import MiniBar from "../MiniBar";
import { projectProgress, buildEngineerIndex, engineerName } from "../../utils/formulas";
import ProjectPlanningOverlays from "../ProjectPlanningOverlays";
import ProjectActivitiesPanel from "./ProjectActivitiesPanel";
import ActivityDetailModal from "../ActivityDetailModal";

function assignedNames(project, engineerIndex) {
  const rows = (project.engineers || []).filter(e => e.engineer_id);
  if (!rows.length) return "Sin asignar";
  return rows.map(e => engineerName(engineerIndex, e.engineer_id)).join(", ");
}

export default function ProjectOverviewTable({ projects, engineers, onUpdateProject, onEdit, showEditButton, StatusBoard }) {
  const [search, setSearch] = useState("");
  const [planning, setPlanning] = useState(null);   // { idx, view: "status"|"gantt" } — ProjectPlanningOverlays
  const [activitiesIdx, setActivitiesIdx] = useState(null); // idx con el panel de Actividades abierto
  const [modalActId, setModalActId] = useState(null); // actividad abierta desde el panel de Actividades

  const engineerIndex = buildEngineerIndex(engineers);

  const filtered = projects
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => !search.trim() || (p.project_name || "").toLowerCase().includes(search.trim().toLowerCase()));

  const activitiesProject = activitiesIdx !== null ? projects[activitiesIdx] : null;
  const modalActivity = modalActId && activitiesProject
    ? (activitiesProject.activities_identified || []).find(a => a.id === modalActId)
    : null;

  const handleActivitySave = (updatedAct) => {
    const { _history, ...actClean } = updatedAct;
    const p = activitiesProject;
    const newActs = (p.activities_identified || []).map(a => a.id === actClean.id ? actClean : a);
    let newTs = p.task_status || {};
    if (_history) {
      const cleanHist = {};
      if (_history.added)       cleanHist.added       = _history.added;
      if (_history.in_progress) cleanHist.in_progress = _history.in_progress;
      if (_history.completed)   cleanHist.completed   = _history.completed;
      newTs = { ...newTs, status_history: { ...(newTs.status_history || {}), [actClean.id]: cleanHist } };
    }
    onUpdateProject(activitiesIdx, { ...p, activities_identified: newActs, task_status: newTs });
  };

  return (
    <div className="director-table-view">
      <div className="director-table-view__search">
        <input
          type="text"
          className="dashboard-search-input"
          placeholder="Buscar proyecto…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <button className="dashboard-search-clear" onClick={() => setSearch("")} title="Limpiar">✕</button>
        )}
      </div>

      <div className="director-table__wrap">
        <table className="director-table">
          <thead>
            <tr>
              <th>Proyecto</th>
              <th>Encargado</th>
              <th>Avance</th>
              <th colSpan={showEditButton ? 4 : 3}>Ver</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={showEditButton ? 7 : 6} className="director-table__empty">Sin proyectos que coincidan.</td></tr>
            ) : filtered.map(({ p, i }) => {
              const m = p.manual_metrics || {};
              const pct = Math.round(projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks));
              return (
                <tr key={p.id}>
                  <td className="director-table__name">{p.project_name || `Proyecto ${i + 1}`}</td>
                  <td className="director-table__assignee">{assignedNames(p, engineerIndex)}</td>
                  <td className="director-table__progress">
                    <MiniBar completed={m.completed_tasks} inProgress={m.in_progress_tasks} total={m.total_tasks} />
                    <span className="director-table__progress-pct">{pct}%</span>
                  </td>
                  <td>
                    <button type="button" className="btn btn--card-plan" onClick={() => setPlanning({ idx: i, view: "gantt" })} title="Diagrama de Gantt">
                      📅 Gantt
                    </button>
                  </td>
                  <td>
                    <button type="button" className="btn btn--card-plan" onClick={() => setPlanning({ idx: i, view: "status" })} title="Estado de actividades">
                      🗃 Estados
                    </button>
                  </td>
                  <td>
                    <button type="button" className="btn btn--card-plan" onClick={() => setActivitiesIdx(i)} title="En proceso, próxima semana y fechas clave">
                      📋 Actividades
                    </button>
                  </td>
                  {showEditButton && (
                    <td>
                      <button type="button" className="btn btn--card-plan" onClick={() => onEdit(i)} title="Editar proyecto completo">
                        ✎ Editar
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <ProjectPlanningOverlays
        project={planning ? projects[planning.idx] : null}
        view={planning?.view}
        onClose={() => setPlanning(null)}
        onUpdateProject={updated => onUpdateProject(planning.idx, updated)}
        engineerCatalog={engineers}
        StatusBoard={StatusBoard}
      />

      {activitiesProject && (
        <ProjectActivitiesPanel
          project={activitiesProject}
          onClose={() => setActivitiesIdx(null)}
          onOpenActivity={setModalActId}
        />
      )}

      {modalActivity && (
        <ActivityDetailModal
          activity={modalActivity}
          projectName={activitiesProject.project_name || "Proyecto"}
          projectId={activitiesProject.id}
          taskStatus={activitiesProject.task_status}
          engineerCatalog={engineers}
          onSave={handleActivitySave}
          onClose={() => setModalActId(null)}
        />
      )}
    </div>
  );
}
