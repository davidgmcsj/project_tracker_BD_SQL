"use strict";

// modules.cjs — Carga defensiva de los módulos opcionales del backend.
//
// Antes eran 4 bloques IIFE try/catch en server.cjs, cada uno con su propia
// lista de nulls escrita a mano. Esa lista YA HABÍA DIVERGIDO: enumeraba 13
// funciones de db-operations pero omitía syncExternalContactToSQL, y por eso
// el handler de /api/external-contacts/sync-one hacía `require()` DENTRO del
// handler, ejecutándose en cada petición.
//
// Aquí se re-exporta el módulo completo en vez de enumerar sus funciones, así
// que agregar una exportación nueva a db-operations.cjs no vuelve a requerir
// tocar esta lista.
//
// Por qué la carga es defensiva: el backend debe poder arrancar y servir las
// rutas que NO dependen de SQL aunque db-operations falle (credenciales mal
// configuradas, driver ausente). Las rutas afectadas responden 503 vía
// requireModulo() en vez de tumbar el proceso entero.

/**
 * Carga un módulo; si falla, registra el error y devuelve `fallback`.
 * @param {string} ruta      ruta del require, ej. "./db-operations.cjs"
 * @param {string} etiqueta  prefijo del log, ej. "DB"
 * @param {*}      fallback  valor a devolver si el require lanza
 */
function cargar(ruta, etiqueta, fallback) {
  try {
    const mod = require(ruta);
    console.log(`[${etiqueta}] ${ruta} cargado correctamente`);
    return mod;
  } catch (e) {
    console.error(`[${etiqueta}] Error cargando ${ruta}:`, e.message);
    return fallback;
  }
}

// Objeto vacío como fallback: cualquier desestructuración da undefined, que es
// exactamente lo que requireModulo() comprueba para responder 503.
const db = cargar("../db-operations.cjs", "DB", {});
const ai = cargar("../gemini-report.cjs", "AI", {});

// auth conserva SESSION_COOKIE incluso si el módulo falla: el nombre de la
// cookie se usa al construir respuestas de logout aunque no haya sesión viva.
const auth = cargar("../auth.cjs", "AUTH", { SESSION_COOKIE: "sid" });

// El router de reports es null (no {}) porque server.cjs comprueba su
// existencia antes de montarlo con app.use.
const reportsRouter = cargar("../reports/index.cjs", "REPORTS", null);

module.exports = { db, ai, auth, reportsRouter };
