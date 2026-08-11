// shared.js — Helpers y constantes usados por varios de los componentes en
// que se dividió EditView.jsx (Fase 4 de la refactorización).
//
// Solo vive aquí lo que cruza más de un componente destino. Lo que un solo
// componente usa se queda en su propio archivo.

import { getToday, canMarkCompleted } from "../../utils/formulas";
import { weekRange, nextWeekRange, SITUATION_LABEL } from "../../utils/weekPlanning";

// Fechas que se registran automáticamente por columna — mismo mapa que usa
// TaskStatusSelector (Kanban) internamente.
const STATUS_DATE_FIELD = { not_started: null, in_progress: "in_progress", completed: "completed" };

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

// Mueve una actividad entre los 3 buckets de task_status (completed/in_progress/
// not_started), igual que TaskStatusSelector.move() al arrastrar una tarjeta
// en el Kanban — misma lógica, reutilizada aquí para el selector de estado del
// modal de detalle (ActivityDetailModal._newStatus). Devuelve el task_status
// actualizado, o el original sin cambios si el destino es "completed" y la
// actividad tiene subtareas pendientes (canMarkCompleted).
export function moveTaskStatus(taskStatus, activities, activityId, toKey) {
  const ts = taskStatus && typeof taskStatus === "object" ? taskStatus : {};
  const acts = safeActs(activities);
  if (toKey === "completed" && !canMarkCompleted(activityId, acts, ts)) return ts;

  const fromKey = ["completed", "in_progress", "not_started"].find(k => safeArr(ts[k]).includes(activityId));
  const next = {
    ...ts,
    completed:   safeArr(ts.completed).filter(id => id !== activityId),
    in_progress: safeArr(ts.in_progress).filter(id => id !== activityId),
    not_started: safeArr(ts.not_started).filter(id => id !== activityId),
  };
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

// ── Constantes ────────────────────────────────────────────────────────────────

export const IMPEDIMENT_TYPES = [
  { category: "blocker",        label: "Bloqueante",         icon: "🚫", hasImpact: true  },
  { category: "risk",           label: "Riesgo",             icon: "🔶", hasImpact: true  },
  { category: "non_conformity", label: "Salida no conforme", icon: "⚠️", hasImpact: false },
];
export const IMPEDIMENT_META = Object.fromEntries(IMPEDIMENT_TYPES.map(t => [t.category, t]));
