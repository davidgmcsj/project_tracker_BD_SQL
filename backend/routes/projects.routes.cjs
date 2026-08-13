"use strict";

// projects.routes.cjs — Estado actual de proyectos (data.json).
//
// Control de acceso por ingeniero (no-admin): un ingeniero solo ve/edita
// proyectos donde tiene AL MENOS UNA actividad asignada — evaluado sobre
// `activities_identified[].assigned_engineers`, no hay lista de "miembros
// del proyecto" separada. Dentro de un proyecto autorizado puede editar
// TODO (no solo sus propias actividades) — así el equipo se autogestiona.
//
// ⚠️ Cruce de IDs: `assigned_engineers[].id` usa el id JSON del catálogo
// (`eng_xxx`, en data.json → engineers[]), NO el `sql_id` (columna
// Usuarios.IngenieroID = req.user.ingenieroId que llega de la sesión). Hay
// que traducir sql_id → eng_xxx vía el catálogo antes de poder comparar.
//
// POST /api/projects es tolerante por diseño PARA ADMIN: `Array.isArray(req.body?.projects)
// ? ... : []` significa que un cuerpo sin `projects` responde 200 y guarda una
// lista vacía, en vez de rechazar con 400. Comportamiento verificado y
// documentado por un test de contrato (routes-contract.test.cjs) — no es un
// bug, es el contrato tal como está hoy. Se mantiene intacto para admin.
//
// Para NO-admin el contrato es distinto a propósito: el frontend de un
// ingeniero solo tiene cargado SU subconjunto de proyectos (porque GET ya
// se lo filtró) — si se aplicara el mismo "reemplaza projects con lo que
// mandó el cliente" de admin, un guardado de un ingeniero BORRARÍA todos
// los proyectos que no ve. Por eso el guardado no-admin hace MERGE: solo
// toca, dentro de la copia completa en disco, las entradas cuyo id ya
// estaba autorizado — el resto del array queda intacto.
//
// El control de versión optimista (expectedVersion) solo se activa cuando el
// llamador lo manda explícitamente — es aditivo, no reemplaza el guardado
// simple que ya usan otros call-sites (autosave de modales, toggles).

const express = require("express");

/** Traduce sql_id (Usuarios.IngenieroID, viene de la sesión) al id JSON del
 * catálogo de ingenieros (eng_xxx, el que aparece en assigned_engineers). */
function getEngineerJsonId(engineers, sqlIngenieroId) {
  if (sqlIngenieroId == null) return null;
  const eng = (engineers || []).find(e => e.sql_id === sqlIngenieroId);
  return eng ? eng.id : null;
}

/** IDs de proyecto donde el ingeniero (id JSON) tiene al menos una actividad asignada. */
function getAuthorizedProjectIds(projects, engineerJsonId) {
  const ids = new Set();
  if (!engineerJsonId) return ids;
  for (const project of projects || []) {
    const activities = project.activities_identified || [];
    const tieneAsignacion = activities.some(act =>
      Array.isArray(act.assigned_engineers) &&
      act.assigned_engineers.some(ae => ae.id === engineerJsonId)
    );
    if (tieneAsignacion) ids.add(project.id);
  }
  return ids;
}

/**
 * @param {object} deps
 * @param {string} deps.DATA_FILE
 * @param {Function} deps.readJson
 * @param {Function} deps.writeJson
 * @param {Function} [deps.syncActividadesDetalle]
 * @param {Function} deps.requireAuth
 */
