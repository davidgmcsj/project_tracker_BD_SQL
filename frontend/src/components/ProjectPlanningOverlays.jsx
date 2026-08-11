// ProjectPlanningOverlays.jsx — Las tres vistas de planificación de un proyecto
// (tablero de estados, Gantt y tabla jerárquica) a pantalla completa, más la
// tarjeta de detalle de actividad que se abre desde cualquiera de ellas.
//
// Se monta tanto desde EditView (botones de la sección "Planificación") como
// desde el Dashboard (accesos rápidos en cada tarjeta de proyecto). Encapsula
// los handlers de edición para que ambos puntos de entrada compartan el mismo
// comportamiento sin duplicar lógica.

import { useEffect, useState } from "react";
import { createActivity, visibleActivities, buildActivityTree, aggregatedProgress, getToday } from "../utils/formulas";
import { moveTaskStatus } from "./edit/shared";
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
  initialActivityId, // abre la tarjeta de detalle de una vez (ej. desde EngineerHub)
}) {
  const [modalActId, setModalActId] = useState(initialActivityId || null);

  // Sincroniza cuando el caller pide abrir OTRA actividad puntual (ej. clic
  // en una fila distinta de "Mi semana") sin pasar por un remount del overlay.
  useEffect(() => {
    if (initialActivityId) setModalActId(initialActivityId);
  }, [initialActivityId]);

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

  // El Kanban solo cambia task_status — el % de la actividad vive aparte, en
  // activities_identified. Al entrar (no salir) de la columna "Completadas"
  // se fuerza su progress a 100, misma regla que ActivityDetailModal cuando
  // se pone la fecha de completada a mano: una actividad completada siempre
  // muestra 100% sin importar por cuál de los dos caminos se marcó.
  const handleStatusChange = (newTaskStatus) => {
    const wasCompleted = new Set(safeArr(taskStatus.completed));
    const nowCompleted = safeArr(newTaskStatus.completed).filter(id => !wasCompleted.has(id));
    const newActs = nowCompleted.length
      ? activities.map(a => nowCompleted.includes(a.id) ? { ...a, progress: 100 } : a)
      : activities;
    commit(newActs, newTaskStatus);
  };

  // Cambia el estado de una actividad desde la columna "Estado" de la tabla
  // jerárquica — mismo mecanismo que el selector del modal de detalle
  // (moveTaskStatus, misma lógica que TaskStatusSelector.move() del Kanban).
  const handleChangeActivityStatus = (activityId, newStatus) => {
    commit(activities, moveTaskStatus(taskStatus, activities, activityId, newStatus));
  };

  // Devuelve el id para poder abrir la tarjeta de la subtarea recién creada.
  // La agrega también a task_status.not_started (con su status_history.added)
  // — sin esto la actividad quedaba en activities_identified pero fuera de
  // los tres buckets del Kanban, mostrándose como "sin clasificar" en vez
  // de aparecer directo en "No iniciadas", que es donde nace toda actividad
  // nueva creada por cualquier otro camino (handleAddActivity en EditView).
  const handleAddChild = (parentId, sequenceOrder) => {
    const newAct = createActivity("Nueva subtarea", parentId, sequenceOrder);
    const newTs = {
      ...taskStatus,
      not_started: [...safeArr(taskStatus.not_started), newAct.id],
      status_history: { ...(taskStatus.status_history || {}), [newAct.id]: { added: getToday() } },
    };
    commit([...activities, newAct], newTs);
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
  // task_status.status_history. _newStatus (cambio de columna del Kanban
  // desde el modal) tampoco: mueve el id entre buckets vía moveTaskStatus
  // (misma lógica que TaskStatusSelector.move()).
  const handleActivitySave = (updatedAct) => {
    const { _history, _newStatus, ...actClean } = updatedAct;
    const newActs = activities.map(a => a.id === actClean.id ? actClean : a);
    let newTs = taskStatus;
    if (_history) {
      const cleanHist = {};
      if (_history.added)       cleanHist.added       = _history.added;
      if (_history.in_progress) cleanHist.in_progress = _history.in_progress;
      if (_history.completed)   cleanHist.completed   = _history.completed;
      newTs = {
        ...newTs,
        status_history: { ...(newTs.status_history || {}), [actClean.id]: cleanHist },
      };
    }
    if (_newStatus) {
      newTs = moveTaskStatus(newTs, newActs, actClean.id, _newStatus);
    }
    commit(newActs, newTs);
  };

  const modalActivity = modalActId ? activities.find(a => a.id === modalActId) : null;
  const modalSubtasks = modalActId ? activities.filter(a => a.parent_id === modalActId) : [];

  // Si tiene subtareas, el % deja de ser editable a mano — se calcula como
  // el promedio de sus hijas (ver mismo comentario en EditView.jsx).
  const modalComputedProgress = modalActivity && modalSubtasks.length > 0
    ? aggregatedProgress(modalActivity, buildActivityTree(activities).childrenOf)
    : null;

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
            onChange={handleStatusChange}
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
            onChangeStatus={handleChangeActivityStatus}
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
          allActivities={activities}
          onSave={handleActivitySave}
          onDelete={handleDeleteActivity}
          onClose={() => setModalActId(null)}
          subtasks={modalSubtasks}
          computedProgress={modalComputedProgress}
          onCreateSubtask={handleCreateSubtaskFromModal}
          onOpenSubtask={setModalActId}
          onDeleteSubtask={handleDeleteActivity}
        />
      )}
    </>
  );
}
