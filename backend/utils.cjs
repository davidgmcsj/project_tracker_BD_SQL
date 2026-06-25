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

module.exports = {
  toArray,
  buildActivityIndex,
  buildActivityIndexFlat,
  resolveActText,
  resolveActArr,
  buildEngineerIndex,
};
