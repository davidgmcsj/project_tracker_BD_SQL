// ProjectPlanningOverlays.jsx — Las tres vistas de planificación de un proyecto
// (tablero de estados, Gantt y tabla jerárquica) a pantalla completa, más la
// tarjeta de detalle de actividad que se abre desde cualquiera de ellas.
//
// Se monta tanto desde EditView (botones de la sección "Planificación") como
// desde el Dashboard (accesos rápidos en cada tarjeta de proyecto). Encapsula
// los handlers de edición para que ambos puntos de entrada compartan el mismo
// comportamiento sin duplicar lógica.

import { useState } from "react";
import { createActivity, visibleActivities } from "../utils/formulas";
import FullscreenOverlay from "./FullscreenOverlay";
import GanttChart from "./GanttChart";
import HierarchyTable from "./HierarchyTable";
import ActivityDetailModal from "./ActivityDetailModal";

const TITLES = {
  status:    "Estado de actividades",
  gantt:     "Cronograma",
  hierarchy: "Planificación",
};

function safeArr(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

export default function ProjectPlanningOverlays({
  project,          // proyecto activo (null = nada abierto)
  view,             // "status" | "gantt" | "hierarchy" | null
  onClose,
  onUpdateProject,  // (updatedProject) => void
  engineerCatalog,
  externalContacts,
  StatusBoard,      // TaskStatusSelector, inyectado para no duplicarlo aquí
}) {
  const [modalActId, setModalActId] = useState(null);

  if (!project || !view) return null;

  const activities = Array.isArray(project.activities_identified) ? project.activities_identified : [];
  const taskStatus = project.task_status && typeof project.task_status === "object" ? project.task_status : {};

  const buildAutoMetrics = (newActs, newTs) => ({
    ...(project.manual_metrics || {}),
    total_tasks:       visibleActivities(newActs).length,
    completed_tasks:   safeArr(newTs.completed).length,
    in_progress_tasks: safeArr(newTs.in_progress).length,
  });

  const commit = (newActs, newTs = taskStatus) => {
    onUpdateProject({
      ...project,
      activities_identified: newActs,
      task_status: newTs,
      manual_metrics: buildAutoMetrics(newActs, newTs),
    });
  };

  // Aplica el patch propio de la fila editada MÁS los de la cascada en una
  // sola actualización — dos escrituras seguidas sobre el mismo snapshot se
  // pisarían entre sí y la fila editada perdería su valor nuevo.
  const handleApplyDateChange = (patches) => {
    const byId = new Map(patches.map(pt => [pt.id, pt]));
    commit(activities.map(a => byId.has(a.id) ? { ...a, ...byId.get(a.id) } : a));
  };

  // Devuelve el id para poder abrir la tarjeta de la subtarea recién creada.
  const handleAddChild = (parentId, sequenceOrder) => {
    const newAct = createActivity("Nueva subtarea", parentId, sequenceOrder);
    commit([...activities, newAct]);
    return newAct.id;
  };

  // Las hijas directas suben a ser hijas del padre de la borrada, en vez de
  // quedar huérfanas.
  const handleDeleteActivity = (actId) => {
    const target = activities.find(a => a.id === actId);
    const parentId = target?.parent_id ?? null;
    const newActs = activities
      .filter(a => a.id !== actId)
      .map(a => a.parent_id === actId ? { ...a, parent_id: parentId } : a);
    const newTs = {
      ...taskStatus,
      completed:      (taskStatus.completed   || []).filter(id => id !== actId),
      in_progress:    (taskStatus.in_progress || []).filter(id => id !== actId),
      not_started:    (taskStatus.not_started || []).filter(id => id !== actId),
      status_history: Object.fromEntries(
        Object.entries(taskStatus.status_history || {}).filter(([id]) => id !== actId)
      ),
    };
    commit(newActs, newTs);
    if (modalActId === actId) setModalActId(null);
  };

  // _history (fechas de transición) no vive en la actividad: se escribe en
  // task_status.status_history.
  const handleActivitySave = (updatedAct) => {
    const { _history, ...actClean } = updatedAct;
    const newActs = activities.map(a => a.id === actClean.id ? actClean : a);
    let newTs = taskStatus;
    if (_history) {
      const cleanHist = {};
      if (_history.added)       cleanHist.added       = _history.added;
      if (_history.in_progress) cleanHist.in_progress = _history.in_progress;
      if (_history.completed)   cleanHist.completed   = _history.completed;
      newTs = {
        ...taskStatus,
        status_history: { ...(taskStatus.status_history || {}), [actClean.id]: cleanHist },
      };
    }
    commit(newActs, newTs);
  };

  const modalActivity = modalActId ? activities.find(a => a.id === modalActId) : null;
  const modalSubtasks = modalActId ? activities.filter(a => a.parent_id === modalActId) : [];

  const handleCreateSubtaskFromModal = () => {
    setModalActId(handleAddChild(modalActId, modalSubtasks.length));
  };

  return (
    <>
      <FullscreenOverlay
        open
        onClose={onClose}
        title={`${TITLES[view]} — ${project.project_name || "Proyecto"}`}
      >
        {view === "status" && StatusBoard && (
          <StatusBoard
            taskStatus={project.task_status}
            activities={activities}
            onOpenDetail={setModalActId}
            onChange={val => commit(activities, val)}
          />
        )}
        {view === "gantt" && (
          <GanttChart
            activities={activities}
            taskStatus={project.task_status}
            onOpenActivity={setModalActId}
          />
        )}
        {view === "hierarchy" && (
          <HierarchyTable
            activities={activities}
            taskStatus={project.task_status}
            onApplyDateChange={handleApplyDateChange}
            onAddChild={handleAddChild}
            onDeleteActivity={handleDeleteActivity}
            onOpenActivity={setModalActId}
          />
        )}
      </FullscreenOverlay>

      {modalActivity && (
        <ActivityDetailModal
          activity={modalActivity}
          projectName={project.project_name || "Proyecto"}
          projectId={project.id}
          taskStatus={project.task_status}
          engineerCatalog={engineerCatalog}
          externalContacts={externalContacts}
          onSave={handleActivitySave}
          onDelete={handleDeleteActivity}
          onClose={() => setModalActId(null)}
          subtasks={modalSubtasks}
          onCreateSubtask={handleCreateSubtaskFromModal}
          onOpenSubtask={setModalActId}
          onDeleteSubtask={handleDeleteActivity}
        />
      )}
    </>
  );
}
