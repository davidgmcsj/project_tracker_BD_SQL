"use strict";

// test-server.cjs — Arranca la app Express en un puerto efímero para los tests
// de contrato HTTP.
//
// Por qué existe: server.cjs solo llama a listen() cuando es el punto de
// entrada (require.main === module). Al importarlo desde un test se obtiene la
// app sin puerto abierto, y este helper la monta en el puerto 0 (el SO asigna
// uno libre) para no chocar con el 3002 de desarrollo.
//
// NO toca la base de datos: los tests de contrato verifican el contrato HTTP
// —códigos de estado, forma de la respuesta, orden de los middlewares—, no la
// lógica de negocio. Las rutas que necesitan SQL devolverán 500/503 sin BD, y
// eso es exactamente lo que se afirma en cada caso.

const http = require("http");
const fs   = require("fs");
const path = require("path");

// ── Protección de los datos reales ────────────────────────────────────────────
// server.cjs escribe data.json/history.json en su propio directorio y NO acepta
// una ruta inyectada todavía (eso llega en la Fase 2, con json-store.cjs). Un
// test que llame a POST /api/projects sobrescribe los datos REALES: ya ocurrió
// una vez durante la Fase 0 — un POST con lista vacía dejó data.json en 3
// líneas, borrando los 16 proyectos.
//
// Estas funciones toman una copia antes de arrancar y la restauran al cerrar,
// de modo que ningún test pueda dañar los datos aunque escriba sin querer.

const BACKEND_DIR   = path.join(__dirname, "..", "..");
const ARCHIVOS_DATO = ["data.json", "history.json"];

function respaldarDatos() {
  const copias = new Map();
  for (const nombre of ARCHIVOS_DATO) {
    const ruta = path.join(BACKEND_DIR, nombre);
    if (fs.existsSync(ruta)) copias.set(ruta, fs.readFileSync(ruta));
  }
  return copias;
}

function restaurarDatos(copias) {
  for (const [ruta, contenido] of copias) {
    const actual = fs.existsSync(ruta) ? fs.readFileSync(ruta) : null;
    if (!actual || !actual.equals(contenido)) {
      fs.writeFileSync(ruta, contenido);
      console.warn(`[test] ${path.basename(ruta)} fue modificado por un test y se restauró`);
    }
  }
}

/**
 * Levanta la app en un puerto efímero.
 * @returns {Promise<{ baseUrl, close, api }>}
 */
async function startTestServer() {
  const copiaDatos = respaldarDatos();

  // Se requiere DENTRO de la función para que las variables de entorno que
  // ponga el test (API_KEY, NODE_ENV) ya estén fijadas cuando server.cjs las
  // lea en tiempo de carga del módulo.
  const { app } = require("../../server.cjs");

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  /**
   * fetch con la cabecera X-API-Key ya puesta.
   * @param {string} path  ruta, ej. "/api/projects"
   * @param {object} [opts]  { method, body, headers, apiKey }
   */
  async function api(path, opts = {}) {
    const { body, apiKey, headers = {}, ...rest } = opts;
    const finalHeaders = { ...headers };

    // apiKey: null desactiva la cabecera a propósito (para probar el 401).
    if (apiKey !== null) {
      finalHeaders["X-API-Key"] = apiKey ?? process.env.API_KEY ?? "";
    }
    if (body !== undefined) {
      finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
    }

    return fetch(`${baseUrl}${path}`, {
      ...rest,
      headers: finalHeaders,
      body: body === undefined ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
    });
  }

  const close = () => new Promise(resolve => server.close(() => {
    restaurarDatos(copiaDatos);   // deshace cualquier escritura de los tests
    resolve();
  }));

  return { baseUrl, close, api };
}

module.exports = { startTestServer };
