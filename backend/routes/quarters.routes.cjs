"use strict";

// quarters.routes.cjs — Cierre de trimestre, limpieza de estadísticas, y
// consulta de trimestres archivados.
//
// ⚠️ __dirname: la carpeta archive/ se resuelve con BACKEND_DIR (inyectado
// por parámetro), NO con el __dirname de este archivo — este vive en
// backend/routes, y archive/ está en backend/. Es la misma trampa que ya
// apareció en json-store.cjs y bootstrap.cjs durante la Fase 2: si se usara
// __dirname a secas, "archive" se buscaría en backend/routes/archive, que no
// existe, y los trimestres desaparecerían en silencio.
//
// GET /:id tiene doble defensa contra path traversal (regex de charset +
// verificación de que la ruta resuelta sigue dentro de archiveDir) — ambas
// deben sobrevivir intactas, están cubiertas por tests de contrato
// (routes-contract.test.cjs).

const express = require("express");
const path    = require("path");
const fs      = require("fs");

/**
 * @param {object} deps
 * @param {string} deps.BACKEND_DIR
 * @param {string} deps.DATA_FILE
 * @param {Function} deps.readJson
 * @param {Function} deps.writeJson
 * @param {Function} deps.getPool
 * @param {Function} deps.computeQuarterStats
 * @param {Function} deps.buildResetProjects
 * @param {Function} deps.errorBody
 * @param {Function} deps.requireAdmin
 */
