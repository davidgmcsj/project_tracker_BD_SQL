"use strict";

// diagnostics.routes.cjs — Diagnóstico de conexión a BD (solo desarrollo) y
// healthcheck para el orquestador (producción).
//
// GET /api/db-ping deshabilitada en producción: expone nombre de servidor/BD
// y detalle de error, información que no debe salir fuera de un entorno de
// desarrollo.

const express = require("express");

/**
 * @param {object} deps
 * @param {boolean} deps.isProduction
 * @param {Function} deps.getPool
 * @param {Function} [deps.saveWeekReportToDB]  se usa solo para comprobar si
 *   db-operations.cjs cargó — cualquier export de ese módulo serviría.
 */
function crearDiagnosticsRouter({ isProduction, getPool, saveWeekReportToDB }) {
  const router = express.Router();

  router.get("/db-ping", async (req, res) => {
    if (isProduction) {
      return res.status(404).json({ error: "No encontrado" });
    }
    if (!saveWeekReportToDB) {
      return res.json({ ok: false, error: "db-operations.cjs no cargó (módulo no encontrado)" });
    }
    try {
      const pool   = await getPool();
      const result = await pool.request().query("SELECT @@SERVERNAME AS srv, DB_NAME() AS db");
      res.json({ ok: true, ...result.recordset[0] });
    } catch (e) {
      console.error("[DB-PING] Fallo:", e.message);
      res.json({ ok: false, error: e.message });
    }
  });

  return router;
}

// crearHealthRouter — liveness/readiness probe para Kubernetes.
//
// Deliberadamente NO pasa por requireApiKey (los probes del kubelet no
// mandan X-API-Key) y NO consulta la base de datos: un liveness probe debe
// reflejar si el proceso Node sigue vivo, no si Azure SQL está lento — de lo
// contrario Kubernetes reiniciaría el pod por una lentitud ajena a él.
function crearHealthRouter() {
  const router = express.Router();

  router.get("/healthz", (req, res) => {
    res.json({ status: "ok" });
  });

  return router;
}

module.exports = { crearDiagnosticsRouter, crearHealthRouter };
