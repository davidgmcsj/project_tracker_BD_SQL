"use strict";

// error-handler.cjs — Construcción de respuestas de error y envoltorio para
// handlers asíncronos.
//
// Resuelve dos duplicaciones medidas en server.cjs (patrones P1 y P2 del plan
// de refactorización):
//   - 20 bloques `try { ... } catch (e) { console.error(...); res.status(500)
//     .json(errorBody(...)) }` escritos a mano, uno por handler.
//   - 14 guardias `if (!fn) return res.status(503).json({ error: "Módulo de
//     BD no disponible" })` con el texto copiado carácter por carácter.

/**
 * Cuerpo de una respuesta de error.
 *
 * El mensaje interno (e.message) solo se incluye FUERA de producción, para no
 * filtrar detalles de SQL o del filesystem a clientes no confiables. El
 * detalle completo siempre queda en el log del servidor vía console.error,
 * sin importar el ambiente.
 */
function errorBody(publicMessage, e) {
  return process.env.NODE_ENV === "production"
    ? { error: publicMessage }
    : { error: publicMessage, detail: e?.message };
}

/**
 * Envuelve un handler async para que cualquier excepción se convierta en un
 * 500 con el cuerpo estándar, en lugar de repetir el try/catch en cada ruta.
 *
 *   app.get("/api/x", asyncHandler("Error leyendo x", async (req, res) => { ... }))
 *
 * @param {string}   publicMessage  mensaje visible para el cliente
 * @param {Function} fn             handler (req, res, next)
 */
function asyncHandler(publicMessage, fn) {
  return async (req, res, next) => {
    try {
      await fn(req, res, next);
    } catch (e) {
      console.error(`[API] ${publicMessage}:`, e.message);
      // Si el handler ya respondió (p. ej. falló al hacer stream de un
      // adjunto), reenviar a Express en vez de intentar un segundo res.json,
      // que lanzaría ERR_HTTP_HEADERS_SENT y ocultaría el error real.
      if (res.headersSent) return next(e);
      res.status(500).json(errorBody(publicMessage, e));
    }
  };
}

/**
 * Guardia para las rutas que dependen de un módulo opcional (db-operations,
 * gemini-report). Si la dependencia no cargó, responde 503 y corta.
 *
 *   if (!requireModulo(saveAttachmentToDB, res)) return;
 *
 * @returns {boolean} true si la dependencia está disponible
 */
function requireModulo(fn, res, mensaje = "Módulo de BD no disponible") {
  if (fn) return true;
  res.status(503).json({ error: mensaje });
  return false;
}

module.exports = { errorBody, asyncHandler, requireModulo };
