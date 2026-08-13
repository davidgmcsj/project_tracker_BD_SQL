// useActivityHandlers.js — Handlers de alta/edición/borrado de actividades y
// su jerarquía (subtareas), extraídos de EditView.jsx. Todos operan sobre el
// proyecto activo (`p`) y persisten vía onUpdateProjectFull/onSaveProjectsDirect
// — mismo contrato que tenían dentro del componente.

import {
  createDefaultEngineer, createActivity, getToday,
  buildAutoMetrics as buildAutoMetricsFrom,
} from "../../utils/formulas";
import { mergePlannerImport, normalizeName } from "../../utils/plannerImport";
import { mergeCronogramaTaskStatus } from "../../utils/cronogramaImport";
import { rescheduleAfterChange } from "../../utils/scheduling";
import { safeArr, transitionActivityStatus } from "./shared";

// Fechas que se registran automáticamente por columna — mismo mapa que usa
// TaskStatusSelector internamente, duplicado aquí porque handleUpdateActivityMeta
// y handleAddActivity replican la misma lógica de status_history desde fuera
// del Kanban (edición inline en ActivitiesList, alta rápida).
const STATUS_DATE_FIELD = {
  not_started: null,
  in_progress: "in_progress",
  completed:   "completed",
};

export function useActivityHandlers({
  p, editingIdx, projects, activities, allActivities,
  engineerCatalog, externalContacts, onCreateEngineer,
  onUpdateProjectFull, onSaveProjectsDirect,
}) {
  const m = p?.manual_metrics || {};

  // Recalcula total/completadas/en_proceso desde actividades y task_status —
  // delega en la versión pura extraída a utils/formulas/progress.js (también
  // reutilizada por autoAdvanceOverdueActivities en App.jsx), preservando
  // aquí la firma de 2 argumentos que ya usan los 9 call-sites de este archivo.
  const buildAutoMetrics = (newActs, newTs) => buildAutoMetricsFrom(m, newActs, newTs);

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

  // Aplica una importación de Cronograma por entregable ya confirmada en el
  // modal. A diferencia de handleApplyPlannerImport, esto es SIEMPRE ADITIVO:
  // { activities, statusByActivityId, engineersToCreate } se concatena a lo
  // que ya existe — nunca reemplaza, empareja ni archiva nada (ver cabecera
  // de utils/cronogramaImport.js).
  const handleApplyCronogramaImport = ({ activities: newActs, statusByActivityId, engineersToCreate }) => {
    const nameToId = new Map();
    (engineerCatalog || []).forEach(e => { if (e?.name) nameToId.set(normalizeName(e.name), e.id); });
    (engineersToCreate || []).forEach(({ name }) => {
      const newId = onCreateEngineer ? onCreateEngineer(name, "") : null;
      if (newId) nameToId.set(normalizeName(name), newId);
    });

    // Los ids de responsable en newActs ya vienen resueltos por el modal
    // (dry-run) contra el catálogo ANTES de que existieran los recién creados
    // — se re-resuelven aquí con el mapa ya completo, mismo criterio de dos
    // pasadas que handleApplyPlannerImport.
    const reResolved = newActs.map(a => {
      const rawName = a.assigned_engineers?.[0]?.name;
      if (!rawName) return a;
      const id = nameToId.get(normalizeName(rawName));
      return id ? { ...a, assigned_engineers: [{ id, name: rawName }] } : a;
    });

    const mergedActivities = [...allActivities, ...reResolved];
    const mergedTaskStatus = mergeCronogramaTaskStatus(p.task_status, statusByActivityId);

    const teamIds = new Set((p.engineers || []).map(r => r.engineer_id).filter(Boolean));
    const importedEngIds = new Set();
    reResolved.forEach(a => {
      (a.assigned_engineers || []).forEach(e => { if (e.id && e.id.startsWith("eng_")) importedEngIds.add(e.id); });
    });
    const newTeamRows = [...importedEngIds]
      .filter(id => !teamIds.has(id))
      .map(id => ({ ...createDefaultEngineer(), engineer_id: id }));
    const mergedEngineers = [...(p.engineers || []), ...newTeamRows];

    const updatedProject = {
      ...p,
      activities_identified: mergedActivities,
      task_status:            mergedTaskStatus,
      manual_metrics:         buildAutoMetrics(mergedActivities, mergedTaskStatus),
      engineers:              mergedEngineers,
    };
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
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

  // Devuelve el id de una subtarea de despliegue recién creada (o null) para
  // que el caller (EditView, que posee el estado del modal) la abra de
  // inmediato — mismo patrón que ya usan handleHierarchyAddChild y
  // handleAddActivity al devolver el id de lo que acaban de crear.
  const handleActivityModalSave = (updatedAct) => {
    // _history (fechas de transición Inscrita/En proceso/Completada) viene del modal
    // pero NO vive en la actividad: se escribe en task_status.status_history[actId].
    // _newStatus (cambio de columna del Kanban) tampoco: mueve el id entre los
    // buckets de task_status vía transitionActivityStatus (misma lógica que el
    // Kanban), que además puede crear las subtareas automáticas de despliegue.
    const { _history, _newStatus, ...actClean } = updatedAct;

    // Cascada de fechas (mismo motor y mismo criterio que HierarchyTable.
    // handleDateChange): si due_date se atrasó respecto al valor que tenía
    // ANTES de abrir el modal, recalcula hermanas solapadas y auto-extiende
    // la fecha de fin de los ancestros. Sin esto, editar la fecha de una
    // subtarea desde su tarjeta de detalle (a diferencia de editarla inline
    // en la tabla jerárquica) dejaba a la actividad padre con su due_date
    // vieja o vacía — el candado 🔒 de HierarchyTable la muestra como
    // "calculada", pero nadie la había recalculado por este camino.
    const previousAct = activities.find(a => a.id === actClean.id);
    const previousDue = previousAct?.due_date;
    let newActs = activities.map(a => a.id === actClean.id ? actClean : a);
    if (actClean.due_date !== previousDue) {
      const cascadePatches = rescheduleAfterChange(newActs, actClean.id, previousDue);
      if (cascadePatches.length) {
        const byId = new Map(cascadePatches.map(pt => [pt.id, pt]));
        newActs = newActs.map(a => byId.has(a.id) ? { ...a, ...byId.get(a.id) } : a);
      }
    }
    let updatedProject = { ...p, activities_identified: newActs };
    let ts = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
    let openActivityId = null;
    if (_history) {
      const cleanHist = {};
      if (_history.added)       cleanHist.added       = _history.added;
      if (_history.in_progress) cleanHist.in_progress = _history.in_progress;
      if (_history.completed)   cleanHist.completed   = _history.completed;
      ts = { ...ts, status_history: { ...(ts.status_history || {}), [actClean.id]: cleanHist } };
    }
    if (_newStatus) {
      const result = transitionActivityStatus(ts, newActs, actClean.id, _newStatus);
      ts = result.taskStatus;
      newActs = result.newActivities;
      openActivityId = result.openActivityId;
    }
    if (_history || _newStatus) {
      updatedProject = { ...updatedProject, activities_identified: newActs, task_status: ts, manual_metrics: buildAutoMetrics(newActs, ts) };
    }
    const updatedProjects = projects.map((pr, i) => i === editingIdx ? updatedProject : pr);
    onUpdateProjectFull(editingIdx, updatedProject);
    if (onSaveProjectsDirect) onSaveProjectsDirect(updatedProjects, undefined, updatedProject.id);
    return openActivityId;
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
    return updatedProject;
  };

  // Crea una subtarea real (actividad hija) y devuelve su id, para abrir
  // inmediatamente la tarjeta de la subtarea recién creada desde la sección
  // "Subtareas" del modal de detalle o desde "+ Agregar tarea principal" en
  // Planificación completa (parentId null). También se usa para agregar
  // tareas principales, no solo subtareas — el nombre quedó del primer uso.
  //
  // Se agrega a task_status.not_started (con su status_history.added) al
  // crearla — sin esto la actividad quedaba fuera de los tres buckets del
  // Kanban ("sin clasificar" en vez de nacer directo en "No iniciadas",
  // que es donde aparece toda actividad creada por cualquier otro camino).
  const handleHierarchyAddChild = (parentId, sequenceOrder) => {
    const newAct = createActivity("Nueva subtarea", parentId, sequenceOrder);
    const newActs = [...activities, newAct];
    const ts = p.task_status && typeof p.task_status === "object" ? p.task_status : {};
    const newTs = {
      ...ts,
      not_started: [...safeArr(ts.not_started), newAct.id],
      status_history: { ...(ts.status_history || {}), [newAct.id]: { added: getToday() } },
    };
    onUpdateProjectFull(editingIdx, {
      ...p,
      activities_identified: newActs,
      task_status: newTs,
      manual_metrics: buildAutoMetrics(newActs, newTs),
    });
    return newAct.id;
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

  // Aplica un array de patches {id, ...campos} en una sola actualización —
  // mismo contrato que ProjectPlanningOverlays.handleApplyDateChange
  // (retraso en cascada jerárquico de HierarchyTable y, desde aquí, el
  // retraso en cascada cronológico de DelayCascadePreview). Una sola
  // escritura evita que dos setState sucesivos sobre el mismo snapshot se
  // pisen entre sí.
  const handleApplyDateChange = (patches) => {
    const byId = new Map(patches.map(pt => [pt.id, pt]));
    const newActs = activities.map(a => byId.has(a.id) ? { ...a, ...byId.get(a.id) } : a);
    onUpdateProjectFull(editingIdx, { ...p, activities_identified: newActs });
  };

  return {
    handleActivitiesChange,
    handleApplyPlannerImport,
    handleApplyCronogramaImport,
    handleUpdateActivityMeta,
    handleBulkAssign,
    handleAddActivity,
    handleActivityModalSave,
    handleActivityModalDelete,
    handleHierarchyAddChild,
    handleHierarchyDelete,
    handleApplyDateChange,
  };
}
