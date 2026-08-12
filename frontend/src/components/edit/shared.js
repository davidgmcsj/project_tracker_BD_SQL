// shared.js — Helpers y constantes usados por varios de los componentes en
// que se dividió EditView.jsx (Fase 4 de la refactorización).
//
// Solo vive aquí lo que cruza más de un componente destino. Lo que un solo
// componente usa se queda en su propio archivo.

import { getToday, canTransitionTo, createActivity, buildAutoMetrics } from "../../utils/formulas.js";
import { weekRange, nextWeekRange, SITUATION_LABEL } from "../../utils/weekPlanning.js";

// Fechas que se registran automáticamente por columna — mismo mapa que usa
// TaskStatusSelector (Kanban) internamente.
const STATUS_DATE_FIELD = {
  not_started: null,
  in_progress: "in_progress",
  ambiente_pruebas: "ambiente_pruebas",
  ambiente_produccion: "ambiente_produccion",
  completed: "completed",
};

const ALL_STATUS_KEYS = ["completed", "in_progress", "not_started", "ambiente_pruebas", "ambiente_produccion"];

// Semana en curso, calculada una vez al cargar el módulo — suficiente para
// una sesión de trabajo normal (el caso extremo de dejar la pestaña abierta
// cruzando la medianoche del domingo se corrige con un refresco de página).
// Usada por EngineerRow y NextWeekPlanningSection.
export const CURRENT_WEEK = weekRange(getToday());

// Usada solo por NextWeekPlanningSection.
export const NEXT_WEEK = nextWeekRange(getToday());

// "completed" no es una situación del motor de clasificación (weekPlanning.js
// solo describe pendientes) — es la vista de "esto ya se hizo" que usa
// NextWeekPlanningSection para el bloque de logros de la semana. Usada por
// WeekActivitiesTable para traducir la columna "Situación".
export const ROW_STATUS_LABEL = { ...SITUATION_LABEL, completed: "Completada" };

// ── Helpers ───────────────────────────────────────────────────────────────────

