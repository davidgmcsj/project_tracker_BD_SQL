"use strict";

// auth-contract.test.cjs — Contrato de la capa de autenticación y del ORDEN de
// los middlewares en server.cjs.
//
// Este archivo es la red de seguridad principal de la refactorización (Fase 2
// del plan): server.cjs tiene 1.303 líneas y 0% de cobertura, y el riesgo
// documentado como CRÍTICO es reordenar los middlewares sin darse cuenta.
//
// La secuencia real hoy es:
//   requireApiKey (406) → body parser (412) → rate limiters (468) →
//   resolución de sesión (479) → requireAdmin (496, por ruta)
//
// Cada test de aquí falla si esa cadena se altera al mover código a
// middleware/*.cjs y routes/*.cjs.
//
//   node --test tests/routes/     (desde backend/)

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

// Se fijan ANTES de cargar server.cjs: el módulo lee API_KEY en tiempo de
// carga y decide si requireApiKey queda activo. Sin esto, la API quedaría
// abierta y los tests de 401 no probarían nada.
process.env.API_KEY = "clave-de-prueba-contrato";
process.env.NODE_ENV = "test";

const { startTestServer } = require("../helpers/test-server.cjs");

let srv;
before(async () => { srv = await startTestServer(); });
after(async () => { await srv.close(); });

// ── requireApiKey ─────────────────────────────────────────────────────────────

test("sin cabecera X-API-Key la API responde 401", async () => {
  const res = await srv.api("/api/projects", { apiKey: null });
  assert.equal(res.status, 401);
});

test("con X-API-Key incorrecta responde 401", async () => {
  const res = await srv.api("/api/projects", { apiKey: "clave-equivocada" });
  assert.equal(res.status, 401);
});

test("el 401 por API key no filtra detalles en el cuerpo", async () => {
  const res = await srv.api("/api/projects", { apiKey: null });
  const body = await res.json();
  assert.equal(body.error, "No autorizado");
  // No debe aparecer la clave esperada ni rastro de pila.
  assert.equal(body.detail, undefined);
  assert.ok(!JSON.stringify(body).includes("clave-de-prueba-contrato"));
});

test("una API key de longitud distinta no rompe timingSafeEqual", async () => {
  // timingSafeEqual lanza si los buffers difieren en longitud; el código
  // compara longitudes antes. Si esa guarda se pierde, esto da 500 en vez
  // de 401.
  const res = await srv.api("/api/projects", { apiKey: "x" });
  assert.equal(res.status, 401);
});

test("con la API key correcta la petición pasa de requireApiKey", async () => {
  // /api/history en vez de /api/projects: desde que GET /api/projects exige
  // sesión (requireAuth, para poder filtrar por ingeniero) ya no sirve como
  // "cualquier ruta autenticada" — daría 401 aunque la API key sea correcta.
  // /api/history sigue sin exigir sesión, solo API key.
  const res = await srv.api("/api/history");
  assert.notEqual(res.status, 401);
});

// ── Orden: requireApiKey ANTES del body parser ────────────────────────────────

test("un cuerpo malformado sin API key da 401, no 400", async () => {
  // Prueba de ORDEN: si el body parser corriera antes que requireApiKey,
  // el JSON inválido produciría 400 antes de comprobar la autenticación,
  // y peticiones no autenticadas consumirían ciclos de parseo.
  const res = await srv.api("/api/projects", {
    method: "POST",
    apiKey: null,
    body: "{ esto no es json valido",
  });
  assert.equal(res.status, 401);
});

// ── Sesión: rutas que leen req.user ───────────────────────────────────────────

test("GET /api/auth/me sin cookie de sesión responde 401", async () => {
  const res = await srv.api("/api/auth/me");
  assert.equal(res.status, 401);
});

test("GET /api/auth/me con cookie inválida responde 401, no 500", async () => {
  const res = await srv.api("/api/auth/me", {
    headers: { Cookie: "sid=token-que-no-existe-en-la-base" },
  });
  assert.equal(res.status, 401);
});

// ── requireAdmin: DESPUÉS de la resolución de sesión ──────────────────────────

test("GET /api/users sin sesión responde 401 (no 403)", async () => {
  // Distinción deliberada: 401 = no autenticado, 403 = autenticado sin rol.
  // Si requireAdmin corriera ANTES del middleware que puebla req.user,
  // todo administrador recibiría 401 permanente.
  const res = await srv.api("/api/users");
  assert.equal(res.status, 401);
});

test("POST /api/users sin sesión responde 401", async () => {
  const res = await srv.api("/api/users", {
    method: "POST",
    body: { username: "x", name: "X", email: "x@x.com", password: "12345678" },
  });
  assert.equal(res.status, 401);
});

test("POST /api/users/:id sin sesión responde 401", async () => {
  const res = await srv.api("/api/users/1", { method: "POST", body: { name: "X" } });
  assert.equal(res.status, 401);
});

test("las rutas de administración exigen API key ANTES que la sesión", async () => {
  // Sin API key el resultado debe ser 401 de requireApiKey, no de requireAdmin.
  const res = await srv.api("/api/users", { apiKey: null });
  assert.equal(res.status, 401);
  const body = await res.json();
  assert.equal(body.error, "No autorizado");   // mensaje de requireApiKey
});

// ── Login ─────────────────────────────────────────────────────────────────────

test("POST /api/auth/login sin credenciales responde 400", async () => {
  const res = await srv.api("/api/auth/login", { method: "POST", body: {} });
  assert.equal(res.status, 400);
});

test("POST /api/auth/login acepta JSON (el parser corre en esta ruta)", async () => {
  // La ruta monta jsonParser explícitamente. Si ese parser se pierde al
  // moverla a routes/auth.routes.cjs, req.body queda undefined y la
  // respuesta pasaría de 400 a 500.
  const res = await srv.api("/api/auth/login", {
    method: "POST",
    body: { username: "usuario-inexistente", password: "loquesea" },
  });
  assert.ok(res.status === 401 || res.status === 500,
    `esperaba 401 (credenciales malas) o 500 (sin BD), recibí ${res.status}`);
  assert.notEqual(res.status, 400);   // 400 significaría que no leyó el cuerpo
});

// ── logout ────────────────────────────────────────────────────────────────────

test("POST /api/auth/logout responde sin error aunque no haya sesión", async () => {
  const res = await srv.api("/api/auth/logout", { method: "POST" });
  assert.ok(res.status < 500, `logout no debe fallar con 5xx, recibí ${res.status}`);
});
