// api.js — Configuración de acceso al backend. Fuente ÚNICA de API_BASE y de
// la cabecera de autenticación.
//
// Antes, `import.meta.env.VITE_API_URL || ""` estaba repetido en 5 archivos
// (App.jsx dos veces, ReportView.jsx, generateQuarterlyReport.js, storage.js).
// Cada copia era una oportunidad de que una quedara desincronizada al cambiar
// el nombre de la variable o la lógica del valor por defecto.
//
// La mayoría de las llamadas deberían pasar por utils/storage.js, que envuelve
// fetch con manejo de errores. Este módulo existe para los call-sites que
// necesitan controlar la respuesta por su cuenta (AbortSignal, streaming de
// IA, descarga de binarios) y por eso hacen fetch() directo.

// VITE_API_URL define la dirección del backend (ej: http://localhost:3002).
// En desarrollo local se configura en frontend/.env; en producción, en el
// servidor de despliegue. Si no está definida, las llamadas usan rutas
// relativas — funciona cuando frontend y backend comparten host.
export const API_BASE = import.meta.env.VITE_API_URL || "";

// VITE_API_KEY debe coincidir con API_KEY del backend — se envía en el header
// X-API-Key de cada request.
//
// OJO: Vite incrusta esta variable en el bundle que se sirve al navegador, así
// que NO es un secreto: cualquiera puede leerla desde las herramientas de
// desarrollo. Es un filtro contra tráfico automatizado, no un control de
// acceso — la autorización real son las sesiones con cookie httpOnly y el
// rol de administrador (migración 019).
const API_KEY = import.meta.env.VITE_API_KEY || "";

/** Cabecera de autenticación para los call-sites que hacen fetch() directo. */
export function authHeaders() {
  return API_KEY ? { "X-API-Key": API_KEY } : {};
}

/** URL absoluta del backend para una ruta dada. Ej: apiUrl("/api/projects") */
export function apiUrl(path) {
  return `${API_BASE}${path}`;
}
