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

import { useState } from "react";
import {
  createDefaultEngineer, createDefaultIndicator, createDefaultImpediment,
  leafActivities, visibleActivities, buildActivityTree, aggregatedProgress,
} from "../utils/formulas";
import ActivityDetailModal from "./ActivityDetailModal";
import PlannerImportModal from "./PlannerImportModal";
import { ProjectNotesPanel } from "./ProjectNotesPanel";
import ProjectPlanningOverlays from "./ProjectPlanningOverlays";

import { safeArr, safeActs, IMPEDIMENT_TYPES } from "./edit/shared";
import { useActivityHandlers } from "./edit/useActivityHandlers";
import ProjectSearchSelect from "./edit/ProjectSearchSelect";
import AssigneeDropdown from "./edit/AssigneeDropdown";
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

// ── EditView principal ────────────────────────────────────────────────────────

export default function EditView({
  projects, editingIdx, hasUnsavedChanges,
  onSelectProject, onUpdateProject, onUpdateProjectFull, onSaveChanges, onSaveProjectsDirect,
  onAddProject, onRemoveProject, onViewReport, onExportReport,
  engineerCatalog, onCreateEngineer,
  externalContacts, onAddExternalContact, onToggleExternalActive,
}) {
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [modalActId,      setModalActId]      = useState(null);
  const [showPlannerModal, setShowPlannerModal] = useState(false);
  const [planningView,    setPlanningView]    = useState(null); // "status" | "gantt" | "hierarchy" | null

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

  // Handlers de alta/edición/borrado de actividades y su jerarquía — ver
  // edit/useActivityHandlers.js. Todos cierran sobre p/activities/editingIdx
  // vía los argumentos del hook, igual que antes cerraban sobre las mismas
  // variables locales.
  const {
    handleActivitiesChange, handleApplyPlannerImport, handleUpdateActivityMeta,
    handleBulkAssign, handleAddActivity, handleActivityModalSave,
    handleActivityModalDelete: handleActivityModalDeleteBase,
    handleHierarchyAddChild, handleHierarchyDelete,
  } = useActivityHandlers({
    p, editingIdx, projects, activities, allActivities,
    engineerCatalog, externalContacts, onCreateEngineer,
    onUpdateProjectFull, onSaveProjectsDirect,
  });

  // Crea una actividad vacía y abre su tarjeta completa de inmediato, para
  // capturar todos los detalles (fechas, responsables, objetivos, subtareas)
  // sin pasar por el formulario mínimo de la lista.
  const handleAddActivityDetailed = () => {
    const newId = handleAddActivity("Nueva actividad", "", "not_started");
    setModalActId(newId);
  };

  const modalActivity = modalActId ? activities.find(a => a.id === modalActId) : null;

  // Subtareas reales de la actividad abierta en el modal — sección "Subtareas".
  // Crear/abrir una reemplaza el modal por la tarjeta de la subtarea (mismo
  // modal, otro id).
  const modalSubtasks = modalActId
    ? activities.filter(a => a.parent_id === modalActId)
    : [];

  // Si la actividad abierta tiene subtareas, su % de avance deja de ser
  // editable a mano: se calcula como el promedio de sus hijas (recursivo,
  // ver aggregatedProgress). Mismo cálculo que ya usa HierarchyTable para
  // MOSTRAR el número — acá además se persiste como el progress real de la
  // actividad al guardar, para que coincida en toda la app (Gantt, Dashboard,
  // el propio modal), no solo en esa tabla.
  const modalComputedProgress = modalActivity && modalSubtasks.length > 0
    ? aggregatedProgress(modalActivity, buildActivityTree(activities).childrenOf)
    : null;

  // El hook no conoce modalActId (estado local de EditView) — cierra el modal
  // aquí después de que el hook persiste el borrado.
  const handleActivityModalDelete = (actId) => {
    handleActivityModalDeleteBase(actId);
    setModalActId(null);
  };

  // Crea una subtarea para la actividad abierta en el modal y navega a su
  // tarjeta de inmediato (misma mecánica que HierarchyTable.handleAddChild).
  const handleCreateSubtaskFromModal = () => {
    const newId = handleHierarchyAddChild(modalActId, modalSubtasks.length);
    setModalActId(newId);
  };

  return (
    <div className="edit-view">
      {/* ── Selector de proyecto (buscador) ── */}
      <ProjectSearchSelect
        projects={projects}
        editingIdx={editingIdx}
        onSelectProject={onSelectProject}
        onAddProject={onAddProject}
      />

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

          {/* ══ 1b. Equipo del proyecto (selector rápido, con buscador) ══ */}
          <div className="field project-team-selector">
            <div className="project-team-selector__header">
              <label className="field__label">Equipo del Proyecto</label>
              <AssigneeDropdown
                assignables={(engineerCatalog || []).filter(e => e.active).map(e => ({ id: e.id, name: e.name, type: "engineer" }))}
                assignedIds={new Set(engineers.map(r => r.engineer_id))}
                placeholder="+ Agregar ingeniero al equipo…"
                onSelect={addEngineerFromCatalog}
              />
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
          computedProgress={modalComputedProgress}
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
