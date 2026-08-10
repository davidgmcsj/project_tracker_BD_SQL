"use strict";

// security-log.cjs — Log estructurado de eventos de seguridad (CN-015).
//
// Canal aparte del console.log/error operacional del resto del backend: emite
// una línea JSON por evento para que un agregador de logs pueda filtrarlos y
// alertar sobre ellos sin depender del formato de los mensajes normales.
//
// Eventos que se emiten hoy: auth_failed (API key inválida), login_failed
// (credenciales incorrectas) y admin_required_denied (sesión sin rol admin).

/**
 * @param {string} event  nombre del evento, ej. "auth_failed"
 * @param {object} req    request de Express, para ip/ruta/método
 * @param {object} [extra] campos adicionales del evento
 */
function logSecurityEvent(event, req, extra = {}) {
  console.warn(JSON.stringify({
    ts:     new Date().toISOString(),
    event,
    ip:     req.ip || req.socket?.remoteAddress || "unknown",
    path:   req.originalUrl || req.path,
    method: req.method,
    ...extra,
  }));
}

module.exports = { logSecurityEvent };
