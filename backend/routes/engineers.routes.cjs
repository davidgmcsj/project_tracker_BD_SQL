"use strict";

// engineers.routes.cjs — Sincronización de ingenieros, colaboradores externos
// y tareas sueltas con Azure SQL. La app trata SQL como caché derivada de
// data.json: cada alta/edición local dispara una llamada aquí para que la
// tabla SQL correspondiente quede al día de inmediato.

const express = require("express");

/**
 * @param {object} deps
 * @param {Function} [deps.syncExternalContactToSQL]
 * @param {Function} [deps.syncEngineerToSQL]
 * @param {Function} [deps.deleteEngineerFromSQL]
 * @param {Function} [deps.syncEngineerTaskToSQL]
 * @param {Function} [deps.deleteEngineerTaskFromSQL]
 * @param {Function} [deps.syncEngineerTasksBatch]
 * @param {Function} deps.errorBody
 * @param {Function} deps.requireAdmin
 */
function crearEngineersRouter({ syncExternalContactToSQL, syncEngineerToSQL, deleteEngineerFromSQL, syncEngineerTaskToSQL, deleteEngineerTaskFromSQL, syncEngineerTasksBatch, errorBody, requireAdmin }) {
  const router = express.Router();

  router.post("/external-contacts/sync-one", async (req, res) => {
    if (!syncExternalContactToSQL) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { contact } = req.body;
      if (!contact?.name) return res.status(400).json({ error: "Falta el nombre del colaborador" });
      const sqlId = await syncExternalContactToSQL(contact);
      res.json({ ok: true, sql_id: sqlId });
    } catch (e) {
      console.error("[SQL] Error sincronizando colaborador externo:", e.message);
      res.status(500).json(errorBody("Error sincronizando colaborador externo", e));
    }
  });

  // Se llama cada vez que se crea/edita/desactiva un ingeniero en la app, para
  // que la tabla Ingenieros de Azure SQL quede al día de inmediato (nombre,
  // cargo, estado). Devuelve el IngenieroID real de SQL para guardarlo en el
  // catálogo local (sql_id).
  //
  // requireAdmin: gestión del catálogo completo (alta/edición de CUALQUIER
  // ingeniero) — mismo criterio que ya oculta la pestaña "Equipo" para
  // no-admin en el frontend, ahora también aplicado en el servidor. NO se
  // aplica a /engineers/tasks/* (tareas sueltas propias) ni a
  // /external-contacts/sync-one — esas sí las usa un ingeniero no-admin
  // sobre sus propios datos (ver EngineerHub "Mi semana" y AssigneeDropdown).
  router.post("/engineers/sync-one", requireAdmin, async (req, res) => {
    if (!syncEngineerToSQL) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { engineer } = req.body;
      if (!engineer?.name) return res.status(400).json({ error: "Falta el ingeniero" });
      const sqlId = await syncEngineerToSQL(engineer);
      res.json({ ok: true, sql_id: sqlId });
    } catch (e) {
      console.error("[SQL] Error sincronizando ingeniero:", e.message);
      res.status(500).json(errorBody("Error sincronizando ingeniero", e));
    }
  });

  // Borrado real del catálogo — a diferencia de "desactivar" (Estado=0 vía
  // sync-one), esto QUITA la fila. El frontend (App.jsx removeEngineer) ya
  // bloqueó el intento si el ingeniero tiene actividades asignadas o un
  // usuario vinculado, pero SQL puede tener sus propias FK (reportes
  // históricos, etc.) que el frontend no ve — si el DELETE falla por eso,
  // se devuelve tal cual para que el admin sepa que hay historial
  // vinculado, en vez de un 500 genérico.
  router.post("/engineers/delete-one", requireAdmin, async (req, res) => {
    if (!deleteEngineerFromSQL) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { sqlId } = req.body;
      if (!sqlId) return res.status(400).json({ error: "Falta el id del ingeniero" });
      await deleteEngineerFromSQL(sqlId);
      res.json({ ok: true });
    } catch (e) {
      console.error("[SQL] Error borrando ingeniero:", e.message);
      const esFK = /REFERENCE|FOREIGN KEY|constraint/i.test(e.message || "");
      const msg = esFK
        ? "No se pudo eliminar: tiene historial vinculado en la base de datos (reportes, actividades). Solo se puede desactivar."
        : "Error borrando ingeniero";
      res.status(esFK ? 409 : 500).json(errorBody(msg, e));
    }
  });

  // Las tareas sueltas no están asociadas a ningún proyecto/reporte, así que
  // viven en su propia tabla (Tareas_Sueltas_Ingeniero), upsert por AppTaskID
  // (el id local "etask_xxx"). Si el ingeniero aún no tiene sql_id (nunca se
  // le había guardado nada en SQL), se crea/resuelve primero.
  router.post("/engineers/tasks/sync-one", async (req, res) => {
    if (!syncEngineerTaskToSQL) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { engineer, task } = req.body;
      if (!engineer?.name || !task?.id) return res.status(400).json({ error: "Falta el ingeniero o la tarea" });

      const engineerSqlId = engineer.sql_id || await syncEngineerToSQL(engineer);
      await syncEngineerTaskToSQL(engineerSqlId, task);
      res.json({ ok: true, sql_id: engineerSqlId });
    } catch (e) {
      console.error("[SQL] Error sincronizando tarea suelta:", e.message);
      res.status(500).json(errorBody("Error sincronizando tarea suelta", e));
    }
  });

  // Reemplaza N peticiones (una por tarea, ver el comentario en
  // syncEngineerTasksBatch) por 1 sola: el frontend manda el array COMPLETO
  // de tareas vigentes del ingeniero + los ids que ya no están (a borrar), y
  // el loop corre del lado del servidor. Mismo criterio best-effort que ya
  // tenía App.jsx cuando hacía esto una por una en el navegador: una tarea
  // que falla no bloquea que las demás se guarden.
  router.post("/engineers/tasks/sync-batch", async (req, res) => {
    if (!syncEngineerTasksBatch) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { engineer, tasks, deletedTaskIds } = req.body;
      if (!engineer?.name || !Array.isArray(tasks)) {
        return res.status(400).json({ error: "Falta el ingeniero o el array de tareas" });
      }
      const engineerSqlId = engineer.sql_id || await syncEngineerToSQL(engineer);
      const result = await syncEngineerTasksBatch(engineerSqlId, tasks, Array.isArray(deletedTaskIds) ? deletedTaskIds : []);
      res.json({ ok: true, sql_id: engineerSqlId, ...result });
    } catch (e) {
      console.error("[SQL] Error sincronizando tareas en lote:", e.message);
      res.status(500).json(errorBody("Error sincronizando tareas en lote", e));
    }
  });

  router.post("/engineers/tasks/delete-one", async (req, res) => {
    if (!deleteEngineerTaskFromSQL) {
      return res.status(503).json({ error: "Módulo de BD no disponible" });
    }
    try {
      const { taskId } = req.body;
      if (!taskId) return res.status(400).json({ error: "Falta el id de la tarea" });
      await deleteEngineerTaskFromSQL(taskId);
      res.json({ ok: true });
    } catch (e) {
      console.error("[SQL] Error borrando tarea suelta:", e.message);
      res.status(500).json(errorBody("Error borrando tarea suelta", e));
    }
  });

  return router;
}

module.exports = { crearEngineersRouter };