function crearProjectsRouter({ DATA_FILE, readJson, writeJson, syncActividadesDetalle, requireAuth }) {
  const router = express.Router();

  router.get("/", requireAuth, async (req, res) => {
    try {
      const data = await readJson(DATA_FILE, { projects: [], weekLabel: null });
      if (req.user.esAdmin) return res.json(data);

      const engineerJsonId = getEngineerJsonId(data.engineers, req.user.ingenieroId);
      const authorizedIds  = getAuthorizedProjectIds(data.projects, engineerJsonId);
      res.json({ ...data, projects: (data.projects || []).filter(p => authorizedIds.has(p.id)) });
    } catch {
      res.status(500).json({ error: "Error leyendo proyectos" });
    }
  });

  router.post("/", requireAuth, async (req, res) => {
    try {
      if (req.user.esAdmin) return await saveAsAdmin(req, res);
      return await saveAsEngineer(req, res);
    } catch {
      res.status(500).json({ error: "Error guardando proyectos" });
    }
  });

  async function saveAsAdmin(req, res) {
    const incomingProjects = Array.isArray(req.body?.projects) ? req.body.projects : [];
    const changedId        = req.body?.changedProjectId || null;
    const expectedVersion  = req.body?.expectedVersion;

    if (changedId && expectedVersion != null) {
      const current = await readJson(DATA_FILE, null);
      const serverProject = current?.projects?.find(p => p.id === changedId);
      const serverVersion = serverProject?.version || 1;
      if (serverProject && serverVersion !== expectedVersion) {
        return res.status(409).json({ error: "conflict", serverProject });
      }
    }

    const projectsToSave = changedId
      ? incomingProjects.map(p => (p.id === changedId ? { ...p, version: (p.version || 1) + 1 } : p))
      : incomingProjects;

    await writeJson(DATA_FILE, { ...req.body, projects: projectsToSave, savedAt: new Date().toISOString() });
    const savedVersion = changedId ? projectsToSave.find(p => p.id === changedId)?.version : undefined;
    res.json({ ok: true, version: savedVersion });

    syncToSql(changedId ? projectsToSave.filter(p => p.id === changedId) : projectsToSave);
  }

  async function saveAsEngineer(req, res) {
    const current = await readJson(DATA_FILE, { projects: [], engineers: [] });
    const engineerJsonId = getEngineerJsonId(current.engineers, req.user.ingenieroId);
    const authorizedIds  = getAuthorizedProjectIds(current.projects, engineerJsonId);

    const incomingProjects = Array.isArray(req.body?.projects) ? req.body.projects : [];
    const changedId         = req.body?.changedProjectId || null;
    const expectedVersion   = req.body?.expectedVersion;

    if (changedId && !authorizedIds.has(changedId)) {
      return res.status(403).json({ error: "No tienes acceso a este proyecto" });
    }
    if (incomingProjects.some(p => !authorizedIds.has(p.id))) {
      return res.status(403).json({ error: "No tienes acceso a uno o más proyectos enviados" });
    }

    if (changedId && expectedVersion != null) {
      const serverProject = current.projects.find(p => p.id === changedId);
      const serverVersion = serverProject?.version || 1;
      if (serverProject && serverVersion !== expectedVersion) {
        return res.status(409).json({ error: "conflict", serverProject });
      }
    }

    // Merge: solo se tocan, dentro de la copia COMPLETA en disco, las
    // entradas ya autorizadas que el cliente mandó. Todo lo demás (otros
    // proyectos, weekLabel, etc.) queda exactamente igual.
    const incomingById = new Map(incomingProjects.map(p => [p.id, p]));
    const mergedProjects = current.projects.map(p => {
      if (!incomingById.has(p.id)) return p;
      const incoming = incomingById.get(p.id);
      return p.id === changedId ? { ...incoming, version: (incoming.version || p.version || 1) + 1 } : incoming;
    });

    // El catálogo de ingenieros ("Mi semana": tareas adicionales, orden
    // manual de la cola) vive en un array TOP-LEVEL aparte de projects — sin
    // este bloque, un guardado no-admin lo dejaría exactamente igual pase lo
    // que pase en req.body.engineers, y esos cambios se verían aplicados en
    // pantalla pero jamás persistirían en el servidor.
    //
    // Autorización deliberadamente estricta: solo se acepta un cambio sobre
    // el PROPIO registro del ingeniero (engineerJsonId, ya resuelto arriba),
    // y solo en los campos que son autogestión legítima — tasks (tareas
    // adicionales) y orden_ahora/orden_proxima (orden manual de la cola).
    // name/role/active/sql_id siguen siendo terreno exclusivo de "Equipo"
    // (requireAdmin, vía /api/engineers) — un payload que intente tocarlos
    // aquí los ignora en silencio, no da error, para no acoplar este
    // endpoint a devolver detalle de qué campo se rechazó.
    const incomingEngineers = Array.isArray(req.body?.engineers) ? req.body.engineers : [];
    const ownIncoming = engineerJsonId ? incomingEngineers.find(e => e.id === engineerJsonId) : null;
    const mergedEngineers = ownIncoming
      ? (current.engineers || []).map(e => e.id === engineerJsonId
          ? { ...e, tasks: ownIncoming.tasks, orden_ahora: ownIncoming.orden_ahora, orden_proxima: ownIncoming.orden_proxima }
          : e)
      : current.engineers;

    await writeJson(DATA_FILE, { ...current, projects: mergedProjects, engineers: mergedEngineers, savedAt: new Date().toISOString() });
    const savedVersion = changedId ? mergedProjects.find(p => p.id === changedId)?.version : undefined;
    res.json({ ok: true, version: savedVersion });

    syncToSql(mergedProjects.filter(p => incomingById.has(p.id)));
  }

  function syncToSql(projectsToSync) {
    if (!syncActividadesDetalle) return;
    for (const project of projectsToSync) {
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

  return router;
}

module.exports = { crearProjectsRouter, getEngineerJsonId, getAuthorizedProjectIds };
