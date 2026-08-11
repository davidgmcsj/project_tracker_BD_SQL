"use strict";

// projects.repo.cjs — Resolución/sync de la fila de Proyectos y de la tabla
// legada Actividades (solo texto, distinta de Actividades_Detalle en
// activity-detail.repo.cjs).
//
// resolveProject y syncProjectMeta garantizan AMBAS el mismo invariante (que
// exista una fila de Proyectos para un AppID) por caminos distintos:
// resolveProject usa cache + SELECT-then-decide (llamada desde saveProject,
// una vez por semana al cerrar reporte); syncProjectMeta usa MERGE (llamada
// en CADA guardado normal desde activity-detail.repo.cjs, para que renombrar
// un proyecto en EditView se refleje de inmediato sin esperar al cierre de
// semana). No se unifican: MERGE evita la carrera de dos guardados casi
// simultáneos insertando dos filas para el mismo AppID, algo que
// resolveProject no necesita resolver porque preloadCaches ya trae el
// AppID cacheado antes de decidir.

const sql = require("mssql");
const { getPool } = require("./pool.cjs");
const { toArray } = require("../utils.cjs");

// ── Pre-carga global en una sola query ────────────────────────────────────────
// Usada por saveWeekReportToDB (weekly-report.repo.cjs) para no hacer un
// SELECT de ingenieros/proyectos por cada proyecto a guardar.

async function preloadCaches(pool, projects) {
  const appIds = projects.map(p => p.id || "").filter(Boolean);

  const [engsRes, proysRes] = await Promise.all([
    pool.request().query("SELECT IngenieroID, Nombre FROM Ingenieros WHERE Estado = 1"),
    appIds.length
      ? (() => {
          const req = pool.request();
          const placeholders = appIds.map((id, i) => {
            req.input(`appId${i}`, sql.NVarChar, id);
            return `@appId${i}`;
          });
          return req.query(`SELECT ProyectoID, AppID, NombreProyecto, URLPlanner FROM Proyectos WHERE AppID IN (${placeholders.join(",")})`);
        })()
      : Promise.resolve({ recordset: [] }),
  ]);

  return {
    engCache:  engsRes.recordset,
    proyCache: proysRes.recordset,
  };
}

async function resolveProject(pool, project, proyCache) {
  const appId = project.id || "";
  const name  = project.project_name || "Sin nombre";
  const url   = project.planner_url  || "";

  const cached = proyCache.find(r => r.AppID === appId);

  if (cached) {
    // Actualizar solo si cambió algo — evita un UPDATE innecesario
    if (cached.NombreProyecto !== name || cached.URLPlanner !== url) {
      await pool.request()
        .input("pid",  sql.Int,      cached.ProyectoID)
        .input("name", sql.NVarChar, name)
        .input("url",  sql.NVarChar, url)
        .query("UPDATE Proyectos SET NombreProyecto = @name, URLPlanner = @url WHERE ProyectoID = @pid");
    }
    return cached.ProyectoID;
  }

  const ins = await pool.request()
    .input("appId", sql.NVarChar, appId)
    .input("name",  sql.NVarChar, name)
    .input("url",   sql.NVarChar, url)
    .query("INSERT INTO Proyectos (AppID, NombreProyecto, URLPlanner) OUTPUT INSERTED.ProyectoID VALUES (@appId, @name, @url)");
  const newId = ins.recordset[0].ProyectoID;
  proyCache.push({ ProyectoID: newId, AppID: appId, NombreProyecto: name, URLPlanner: url });
  return newId;
}

// Mantiene Proyectos.NombreProyecto/URLPlanner al día en CADA guardado
// normal, no solo al "Guardar reporte" semanal (que es lo único que corría
// resolveProject antes). Sin esto, renombrar un proyecto en EditView nunca
// se reflejaba en Reportes/Ingenieros hasta la próxima vez que se cerrara
// la semana — esas vistas hacen JOIN Proyectos y proyectan NombreProyecto.
// MERGE en vez de SELECT-then-decide: evita la carrera de insertar dos
// filas para el mismo AppID si dos guardados llegan casi al mismo tiempo.
async function syncProjectMeta(pool, project) {
  const appId = project.id || "";
  if (!appId) return;
  const name = project.project_name || "Sin nombre";
  const url  = project.planner_url  || "";

  await pool.request()
    .input("appId", sql.NVarChar, appId)
    .input("name",  sql.NVarChar, name)
    .input("url",   sql.NVarChar, url)
    .query(`
      MERGE Proyectos AS t
      USING (SELECT @appId AS AppID) AS s ON t.AppID = s.AppID
      WHEN MATCHED AND (t.NombreProyecto <> @name OR t.URLPlanner <> @url) THEN
        UPDATE SET NombreProyecto = @name, URLPlanner = @url
      WHEN NOT MATCHED THEN
        INSERT (AppID, NombreProyecto, URLPlanner) VALUES (@appId, @name, @url);
    `);
}

// Inserta actividades nuevas en un solo INSERT multi-row. Tabla legada
// "Actividades" (solo texto/orden) — distinta de "Actividades_Detalle", que
// tiene fechas/estado/progreso y vive en activity-detail.repo.cjs.
async function syncActividades(pool, proyectoID, activitiesArr) {
  const acts = toArray(activitiesArr).map(a => (a?.text || "").trim()).filter(Boolean);
  if (!acts.length) return;

  const existing = await pool.request()
    .input("pid", sql.Int, proyectoID)
    .query("SELECT DescripcionActividad FROM Actividades WHERE ProyectoID = @pid");

  const existingSet = new Set(existing.recordset.map(r => r.DescripcionActividad));
  const nuevas = acts.filter((a, i) => !existingSet.has(a));
  if (!nuevas.length) return;

  // INSERT multi-row: una sola query para todas las actividades nuevas
  const req = pool.request().input("pid", sql.Int, proyectoID);
  const rows = nuevas.map((desc, i) => {
    req.input(`desc${i}`,  sql.NVarChar, desc);
    req.input(`orden${i}`, sql.Int,      acts.indexOf(desc));
    return `(@pid, @desc${i}, @orden${i})`;
  });
  await req.query(`INSERT INTO Actividades (ProyectoID, DescripcionActividad, Orden) VALUES ${rows.join(",")}`);
}

module.exports = { preloadCaches, resolveProject, syncProjectMeta, syncActividades };
