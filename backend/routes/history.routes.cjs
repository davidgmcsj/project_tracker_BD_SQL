"use strict";

// history.routes.cjs — Historial semanal (snapshots de reportes).
//
// POST /api/report escribe en HISTORY_FILE y en SQL Server en paralelo. Si
// SQL falla, el error se loguea pero NO interrumpe la respuesta al cliente —
// el JSON actúa como respaldo ante caídas de la BD, con reintento automático
// a los 5 segundos.

const express = require("express");

/**
 * @param {object} deps
 * @param {string} deps.DATA_FILE
 * @param {string} deps.HISTORY_FILE
 * @param {Function} deps.readJson
 * @param {Function} deps.writeJson
 * @param {Function} [deps.saveWeekReportToDB]
 * @param {Function} deps.errorBody
 */
function crearHistoryRouter({ DATA_FILE, HISTORY_FILE, readJson, writeJson, saveWeekReportToDB, errorBody }) {
  const router = express.Router();

  // Normaliza cualquier fecha a su lunes de semana (YYYY-MM-DD). Sirve como
  // clave única por semana: dos reportes de la misma semana se sobreescriben
  // en lugar de duplicarse.
  function getMondayOf(dateStr) {
    const d    = new Date(dateStr + "T12:00:00");
    const day  = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d.toISOString().slice(0, 10);
  }

  router.post("/report", async (req, res) => {
    try {
      const { projects, weekLabel, saved_at } = req.body;
      if (!projects?.length) return res.status(400).json({ error: "Sin proyectos" });

      const reportDate = projects[0].report_date || new Date().toISOString().slice(0, 10);
      const weekKey    = getMondayOf(reportDate);
      const data       = await readJson(HISTORY_FILE, { reports: [] });
      const entry      = { week_key: weekKey, report_date: reportDate, weekLabel, saved_at: saved_at || new Date().toISOString(), projects };

      // UPSERT por semana: si ya existe un reporte de esa semana, lo reemplaza
      const idx = data.reports.findIndex(r => (r.week_key || r.report_date) === weekKey);
      if (idx >= 0) data.reports[idx] = entry;
      else          data.reports.push(entry);

      data.reports.sort((a, b) => (b.week_key || b.report_date || "").localeCompare(a.week_key || a.report_date || ""));
      await writeJson(HISTORY_FILE, data);
      console.log("[API] Reporte guardado en history.json:", reportDate, weekKey);

      // Responde al frontend inmediatamente — el JSON ya está guardado
      res.json({ ok: true, report_date: reportDate, week_key: weekKey });

      // Escritura en SQL Server en segundo plano con reintento automático
      if (saveWeekReportToDB) {
        const currentData = await readJson(DATA_FILE, { engineers: [] });
        const engineersCatalog = currentData.engineers || [];
        saveWeekReportToDB(projects, weekLabel, entry.saved_at, engineersCatalog)
          .then(() => console.log("[SQL] ✓ Reporte guardado en base de datos:", reportDate))
          .catch(e => {
            console.warn("[SQL] ⚠ Primer intento fallido, reintentando en 5s:", e.message);
            setTimeout(() => {
              saveWeekReportToDB(projects, weekLabel, entry.saved_at, engineersCatalog)
                .then(() => console.log("[SQL] ✓ Reporte guardado en base de datos (reintento):", reportDate))
                .catch(e2 => console.error("[SQL] ✗ Error definitivo guardando en BD:", e2.message));
            }, 5000);
          });
      }
    } catch (e) {
      console.error("[API] Error en POST /api/report:", e.message, e.stack);
      res.status(500).json(errorBody("Error guardando reporte", e));
    }
  });

  router.get("/history", async (req, res) => {
    try {
      const data = await readJson(HISTORY_FILE, { reports: [] });
      res.json({
        reports: data.reports.map(r => ({
          report_date: r.report_date,
          weekLabel:   r.weekLabel,
          saved_at:    r.saved_at,
        })),
      });
    } catch {
      res.status(500).json({ error: "Error leyendo historial" });
    }
  });

  router.get("/history/:date", async (req, res) => {
    try {
      const data  = await readJson(HISTORY_FILE, { reports: [] });
      const entry = data.reports.find(r => r.report_date === req.params.date);
      if (!entry) return res.status(404).json({ error: "Fecha no encontrada" });
      res.json(entry);
    } catch {
      res.status(500).json({ error: "Error leyendo historial" });
    }
  });

  return router;
}

module.exports = { crearHistoryRouter };
