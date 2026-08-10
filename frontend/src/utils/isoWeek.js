// isoWeek.js — Cálculo de semana ISO 8601 (año + número de semana).
//
// Espejo ESM de backend/utils.cjs (mismas 6 funciones). Backend (CommonJS) y
// frontend (ESM, sin bundler compartido) no pueden importar el mismo archivo,
// así que esta lógica se duplica a propósito — 12 líneas, blindadas con un
// test de paridad (isoWeek.test.js) que corre las mismas fechas en ambos lados.

export function isoWeekParts(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day); // jueves de la semana ISO que contiene dateStr
  const isoYear = d.getFullYear();
  const yearStart = new Date(isoYear, 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { isoYear, week };
}

export function isoWeekNumber(dateStr) { return isoWeekParts(dateStr).week; }
export function isoYearOf(dateStr) { return isoWeekParts(dateStr).isoYear; }

export function isoWeek(dateStr) {
  const { isoYear, week } = isoWeekParts(dateStr);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function isoWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1); // lunes de la semana que contiene dateStr
  return d.toISOString().slice(0, 10);
}

export function isoWeekEnd(dateStr) {
  const start = new Date(isoWeekStart(dateStr) + "T12:00:00");
  start.setDate(start.getDate() + 6);
  return start.toISOString().slice(0, 10);
}

export function todayISO() { return new Date().toISOString().slice(0, 10); }
