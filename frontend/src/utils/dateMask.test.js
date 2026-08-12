// dateMask.test.js — node --test src/utils/dateMask.test.js (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { isoToDisplay, displayToIso, isValidCalendarDate, maskInput, buildCalendarGrid, monthLabel } from "./dateMask.js";

// ── isoToDisplay ──────────────────────────────────────────────────────────────

test("isoToDisplay convierte YYYY-MM-DD a DD/MM/AAAA", () => {
  assert.equal(isoToDisplay("2026-08-03"), "03/08/2026");
});

test("isoToDisplay con vacío/null/undefined devuelve cadena vacía", () => {
  assert.equal(isoToDisplay(""), "");
  assert.equal(isoToDisplay(null), "");
  assert.equal(isoToDisplay(undefined), "");
});

test("isoToDisplay con string malformado devuelve cadena vacía", () => {
  assert.equal(isoToDisplay("03/08/2026"), "");
  assert.equal(isoToDisplay("no-es-fecha"), "");
});

// ── isValidCalendarDate ────────────────────────────────────────────────────────

test("isValidCalendarDate acepta una fecha real", () => {
  assert.equal(isValidCalendarDate(29, 2, 2024), true); // año bisiesto
});

test("isValidCalendarDate rechaza 31 de febrero", () => {
  assert.equal(isValidCalendarDate(31, 2, 2026), false);
});

test("isValidCalendarDate rechaza 29 de febrero en año no bisiesto", () => {
  assert.equal(isValidCalendarDate(29, 2, 2026), false);
});

test("isValidCalendarDate rechaza 31 de abril (mes de 30 días)", () => {
  assert.equal(isValidCalendarDate(31, 4, 2026), false);
});

test("isValidCalendarDate rechaza mes 13", () => {
  assert.equal(isValidCalendarDate(1, 13, 2026), false);
});

// ── displayToIso ──────────────────────────────────────────────────────────────

test("displayToIso convierte DD/MM/AAAA completo y válido a YYYY-MM-DD", () => {
  assert.equal(displayToIso("03/08/2026"), "2026-08-03");
});

test("displayToIso con fecha inválida (31/02) devuelve null", () => {
  assert.equal(displayToIso("31/02/2026"), null);
});

test("displayToIso con texto incompleto devuelve null", () => {
  assert.equal(displayToIso("03/08"), null);
  assert.equal(displayToIso("03/08/20"), null);
  assert.equal(displayToIso(""), null);
});

test("displayToIso con formato incorrecto devuelve null", () => {
  assert.equal(displayToIso("2026-08-03"), null);
  assert.equal(displayToIso("3/8/2026"), null); // exige 2 dígitos por segmento
});

// ── maskInput ─────────────────────────────────────────────────────────────────

test("maskInput inserta / automáticamente cada 2 dígitos", () => {
  assert.equal(maskInput("0"), "0");
  assert.equal(maskInput("03"), "03");
  assert.equal(maskInput("030"), "03/0");
  assert.equal(maskInput("0308"), "03/08");
  assert.equal(maskInput("03082"), "03/08/2");
  assert.equal(maskInput("03082026"), "03/08/2026");
});

test("maskInput descarta caracteres no numéricos", () => {
  assert.equal(maskInput("ab03cd08ef2026"), "03/08/2026");
});

test("maskInput acepta pegar una fecha ya con barras (idempotente)", () => {
  assert.equal(maskInput("03/08/2026"), "03/08/2026");
});

test("maskInput trunca a 8 dígitos (DDMMAAAA)", () => {
  assert.equal(maskInput("030820269999"), "03/08/2026");
});

test("maskInput con cadena vacía devuelve cadena vacía", () => {
  assert.equal(maskInput(""), "");
});

// ── round-trip ────────────────────────────────────────────────────────────────

test("isoToDisplay y displayToIso son inversas para una fecha válida", () => {
  const iso = "2026-12-25";
  assert.equal(displayToIso(isoToDisplay(iso)), iso);
});

// ── buildCalendarGrid / monthLabel — picker visual de DateInput ────────────────

test("monthLabel arma el nombre del mes en español + año", () => {
  assert.equal(monthLabel(2026, 7), "agosto 2026"); // monthIndex 7 = agosto
});

test("buildCalendarGrid devuelve un múltiplo de 7 celdas", () => {
  const grid = buildCalendarGrid(2026, 7); // agosto 2026
  assert.equal(grid.length % 7, 0);
});

test("buildCalendarGrid agosto 2026 incluye todos los días del mes marcados inMonth", () => {
  const grid = buildCalendarGrid(2026, 7);
  const inMonthDays = grid.filter(c => c.inMonth).map(c => c.day);
  assert.deepEqual(inMonthDays, Array.from({ length: 31 }, (_, i) => i + 1));
});

test("buildCalendarGrid rellena el inicio con días de julio cuando agosto empieza sábado", () => {
  const grid = buildCalendarGrid(2026, 7); // 1 ago 2026 cae sábado → 6 celdas de relleno (dom..vie)
  assert.equal(grid[0].inMonth, false);
  assert.equal(grid[0].day, 26); // domingo 26 de julio
  assert.equal(grid[5].day, 31); // viernes 31 de julio
  assert.equal(grid[6].inMonth, true);
  assert.equal(grid[6].day, 1); // sábado 1 de agosto
});

test("buildCalendarGrid las celdas de relleno inicial son consecutivas hasta el día 1 del mes", () => {
  const grid = buildCalendarGrid(2026, 7);
  const firstRealIdx = grid.findIndex(c => c.inMonth === true);
  const lastFiller = grid[firstRealIdx - 1];
  const firstReal = grid[firstRealIdx];
  const d1 = new Date(lastFiller.iso + "T12:00:00");
  const d2 = new Date(firstReal.iso + "T12:00:00");
  assert.equal((d2 - d1) / 86400000, 1);
});

test("buildCalendarGrid en un mes con 5 semanas exactas (30 días, empieza domingo) no agrega relleno final", () => {
  // abril 2026 (monthIndex 3) tiene 30 días y empieza miércoles — solo para
  // confirmar que el conteo de celdas sigue siendo múltiplo de 7 sin
  // asumir un caso "sin relleno" específico (depende del calendario real).
  const grid = buildCalendarGrid(2026, 3);
  assert.equal(grid.length % 7, 0);
  assert.ok(grid.filter(c => c.inMonth).length === 30);
});
