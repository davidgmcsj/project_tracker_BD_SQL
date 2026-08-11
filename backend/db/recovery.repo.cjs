"use strict";

// recovery.repo.cjs — Reconstrucción de data.json desde SQL.
//
// SQL es la fuente de verdad; data.json es la caché rápida que sirve cada
// GET /api/projects. Si esa caché desaparece o se corrompe (ej. un reinicio
// de Azure App Service sin disco persistente), esto reconstruye el estado
// de proyectos desde el último RawDataJSON guardado de cada uno.
//
// Limitación conocida: el catálogo de ingenieros NO se reconstruye acá. Los
// ids de ingeniero (eng_xxx) son locales a la app y no existen en SQL (solo
// existe IngenieroID numérico) — generar ids nuevos rompería la relación con
// activities_identified[].assigned_engineers de las actividades restauradas.
// Devuelve engineers/externalContacts vacíos a propósito; se reconstruyen
// solos a medida que se vuelve a usar la app.

const { getPool } = require("./pool.cjs");

async function rebuildDataJsonFromSQL() {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT r.RawDataJSON
    FROM ReportesSemanales r
    INNER JOIN (
      SELECT ProyectoID, MAX(SavedAt) AS UltimoGuardado
      FROM ReportesSemanales
      GROUP BY ProyectoID
    ) latest ON r.ProyectoID = latest.ProyectoID AND r.SavedAt = latest.UltimoGuardado
    WHERE r.RawDataJSON IS NOT NULL AND r.RawDataJSON != ''
  `);

  const projects = result.recordset
    .map(row => { try { return JSON.parse(row.RawDataJSON); } catch { return null; } })
    .filter(Boolean);

  if (!projects.length) return null;
  return { projects, weekLabel: null, engineers: [], externalContacts: [], savedAt: new Date().toISOString() };
}

async function maxSqlSavedAt() {
  const pool = await getPool();
  const res = await pool.request().query("SELECT MAX(SavedAt) AS maxSavedAt FROM ReportesSemanales");
  return res.recordset[0]?.maxSavedAt || null;
}

module.exports = { rebuildDataJsonFromSQL, maxSqlSavedAt };
