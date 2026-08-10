// EditView.jsx — Orquestador de la pantalla de edición de proyecto. La
// mayoría de las piezas (ActivitiesList, TaskStatusSelector, BulkAssignPanel,
// EngineerRow, etc.) se dividieron a components/edit/ en la Fase 4 de la
// refactorización — este archivo compone el layout y contiene el estado y
// los handlers que se pasan a cada pieza como props.
//
// TaskStatusSelector se RE-EXPORTA desde aquí (no se mueve el import): App.jsx
// hace `import EditView, { TaskStatusSelector } from "./components/EditView"`
// y lo inyecta en ProjectPlanningOverlays como StatusBoard. Cambiar ese import
// está fuera del alcance de esta refactorización — el contrato público del
// módulo no cambia.

import { useState, useRef } from "react";
import {
  createDefaultEngineer, createDefaultIndicator, createDefaultImpediment,
  createActivity, visibleActivities, leafActivities, getToday,
} from "../utils/formulas";
import { mergePlannerImport, normalizeName } from "../utils/plannerImport";
import ActivityDetailModal from "./ActivityDetailModal";
import PlannerImportModal from "./PlannerImportModal";
import { ProjectNotesPanel } from "./ProjectNotesPanel";
import ProjectPlanningOverlays from "./ProjectPlanningOverlays";

import { safeArr, safeActs, IMPEDIMENT_TYPES } from "./edit/shared";
import ActivitiesList from "./edit/ActivitiesList";
import BulkAssignPanel from "./edit/BulkAssignPanel";
import IndicatorRow from "./edit/IndicatorRow";
import ImpedimentRow from "./edit/ImpedimentRow";
import EngineerRow from "./edit/EngineerRow";
import NextWeekPlanningSection from "./edit/NextWeekPlanningSection";
import ProjectPulseField from "./edit/ProjectPulseField";
import DeleteConfirmModal from "./edit/DeleteConfirmModal";
import TaskStatusSelector from "./edit/TaskStatusSelector";

export { TaskStatusSelector };

// ── Constantes ────────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "on-track",        label: "En curso"        },
  { value: "at-risk",         label: "En riesgo"       },
  { value: "blocked",         label: "Bloqueado"       },
  { value: "completed",       label: "Completado"      },
  { value: "mejora-continua", label: "Mejora Continua" },
];

// Fechas que se registran automáticamente por columna — mismo mapa que usa
// TaskStatusSelector internamente, duplicado aquí porque handleUpdateActivityMeta
// y handleAddActivity replican la misma lógica de status_history desde fuera
// del Kanban (edición inline en ActivitiesList, alta rápida).
const STATUS_DATE_FIELD = {
  not_started: null,
  in_progress: "in_progress",
  completed:   "completed",
};

// ── EditView principal ────────────────────────────────────────────────────────

