// requestCache.test.js — Tests de la caché en memoria + deduplicación de
// peticiones (ver requestCache.js).
//
//   node --test src/utils/requestCache.test.js     (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { withCache, invalidateCache, invalidateCachePrefix, _clearCacheForTests } from "./requestCache.js";

function afterEach() { _clearCacheForTests(); }

// ── withCache: sirve la copia en memoria mientras esté fresca ────────────────

test("withCache llama a fetchFn la primera vez y devuelve su valor", async () => {
  let calls = 0;
  const value = await withCache("k1", async () => { calls++; return "valor"; });
  assert.equal(value, "valor");
  assert.equal(calls, 1);
  afterEach();
});

test("withCache NO vuelve a llamar fetchFn mientras la entrada siga fresca", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return calls; };
  const a = await withCache("k1", fetchFn, 60000);
  const b = await withCache("k1", fetchFn, 60000);
  assert.equal(a, 1);
  assert.equal(b, 1); // sirvió la copia en caché, no volvió a llamar
  assert.equal(calls, 1);
  afterEach();
});

test("withCache vuelve a llamar fetchFn tras expirar el TTL", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return calls; };
  await withCache("k1", fetchFn, 1); // TTL de 1ms
  await new Promise(r => setTimeout(r, 20)); // esperar a que expire
  const b = await withCache("k1", fetchFn, 1);
  assert.equal(b, 2);
  assert.equal(calls, 2);
  afterEach();
});

test("withCache mantiene entradas de distintas keys aisladas entre sí", async () => {
  const a = await withCache("proyecto-A", async () => "notas-A");
  const b = await withCache("proyecto-B", async () => "notas-B");
  assert.equal(a, "notas-A");
  assert.equal(b, "notas-B");
  afterEach();
});

// ── Dedupe: peticiones simultáneas para la MISMA key se enganchan a 1 sola ──

test("withCache deduplica llamadas concurrentes: solo 1 fetchFn real para N llamadas en paralelo", async () => {
  let calls = 0;
  const fetchFn = () => new Promise(resolve => {
    calls++;
    setTimeout(() => resolve("dato"), 20);
  });

  // Simula el fan-out real: 5 componentes montados a la vez piden lo mismo
  // (ej. 5 bloques de proyecto en el historial de un ingeniero).
  const results = await Promise.all([
    withCache("k1", fetchFn),
    withCache("k1", fetchFn),
    withCache("k1", fetchFn),
    withCache("k1", fetchFn),
    withCache("k1", fetchFn),
  ]);

  assert.equal(calls, 1); // una sola petición real salió
  results.forEach(r => assert.equal(r, "dato"));
  afterEach();
});

test("withCache no deduplica keys distintas entre sí (cada una dispara su propia llamada)", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return calls; };
  await Promise.all([
    withCache("proyecto-A", fetchFn),
    withCache("proyecto-B", fetchFn),
    withCache("proyecto-C", fetchFn),
  ]);
  assert.equal(calls, 3);
  afterEach();
});

// ── invalidateCache: fuerza a que la próxima lectura vaya a buscar dato fresco ─

test("invalidateCache hace que la siguiente llamada vuelva a pedir el dato", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return calls; };
  await withCache("k1", fetchFn, 60000);
  invalidateCache("k1");
  const after = await withCache("k1", fetchFn, 60000);
  assert.equal(after, 2);
  assert.equal(calls, 2);
  afterEach();
});

test("invalidateCache sobre una key inexistente no revienta", () => {
  assert.doesNotThrow(() => invalidateCache("nunca-existio"));
});

test("invalidateCache solo afecta la key indicada, no otras", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return calls; };
  await withCache("k1", fetchFn, 60000);
  await withCache("k2", fetchFn, 60000);
  invalidateCache("k1");
  await withCache("k1", fetchFn, 60000); // vuelve a llamar
  await withCache("k2", fetchFn, 60000); // sigue en caché, no vuelve a llamar
  assert.equal(calls, 3); // k1 inicial + k2 inicial + k1 tras invalidar
  afterEach();
});

// ── invalidateCachePrefix: invalida varias keys relacionadas de una vez ──────

test("invalidateCachePrefix invalida todas las keys que empiezan con el prefijo", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; return calls; };
  await withCache("notes:proj1", fetchFn, 60000);
  await withCache("notes:proj2", fetchFn, 60000);
  await withCache("other:thing", fetchFn, 60000);

  invalidateCachePrefix("notes:");

  await withCache("notes:proj1", fetchFn, 60000); // debe volver a llamar
  await withCache("notes:proj2", fetchFn, 60000); // debe volver a llamar
  await withCache("other:thing", fetchFn, 60000); // NO debe volver a llamar

  assert.equal(calls, 5); // 3 iniciales + 2 re-fetch de notes:*
  afterEach();
});

// ── Propagación de errores: un fetchFn que falla no deja la caché corrupta ──

test("si fetchFn lanza error, no se guarda nada en caché y el error se propaga", async () => {
  let calls = 0;
  const fetchFn = async () => { calls++; throw new Error("falló la red"); };

  await assert.rejects(() => withCache("k1", fetchFn), /falló la red/);

  // La siguiente llamada debe reintentar (no quedó una entrada fallida cacheada).
  const fetchFnOk = async () => { calls++; return "ok"; };
  const result = await withCache("k1", fetchFnOk);
  assert.equal(result, "ok");
  assert.equal(calls, 2);
  afterEach();
});

test("un fetchFn que falla no deja una promesa colgada bloqueando llamadas futuras a la misma key", async () => {
  const fetchFnFail = async () => { throw new Error("falló"); };
  await assert.rejects(() => withCache("k1", fetchFnFail));

  // Sin la limpieza de inFlight en el .finally(), esta segunda llamada se
  // quedaría esperando indefinidamente la promesa fallida ya resuelta.
  const fetchFnOk = async () => "recuperado";
  const result = await withCache("k1", fetchFnOk);
  assert.equal(result, "recuperado");
  afterEach();
});
