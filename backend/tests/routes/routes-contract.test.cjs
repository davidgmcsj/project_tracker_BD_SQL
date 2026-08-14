"use strict";

// routes-contract.test.cjs — Contrato HTTP de las rutas de server.cjs.
//
// Red de seguridad para mover las 27 rutas a routes/*.cjs (Fase 2 del plan).
// Verifica códigos de estado y forma de la respuesta, NO lógica de negocio:
// si una ruta cambia de sitio y pierde un middleware, un parser o una
// validación, alguno de estos casos falla.
//
// Cubre en particular los tres riesgos que el plan marca como delicados:
//   1. La exclusión del parser genérico para /api/attachments/upload, que se
//      hace comparando req.path exacto y se rompe EN SILENCIO al montar la
//      ruta bajo un prefijo de router.
//   2. La doble defensa contra path traversal en GET /api/quarters/:id.
//   3. Las validaciones de entrada que devuelven 400 y no 500.
//
//   node --test tests/routes/     (desde backend/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

process.env.API_KEY = "clave-de-prueba-contrato";
process.env.NODE_ENV = "test";

const { startTestServer } = require("../helpers/test-server.cjs");

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

// Rutas que requieren SQL: sin base de datos disponible responden 5xx, con
// ella 2xx. Ambas cosas prueban que la ruta EXISTE y pasó los middlewares;
// lo que nunca debe salir es 404 (ruta perdida) ni 401 (auth mal puesta).
function assertRutaViva(res, ruta) {
  assert.notEqual(res.status, 404, `${ruta} devolvió 404: la ruta se perdió`);
  assert.notEqual(res.status, 401, `${ruta} devolvió 401: autenticación mal aplicada`);
}

// ── Proyectos ─────────────────────────────────────────────────────────────────

// GET /api/projects ahora exige sesión (requireAuth), no solo API key —
// necesaria para saber a qué ingeniero filtrar. Sin sesión real (este test
// harness no toca SQL, ver test-server.cjs), el contrato correcto es 401, no
// 200. assertRutaViva no aplica aquí a propósito: 401 es el comportamiento
// esperado, no un error de montaje de ruta.
test("GET /api/projects sin sesión responde 401 (requiere login, filtra por ingeniero)", async () => {
  const res = await srv.api("/api/projects");
  assert.notEqual(res.status, 404, "GET /api/projects devolvió 404: la ruta se perdió");
  assert.equal(res.status, 401);
});

// NOTA sobre POST /api/projects: no se prueba aquí porque ESCRIBE en el
// data.json real (no hay inyección de dependencias para la ruta de datos).
// Su comportamiento comprobado a mano es tolerante por diseño PARA ADMIN: el
// handler hace `Array.isArray(req.body?.projects) ? ... : []`, así que un
// cuerpo sin projects responde 200 y guarda una lista vacía, en vez de
// rechazar con 400. Para no-admin el contrato es distinto (merge autorizado
// por proyecto, ver routes/projects.routes.cjs). Cubrirlo de verdad exige
// parametrizar DATA_FILE — trabajo de la Fase 2, cuando json-store.cjs se
// extraiga como módulo propio.

// ── Historial ─────────────────────────────────────────────────────────────────

test("GET /api/history devuelve la lista de fechas", async () => {
  const res = await srv.api("/api/history");
  assertRutaViva(res, "GET /api/history");
  assert.equal(res.status, 200);
});

test("GET /api/history/:date con fecha inexistente responde 404", async () => {
  const res = await srv.api("/api/history/1999-01-01");
  assert.equal(res.status, 404);
});