export default function EditView({
  projects, editingIdx, hasUnsavedChanges,
  onSelectProject, onUpdateProject, onUpdateProjectFull, onSaveChanges, onSaveProjectsDirect,
  onReorderProjects, onAddProject, onRemoveProject, onViewReport, onExportReport,
  engineerCatalog, onCreateEngineer,
  externalContacts, onAddExternalContact, onToggleExternalActive,
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [dragOverIdx,     setDragOverIdx]     = useState(null);
  const [modalActId,      setModalActId]      = useState(null);
  const [showPlannerModal, setShowPlannerModal] = useState(false);
  const [planningView,    setPlanningView]    = useState(null); // "status" | "gantt" | "hierarchy" | null
  const dragSrcIdx = useRef(null);

  const handleDragStart = (e, i) => { dragSrcIdx.current = i; e.dataTransfer.effectAllowed = "move"; };
  const handleDragOver  = (e, i) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverIdx(i); };
  const handleDrop      = (e, i) => { e.preventDefault(); const src = dragSrcIdx.current; if (src !== null && src !== i) onReorderProjects(src, i); setDragOverIdx(null); };
  const handleDragEnd   = ()     => { dragSrcIdx.current = null; setDragOverIdx(null); };

  const p          = editingIdx !== null ? projects[editingIdx] : null;
  const m          = p?.manual_metrics || {};
  const engineers   = p?.engineers   || [];
  const indicators  = p?.indicators  || [];
  const impediments = p?.impediments || [];
  // allActivities = crudo (incluye archivadas) para almacenamiento y merge de importación.
  // activities    = solo visibles (no archivadas) para toda la UI y las métricas.
  const allActivities = safeActs(p?.activities_identified);
  const activities    = visibleActivities(allActivities);

  // Métricas calculadas automáticamente desde actividades y estado de actividades.
  // Solo cuentan las HOJAS (actividades sin subtareas): un padre con subtareas
  // es un contenedor organizativo, no una unidad de trabajo medible — contarlo
  // aparte infla el total (un padre con 5 hijas terminadas aparecería como 6
  // tareas, no 5). Ver leafActivities (formulas.js).
  const ts              = p?.task_status || {};
  const leafIds         = new Set(leafActivities(activities).map(a => a.id));
  const autoTotal       = leafIds.size;
  const autoCompletadas = safeArr(ts.completed).filter(id => leafIds.has(id)).length;
  const autoEnProceso   = safeArr(ts.in_progress).filter(id => leafIds.has(id)).length;
  const autoNoIniciadas = Math.max(0, autoTotal - autoCompletadas - autoEnProceso);

  const updateMetric = (field, val) =>
    onUpdateProject(editingIdx, "manual_metrics", { ...m, [field]: val === "" ? "" : Number(val) });

  // Recalcula total/completadas/en_proceso desde actividades y task_status.
  // Cuenta solo actividades visibles (las archivadas por Planner no inflan el
  // total) Y solo hojas (mismo criterio que autoTotal/autoCompletadas arriba).
  const buildAutoMetrics = (newActs, newTs) => {
    const visibles    = visibleActivities(newActs);
    const leafIdsNext = new Set(leafActivities(visibles).map(a => a.id));
    return {
      ...m,
      total_tasks:       leafIdsNext.size,
      completed_tasks:   safeArr(newTs.completed).filter(id => leafIdsNext.has(id)).length,
      in_progress_tasks: safeArr(newTs.in_progress).filter(id => leafIdsNext.has(id)).length,
    };
  };

  const addEngineer    = () => onUpdateProject(editingIdx, "engineers",   [...engineers,   createDefaultEngineer()]);
  const updateEngineer = (i, f, v) => onUpdateProject(editingIdx, "engineers",   engineers.map((e, idx)   => idx === i ? { ...e,   [f]: v } : e));
  const removeEngineer = (i)       => onUpdateProject(editingIdx, "engineers",   engineers.filter((_, idx) => idx !== i));

  // Agrega un ingeniero al proyecto desde el selector rápido del header
  const addEngineerFromCatalog = (engId) => {
    if (!engId) return;
    const alreadyInTeam = engineers.some(e => e.engineer_id === engId);
    if (alreadyInTeam) return;
    const newRow = { ...createDefaultEngineer(), engineer_id: engId };
    onUpdateProject(editingIdx, "engineers", [...engineers, newRow]);
  };

  // Quita un ingeniero del equipo del proyecto (desde el selector rápido del header)
  const removeEngineerFromTeam = (engId) => {
    onUpdateProject(editingIdx, "engineers", engineers.filter(e => e.engineer_id !== engId));
  };

  const addIndicator    = () => onUpdateProject(editingIdx, "indicators",  [...indicators,  createDefaultIndicator()]);
  const updateIndicator = (i, f, v) => onUpdateProject(editingIdx, "indicators",  indicators.map((ind, idx) => idx === i ? { ...ind, [f]: v } : ind));
  const removeIndicator = (i)       => onUpdateProject(editingIdx, "indicators",  indicators.filter((_, idx) => idx !== i));

  const addImpediment    = (cat) => onUpdateProject(editingIdx, "impediments", [...impediments, createDefaultImpediment(cat)]);
  const updateImpediment = (i, f, v) => onUpdateProject(editingIdx, "impediments", impediments.map((im, idx) => idx === i ? { ...im, [f]: v } : im));
  const removeImpediment = (i)       => onUpdateProject(editingIdx, "impediments", impediments.filter((_, idx) => idx !== i));

  // Cada actividad tiene un id estable que nunca cambia. Borrar o reordenar
  // actividades NO afecta a las demás: el id deja de aparecer en newActs y
  // solo hay que podar las referencias colgantes (la actividad que se borró)
  // de todos los campos que la referencian por id.
  const handleActivitiesChange = (newActs) => {
    // newActs viene de la lista visible (sin archivadas). Reincorporamos las
    // actividades archivadas para no perderlas al guardar (siguen ocultas y
    // recuperables). Los ids archivados no entran en validIds, así que sus
    // referencias en task_status ya estaban podadas de antemano.
    const archived = allActivities.filter(a => a.archived);
    const mergedActs = [...newActs, ...archived];
    const validIds = new Set(newActs.map(a => a.id));
    const ts = p.task_status && typeof p.task_status === "object" ? p.task_status : {};

    const pruneArr     = (arr) => safeArr(arr).filter(id => validIds.has(id));
    const pruneObjKeys = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => validIds.has(id)));

    const newTs = {
      completed:   pruneArr(ts.completed),
      in_progress: pruneArr(ts.in_progress),
      not_started: pruneArr(ts.not_started),
    };

    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: mergedActs,
      task_status: {
        ...newTs,
        completed_dates: pruneObjKeys(ts.completed_dates),
        status_history:  pruneObjKeys(ts.status_history),
      },
      manual_metrics:      buildAutoMetrics(newActs, newTs),
      weekly_achievements: pruneArr(p.weekly_achievements),
      next_week_plan:      pruneArr(p.next_week_plan),
      engineers: (p.engineers || []).map(eng => ({
        ...eng,
        weekly_detail: pruneArr(eng.weekly_detail),
      })),
    });
  };

  // Aplica una importación de Planner ya confirmada en el modal.
  // Recibe { rows, engineersToCreate, hasParentColumn }. Pasos:
  //   1) Crear los ingenieros faltantes (onCreateEngineer es síncrono, devuelve id).
  //   2) Merge definitivo pasando el mapa nombre→id ya resuelto (enlaza responsables).
  //   3) Persistir proyecto (localStorage + servidor).
  const handleApplyPlannerImport = ({ rows, engineersToCreate, hasParentColumn }) => {
    const nameToId = new Map();
    (engineerCatalog || []).forEach(e => { if (e?.name) nameToId.set(normalizeName(e.name), e.id); });
    (engineersToCreate || []).forEach(({ name }) => {
      const newId = onCreateEngineer ? onCreateEngineer(name, "") : null;
      if (newId) nameToId.set(normalizeName(name), newId);
    });

    const res = mergePlannerImport(
      allActivities, p.task_status, rows, engineerCatalog, createActivity, nameToId, hasParentColumn
    );

    // Poblar el "Equipo del Proyecto" (p.engineers) con los responsables que trae
    // el Excel, sin duplicar los que ya están. Reúne todos los ids asignados a las
    // actividades importadas (no archivadas) y agrega una fila por cada uno nuevo.
    const teamIds = new Set((p.engineers || []).map(r => r.engineer_id).filter(Boolean));
    const importedEngIds = new Set();
    res.activities.forEach(a => {
      if (a.archived) return;
      (a.assigned_engineers || []).forEach(e => {
        // Solo ingenieros del catálogo (ids "eng_..."), no colaboradores externos ("ext_...").
        if (e.id && e.id.startsWith("eng_")) importedEngIds.add(e.id);
      });
    });
    const newTeamRows = [...importedEngIds]
      .filter(id => !teamIds.has(id))
      .map(id => ({ ...createDefaultEngineer(), engineer_id: id }));
    const mergedEngineers = [...(p.engineers || []), ...newTeamRows];

    const updatedProject = {
      ...p,
      activities_identified: res.activities,
      task_status:           res.task_status,
      manual_metrics:        buildAutoMetrics(res.activities, res.task_status),
      engineers:             mergedEngineers,
      planner_last_import:   new Date().toISOString(),
    };
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
    // Persistir con el array explícito para evitar estado obsoleto (mismo patrón que
    // handleActivityModalSave). Los ingenieros nuevos ya se persistieron en onCreateEngineer.
    if (onSaveProjectsDirect) onSaveProjectsDirect(updatedProjects, undefined, updatedProject.id);
  };

  const handleUpdateActivityMeta = (actId, newEngId, newStatus) => {
    let updatedActs = activities.map(a => {
      if (a.id !== actId) return a;
      let updatedEngs = a.assigned_engineers || [];
      let updatedDate = a.assigned_date;
      if (newEngId !== undefined) {
        const today = getToday();
        if (newEngId !== null && typeof newEngId === 'object') {
          // Multi-assign format: { action: 'add'|'remove', engId }
          if (newEngId.action === 'add') {
            const allContacts = [...(engineerCatalog || []), ...(externalContacts || [])];
            const eng = allContacts.find(e => e.id === newEngId.engId);
            if (eng && !updatedEngs.some(e => e.id === eng.id)) {
              updatedEngs = [...updatedEngs, { id: eng.id, name: eng.name }];
              updatedDate = updatedDate || today;
            }
          } else if (newEngId.action === 'remove') {
            updatedEngs = updatedEngs.filter(e => e.id !== newEngId.engId);
            if (updatedEngs.length === 0) updatedDate = null;
          }
        } else if (newEngId === '') {
          updatedEngs = [];
          updatedDate = null;
        } else {
          const allContacts = [...(engineerCatalog || []), ...(externalContacts || [])];
          const eng = allContacts.find(e => e.id === newEngId);
          if (eng) {
            updatedEngs = [{ id: eng.id, name: eng.name }];
            updatedDate = a.assigned_date || today;
          }
        }
      }
      return {
        ...a,
        assigned_engineers: updatedEngs,
        assigned_date: updatedDate,
      };
    });

    let updatedTs = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
    if (newStatus !== undefined) {
      const fromKey = ["completed", "in_progress", "not_started"].find(k => safeArr(updatedTs[k]).includes(actId));
      const next = {
        completed:   safeArr(updatedTs.completed).filter(s => s !== actId),
        in_progress: safeArr(updatedTs.in_progress).filter(s => s !== actId),
        not_started: safeArr(updatedTs.not_started).filter(s => s !== actId),
      };
      if (newStatus !== "") {
        next[newStatus] = [...next[newStatus], actId];
      }

      const today = () => getToday();
      const cDates = { ...(updatedTs.completed_dates || {}) };
      if (newStatus === "completed") cDates[actId] = today();
      else if (fromKey === "completed") delete cDates[actId];
      next.completed_dates = cDates;

      const hist = { ...(updatedTs.status_history || {}) };
      if (!hist[actId]) hist[actId] = { added: today() };
      const dateField = STATUS_DATE_FIELD[newStatus];
      if (dateField) hist[actId] = { ...hist[actId], [dateField]: today() };
      if (fromKey === "in_progress" && newStatus !== "in_progress") delete hist[actId].in_progress;
      if (fromKey === "completed"   && newStatus !== "completed")   delete hist[actId].completed;
      next.status_history = hist;

      const completedBy = { ...(updatedTs.completed_by || {}) };
      if (newStatus === "completed") {
        const act = updatedActs.find(a => a.id === actId);
        if (act && (act.assigned_engineers || []).length > 0) {
          completedBy[actId] = act.assigned_engineers.map(e => ({ engineer_id: e.id, engineer_name: e.name }));
        }
      } else if (fromKey === "completed") {
        delete completedBy[actId];
      }
      next.completed_by = completedBy;

      updatedTs = next;
    }

    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: updatedActs,
      task_status: updatedTs,
      manual_metrics: buildAutoMetrics(updatedActs, updatedTs),
    });
  };

  const handleBulkAssign = (engId, actIds) => {
    const allContacts = [...(engineerCatalog || []), ...(externalContacts || [])];
    const eng = allContacts.find(e => e.id === engId);
    if (!eng) return;
    const today  = getToday();
    const idSet  = new Set(actIds);
    const newActs = activities.map(a => {
      if (!idSet.has(a.id)) return a;
      // Si ya está asignado, no duplicar
      if ((a.assigned_engineers || []).some(e => e.id === eng.id)) return a;
      return {
        ...a,
        assigned_engineers: [...(a.assigned_engineers || []), { id: eng.id, name: eng.name }],
        assigned_date: a.assigned_date || today,
      };
    });
    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      manual_metrics: buildAutoMetrics(newActs, p.task_status || {}),
    });
  };

  // parentId opcional: "esta actividad es subtarea de..." desde el alta rápida
  // (ActivitiesList) o la tarjeta detallada. sequence_order se calcula igual
  // que en HierarchyTable.handleAddChild — siguiente valor entre hermanas del
  // mismo padre, para que quede al final del grupo.
  const handleAddActivity = (text, engId, status, parentId = null) => {
    const siblings = activities.filter(a => (a.parent_id ?? null) === (parentId ?? null));
    const sequenceOrder = siblings.length
      ? Math.max(...siblings.map(a => Number(a.sequence_order) || 0)) + 1
      : 0;
    const newAct = createActivity(text, parentId, sequenceOrder);
    const actId = newAct.id;
    const todayStr = getToday();

    if (engId !== "") {
      const eng = (engineerCatalog || []).find(e => e.id === engId);
      if (eng) {
        newAct.assigned_engineers = [{ id: eng.id, name: eng.name }];
        newAct.assigned_date = todayStr;
      }
    }

    const newActs = [...activities, newAct];

    let updatedTs = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
    if (status !== "") {
      const next = {
        completed:   safeArr(updatedTs.completed),
        in_progress: safeArr(updatedTs.in_progress),
        not_started: safeArr(updatedTs.not_started),
      };
      next[status] = [...next[status], actId];

      const cDates = { ...(updatedTs.completed_dates || {}) };
      if (status === "completed") cDates[actId] = todayStr;
      next.completed_dates = cDates;

      const hist = { ...(updatedTs.status_history || {}) };
      hist[actId] = { added: todayStr };
      const dateField = STATUS_DATE_FIELD[status];
      if (dateField) hist[actId][dateField] = todayStr;
      next.status_history = hist;

      const completedBy = { ...(updatedTs.completed_by || {}) };
      if (status === "completed" && (newAct.assigned_engineers || []).length > 0) {
        completedBy[actId] = newAct.assigned_engineers.map(e => ({ engineer_id: e.id, engineer_name: e.name }));
      }
      next.completed_by = completedBy;

      updatedTs = next;
    }

    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      task_status: updatedTs,
      manual_metrics: buildAutoMetrics(newActs, updatedTs),
    });
    return actId;
  };

  // Crea una actividad vacía y abre su tarjeta completa de inmediato, para
  // capturar todos los detalles (fechas, responsables, objetivos, subtareas)
  // sin pasar por el formulario mínimo de la lista.
  const handleAddActivityDetailed = () => {
    const newId = handleAddActivity("Nueva actividad", "", "not_started");
    setModalActId(newId);
  };

  const modalActivity = modalActId ? activities.find(a => a.id === modalActId) : null;

  // Subtareas reales de la actividad abierta en el modal — sección "Subtareas"
  // (distinta del checklist "Subactividades"). Crear/abrir una reemplaza el
  // modal por la tarjeta de la subtarea (mismo modal, otro id).
  const modalSubtasks = modalActId
    ? activities.filter(a => a.parent_id === modalActId)
    : [];

  const handleActivityModalSave = (updatedAct) => {
    // _history (fechas de transición Inscrita/En proceso/Completada) viene del modal
    // pero NO vive en la actividad: se escribe en task_status.status_history[actId].
    const { _history, ...actClean } = updatedAct;
    const newActs = activities.map(a => a.id === actClean.id ? actClean : a);
    let updatedProject = { ...p, activities_identified: newActs };
    if (_history) {
      const ts = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
      const cleanHist = {};
      if (_history.added)       cleanHist.added       = _history.added;
      if (_history.in_progress) cleanHist.in_progress = _history.in_progress;
      if (_history.completed)   cleanHist.completed   = _history.completed;
      updatedProject = {
        ...updatedProject,
        task_status: {
          ...ts,
          status_history: { ...(ts.status_history || {}), [actClean.id]: cleanHist },
        },
      };
    }
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
    if (onSaveProjectsDirect) onSaveProjectsDirect(updatedProjects, undefined, updatedProject.id);
  };

  // Elimina una actividad desde el modal de detalle: la quita de la lista,
  // la saca de todos los depósitos del task_status y guarda inmediatamente.
  const handleActivityModalDelete = (actId) => {
    const newActs = activities.filter(a => a.id !== actId);
    const ts = p.task_status || {};
    const updatedTs = {
      ...ts,
      completed:      (ts.completed   || []).filter(id => id !== actId),
      in_progress:    (ts.in_progress || []).filter(id => id !== actId),
      not_started:    (ts.not_started || []).filter(id => id !== actId),
      status_history: Object.fromEntries(
        Object.entries(ts.status_history || {}).filter(([id]) => id !== actId)
      ),
    };
    const updatedProject  = { ...p, activities_identified: newActs, task_status: updatedTs, manual_metrics: buildAutoMetrics(newActs, updatedTs) };
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
    if (onSaveProjectsDirect) onSaveProjectsDirect(updatedProjects, undefined, updatedProject.id);
    setModalActId(null);
  };

  // Crea una subtarea real (actividad hija) y devuelve su id, para abrir
  // inmediatamente la tarjeta de la subtarea recién creada desde la sección
  // "Subtareas" del modal de detalle.
  const handleHierarchyAddChild = (parentId, sequenceOrder) => {
    const newAct = createActivity("Nueva subtarea", parentId, sequenceOrder);
    const newActs = [...activities, newAct];
    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      manual_metrics: buildAutoMetrics(newActs, p.task_status || {}),
    });
    return newAct.id;
  };

  // Crea una subtarea para la actividad abierta en el modal y navega a su
  // tarjeta de inmediato (misma mecánica que HierarchyTable.handleAddChild).
  const handleCreateSubtaskFromModal = () => {
    const newId = handleHierarchyAddChild(modalActId, modalSubtasks.length);
    setModalActId(newId);
  };

  // Elimina una actividad de la jerarquía. Sus hijas directas (si las tenía)
  // suben a ser hijas de SU padre en vez de quedar huérfanas — mismo criterio
  // que buildActivityTree ya aplica a datos huérfanos preexistentes.
  const handleHierarchyDelete = (actId) => {
    const target = activities.find(a => a.id === actId);
    const parentId = target?.parent_id ?? null;
    const newActs = activities
      .filter(a => a.id !== actId)
      .map(a => a.parent_id === actId ? { ...a, parent_id: parentId } : a);
    const ts = p.task_status || {};
    const updatedTs = {
      ...ts,
      completed:      (ts.completed   || []).filter(id => id !== actId),
      in_progress:    (ts.in_progress || []).filter(id => id !== actId),
      not_started:    (ts.not_started || []).filter(id => id !== actId),
      status_history: Object.fromEntries(
        Object.entries(ts.status_history || {}).filter(([id]) => id !== actId)
      ),
    };
    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      task_status: updatedTs,
      manual_metrics: buildAutoMetrics(newActs, updatedTs),
    });
  };

  return (
    <div className="edit-view">
      {/* ── Pestañas ── */}
      <div className="project-tabs">
        {projects.map((proj, i) => (
          <button
            key={proj.id} draggable
            className={`project-tab ${editingIdx === i ? "project-tab--active" : ""} ${dragOverIdx === i ? "project-tab--drag-over" : ""}`}
            onClick={() => onSelectProject(i)}
            onDragStart={e => handleDragStart(e, i)} onDragOver={e => handleDragOver(e, i)}
            onDrop={e => handleDrop(e, i)} onDragEnd={handleDragEnd}
            title="Arrastra para reordenar"
          >
            <span className="project-tab__grip">⠿</span>
            {proj.project_name || `Proyecto ${i + 1}`}
          </button>
        ))}
        <button className="project-tab project-tab--add" onClick={onAddProject}>+ Nuevo</button>
      </div>

      {p ? (
        <div className="edit-panel">
          {/* Cabecera */}
          <div className="edit-panel__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                type="button"
                className={`priority-star priority-star--lg${p.priority ? " priority-star--active" : ""}`}
                onClick={() => onUpdateProject(editingIdx, "priority", !p.priority)}
                title={p.priority ? "Quitar de prioritarios" : "Marcar como prioritario"}
                aria-pressed={!!p.priority}
              >
                {p.priority ? "★" : "☆"}
              </button>
              <h2 style={{ fontSize: "18px", color: "var(--azul-oscuro)" }}>Editando: {p.project_name || "Nuevo Proyecto"}</h2>
            </div>
            <button
              className={`btn ${hasUnsavedChanges ? "btn--accent" : ""}`}
              onClick={onSaveChanges} style={{ padding: "10px 24px", fontSize: "14px" }}
              disabled={!hasUnsavedChanges}
            >
              {hasUnsavedChanges ? "💾 Guardar cambios" : "✓ Guardado"}
            </button>
          </div>

          {/* ══ 1. Identificación ══ */}
          <div className="edit-row" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
            <div className="field">
              <label className="field__label">Nombre del Proyecto</label>
              <input
                className="field__input" value={p.project_name}
                placeholder="Ej: Migración CRM"
                onChange={e => onUpdateProject(editingIdx, "project_name", e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field__label">Estado</label>
              <select
                className="field__input" value={p.status}
                onChange={e => onUpdateProject(editingIdx, "status", e.target.value)}
              >
                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="field__label">URL de Planner</label>
              <input
                className="field__input" value={p.planner_url || ""}
                placeholder="https://tasks.office.com/…"
                onChange={e => onUpdateProject(editingIdx, "planner_url", e.target.value)}
              />
            </div>
          </div>

          {/* ══ 1b. Equipo del proyecto (selector rápido) ══ */}
          <div className="field project-team-selector">
            <div className="project-team-selector__header">
              <label className="field__label">Equipo del Proyecto</label>
              <select
                className="field__input project-team-selector__select"
                value=""
                onChange={e => addEngineerFromCatalog(e.target.value)}
              >
                <option value="">+ Agregar ingeniero al equipo…</option>
                {(engineerCatalog || [])
                  .filter(e => e.active && !engineers.some(r => r.engineer_id === e.id))
                  .map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <div className="project-team-selector__chips">
              {engineers.length === 0 && (
                <span className="project-team-selector__empty">Sin ingenieros asignados al proyecto</span>
              )}
              {engineers.map(row => {
                const cat = (engineerCatalog || []).find(e => e.id === row.engineer_id);
                const name = cat?.name || row.engineer_id || "Sin nombre";
                return (
                  <span key={row.engineer_id || name} className="project-team-chip">
                    {name}
                    <button
                      className="project-team-chip__remove"
                      type="button"
                      title="Quitar del equipo"
                      onClick={() => removeEngineerFromTeam(row.engineer_id)}
                    >×</button>
                  </span>
                );
              })}
            </div>
          </div>

          {/* ══ 2. Métricas de avance (auto-calculadas) ══ */}
          <div className="field field--optional">
            <label className="field__label" style={{ marginBottom: 10 }}>
              Métricas de Avance
              <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>
                (calculadas automáticamente desde actividades y estado)
              </span>
            </label>
            <div className="edit-row" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: "12px" }}>
              {[
                { lbl: "Total actividades",  val: autoTotal       },
                { lbl: "Completadas",        val: autoCompletadas },
                { lbl: "En proceso",         val: autoEnProceso   },
                { lbl: "No iniciadas",       val: autoNoIniciadas },
                { lbl: "Tareas compartidas", val: null            },
              ].map(({ lbl, val }) => (
                <div className="field" key={lbl}>
                  <label className="field__label" style={{ fontSize: "11px" }}>{lbl}</label>
                  {val === null ? (
                    <input
                      className="field__input" type="number" min="0"
                      value={m.shared_tasks_discount ?? 0}
                      onFocus={e => e.target.select()}
                      onChange={e => updateMetric("shared_tasks_discount", e.target.value)}
                    />
                  ) : (
                    <input
                      className="field__input" type="number" readOnly value={val}
                      style={{ background: "#f8fafc", fontWeight: "bold", color: "var(--text)" }}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ══ 3. Actividades identificadas ══ */}
          <ActivitiesList
            activities={activities}
            engineerCatalog={engineerCatalog}
            externalContacts={externalContacts}
            taskStatus={p.task_status}
            onChange={handleActivitiesChange}
            onUpdateActivityMeta={handleUpdateActivityMeta}
            onAddActivity={handleAddActivity}
            onAddActivityDetailed={handleAddActivityDetailed}
            onCreateExternal={onAddExternalContact}
            onImportPlanner={() => setShowPlannerModal(true)}
          />

          {/* ══ 3b. Asignación masiva ══ */}
          {activities.length > 0 && (
            <BulkAssignPanel
              activities={activities}
              engineerCatalog={engineerCatalog}
              externalContacts={externalContacts}
              taskStatus={p.task_status}
              onBulkAssign={handleBulkAssign}
            />
          )}

          {/* ══ 4. Planificación — accesos a las vistas a pantalla completa ══
                 Las tres vistas (tablero de estados, Gantt y tabla jerárquica)
                 viven en overlay: dentro del formulario quedaban demasiado
                 estrechas para ser útiles. */}
          {activities.length > 0 && (
            <div className="field field--optional">
              <div className="field__header">
                <label className="field__label" style={{ marginBottom: 0 }}>
                  Planificación
                  <span style={{ fontSize: "11px", color: "var(--text-3)", fontWeight: 400, marginLeft: 8 }}>
                    Estados, cronograma y tabla de actividades, a pantalla completa
                  </span>
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn--accent"
                    style={{ padding: "5px 14px", fontSize: "12px" }}
                    onClick={() => setPlanningView("status")}
                  >
                    🗃 Ver estado de actividades
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent"
                    style={{ padding: "5px 14px", fontSize: "12px" }}
                    onClick={() => setPlanningView("gantt")}
                  >
                    📅 Ver diagrama de Gantt
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent"
                    style={{ padding: "5px 14px", fontSize: "12px" }}
                    onClick={() => setPlanningView("hierarchy")}
                  >
                    🗂 Ver planificación completa
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Mismo componente que usa el dashboard: las tres vistas y la
              tarjeta de detalle se comportan igual desde ambos accesos. */}
          <ProjectPlanningOverlays
            project={p}
            view={planningView}
            onClose={() => setPlanningView(null)}
            onUpdateProject={updated => onUpdateProjectFull(editingIdx, updated)}
            engineerCatalog={engineerCatalog}
            externalContacts={externalContacts}
            StatusBoard={TaskStatusSelector}
          />

          {/* ══ 5. Indicadores ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Indicadores</label>
              <button className="btn btn--accent" style={{ padding: "5px 14px", fontSize: "12px" }} type="button" onClick={addIndicator}>
                + Agregar indicador
              </button>
            </div>
            {indicators.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                {indicators.map((ind, i) => (
                  <IndicatorRow key={i} ind={ind} index={i} onChange={updateIndicator} onRemove={removeIndicator} />
                ))}
              </div>
            )}
          </div>

          {/* ══ 6. Impedimentos ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Impedimentos y Riesgos</label>
              <div style={{ display: "flex", gap: 8 }}>
                {IMPEDIMENT_TYPES.map(t => (
                  <button key={t.category} className="btn btn--accent" style={{ padding: "5px 12px", fontSize: "11px" }}
                    type="button" onClick={() => addImpediment(t.category)}>
                    {t.icon} {t.label}
                  </button>
                ))}
              </div>
            </div>
            {impediments.length > 0 && (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                {impediments.map((im, i) => (
                  <ImpedimentRow key={i} item={im} index={i} onChange={updateImpediment} onRemove={removeImpediment} />
                ))}
              </div>
            )}
          </div>

          {/* ══ 7. (Removido) Asignación de Responsables — ahora se hace arriba,
                 en cada actividad de "Actividades identificadas". ══ */}

          {/* ══ 8. Ingenieros ══ */}
          <div className="field field--optional">
            <div className="field__header">
              <label className="field__label">Equipo de Ingenieros</label>
              <button className="btn btn--accent" style={{ padding: "5px 14px", fontSize: "12px" }} type="button" onClick={addEngineer}>
                + Agregar ingeniero
              </button>
            </div>
            {engineers.length > 0 && (
              <>
                {engineers.map((eng, i) => (
                  <EngineerRow key={i} eng={eng} index={i}
                    onChange={updateEngineer} onRemove={removeEngineer}
                    activities={activities}
                    taskStatus={p.task_status}
                    engineerCatalog={engineerCatalog}
                    onCreateEngineer={onCreateEngineer}
                    onOpenActivity={setModalActId}
                  />
                ))}
                <div className="shared-tasks-row">
                  <span className="shared-tasks-row__label">Tareas compartidas entre ingenieros</span>
                  <input
                    className="field__input shared-tasks-row__input" type="number" min="0"
                    value={m.shared_tasks_discount ?? 0} onFocus={e => e.target.select()}
                    onChange={e => updateMetric("shared_tasks_discount", e.target.value === "" ? 0 : Number(e.target.value))}
                  />
                </div>
              </>
            )}
          </div>

          {/* ══ 9. Estado actual del proyecto — Panel "Pulso del proyecto" ══ */}
          <ProjectPulseField
            project={p}
            value={p.status_notes || ""}
            onChange={val => onUpdateProject(editingIdx, "status_notes", val)}
          />

          {/* ══ 9b. Notas y comentarios fechados (Proyecto_Notas, independiente del pulso) ══ */}
          <ProjectNotesPanel proyectoAppID={p.id} />

          {/* ══ 10. Cierre semanal — automático ══
                 Reemplaza la selección manual de "qué se hizo" y "plan próxima
                 semana": ambos se deducen de las fechas de las actividades.
                 Sigue escribiendo en next_week_plan/weekly_achievements para
                 que ReportView y el resto de consumidores no cambien. */}
          <NextWeekPlanningSection
            activities={activities}
            taskStatus={p.task_status}
            onUpdateProject={updated => onUpdateProjectFull(editingIdx, updated)}
            project={p}
            onOpenActivity={setModalActId}
          />

          <div className="edit-panel__footer">
            <button className="btn btn--accent"  onClick={() => onViewReport(editingIdx)}>📄 Ver reporte</button>
            <button className="btn btn--export"  onClick={() => onExportReport(editingIdx)}>📋 Copiar reporte</button>
            <button className="btn btn--danger"  onClick={() => setShowDeleteModal(true)}>Eliminar proyecto</button>
          </div>

          {showDeleteModal && (
            <DeleteConfirmModal
              projectName={p.project_name || "este proyecto"}
              onCancel={() => setShowDeleteModal(false)}
              onConfirm={() => { setShowDeleteModal(false); onRemoveProject(editingIdx); }}
            />
          )}
        </div>
      ) : (
        <div className="edit-empty">
          {projects.length > 0
            ? "Selecciona un proyecto para editarlo"
            : 'Haz clic en "+ Nuevo" para agregar tu primer proyecto'}
        </div>
      )}

      {modalActivity && p && (
        <ActivityDetailModal
          activity={modalActivity}
          projectName={p.project_name || "Proyecto"}
          projectId={p.id}
          taskStatus={p.task_status}
          engineerCatalog={engineerCatalog}
          externalContacts={externalContacts}
          onSave={handleActivityModalSave}
          onDelete={handleActivityModalDelete}
          onClose={() => setModalActId(null)}
          subtasks={modalSubtasks}
          onCreateSubtask={handleCreateSubtaskFromModal}
          onOpenSubtask={setModalActId}
          onDeleteSubtask={handleHierarchyDelete}
        />
      )}

      {p && (
        <PlannerImportModal
          isOpen={showPlannerModal}
          onClose={() => setShowPlannerModal(false)}
          onConfirm={handleApplyPlannerImport}
          existingActivities={allActivities}
          existingTaskStatus={p.task_status}
          engineerCatalog={engineerCatalog}
        />
      )}
    </div>
  );
}
