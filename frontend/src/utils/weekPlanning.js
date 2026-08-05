// weekPlanning.js — Deduce automáticamente qué actividades corresponden a una
// semana dada, a partir de sus fechas de inicio/fin. Reemplaza la selección
// manual de "actividades de la semana" y "plan de la próxima semana".
//
// Regla central: una actividad pertenece a una semana si su rango
// [start_date, due_date] SE SOLAPA con el rango [lunes, domingo] de esa semana.
// Es lo que hace que una tarea de varias semanas aparezca en todas las que
// atraviesa, sin duplicar el dato ni pedirle nada al usuario.
//
// Todas las funciones son puras y trabajan con fechas ISO "YYYY-MM-DD".

import { getMondayOf, getActivityStatus } from "./formulas.js";

// Situación de una actividad DENTRO de una semana concreta. El orden importa:
// se evalúa de más urgente a menos, y la primera que aplica es la que manda.
export const SITUATION = {
  OVERDUE:   "overdue",    // venció antes de esta semana y sigue sin completarse
  DUE:       "due",        // su fecha de entrega cae dentro de esta semana
  STARTS:    "starts",     // arranca en esta semana (y termina después)
  CONTINUES: "continues",  // venía de antes y sigue después: semana intermedia
};

export const SITUATION_LABEL = {
  [SITUATION.OVERDUE]:   "En demora",
  [SITUATION.DUE]:       "Vence esta semana",
  [SITUATION.STARTS]:    "Inicia esta semana",
  [SITUATION.CONTINUES]: "Continúa",
};

// ── Helpers de semana ─────────────────────────────────────────────────────────

function addDaysISO(iso, days) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Rango lunes-domingo de la semana que contiene `dateStr`.
export function weekRange(dateStr) {
  const start = getMondayOf(dateStr);
  return { start, end: addDaysISO(start, 6) };
}

// Rango de la semana siguiente a la que contiene `dateStr`.
export function nextWeekRange(dateStr) {
  return weekRange(addDaysISO(getMondayOf(dateStr), 7));
}

// ── Solapamiento ──────────────────────────────────────────────────────────────

// Rango efectivo de una actividad. Tolera que falte un extremo: con solo una
// fecha, la actividad se trata como puntual en ese día. Sin ninguna, null
// (no puede ubicarse en el calendario).
export function activityRange(activity) {
  const start = activity?.start_date || null;
  const due   = activity?.due_date   || null;
  if (!start && !due) return null;
  const from = start || due;
  const to   = due   || start;
  // Fechas invertidas (fin antes que inicio): se normalizan en vez de
  // descartar la actividad, para no ocultarla por un error de captura.
  return from <= to ? { from, to } : { from: to, to: from };
}

// True si la actividad se cruza con el rango dado, aunque sea un solo día.
export function overlapsWeek(activity, range) {
  const r = activityRange(activity);
  if (!r) return false;
  return r.from <= range.end && r.to >= range.start;
}

// ── Clasificación ─────────────────────────────────────────────────────────────

// Sitúa una actividad dentro de una semana. `taskStatus` se usa solo para
// distinguir "en demora" de "vencía y ya se completó".
export function situationInWeek(activity, range, taskStatus) {
  const r = activityRange(activity);
  if (!r) return null;
  const isCompleted = getActivityStatus(taskStatus, activity.id) === "Completada";

  if (r.to < range.start) return isCompleted ? null : SITUATION.OVERDUE;
  if (r.to <= range.end)  return SITUATION.DUE;
  if (r.from >= range.start) return SITUATION.STARTS;
  return SITUATION.CONTINUES;
}

// ── Consultas de alto nivel ───────────────────────────────────────────────────

// Actividades de una semana, ya clasificadas y ordenadas por fecha de entrega.
// Incluye las vencidas sin completar aunque su rango no toque la semana: siguen
// siendo trabajo pendiente que el ingeniero arrastra.
export function activitiesForWeek(activities, range, taskStatus, { includeOverdue = true } = {}) {
  return (activities || [])
    .map(activity => ({ activity, situation: situationInWeek(activity, range, taskStatus) }))
    .filter(({ activity, situation }) => {
      if (!situation) return false;
      if (situation === SITUATION.OVERDUE) return includeOverdue;
      return overlapsWeek(activity, range);
    })
    .sort((a, b) => {
      const ra = activityRange(a.activity), rb = activityRange(b.activity);
      return (ra?.to || "").localeCompare(rb?.to || "");
    });
}

// Igual que activitiesForWeek pero solo lo asignado a un ingeniero.
export function activitiesForEngineerWeek(activities, range, taskStatus, engineerId, opts) {
  const mine = (activities || []).filter(a =>
    (a.assigned_engineers || []).some(e => e.id === engineerId)
  );
  return activitiesForWeek(mine, range, taskStatus, opts);
}

// Actividades completadas DENTRO de la semana — sustituye a la selección
// manual de "qué se hizo esta semana". Se apoya en completed_dates, que ya
// registra la fecha en que cada actividad pasó a Completada.
export function completedInWeek(activities, range, taskStatus) {
  const dates = taskStatus?.completed_dates || {};
  return (activities || []).filter(a => {
    const done = dates[a.id];
    return done && done >= range.start && done <= range.end;
  });
}