function crearQuartersRouter({ BACKEND_DIR, DATA_FILE, readJson, writeJson, getPool, computeQuarterStats, buildResetProjects, errorBody, requireAdmin }) {
  const router = express.Router();
  const archiveDir = path.join(BACKEND_DIR, "archive");

  // POST /api/quarter-reset
  //   Recibe el estado actual completo (projects, engineers, externalContacts, weekLabel).
  //   Ejecuta en orden:
  //     1. Calcula estadísticas del trimestre que se cierra.
  //     2. Guarda snapshot completo en SQL (Trimestres_Archivo) y en archivo físico.
  //     3. Construye el nuevo estado limpio (solo actividades no terminadas).
  //     4. Sobreescribe data.json con el estado nuevo.
  //   Responde con un resumen del resultado para mostrar al usuario.
  //
  // Estrategia de limpieza por proyecto:
  //   - activities_identified: se conservan SOLO las in_progress y not_started
  //   - task_status.completed: se vacía
  //   - task_status.in_progress / not_started: se conservan sin cambios
  //   - task_status.status_history: se conservan solo las entradas de actos que continúan
  //   - engineers[].weekly_total y weekly_detail: se resetean a 0 / []
  //   - weekly_achievements, next_week_plan, impediments: se vacían
  //   - manual_metrics: se recalcula basado en las actividades que quedan
  //   - La actividad en sí (checklist, notas, fechas clave, prioridad, etc.): se conserva intacta
  // Solo admin: irreversible y afecta TODOS los proyectos del portafolio.
  router.post("/quarter-reset", requireAdmin, async (req, res) => {
    try {
      const { projects = [], engineers = [], externalContacts = [], weekLabel = "", quarterLabel = "", quarterStart = "" } = req.body;

      if (!quarterLabel) return res.status(400).json({ error: "Falta quarterLabel (ej: 'Q2 2026')" });

      // ── 1. Calcular estadísticas del trimestre que se cierra ───────────────
      const { totalArchivadas, totalTransferidas } = computeQuarterStats(projects);

      // ── 2. Guardar snapshot completo en archivo físico de respaldo ─────────
      const archiveFile = path.join(archiveDir, `quarter_${quarterLabel.replace(/\s/g, "_")}.json`);

      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

      const snapshotData = { projects, engineers, externalContacts, weekLabel, quarterLabel, archivedAt: new Date().toISOString() };
      await writeJson(archiveFile, snapshotData);
      console.log(`[QUARTER] ✓ Snapshot guardado en archivo: ${archiveFile}`);

      // ── 3. Guardar snapshot en SQL (Trimestres_Archivo) ────────────────────
      //    Usamos el pool de db-operations si está disponible.
      //    Si falla SQL, el archivo físico ya tiene el backup — no bloqueamos el reset.
      try {
        const mssql = require("mssql");
        const pool  = await getPool();
        await pool.request()
          .input("quarterLabel",  mssql.NVarChar(50),   quarterLabel)
          .input("fechaInicio",   mssql.Date,           quarterStart ? new Date(quarterStart) : new Date())
          .input("totalProy",     mssql.Int,             projects.length)
          .input("archivadas",    mssql.Int,             totalArchivadas)
          .input("transferidas",  mssql.Int,             totalTransferidas)
          .input("jsonData",      mssql.NVarChar,        JSON.stringify(snapshotData))
          .query(`
            INSERT INTO Trimestres_Archivo
              (QuarterLabel, FechaInicio, TotalProyectos, ActividadesArchivadas, ActividadesTransferidas, ArchivedDataJSON)
            VALUES
              (@quarterLabel, @fechaInicio, @totalProy, @archivadas, @transferidas, @jsonData)
          `);
        console.log(`[QUARTER] ✓ Snapshot guardado en SQL: ${quarterLabel}`);
      } catch (sqlErr) {
        // SQL falló pero el archivo físico ya está guardado — el reset continúa igual
        console.warn(`[QUARTER] ⚠ SQL falló (archivo físico disponible como respaldo): ${sqlErr.message}`);
      }

      // ── 4. Construir el nuevo estado limpio para el nuevo trimestre ─────────
      const newProjects = buildResetProjects(projects);

      // ── 5. Sobreescribir data.json con el estado del nuevo trimestre ───────
      const currentData = await readJson(DATA_FILE, {});
      await writeJson(DATA_FILE, {
        ...currentData,
        projects:        newProjects,
        engineers,
        externalContacts,
        weekLabel,
      });

      console.log(`[QUARTER] ✓ Reset trimestral completado. Archivadas: ${totalArchivadas}, Transferidas: ${totalTransferidas}`);

      res.json({
        ok:                   true,
        quarterLabel,
        archivedAt:           new Date().toISOString(),
        totalProyectos:       projects.length,
        activitiesArchived:   totalArchivadas,
        activitiesTransferred: totalTransferidas,
      });

    } catch (e) {
      console.error("[QUARTER] Error en reset:", e.message);
      res.status(500).json(errorBody("Error ejecutando el reset trimestral", e));
    }
  });

  // POST /api/clean-stats
  //   Borra weekly_total, weekly_detail, status_history, weekly_achievements,
  //   next_week_plan e impediments de todos los proyectos actuales.
  //   NO archiva nada. Úsalo cuando el reset ya se ejecutó pero quedaron datos sucios.
  // Solo admin: afecta TODOS los proyectos del portafolio.
  router.post("/clean-stats", requireAdmin, async (req, res) => {
    try {
      const currentData = await readJson(DATA_FILE, {});

      const projects = (currentData.projects || []).map(p => {
        const ts = p.task_status || {};

        // Actividades que NO están completadas (se conservan intactas)
        const keepIds = new Set([...(ts.in_progress || []), ...(ts.not_started || [])]);
        const newActs = (p.activities_identified || []).filter(a => keepIds.has(a.id));

        // Recalcular métricas basadas en las actividades que quedan
        const newMetrics = {
          total_tasks:           newActs.length,
          completed_tasks:       0,
          in_progress_tasks:     (ts.in_progress || []).length,
          shared_tasks_discount: 0,
        };

        return {
          ...p,
          // Estado del proyecto → neutro
          status:              "on-track",
          status_notes:        "",
          show_closing_fields: false,
          // Métricas → recalculadas limpias
          manual_metrics:      newMetrics,
          // Indicadores → vaciados
          indicators:          (p.indicators || []).map(ind => ({
            ...ind,
            total: 0, completed: 0, in_progress: 0,
          })),
          // Semana → limpia
          weekly_achievements: [],
          next_week_plan:      [],
          impediments:         [],
          comments:            [],
          milestones:          (p.milestones || []).map(m => ({ ...m, completed: false })),
          // Solo actividades no completadas, sin historial de fechas
          activities_identified: newActs,
          task_status: {
            completed:      [],
            in_progress:    ts.in_progress || [],
            not_started:    ts.not_started || [],
            status_history: {},
          },
          // Ingenieros por proyecto → limpiar estadísticas semanales e histórico de contadores
          engineers: (p.engineers || []).map(e => ({
            ...e,
            assigned:      0,
            completed:     0,
            in_progress:   0,
            weekly_total:  0,
            weekly_detail: [],
          })),
        };
      });

      await writeJson(DATA_FILE, { ...currentData, projects });
      console.log(`[CLEAN-STATS] ✓ Limpieza completa: ${projects.length} proyectos`);
      res.json({ ok: true, projectsCleaned: projects.length });
    } catch (e) {
      console.error("[CLEAN-STATS] Error:", e.message);
      res.status(500).json(errorBody("Error limpiando estadísticas", e));
    }
  });

  // GET /api/quarters
  //   Primero intenta leer desde SQL (fuente primaria).
  //   Si SQL no está disponible, lee los archivos JSON físicos del directorio archive/.
  //   Devuelve lista ordenada de más reciente a más antiguo.
  router.get("/quarters", async (req, res) => {
    // Intentar desde SQL primero
    try {
      const pool   = await getPool();
      const result = await pool.request().query(`
        SELECT TrimestreID, QuarterLabel, FechaInicio, FechaReset,
               TotalProyectos, ActividadesArchivadas, ActividadesTransferidas, CreadoEn
        FROM Trimestres_Archivo
        ORDER BY FechaReset DESC
      `);
      return res.json({ ok: true, source: "sql", quarters: result.recordset });
    } catch (sqlErr) {
      console.warn("[QUARTER] SQL no disponible para listar trimestres, leyendo archivos físicos:", sqlErr.message);
    }

    // Fallback: leer archivos físicos del directorio archive/
    try {
      if (!fs.existsSync(archiveDir)) return res.json({ ok: true, source: "files", quarters: [] });

      const files   = fs.readdirSync(archiveDir).filter(f => f.startsWith("quarter_") && f.endsWith(".json"));
      const quarters = files.map(f => {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
          return {
            TrimestreID:             f,
            QuarterLabel:            data.quarterLabel || f,
            FechaReset:              data.archivedAt,
            TotalProyectos:          data.projects?.length || 0,
            ActividadesArchivadas:   null,
            ActividadesTransferidas: null,
          };
        } catch { return null; }
      }).filter(Boolean).sort((a, b) => new Date(b.FechaReset) - new Date(a.FechaReset));

      return res.json({ ok: true, source: "files", quarters });
    } catch (e) {
      res.status(500).json(errorBody("Error leyendo trimestres archivados", e));
    }
  });

  // GET /api/quarters/:id
  //   :id puede ser un TrimestreID numérico (desde SQL) o el nombre del archivo físico.
  //   Devuelve el JSON completo del trimestre para mostrarlo en la app (modo lectura).
  router.get("/quarters/:id", async (req, res) => {
    const { id } = req.params;

    // Si es numérico, buscar en SQL
    if (/^\d+$/.test(id)) {
      try {
        const mssql  = require("mssql");
        const pool   = await getPool();
        const result = await pool.request()
          .input("id", mssql.Int, parseInt(id))
          .query(`SELECT ArchivedDataJSON, QuarterLabel, FechaInicio, FechaReset FROM Trimestres_Archivo WHERE TrimestreID = @id`);

        if (!result.recordset.length) return res.status(404).json({ error: "Trimestre no encontrado" });

        const row  = result.recordset[0];
        const data = JSON.parse(row.ArchivedDataJSON);
        return res.json({ ok: true, source: "sql", quarterLabel: row.QuarterLabel, ...data });
      } catch (sqlErr) {
        console.warn("[QUARTER] SQL falló, intentando archivo físico:", sqlErr.message);
      }
    }

    // Fallback o ID de archivo: leer desde archive/
    try {
      // El id puede ser el nombre del archivo (quarter_Q2_2026.json) o el quarterLabel.
      // Se valida contra un charset seguro antes de tocar el filesystem para evitar
      // path traversal vía "../" — path.join() por sí solo NO bloquea esto.
      if (!/^[\w.\-]+$/.test(id)) {
        return res.status(400).json({ error: "ID de trimestre inválido" });
      }
      const fileName = id.endsWith(".json") ? id : `${id}.json`;
      const filePath = path.join(archiveDir, fileName);

      // Cinturón y tirantes: confirma que la ruta resuelta sigue dentro de archiveDir.
      if (!filePath.startsWith(archiveDir + path.sep)) {
        return res.status(400).json({ error: "Ruta de trimestre inválida" });
      }

      if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Archivo de trimestre no encontrado" });

      const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return res.json({ ok: true, source: "file", ...data });
    } catch (e) {
      res.status(500).json(errorBody("Error leyendo trimestre", e));
    }
  });

  return router;
}

module.exports = { crearQuartersRouter };
