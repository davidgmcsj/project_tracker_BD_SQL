// engineerModel.js — Catálogo de ingenieros (modelo basado en IDs estables).
// Cada ingeniero del catálogo tiene un id estable. engineers[].engineer_id dentro
// de un proyecto referencia ese id, nunca un nombre libre — mismo patrón que las
// actividades: borrar/desactivar un ingeniero no rompe referencias existentes.

import { getToday } from "./dateHelpers.js";

export function genEngineerId() {
  return "eng_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createEngineer(name = "", role = "") {
  return { id: genEngineerId(), name, role, active: true, created_at: getToday(), tasks: [] };
}

export function genExternalContactId() {
  return "ext_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createExternalContact(name = "", company = "") {
  return { id: genExternalContactId(), name, company, active: true, created_at: getToday() };
}

// Construye un índice id → nombre a partir del catálogo de ingenieros.
export function buildEngineerIndex(engineers) {
  const map = new Map();
  (Array.isArray(engineers) ? engineers : []).forEach(e => {
    if (e && e.id != null) map.set(e.id, e.name || "");
  });
  return map;
}

// Resuelve un id de ingeniero a su nombre. Si no se encuentra, devuelve el id tal cual.
export function engineerName(index, id) {
  return index.get(id) ?? id ?? "";
}

// "Cristian Mauricio Rodriguez" → "Cristian M." — usado donde el espacio es
// reducido (celdas de tabla) y basta con distinguir personas por su primer
// nombre + inicial. Un solo nombre (sin segunda palabra) se devuelve tal cual.
export function shortEngineerName(fullName) {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] || "";
  return `${parts[0]} ${parts[1][0].toUpperCase()}.`;
}

export function genEngineerTaskId() {
  return "etask_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createEngineerTask(description = "") {
  // Modelo rico, análogo a una actividad de proyecto pero con estado + fechas
  // dentro de la propia tarea (no en un task_status externo).
  // history: fechas de las 3 transiciones de estado (added = inscrita).
  // Se auto-registran al cambiar de estado. `date` se conserva por
  // compatibilidad con tareas creadas antes de que existiera el historial.
  return {
    id: genEngineerTaskId(),
    description,
    status: "not_started",
    date: "",
    history: { added: getToday(), in_progress: "", completed: "" },
    detail:        "",
    objectives:    "",
    solution:      "",
    start_date:    "",
    due_date:      "",
    progress:      0,
    planned_hours: 0,
    checklist:     [],
    notes:         [],
    key_dates:     [],
  };
}

// Normaliza una tarea (posiblemente antigua) al modelo rico completo, sin perder
// datos existentes. Úsalo al abrir el modal para garantizar todos los campos.
export function normalizeEngineerTask(task) {
  const t = task || {};
  return {
    id:            t.id || genEngineerTaskId(),
    description:   t.description || "",
    status:        t.status || "not_started",
    date:          t.date || "",
    history:       { added: t.date || "", in_progress: "", completed: "", ...(t.history || {}) },
    detail:        t.detail || "",
    objectives:    t.objectives || "",
    solution:      t.solution || "",
    start_date:    t.start_date || "",
    due_date:      t.due_date || "",
    progress:      Number(t.progress) || 0,
    planned_hours: Number(t.planned_hours) || 0,
    checklist:     Array.isArray(t.checklist) ? t.checklist : [],
    notes:         Array.isArray(t.notes)     ? t.notes     : [],
    key_dates:     Array.isArray(t.key_dates) ? t.key_dates : [],
  };
}

// Aplica un cambio de estado a una tarea suelta, auto-registrando la fecha de la
// transición si es la primera vez que se alcanza ese estado. Devuelve la tarea nueva.
// Normaliza tareas antiguas que aún no tienen `history`.
export function applyEngineerTaskStatus(task, newStatus) {
  const history = { added: "", in_progress: "", completed: "", ...(task.history || {}) };
  if (!history.added) history.added = task.date || getToday();
  if (newStatus === "in_progress" && !history.in_progress) history.in_progress = getToday();
  if (newStatus === "completed") {
    if (!history.in_progress) history.in_progress = getToday();
    if (!history.completed)   history.completed   = getToday();
  }
  return { ...task, status: newStatus, history };
}