export function safeArr(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

// activities_identified es un array de objetos {id, text}, nunca un string suelto.
export function safeActs(val) {
  return Array.isArray(val) ? val : [];
}

// Mezcla ingenieros activos + externos activos en un único array para dropdowns de asignación.
// type: 'engineer' | 'external' permite distinguirlos visualmente.
export function buildAssignables(engineerCatalog, externalContacts) {
  const engineers = (engineerCatalog || []).filter(e => e.active).map(e => ({
    id: e.id, name: e.name, type: "engineer",
  }));
  const externals = (externalContacts || []).filter(c => c.active).map(c => ({
    id: c.id, name: c.name, company: c.company || "", type: "external",
  }));
  return [...engineers, ...externals];
}

// Siguiente sequence_order entre hermanas del mismo padre — mismo cálculo
// que HierarchyTable.nextSequenceOrder, duplicado aquí (función de una línea,
// sin dependencias) para crear la subtarea de despliegue al final del grupo.
function nextSequenceOrder(activities, parentId) {
  const siblings = activities.filter(a => (a.parent_id ?? null) === (parentId ?? null));
  if (!siblings.length) return 0;
  return Math.max(...siblings.map(a => Number(a.sequence_order) || 0)) + 1;
}

// Mueve una actividad entre los 5 buckets de task_status, SIN validar nada —
// motor de bajo nivel reutilizado tanto por la transición pública
// (transitionActivityStatus, que sí valida vía canTransitionTo) como por las
// transiciones automáticas internas del padre en la cadena de despliegue
// (que deliberadamente NO pasan por esa validación — ver su comentario).
function moveBucket(taskStatus, activities, activityId, toKey) {
  const ts = taskStatus && typeof taskStatus === "object" ? taskStatus : {};
  const acts = safeActs(activities);

  const fromKey = ALL_STATUS_KEYS.find(k => safeArr(ts[k]).includes(activityId));
  const next = { ...ts };
  ALL_STATUS_KEYS.forEach(k => { next[k] = safeArr(ts[k]).filter(id => id !== activityId); });
  next[toKey] = [...next[toKey], activityId];

  const cDates = { ...(ts.completed_dates || {}) };
  if (toKey === "completed") cDates[activityId] = getToday();
  else if (fromKey === "completed") delete cDates[activityId];
  next.completed_dates = cDates;

  const hist = { ...(ts.status_history || {}) };
  if (!hist[activityId]) hist[activityId] = { added: getToday() };
  const dateField = STATUS_DATE_FIELD[toKey];
  if (dateField) hist[activityId] = { ...hist[activityId], [dateField]: getToday() };
  if (fromKey === "in_progress" && toKey !== "in_progress") { const h = { ...hist[activityId] }; delete h.in_progress; hist[activityId] = h; }
  if (fromKey === "completed"   && toKey !== "completed")   { const h = { ...hist[activityId] }; delete h.completed;   hist[activityId] = h; }
  next.status_history = hist;

  const act = acts.find(a => a.id === activityId);
  const completedBy = { ...(ts.completed_by || {}) };
  if (toKey === "completed" && (act?.assigned_engineers || []).length > 0) {
    completedBy[activityId] = act.assigned_engineers.map(e => ({ engineer_id: e.id, engineer_name: e.name }));
  } else if (fromKey === "completed") {
    delete completedBy[activityId];
  }
  next.completed_by = completedBy;

  return next;
}

// Crea la subtarea automática de un paso de despliegue (rol "test_deploy" o
// "prod_deploy") colgando del padre indicado, y la agrega a not_started —
// mismo patrón que handleHierarchyAddChild (useActivityHandlers.js).
function createDeploymentSubtask(activities, taskStatus, parentId, text, role) {
  const newAct = { ...createActivity(text, parentId, nextSequenceOrder(activities, parentId)), deployment_role: role };
  const newActivities = [...activities, newAct];
  const ts = {
    ...taskStatus,
    not_started: [...safeArr(taskStatus.not_started), newAct.id],
    status_history: { ...(taskStatus.status_history || {}), [newAct.id]: { added: getToday() } },
  };
  return { newActivities, taskStatus: ts, newActivityId: newAct.id };
}

// Punto de entrada ÚNICO para cambiar el estado de una actividad — usado por
// los 3 caminos de la UI (Kanban/TaskStatusSelector, selector del modal de
// detalle vía _newStatus, y el <select> de HierarchyTable), para que el flujo
// de ambientes de despliegue (desarrollo → pruebas → producción) se comporte
// igual sin importar por dónde se dispare.
//
// A diferencia del antiguo moveTaskStatus (solo devolvía task_status), esta
// función puede CREAR actividades (las subtareas automáticas de despliegue),
// así que su contrato de retorno es distinto a propósito:
//   { taskStatus, newActivities, openActivityId }
// openActivityId: id de una subtarea recién creada que el caller debe abrir
// de inmediato (mismo patrón que ya usa "+ Subtarea" hoy), o null si no
// aplica.
//
// Si el destino no es alcanzable (canTransitionTo lo bloquea: subtareas
// normales pendientes, intento de completar a mano desde un ambiente, o
// intento de entrar a un ambiente sin es_desarrollo), es un no-op: devuelve
// taskStatus/activities intactos y openActivityId null.
export function transitionActivityStatus(taskStatus, activities, activityId, toKey) {
  const ts = taskStatus && typeof taskStatus === "object" ? taskStatus : {};
  const acts = safeActs(activities);

  if (!canTransitionTo(activityId, acts, ts, toKey)) {
    return { taskStatus: ts, newActivities: acts, openActivityId: null };
  }

  let nextTs = moveBucket(ts, acts, activityId, toKey);
  let nextActs = acts;
  let openActivityId = null;

  if (toKey === "ambiente_pruebas") {
    const created = createDeploymentSubtask(nextActs, nextTs, activityId, "Paso a servidor de pruebas", "test_deploy");
    nextActs = created.newActivities;
    nextTs = created.taskStatus;
    openActivityId = created.newActivityId;
  }

  if (toKey === "completed") {
    const completedAct = nextActs.find(a => a.id === activityId);
    const parentId = completedAct?.parent_id ?? null;
    const parent = parentId ? nextActs.find(a => a.id === parentId) : null;

    // Transiciones automáticas del padre — DELIBERADAMENTE sin pasar por
    // canTransitionTo (ver su comentario): el padre solo llega aquí como
    // efecto secundario de completar SU PROPIA subtarea de despliegue, nunca
    // por acción directa del usuario sobre el padre.
    if (parent && completedAct.deployment_role === "test_deploy") {
      nextTs = moveBucket(nextTs, nextActs, parentId, "ambiente_produccion");
      const created = createDeploymentSubtask(nextActs, nextTs, parentId, "Paso a servidor de producción", "prod_deploy");
      nextActs = created.newActivities;
      nextTs = created.taskStatus;
      openActivityId = created.newActivityId;
    } else if (parent && completedAct.deployment_role === "prod_deploy") {
      nextTs = moveBucket(nextTs, nextActs, parentId, "completed");
      nextActs = nextActs.map(a => a.id === parentId ? { ...a, progress: 100 } : a);
      openActivityId = null;
    }
  }

  return { taskStatus: nextTs, newActivities: nextActs, openActivityId };
}

// Recorre TODAS las actividades "No iniciadas" de un proyecto y mueve a "En
// proceso" las que ya deberían haber arrancado (start_date <= hoy) — el
// usuario lo pidió explícitamente: "si una actividad arranca hoy el mismo
// sistema debe cambiarla a en proceso para que no sea enredado para el
// equipo y no lo tenga que hacer manualmente". Reutiliza
// transitionActivityStatus (mismo motor que el Kanban/HierarchyTable/modal
// de detalle) para que el efecto sea IDÉNTICO a que un humano hubiera hecho
// el cambio a mano: registra status_history.in_progress con la fecha de hoy,
// etc. — así se refleja igual en Kanban, Gantt y Planificación sin tocar
// esas vistas.
//
// Actividades SIN start_date nunca se tocan (no hay "hoy llegó" que
// detectar). Devuelve el proyecto sin cambios (misma referencia) si no había
// nada que mover, para que el caller pueda saltarse el guardado con un
// simple chequeo de identidad.
export function autoAdvanceOverdueActivities(project) {
  const acts = safeActs(project?.activities_identified);
  const ts = project?.task_status && typeof project.task_status === "object" ? project.task_status : {};
  const today = getToday();

  const dueIds = safeArr(ts.not_started).filter(id => {
    const act = acts.find(a => a.id === id);
    return act?.start_date && act.start_date <= today;
  });
  if (!dueIds.length) return { project, movedCount: 0 };

  let nextTs = ts;
  let nextActs = acts;
  dueIds.forEach(id => {
    const result = transitionActivityStatus(nextTs, nextActs, id, "in_progress");
    nextTs = result.taskStatus;
    nextActs = result.newActivities;
  });

  return {
    project: {
      ...project,
      activities_identified: nextActs,
      task_status: nextTs,
      manual_metrics: buildAutoMetrics(project.manual_metrics, nextActs, nextTs),
    },
    movedCount: dueIds.length,
  };
}

// ── Constantes ────────────────────────────────────────────────────────────────

export const IMPEDIMENT_TYPES = [
  { category: "blocker",        label: "Bloqueante",         icon: "🚫", hasImpact: true  },
  { category: "risk",           label: "Riesgo",             icon: "🔶", hasImpact: true  },
  { category: "non_conformity", label: "Salida no conforme", icon: "⚠️", hasImpact: false },
];
export const IMPEDIMENT_META = Object.fromEntries(IMPEDIMENT_TYPES.map(t => [t.category, t]));
