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
// connectionTimeout/requestTimeout ANTES eran 60s — con eso, una conexión
// "zombi" (Azure la cerró en silencio del lado del servidor, pero el pool no
// se entera y la sigue entregando) hacía que la primera consulta tras un
// rato de inactividad se colgara hasta 1 minuto entero antes de fallar, y el
// usuario tenía que refrescar varias veces para que el navegador cancelara
// esa petición colgada y el backend reintentara con una conexión nueva.
// 15s es tiempo de sobra para una consulta real contra esta base — si algo
// falla de verdad, ahora falla rápido en vez de colgar la pantalla.
function buildConfig({ withPool = true, trustServerCertificate } = {}) {
  const trust = trustServerCertificate ?? (process.env.NODE_ENV !== "production");
  return {
    user:              process.env.DB_USER,
    password:          process.env.DB_PASSWORD,
    server:            process.env.DB_SERVER || "localhost",
    port:              1433,
    database:          process.env.DB_NAME,
    connectionTimeout: 15000,
    requestTimeout:    15000,
    options:           { encrypt: true, trustServerCertificate: trust },
    // min:1 (antes 0) mantiene SIEMPRE al menos una conexión real abierta —
    // sin esto, tras idleTimeoutMillis el pool quedaba en 0 conexiones y la
    // siguiente petición pagaba el costo completo de reconectar desde cero
    // (TCP + TLS + login contra Azure SQL), que es la demora larga que se
    // sentía al volver a la app tras un rato sin usarla.
    ...(withPool ? { pool: { max: 20, min: 1, idleTimeoutMillis: 60000 } } : {}),
  };
}

const config = buildConfig();

let _pool = null;
let _keepAliveTimer = null;

// Mantiene viva la conexión mínima del pool con un SELECT trivial cada 4
// minutos — Azure SQL corta conexiones inactivas más allá de cierto tiempo
// (política del servidor, no configurable desde el driver), y min:1 por sí
// solo no evita que esa única conexión se vuelva "zombi" si nadie la usa
// durante mucho rato. Si el ping falla, se descarta el pool (igual que el
// evento "error") para forzar una reconexión limpia en la siguiente request
// real, en vez de seguir "manteniendo viva" una conexión ya muerta.
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;

function startKeepAlive() {
  if (_keepAliveTimer) return;
  _keepAliveTimer = setInterval(async () => {
    if (!_pool) return;
    try {
      await _pool.request().query("SELECT 1");
    } catch {
      _pool = null;
    }
  }, KEEPALIVE_INTERVAL_MS);
  _keepAliveTimer.unref?.(); // no debe mantener vivo el proceso por sí solo
}

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
    startKeepAlive();
  } catch (e) {
    _pool = null;
    throw e;
  }
  return _pool;
}

module.exports = { config, buildConfig, getPool };
