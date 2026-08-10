"use strict";

// env.cjs — Variables de entorno y validaciones de arranque.
//
// ⚠️ ESTE MÓDULO TIENE EFECTOS AL CARGARSE. Las comprobaciones de producción
// llaman a process.exit(1) durante el require, NO dentro de una función. Es
// deliberado: el servidor debe fallar CERRADO si le faltan FRONTEND_URL o
// API_KEY en producción, antes de aceptar una sola petición.
//
// No convertir esto en una función lazy: si la validación se difiere, el
// servidor arrancaría sin autenticación en producción y solo se descubriría
// al recibir tráfico real.

require("dotenv/config");

const isProduction = process.env.NODE_ENV === "production";

// ── Validaciones que fallan cerrado ───────────────────────────────────────────

if (isProduction && !process.env.FRONTEND_URL) {
  console.error("[FATAL] FRONTEND_URL debe estar definido en producción (NODE_ENV=production).");
  process.exit(1);
}

// Herramienta interna: todos los clientes autorizados comparten la misma clave,
// enviada en el header X-API-Key. No distingue usuarios individuales — de eso
// se encargan las sesiones con cookie (migración 018) y el rol de
// administrador (migración 019).
const API_KEY = process.env.API_KEY || "";

if (!API_KEY) {
  if (isProduction) {
    console.error("[FATAL] API_KEY debe estar definida en producción (NODE_ENV=production).");
    process.exit(1);
  }
  console.warn("[WARN] API_KEY no definida — la API queda sin autenticación (solo aceptable en desarrollo local).");
}

module.exports = {
  isProduction,
  API_KEY,
  PORT:         process.env.PORT || 3002,
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",
};
