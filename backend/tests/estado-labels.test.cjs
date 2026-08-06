// estado-labels.test.cjs — translateEstado es pura, sin dependencias externas.
//
//   node --test tests/      (desde backend/)

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { translateEstado } = require("../reports/estado-labels.cjs");

test("traduce el vocabulario de actividad (not_started/in_progress/completed)", () => {
  assert.equal(translateEstado("estado", "not_started"), "No iniciada");
  assert.equal(translateEstado("estado", "in_progress"), "En proceso");
  assert.equal(translateEstado("estado", "completed"), "Completada");
});

test("traduce el vocabulario de proyecto (on-track/at-risk/blocked/mejora-continua)", () => {
  assert.equal(translateEstado("estado", "on-track"), "En curso");
  assert.equal(translateEstado("estado", "at-risk"), "En riesgo");
  assert.equal(translateEstado("estado", "blocked"), "Bloqueado");
  assert.equal(translateEstado("estado", "mejora-continua"), "Mejora Continua");
});

test("valor desconocido en la columna estado se devuelve tal cual, sin inventar traducción", () => {
  assert.equal(translateEstado("estado", "algo-nuevo"), "algo-nuevo");
});

test("columnas que NO son 'estado' nunca se tocan, aunque el valor coincida con un estado conocido", () => {
  assert.equal(translateEstado("actividad", "completed"), "completed");
  assert.equal(translateEstado("tipo", "in_progress"), "in_progress");
});

test("null/undefined pasan intactos", () => {
  assert.equal(translateEstado("estado", null), null);
  assert.equal(translateEstado("estado", undefined), undefined);
});
