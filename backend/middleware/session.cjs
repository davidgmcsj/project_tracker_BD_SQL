"use strict";

// session.cjs — Resolución de la sesión por cookie y guardia de rol admin.
//
// Dos piezas con una dependencia de ORDEN estricta entre ellas:
//
//   1. resolverSesion  — puebla req.user leyendo la cookie. NO bloquea: si no
//      hay sesión, req.user queda null y la petición continúa. Se monta sobre
//      todo /api/*, porque varias rutas usan la identidad sin exigirla (por
//      ejemplo, el autor real de una nota de proyecto).
//
//   2. requireAdmin    — LEE req.user. Debe correr DESPUÉS de resolverSesion.
//      Si se invirtiera el orden, req.user siempre sería undefined y TODO
//      administrador recibiría 401 permanente. Hay un test de contrato que lo
//      verifica: "GET /api/users sin sesión responde 401 (no 403)".
//
// La distinción 401/403 es deliberada: 401 = no autenticado (no hay sesión),
// 403 = autenticado pero sin rol suficiente. Un cliente puede reaccionar
// distinto a cada uno (reintentar login vs. mostrar "no tienes permiso").

const { logSecurityEvent } = require("./security-log.cjs");

/**
 * Construye el middleware que resuelve la sesión.
 *
 * Recibe las dependencias por parámetro en vez de importarlas: auth.cjs y
 * db-operations.cjs se cargan de forma defensiva (config/modules.cjs) y pueden
 * no estar disponibles, en cuyo caso este middleware pasa de largo sin
 * bloquear la petición.
 */
function crearResolverSesion({ getPool, getSessionUser, parseCookies, SESSION_COOKIE }) {
  return async function resolverSesion(req, res, next) {
    if (!getSessionUser) return next();
    try {
      const pool = await getPool();
      const { [SESSION_COOKIE]: token } = parseCookies(req);
      req.user = await getSessionUser(pool, token);
    } catch {
      // Una sesión irresoluble (BD caída, cookie corrupta) no debe tumbar la
      // petición: las rutas que exigen identidad ya responden 401 por su cuenta.
      req.user = null;
    }
    next();
  };
}

/** Exige sesión activa con rol de administrador. Debe ir tras resolverSesion. */
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
  if (!req.user.esAdmin) {
    logSecurityEvent("admin_required_denied", req, { userId: req.user.id });
    return res.status(403).json({ error: "Requiere rol de administrador" });
  }
  next();
}

/**
 * Exige sesión activa, sin importar el rol. Base del control de acceso por
 * ingeniero (GET/POST /api/projects) — sin esto req.user podría llegar null
 * y no habría forma de saber a qué proyectos filtrar/autorizar.
 */
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
  next();
}

module.exports = { crearResolverSesion, requireAdmin, requireAuth };
