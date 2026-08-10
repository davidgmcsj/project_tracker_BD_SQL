"use strict";

// ── Utilidades compartidas del backend ───────────────────────────────────────
// Funciones puras sin dependencias externas usadas en server.cjs,
// db-operations.cjs y gemini-report.cjs.

// Normaliza cualquier valor a array de strings no vacíos.
// Acepta: undefined/null → [], Array → filtrado, string → split por newline.
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

// Construye índice id → { text, position } desde activities_identified.
// La versión "full" incluye position para labels numerados (ej. "3. Texto").
function buildActivityIndex(activities) {
  const map = new Map();
  (Array.isArray(activities) ? activities : []).forEach((a, i) => {
    if (a && a.id != null) map.set(a.id, { text: a.text || "", position: i + 1 });
  });
  return map;
}

// Versión simple: id → texto plano (para escritura SQL donde no se necesita posición).
function buildActivityIndexFlat(activities) {
  const map = new Map();
  (Array.isArray(activities) ? activities : []).forEach(a => {
    if (a && a.id != null) map.set(a.id, a.text || "");
  });
  return map;
}

function resolveActText(index, id) { return index.get(id)?.text ?? index.get(id) ?? id ?? ""; }
function resolveActArr(index, ids) { return toArray(ids).map(id => resolveActText(index, id)); }

// Construye índice id → { name, sqlId } desde el catálogo global de ingenieros.
function buildEngineerIndex(engineersCatalog) {
  const map = new Map();
  (Array.isArray(engineersCatalog) ? engineersCatalog : []).forEach(e => {
    if (e && e.id != null) map.set(e.id, { name: e.name || "", sqlId: e.sql_id || null });
  });
  return map;
}

// ── Semana ISO 8601 ──────────────────────────────────────────────────────────
// Mismo algoritmo que el getWeekNumber histórico (db-operations.cjs), extraído
// aquí y completado con el AÑO ISO: sin él, el 1-ene-2027 (viernes) calcula
// bien la semana 53 pero queda etiquetado como "2027-W53" en vez de "2026-W53",
// porque esa semana pertenece al año anterior según ISO 8601.
// Espejo ESM en frontend/src/utils/isoWeek.js — blindado con test de paridad.

function isoWeekParts(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day); // jueves de la semana ISO que contiene dateStr
  const isoYear = d.getFullYear();
  const yearStart = new Date(isoYear, 0, 1);
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { isoYear, week };
}

function isoWeekNumber(dateStr) { return isoWeekParts(dateStr).week; }
function isoYearOf(dateStr) { return isoWeekParts(dateStr).isoYear; }

function isoWeek(dateStr) {
  const { isoYear, week } = isoWeekParts(dateStr);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

function isoWeekStart(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1); // lunes de la semana que contiene dateStr
  return d.toISOString().slice(0, 10);
}

function isoWeekEnd(dateStr) {
  const start = new Date(isoWeekStart(dateStr) + "T12:00:00");
  start.setDate(start.getDate() + 6);
  return start.toISOString().slice(0, 10);
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

module.exports = {
  toArray,
  buildActivityIndex,
  buildActivityIndexFlat,
  resolveActText,
  resolveActArr,
  buildEngineerIndex,
  isoWeekParts,
  isoWeekNumber,
  isoYearOf,
  isoWeek,
  isoWeekStart,
  isoWeekEnd,
  todayISO,
};