// POST /api/report ahora exige rol admin (requireAdmin) — cierra la semana
// del PORTAFOLIO completo, antes solo estaba "protegido" por el botón oculto
// en la UI. Sin sesión, el 401 de requireAdmin corre ANTES que la validación
// de body, así que el contrato pasa de 400 a 401.
test("POST /api/report sin sesión responde 401 (requiere rol admin)", async () => {
  const res = await srv.api("/api/report", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

// ── Adjuntos — la exclusión del body parser ───────────────────────────────────

test("POST /api/attachments/upload sin campos responde 400", async () => {
  // Si al mover esta ruta a un router se pierde attachmentJsonParser, el
  // cuerpo llega sin parsear y la respuesta sería 500 en vez de 400.
  const res = await srv.api("/api/attachments/upload", { method: "POST", body: {} });
  assertRutaViva(res, "POST /api/attachments/upload");
  assert.ok(res.status === 400 || res.status === 503, `recibí ${res.status}`);
});

test("POST /api/attachments/upload acepta cuerpos mayores al límite general", async () => {
  // RIESGO CRÍTICO del plan: el parser genérico limita a 2 MB y excluye esta
  // ruta comparando req.path EXACTO. Al montarla bajo un prefijo de router,
  // req.path pierde el prefijo y la exclusión deja de aplicar en silencio:
  // este cuerpo pasaría a fallar con 413 en vez de llegar al handler.
  const dataBase64 = "A".repeat(3 * 1024 * 1024); // 3 MB — supera el límite genérico
  const res = await srv.api("/api/attachments/upload", {
    method: "POST",
    body: { appAdjuntoID: "t1", appActividadID: "a1", nombre: "x.txt", dataBase64 },
  });
  assert.notEqual(res.status, 413,
    "413 = el parser genérico de 2 MB capturó la ruta; la exclusión se rompió");
});

test("GET /api/attachments/:id inexistente responde 404 con cuerpo JSON", async () => {
  // Aquí el 404 es del HANDLER (adjunto no encontrado en la BD), no de Express
  // por ruta inexistente. Se distinguen por el cuerpo: el del handler trae
  // { error: "Adjunto no encontrado" }; el de Express, HTML.
  const res = await srv.api("/api/attachments/id-inexistente");
  assert.notEqual(res.status, 401, "autenticación mal aplicada");
  assert.ok(res.status === 404 || res.status === 503, `recibí ${res.status}`);
  if (res.status === 404) {
    const body = await res.json();
    assert.equal(body.error, "Adjunto no encontrado",
      "el 404 debe venir del handler, no de Express por ruta perdida");
  }
});

test("POST /api/attachments/delete sin id responde 400", async () => {
  const res = await srv.api("/api/attachments/delete", { method: "POST", body: {} });
  assert.ok(res.status === 400 || res.status === 503, `recibí ${res.status}`);
});

// ── Trimestres — path traversal ───────────────────────────────────────────────

test("GET /api/quarters responde la lista", async () => {
  const res = await srv.api("/api/quarters");
  assertRutaViva(res, "GET /api/quarters");
  assert.equal(res.status, 200);
});

test("GET /api/quarters/:id bloquea path traversal con ../", async () => {
  const res = await srv.api("/api/quarters/..%2F..%2Fdata");
  assert.ok(res.status === 400 || res.status === 404,
    `path traversal debe dar 400/404, recibí ${res.status}`);
});

test("GET /api/quarters/:id bloquea barras y caracteres fuera del charset", async () => {
  for (const id of ["..", "a/b", "a\\b", "../../.env"]) {
    const res = await srv.api(`/api/quarters/${encodeURIComponent(id)}`);
    assert.ok(res.status === 400 || res.status === 404,
      `id "${id}" debería rechazarse, recibí ${res.status}`);
  }
});

test("GET /api/quarters/:id con id válido pero inexistente responde 404", async () => {
  const res = await srv.api("/api/quarters/quarter_Q9_1999");
  assert.ok(res.status === 404 || res.status === 500, `recibí ${res.status}`);
});

// ── Ingenieros y contactos ────────────────────────────────────────────────────

// requireAdmin: gestión del catálogo completo de ingenieros — mismo
// criterio que ya oculta "Equipo" para no-admin en el frontend. Sin sesión
// el 401 de requireAdmin corre ANTES que la validación de body.
test("POST /api/engineers/sync-one sin sesión responde 401 (requiere rol admin)", async () => {
  const res = await srv.api("/api/engineers/sync-one", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

test("POST /api/engineers/delete-one sin sesión responde 401 (requiere rol admin)", async () => {
  const res = await srv.api("/api/engineers/delete-one", { method: "POST", body: {} });
  assert.equal(res.status, 401);
});

test("POST /api/external-contacts/sync-one sin contacto responde 400", async () => {
  // Esta ruta hace require() de db-operations DENTRO del handler (bug latente
  // P3 del plan). Al centralizar la carga de módulos debe seguir respondiendo
  // igual.
  const res = await srv.api("/api/external-contacts/sync-one", { method: "POST", body: {} });
  assert.ok(res.status === 400 || res.status === 503, `recibí ${res.status}`);
});

test("POST /api/engineers/tasks/sync-one sin datos responde 400", async () => {
  const res = await srv.api("/api/engineers/tasks/sync-one", { method: "POST", body: {} });
  assert.ok(res.status === 400 || res.status === 503, `recibí ${res.status}`);
});

test("POST /api/engineers/tasks/delete-one sin id responde 400", async () => {
  const res = await srv.api("/api/engineers/tasks/delete-one", { method: "POST", body: {} });
  assert.ok(res.status === 400 || res.status === 503, `recibí ${res.status}`);
});

// ── Rutas de IA ───────────────────────────────────────────────────────────────

test("POST /api/generate-report existe y no responde 404", async () => {
  const res = await srv.api("/api/generate-report", { method: "POST", body: {} });
  assertRutaViva(res, "POST /api/generate-report");
});

test("POST /api/project-status existe y no responde 404", async () => {
  const res = await srv.api("/api/project-status", { method: "POST", body: {} });
  assertRutaViva(res, "POST /api/project-status");
});

test("POST /api/generate-global-status existe y no responde 404", async () => {
  const res = await srv.api("/api/generate-global-status", { method: "POST", body: {} });
  assertRutaViva(res, "POST /api/generate-global-status");
});

// ── Módulo de Reportes (router montado) ───────────────────────────────────────

test("GET /api/reports/registry responde el catálogo de consultas", async () => {
  // El router de reports se monta con app.use("/api/reports", ...). Si se
  // pierde el montaje, esto da 404.
  const res = await srv.api("/api/reports/registry");
  assertRutaViva(res, "GET /api/reports/registry");
  assert.equal(res.status, 200);
});

test("POST /api/reports/query con consulta inexistente responde 400", async () => {
  const res = await srv.api("/api/reports/query", {
    method: "POST",
    body: { consulta: "consulta_que_no_existe" },
  });
  assert.ok(res.status === 400 || res.status >= 500, `recibí ${res.status}`);
});

test("el router de reports también exige API key", async () => {
  const res = await srv.api("/api/reports/registry", { apiKey: null });
  assert.equal(res.status, 401);
});

// ── Diagnóstico ───────────────────────────────────────────────────────────────

test("GET /api/db-ping responde fuera de producción", async () => {
  // En producción devuelve 404 a propósito. Con NODE_ENV=test debe responder.
  const res = await srv.api("/api/db-ping");
  assert.notEqual(res.status, 401);
});

// ── Rutas inexistentes ────────────────────────────────────────────────────────

test("una ruta que no existe responde 404, no 500", async () => {
  const res = await srv.api("/api/ruta-que-no-existe-en-absoluto");
  assert.equal(res.status, 404);
});
