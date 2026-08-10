"use strict";

// api-key.cjs — Autenticación por clave compartida (header X-API-Key).
//
// Herramienta interna: todos los clientes autorizados usan la misma clave. No
// distingue usuarios individuales — de eso se encargan las sesiones con cookie
// (middleware/session.cjs). Son capas ORTOGONALES: requireApiKey es
// obligatorio en todo /api/*, y la sesión se resuelve encima sin bloquear.
//
// ⚠️ ORDEN CRÍTICO: este middleware debe montarse ANTES del body parser. Si se
// invirtiera, el parser gastaría ciclos deserializando peticiones no
// autorizadas y el límite ampliado de /api/attachments/upload (14 MB) quedaría
// expuesto sin autenticación. Hay un test de contrato que lo verifica:
// "un cuerpo malformado sin API key da 401, no 400".

const crypto = require("crypto");
const { API_KEY } = require("../config/env.cjs");
const { logSecurityEvent } = require("./security-log.cjs");

/**
 * Exige la clave compartida en el header X-API-Key.
 *
 * La comparación usa timingSafeEqual para no filtrar información por tiempo de
 * respuesta. Como timingSafeEqual LANZA si los buffers tienen distinta
 * longitud, se compara la longitud primero — sin esa guarda, una clave de
 * largo distinto produciría un 500 en vez de un 401.
 */
function requireApiKey(req, res, next) {
  // Sin API_KEY configurada la API queda abierta: solo ocurre en desarrollo,
  // porque config/env.cjs aborta el arranque si falta en producción.
  if (!API_KEY) return next();

  const provided = req.headers["x-api-key"] || "";
  const a = Buffer.from(String(provided));
  const b = Buffer.from(API_KEY);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);

  if (!valid) {
    logSecurityEvent("auth_failed", req);
    return res.status(401).json({ error: "No autorizado" });
  }
  next();
}

module.exports = { requireApiKey };
