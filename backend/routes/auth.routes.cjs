"use strict";

// auth.routes.cjs — Login por base de datos, logout, sesión actual.
//
// ⚠️ EL MÁS DELICADO de todos los routers extraídos: de aquí depende req.user,
// que consumen requireAdmin (users.routes.cjs) y reports/index.cjs (autor de
// notas de proyecto). Por eso se movió AL FINAL en el orden de extracción de
// la Fase 2 — cualquier fallo aquí se manifiesta en otros módulos, no en este.
//
// Convive con X-API-Key (requireApiKey, montado en app.cjs sobre TODO /api/*):
// esto agrega identidad real ENCIMA, no la reemplaza. Sin roles todavía en el
// sentido de "solo ciertas rutas": cualquier usuario logueado puede hacer lo
// mismo que ya permite la API_KEY, salvo /api/users/* (requireAdmin).
//
// GET /me NO usa router.use(jsonParser): no tiene body, y POST /login monta su
// propio jsonParser explícito por ruta — el parser genérico de 2 MB (montado
// en app.cjs sobre /api) alcanzaría igual, pero se mantiene explícito para no
// depender de que /api/auth/login pase por ese middleware en un orden dado.

const express = require("express");

/**
 * @param {object} deps
 * @param {import("express").RequestHandler} deps.jsonParser
 * @param {Function} deps.getPool
 * @param {Function} [deps.createSession]
 * @param {Function} [deps.deleteSession]
 * @param {Function} deps.verifyPassword
 * @param {Function} deps.parseCookies
 * @param {string}   deps.SESSION_COOKIE
 * @param {boolean}  deps.isProduction
 * @param {Function} deps.logSecurityEvent
 * @param {Function} deps.errorBody
 */
function crearAuthRouter({ jsonParser, getPool, createSession, deleteSession, verifyPassword, parseCookies, SESSION_COOKIE, isProduction, logSecurityEvent, errorBody }) {
  const router = express.Router();

  router.post("/login", jsonParser, async (req, res) => {
    if (!createSession) return res.status(503).json({ error: "Módulo de autenticación no disponible" });
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Usuario y contraseña son obligatorios" });

    try {
      const pool = await getPool();
      const result = await pool.request()
        .input("usuario", require("mssql").NVarChar(100), String(username).trim())
        .query("SELECT UsuarioID, NombreCompleto, Email, PasswordHash, PasswordSalt, Activo, IngenieroID, EsAdmin FROM Usuarios WHERE NombreUsuario = @usuario");
      const row = result.recordset[0];

      if (!row || !row.Activo || !verifyPassword(password, row.PasswordSalt, row.PasswordHash)) {
        logSecurityEvent("login_failed", req, { username: String(username).slice(0, 100) });
        return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
      }

      const { token, expiraEn } = await createSession(pool, row.UsuarioID);
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true, secure: isProduction, sameSite: "lax", expires: expiraEn, path: "/",
      });
      // Mismos campos que getSessionUser (auth.cjs) — así App.jsx no depende
      // de un segundo round-trip a /api/auth/me para saber si es admin y
      // decidir qué navegación mostrar.
      res.json({
        ok: true,
        user: { name: row.NombreCompleto, email: row.Email || "", ingenieroId: row.IngenieroID ?? null, esAdmin: !!row.EsAdmin },
      });
    } catch (e) {
      console.error("[AUTH] Error en login:", e.message);
      res.status(500).json(errorBody("Error iniciando sesión", e));
    }
  });

  router.post("/logout", async (req, res) => {
    try {
      if (deleteSession) {
        const pool = await getPool();
        const { [SESSION_COOKIE]: token } = parseCookies(req);
        await deleteSession(pool, token);
      }
    } catch (e) {
      console.warn("[AUTH] No se pudo borrar la sesión en BD:", e.message);
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  router.get("/me", (req, res) => {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });
    res.json({ user: req.user });
  });

  return router;
}

module.exports = { crearAuthRouter };
