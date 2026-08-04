// isoWeek.test.js — Mismas fronteras de año ISO que backend/tests/iso-week.test.cjs.
// La paridad completa (200 fechas cruzadas) se agrega en la fase de pruebas;
// este archivo cubre los casos básicos del lado frontend.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isoWeek, isoWeekNumber, isoYearOf, isoWeekStart, isoWeekEnd, todayISO } from "./isoWeek.js";

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
  assert.equal(isoWeekStart("2026-08-05"), "2026-08-03");
  assert.equal(isoWeekEnd("2026-08-05"), "2026-08-09");
});

test("todayISO devuelve fecha en formato YYYY-MM-DD", () => {
  assert.match(todayISO(), /^\d{4}-\d{2}-\d{2}$/);
});
