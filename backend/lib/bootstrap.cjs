"use strict";

// bootstrap.cjs — Inicialización del backend antes de aceptar tráfico.
//
// SQL es la fuente de verdad; data.json es la caché rápida. Si falta o está
// corrupto, se intenta reconstruir desde SQL — antes de esto, un data.json
// ausente en Azure App Service (disco no persistente) arrancaba con un archivo
// vacío y perdía todos los proyectos en silencio.
//
// ⚠️ __dirname: la copia local de respaldo se busca en el directorio del
// BACKEND (BACKEND_DIR de json-store.cjs), no en el de este archivo. Al mover
// init() aquí, un __dirname a secas apuntaría a backend/lib y la copia de
// desarrollo nunca se encontraría.
//
// Las dependencias de SQL se reciben por parámetro porque db-operations.cjs se
// carga de forma defensiva (config/modules.cjs) y puede no estar disponible.

const fs   = require("fs").promises;
const path = require("path");
const {
  BACKEND_DIR, DATA_DIR, DATA_FILE, HISTORY_FILE, readJson, writeJson,
} = require("./json-store.cjs");
const { migrateArrayFields, migrateCommentsAndMilestones } = require("./legacy-migrations.cjs");

/**
 * Construye la función init() con sus dependencias de SQL inyectadas.
 * @param {object} deps
 * @param {Function} [deps.rebuildDataJsonFromSQL]
 * @param {Function} [deps.maxSqlSavedAt]
 */
function crearInit({ rebuildDataJsonFromSQL, maxSqlSavedAt }) {

async function recoverDataFileFromSQL(reason) {
  if (!rebuildDataJsonFromSQL) {
    console.warn(`[INIT] ⚠ data.json ${reason} y el módulo de BD no está disponible — no se puede reconstruir.`);
    return false;
  }
  console.warn(`[INIT] ⚠ data.json ${reason} — intentando reconstruir desde SQL...`);
  try {
    const rebuilt = await rebuildDataJsonFromSQL();
    if (!rebuilt) {
      console.warn("[INIT] ⚠ SQL tampoco tiene datos de respaldo (ReportesSemanales vacía).");
      return false;
    }
    await writeJson(DATA_FILE, rebuilt);
    console.log(`[INIT] ✓ data.json reconstruido desde SQL — ${rebuilt.projects.length} proyectos. El catálogo de ingenieros quedó vacío, se reconstruye solo con el uso.`);
    return true;
  } catch (e) {
    console.error("[INIT] ✗ Falló la reconstrucción desde SQL:", e.message);
    return false;
  }
}

async function warnIfDataFileStale() {
  if (!maxSqlSavedAt) return;
  const data = await readJson(DATA_FILE, null);
  if (!data?.savedAt) return; // archivo previo a esta fase, sin el campo — nada que comparar
  try {
    const maxSql = await maxSqlSavedAt();
    if (maxSql && new Date(maxSql) > new Date(data.savedAt)) {
      console.warn(
        `[INIT] ⚠ data.json (${data.savedAt}) está más viejo que el último guardado en SQL (${new Date(maxSql).toISOString()}). ` +
        `Si esto es inesperado (no un simple redeploy), considera restaurar con POST /api/restore-from-db.`
      );
    }
  } catch (e) {
    console.warn("[INIT] No se pudo comparar data.json contra SQL:", e.message);
  }
}

async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  const existe = await fs.access(DATA_FILE).then(() => true).catch(() => false);
  let corrupto = false;
  if (existe) {
    try { JSON.parse(await fs.readFile(DATA_FILE, "utf-8")); }
    catch { corrupto = true; }
  }

  if (!existe || corrupto) {
    const recuperado = await recoverDataFileFromSQL(corrupto ? "está corrupto" : "no existe");
    if (!recuperado && !existe) {
      // Último recurso: copia de desarrollo local, o arrancar vacío.
      // BACKEND_DIR, no __dirname: este archivo vive en backend/lib, y la
      // copia local de desarrollo está en backend/.
      const localData = path.join(BACKEND_DIR, "data.json");
      try {
        await fs.access(localData);
        await fs.copyFile(localData, DATA_FILE);
        console.log("[INIT] data.json copiado al directorio de datos (copia local de desarrollo)");
      } catch {
        await writeJson(DATA_FILE, { projects: [], weekLabel: null, engineers: [] });
        console.warn("[INIT] ⚠ Arrancando con data.json vacío — no había respaldo en SQL ni copia local.");
      }
    }
    // Si estaba corrupto y no se pudo recuperar, se deja el archivo corrupto tal
    // cual (no se sobreescribe con vacío): readJson() ya cae a su fallback en
    // memoria en cada lectura, y el archivo original queda disponible para
    // revisión o recuperación manual.
  } else {
    await warnIfDataFileStale();
  }

  await migrateArrayFields();
  await migrateCommentsAndMilestones();

  if (!(await readJson(HISTORY_FILE, null))) {
    await writeJson(HISTORY_FILE, { reports: [] });
  }

  console.log(`Datos en: ${DATA_DIR}`);
}

  return init;
}

module.exports = { crearInit };
