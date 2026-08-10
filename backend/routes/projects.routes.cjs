"use strict";

// projects.routes.cjs — Estado actual de proyectos (data.json).
//
// POST /api/projects es tolerante por diseño: `Array.isArray(req.body?.projects)
// ? ... : []` significa que un cuerpo sin `projects` responde 200 y guarda una
// lista vacía, en vez de rechazar con 400. Comportamiento verificado y
// documentado por un test de contrato (routes-contract.test.cjs) — no es un
// bug, es el contrato tal como está hoy.
//
// El control de versión optimista (expectedVersion) solo se activa cuando el
// llamador lo manda explícitamente — es aditivo, no reemplaza el guardado
// simple que ya usan otros call-sites (autosave de modales, toggles).

const express = require("express");

/**
 * @param {object} deps
 * @param {string} deps.DATA_FILE
 * @param {Function} deps.readJson
 * @param {Function} deps.writeJson
 * @param {Function} [deps.syncActividadesDetalle]
 */
function crearProjectsRouter({ DATA_FILE, readJson, writeJson, syncActividadesDetalle }) {
  const router = express.Router();

  router.get("/", async (req, res) => {
    try {
      res.json(await readJson(DATA_FILE, { projects: [], weekLabel: null }));
    } catch {
      res.status(500).json({ error: "Error leyendo proyectos" });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const incomingProjects = Array.isArray(req.body?.projects) ? req.body.projects : [];
      const changedId        = req.body?.changedProjectId || null;
      const expectedVersion  = req.body?.expectedVersion;

      // Control de versión optimista (Fase 8 — riesgo 10.1): solo se activa
      // cuando el llamador manda expectedVersion. Los call-sites que ya
      // mandaban changedProjectId sin expectedVersion (autosave de modales,
      // toggles del dashboard) siguen guardando sin chequeo, igual que antes
      // — el contrato es aditivo, no reemplaza nada.
      if (changedId && expectedVersion != null) {
        const current = await readJson(DATA_FILE, null);
        const serverProject = current?.projects?.find(p => p.id === changedId);
        const serverVersion = serverProject?.version || 1;
        if (serverProject && serverVersion !== expectedVersion) {
          return res.status(409).json({ error: "conflict", serverProject });
        }
      }

      // Incrementar la versión del proyecto identificado — pasa en CUALQUIER
      // guardado que traiga changedProjectId (no solo los que chequean
      // versión), para que un guardado sin chequeo no deje "invisible" un
      // cambio real y genere un falso negativo en el próximo chequeo.
      const projectsToSave = changedId
        ? incomingProjects.map(p => (p.id === changedId ? { ...p, version: (p.version || 1) + 1 } : p))
        : incomingProjects;

      // savedAt: permite comparar data.json contra el máximo SavedAt de SQL al
      // arrancar (warnIfDataFileStale) sin cambiar el contrato de la respuesta
      // ni la latencia percibida — sigue siendo fire-and-forget hacia SQL.
      await writeJson(DATA_FILE, { ...req.body, projects: projectsToSave, savedAt: new Date().toISOString() });
      const savedVersion = changedId ? projectsToSave.find(p => p.id === changedId)?.version : undefined;
      res.json({ ok: true, version: savedVersion });

      // Sync operacional: solo el proyecto que cambió (identificado por changedProjectId)
      if (syncActividadesDetalle) {
        const toSync = changedId
          ? projectsToSave.filter(p => p.id === changedId)
          : projectsToSave;

        for (const project of toSync) {
          syncActividadesDetalle(project)
            .then(() => console.log(`[SQL] ✓ Actividades sincronizadas — proyecto ${project.id}`))
            .catch(e => {
              console.warn(`[SQL] ⚠ Reintentando sync proyecto ${project.id} en 5s:`, e.message);
              setTimeout(() => {
                syncActividadesDetalle(project)
                  .then(() => console.log(`[SQL] ✓ Actividades sincronizadas (reintento) — proyecto ${project.id}`))
                  .catch(e2 => console.error(`[SQL] ✗ Error definitivo sync proyecto ${project.id}:`, e2.message));
              }, 5000);
            });
        }
      }
    } catch {
      res.status(500).json({ error: "Error guardando proyectos" });
    }
  });

  return router;
}

module.exports = { crearProjectsRouter };
