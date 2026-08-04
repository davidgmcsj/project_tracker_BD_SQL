// iso-week.test.cjs — Fronteras de año ISO 8601.
//
//   node --test tests/      (desde backend/)
//
// El caso que motiva Fase 0: getWeekNumber ya calculaba bien el número de
// semana (algoritmo ISO correcto), pero el año se tomaba del calendario, no
// del año ISO — así que el 1-ene-2027 (viernes) quedaba mal etiquetado.

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { isoWeek, isoWeekNumber, isoYearOf, isoWeekStart, isoWeekEnd, todayISO } = require("../utils.cjs");

test("2026-01-01 (jueves) pertenece a la semana 1 del año ISO 2026", () => {
  assert.equal(isoWeekNumber("2026-01-01"), 1);
  assert.equal(isoYearOf("2026-01-01"), 2026);
  assert.equal(isoWeek("2026-01-01"), "2026-W01");
});

test("2027-01-01 (viernes) pertenece al año ISO 2026, no 2027", () => {
  assert.equal(isoYearOf("2027-01-01"), 2026);
  assert.equal(isoWeek("2027-01-01"), "2026-W53");
});

test("2025-12-29 (lunes) ya pertenece a la semana 1 del año ISO 2026", () => {
  assert.equal(isoYearOf("2025-12-29"), 2026);
  assert.equal(isoWeekNumber("2025-12-29"), 1);
});

test("isoWeekStart/isoWeekEnd delimitan la semana lunes-domingo", () => {
  assert.equal(isoWeekStart("2026-08-05"), "2026-08-03"); // miércoles → lunes de esa semana
  assert.equal(isoWeekEnd("2026-08-05"), "2026-08-09");   // miércoles → domingo de esa semana
});

test("todayISO devuelve fecha en formato YYYY-MM-DD", () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});
