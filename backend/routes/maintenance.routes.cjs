"use strict";

// maintenance.routes.cjs — Restauración manual del estado desde SQL.

const express = require("express");

/**
 * @param {object} deps
 * @param {string} deps.DATA_FILE
 * @param {Function} deps.readJson
 * @param {Function} deps.writeJson
 * @param {Function} [deps.rebuildDataJsonFromSQL]
 * @param {Function} deps.errorBody
 */
function crearMaintenanceRouter({ DATA_FILE, readJson, writeJson, rebuildDataJsonFromSQL, errorBody }) {
  const router = express.Router();

  router.post("/restore-from-db", async (req, res) => {
    if (!rebuildDataJsonFromSQL) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const rebuilt = await rebuildDataJsonFromSQL();
      if (!rebuilt) {
        return res.status(404).json({ error: "No hay datos de respaldo en la base de datos" });
      }

      // A diferencia del rebuild de arranque (donde no hay nada que preservar),
      // acá sí hay un data.json vivo — se conservan weekLabel/engineers/
      // externalContacts actuales y solo se reemplazan los proyectos.
      const currentData = await readJson(DATA_FILE, { projects: [], weekLabel: null });
      await writeJson(DATA_FILE, { ...currentData, projects: rebuilt.projects, savedAt: new Date().toISOString() });

      console.log(`[RESTORE] ✓ Restaurados ${rebuilt.projects.length} proyectos desde la BD`);
      res.json({ ok: true, restored: rebuilt.projects.length });
    } catch (e) {
      console.error("[RESTORE] Error:", e.message);
      res.status(500).json(errorBody("Error restaurando desde BD", e));
    }
  });

  return router;
}

module.exports = { crearMaintenanceRouter };
