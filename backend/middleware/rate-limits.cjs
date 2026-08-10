"use strict";

// rate-limits.cjs — Limitadores de tasa por tipo de operación.
//
// Cuatro límites distintos, no uno solo, porque el coste de cada operación es
// muy distinto:
//   - aiLimiter: cada llamada a Gemini/Groq/OpenRouter cuesta dinero real.
//   - destructiveLimiter: cierre de trimestre y limpieza de estadísticas
//     reescriben data.json entero; un bucle accidental haría mucho daño.
//   - authLimiter: bajo a propósito para frenar fuerza bruta sobre el login.
//   - generalLimiter: red de seguridad para el resto de la API.
//
// El ORDEN de montaje importa: generalLimiter va primero sobre todo /api, y
// los específicos se suman encima para sus rutas. Ver montarRateLimits().

const rateLimit = require("express-rate-limit");
const { logSecurityEvent } = require("./security-log.cjs");

// Handler común: registra el evento de seguridad antes de responder con el
// mensaje del limiter.
function rateLimitHandler(event) {
  return (req, res, next, options) => {
    logSecurityEvent(event, req);
    res.status(options.statusCode).json(options.message);
  };
}

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes de generación con IA, intenta de nuevo más tarde" },
  handler: rateLimitHandler("rate_limit_ai_exceeded"),
});

const destructiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas operaciones destructivas, intenta de nuevo más tarde" },
  handler: rateLimitHandler("rate_limit_destructive_exceeded"),
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes, intenta de nuevo más tarde" },
  handler: rateLimitHandler("rate_limit_general_exceeded"),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // login de humanos, no de scripts — bajo a propósito contra fuerza bruta
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiados intentos de inicio de sesión, intenta de nuevo más tarde" },
  handler: rateLimitHandler("rate_limit_auth_exceeded"),
});

/**
 * Monta los cuatro limitadores en el orden correcto.
 * Debe llamarse DESPUÉS de requireApiKey y ANTES de las rutas.
 */
function montarRateLimits(app) {
  app.use("/api", generalLimiter);
  app.use(["/api/generate-report", "/api/project-status", "/api/generate-global-status"], aiLimiter);
  app.use(["/api/quarter-reset", "/api/clean-stats"], destructiveLimiter);
  app.use("/api/auth/login", authLimiter);
}

module.exports = {
  montarRateLimits,
  aiLimiter,
  destructiveLimiter,
  generalLimiter,
  authLimiter,
};
