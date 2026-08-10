"use strict";

// json-store.cjs — Lectura/escritura de los archivos JSON de datos y
// resolución del directorio donde viven.
//
// ⚠️ SOBRE __dirname: la ruta de datos se ancla al directorio del BACKEND, no
// al de este archivo. Antes esta lógica vivía en server.cjs, donde __dirname
// era backend/; al moverla a backend/lib/ el valor cambiaría y los datos se
// escribirían en backend/lib/data.json. Por eso se sube un nivel con
// path.join(__dirname, "..") en vez de usar __dirname a secas.
//
// El DATA_FILE sigue sin ser inyectable: los tests de contrato no pueden
// apuntarlo a un temporal, y por eso tests/helpers/test-server.cjs respalda y
// restaura los archivos reales. Parametrizarlo es trabajo pendiente — ver el
// límite conocido documentado en la Fase 0 del plan.

const fs   = require("fs").promises;
const path = require("path");

const BACKEND_DIR = path.join(__dirname, "..");

/**
 * Directorio de datos persistentes.
 *
 * En Azure App Service Linux, HOME=/home y /home es el único directorio con
 * escritura persistente entre reinicios. En local, el propio directorio del
 * backend.
 */
function getDataDir() {
  return process.env.HOME === "/home" ? "/home/data" : BACKEND_DIR;
}

const DATA_DIR     = getDataDir();
const DATA_FILE    = path.join(DATA_DIR, "data.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");

/** Lee un JSON; ante cualquier error (inexistente, corrupto) devuelve `fallback`. */
async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

/** Escribe un JSON indentado a 2 espacios. */
async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

module.exports = {
  BACKEND_DIR,
  getDataDir,
  DATA_DIR,
  DATA_FILE,
  HISTORY_FILE,
  readJson,
  writeJson,
};
