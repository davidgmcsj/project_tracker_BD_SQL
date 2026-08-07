"use strict";

// pool.cjs — Configuración de conexión a Azure SQL y pool compartido.
// Fuente única: antes el objeto de configuración estaba copiado literal en
// db-operations.cjs y en run-migration.cjs, con el riesgo de que divergieran
// (timeouts, tamaño del pool, política de certificado).

require("dotenv/config");
const sql = require("mssql");

/**
 * Construye la configuración de conexión.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.withPool]  incluir la sección `pool` (solo la app la
 *   necesita; el runner de migraciones abre una conexión y termina).
 * @param {boolean} [opts.trustServerCertificate]  forzar la política de
 *   certificado. Por defecto se valida en producción y se confía fuera.
 */
function buildConfig({ withPool = true, trustServerCertificate } = {}) {
  const trust = trustServerCertificate ?? (process.env.NODE_ENV !== "production");
  return {
    user:              process.env.DB_USER,
    password:          process.env.DB_PASSWORD,
    server:            process.env.DB_SERVER || "localhost",
    port:              1433,
    database:          process.env.DB_NAME,
    connectionTimeout: 60000,
    requestTimeout:    60000,
    options:           { encrypt: true, trustServerCertificate: trust },
    ...(withPool ? { pool: { max: 20, min: 0, idleTimeoutMillis: 60000 } } : {}),
  };
}

const config = buildConfig();

let _pool = null;

/**
 * Pool singleton con auto-invalidación: si la conexión falla, se descarta la
 * referencia para que el siguiente llamado reconecte en vez de reutilizar un
 * pool muerto.
 */
async function getPool() {
  if (_pool) return _pool;
  try {
    _pool = await sql.connect(config);
    _pool.on("error", () => { _pool = null; });
  } catch (e) {
    _pool = null;
    throw e;
  }
  return _pool;
}

module.exports = { config, buildConfig, getPool };
