"use strict";

// ai.routes.cjs — Generación de contenido con IA: informe trimestral, status
// semanal por proyecto, status global. Las tres rutas siguen el mismo patrón:
// guardia de módulo disponible, log de inicio/fin, error homogéneo.

const express = require("express");

/**
 * @param {object} deps
 * @param {Function} [deps.generateReportWithAI]
 * @param {Function} [deps.generateStatusSummaryWithAI]
 * @param {Function} [deps.generateGlobalStatusWithAI]
 * @param {Function} deps.errorBody
 */
function crearAiRouter({ generateReportWithAI, generateStatusSummaryWithAI, generateGlobalStatusWithAI, errorBody }) {
  const router = express.Router();

  router.post("/generate-report", async (req, res) => {
    if (!generateReportWithAI) {
      return res.status(503).json({ error: "Módulo de IA no disponible" });
    }
    try {
      const { project, quarterLabel, engineerCatalog } = req.body;
      if (!project) return res.status(400).json({ error: "Falta el proyecto" });

      console.log("[AI] Generando informe para:", project.project_name);
      const analysis = await generateReportWithAI(project, quarterLabel || "", engineerCatalog || []);
      console.log("[AI] Informe generado OK");
      res.json({ ok: true, analysis });
    } catch (e) {
      console.error("[AI] Error generando informe:", e.message);
      res.status(500).json(errorBody("Error generando informe con IA", e));
    }
  });

  router.post("/project-status", async (req, res) => {
    if (!generateStatusSummaryWithAI) {
      return res.status(503).json({ error: "Módulo de IA no disponible" });
    }
    try {
      const { project } = req.body;
      if (!project) return res.status(400).json({ error: "Falta el proyecto" });
      console.log("[AI-STATUS] Generando status para:", project.project_name);
      const status = await generateStatusSummaryWithAI(project);
      console.log("[AI-STATUS] OK");
      res.json({ ok: true, status });
    } catch (e) {
      console.error("[AI-STATUS] Error:", e.message);
      res.status(500).json(errorBody("Error generando status", e));
    }
  });

  router.post("/generate-global-status", async (req, res) => {
    if (!generateGlobalStatusWithAI) {
      return res.status(503).json({ error: "Módulo de IA no disponible" });
    }
    try {
      const { projects, weekLabel, engineerCatalog, mode } = req.body;
      if (!projects?.length) return res.status(400).json({ error: "Sin proyectos para analizar" });
      console.log(`[AI-GLOBAL] Generando status ${mode || "full"} para ${projects.length} proyectos...`);
      const analysis = await generateGlobalStatusWithAI(projects, weekLabel || "", engineerCatalog || [], mode || "full");
      console.log("[AI-GLOBAL] OK");
      res.json({ ok: true, analysis });
    } catch (e) {
      console.error("[AI-GLOBAL] Error:", e.message);
      res.status(500).json(errorBody("Error generando status global", e));
    }
  });

  return router;
}

module.exports = { crearAiRouter };
