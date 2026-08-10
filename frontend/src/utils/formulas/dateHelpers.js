// dateHelpers.js — Fecha: labels de semana, formateo ISO/DMY, lunes de la
// semana, próximo viernes.

import { isoWeekNumber, todayISO } from "../isoWeek.js";

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

// Semana ISO 8601 (antes: días transcurridos / 7, que no alinea con lunes ni
// respeta años bisiestos de 53 semanas). El número puede diferir en ±1 del
// cálculo anterior — es la corrección esperada.
export function getWeekLabel() {
  const now  = new Date();
  const week = isoWeekNumber(todayISO());
  return `Semana ${week} — ${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

/**
 * Date → "YYYY-MM-DD". El patrón `toISOString().slice(0, 10)` estaba repetido
 * 29 veces por toda la app; este helper le pone nombre y un único sitio donde
 * corregirlo si algún día hace falta.
 *
 * OJO: toISOString() convierte a UTC, así que para una hora local de la noche
 * puede devolver el día siguiente. Todo el código existente ya dependía de
 * este comportamiento, así que se conserva tal cual — cambiarlo aquí movería
 * fechas en toda la aplicación.
 */
export function toISODate(date) {
  return date.toISOString().slice(0, 10);
}

export function getToday() {
  return toISODate(new Date());
}

// Formatea "YYYY-MM-DD" a "DD/MM/YYYY". Vacío → "—".
export function formatDateDMY(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export function getMondayOf(dateStr) {
  const d    = new Date(dateStr + "T12:00:00");
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return toISODate(d);
}

export function isSameWeek(dateA, dateB) {
  return getMondayOf(dateA) === getMondayOf(dateB);
}

export function getNextFriday() {
  const now  = new Date();
  const day  = now.getDay();
  // Si hoy es antes del viernes, saltar al viernes de la PRÓXIMA semana
  const diff = day < 5 ? 5 - day + 7 : day === 5 ? 7 : 6;
  const fri  = new Date(now);
  fri.setDate(now.getDate() + diff);
  return toISODate(fri);
}

export function getWeekRangeLabel(dateStr) {
  const fri = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const dayOfWeek = fri.getDay();
  fri.setDate(fri.getDate() + (dayOfWeek <= 5 ? 5 - dayOfWeek : -(dayOfWeek - 5)));
  const mon = new Date(fri);
  mon.setDate(fri.getDate() - 4);
  const fmt = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return `Semana del ${fmt(mon)} – ${fmt(fri)} ${fri.getFullYear()}`;
}
