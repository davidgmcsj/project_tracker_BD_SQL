"use strict";

// users.routes.cjs — Administración de usuarios (migración 019, solo admins).
//
// No hay endpoint de auto-registro (ver backend/scripts/create-user.cjs):
// crear/editar usuarios pasa por requireAdmin, así que solo un admin ya
// logueado puede provisionar cuentas nuevas — no reabre el hueco que
// create-user.cjs documenta evitar.
//
// requireAdmin depende de req.user, poblado por el middleware de sesión que
// se monta en app.cjs ANTES de este router — ver middleware/session.cjs.

const express = require("express");

/**
 * @param {object} deps
 * @param {Function} deps.requireAdmin
 * @param {Function} [deps.listUsers]
 * @param {Function} [deps.createUser]
 * @param {Function} [deps.updateUser]
 * @param {Function} deps.errorBody
 */
function crearUsersRouter({ requireAdmin, listUsers, createUser, updateUser, errorBody }) {
  const router = express.Router();

  router.get("/", requireAdmin, async (req, res) => {
    if (!listUsers) return res.status(503).json({ error: "Módulo de BD no disponible" });
    try {
      res.json(await listUsers());
    } catch (e) {
      console.error("[USERS] Error listando usuarios:", e.message);
      res.status(500).json(errorBody("Error listando usuarios", e));
    }
  });

  router.post("/", requireAdmin, async (req, res) => {
    if (!createUser) return res.status(503).json({ error: "Módulo de BD no disponible" });
    try {
      const id = await createUser(req.body || {});
      res.json({ ok: true, id });
    } catch (e) {
      // Errores de validación (usuario/nombre/contraseña faltante, contraseña
      // corta) vienen de createUser como Error simple — se devuelven tal cual
      // al frontend en vez de un genérico 500, igual que query-builder.cjs.
      const isValidation = /obligatorio|al menos 8 caracteres/.test(e.message);
      if (isValidation) return res.status(400).json({ error: e.message });
      console.error("[USERS] Error creando usuario:", e.message);
      res.status(500).json(errorBody("Error creando usuario", e));
    }
  });

  router.post("/:id", requireAdmin, async (req, res) => {
    if (!updateUser) return res.status(503).json({ error: "Módulo de BD no disponible" });
    try {
      await updateUser(Number(req.params.id), req.body || {});
      res.json({ ok: true });
    } catch (e) {
      const isValidation = /obligatorio|al menos 8 caracteres/.test(e.message);
      if (isValidation) return res.status(400).json({ error: e.message });
      console.error("[USERS] Error actualizando usuario:", e.message);
      res.status(500).json(errorBody("Error actualizando usuario", e));
    }
  });

  return router;
}

module.exports = { crearUsersRouter };
