// ganttHelpers.test.js — computeDatedRows (filtros compuestos del Gantt:
// estado + tarea padre + alcance).
//
//   node --test src/components/gantt/ganttHelpers.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDatedRows } from "./ganttHelpers.js";

const acts = [
  { id: "p1", parent_id: null, text: "Padre 1", start_date: "2026-01-01" },
  { id: "c1", parent_id: "p1", text: "Hija 1",  start_date: "2026-01-02" },
  { id: "c2", parent_id: "p1", text: "Hija 2",  start_date: "2026-01-03" },
  { id: "g1", parent_id: "c1", text: "Nieta 1", start_date: "2026-01-04" }, // subtarea de 2do nivel
  { id: "p2", parent_id: null, text: "Padre 2", start_date: "2026-01-05" },
  { id: "nodate", parent_id: null, text: "Sin fecha" }, // no debe aparecer nunca
];

const taskStatus = { completed: ["c2"], in_progress: ["c1"], not_started: ["p1", "g1", "p2"] };

test("computeDatedRows sin filtros devuelve todas las actividades con fecha, en orden jerárquico", () => {
  const rows = computeDatedRows(acts, taskStatus, {});
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2", "p2"]);
});

test("computeDatedRows con scope roots devuelve solo raíces", () => {
  const rows = computeDatedRows(acts, taskStatus, { scopeFilter: "roots" });
  assert.deepEqual(rows.map(a => a.id).sort(), ["p1", "p2"]);
});

test("computeDatedRows con parentFilter + scope all devuelve el padre y TODOS sus descendientes (multi-nivel)", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "all" });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2"]);
});

// Bug reportado: "Solo subtareas" con una tarea padre elegida devolvía una
// tabla vacía en vez de las subtareas — walk() arrancaba en parentFilter (un
// id que quedó sin hijos indexados porque el padre se excluyó de `visible`)
// en vez de null (donde childrenOf SÍ cuelga esos hijos huérfanos).
test("computeDatedRows con parentFilter + scope childrenOnly devuelve solo las subtareas, sin la fila del padre", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "childrenOnly" });
  assert.deepEqual(rows.map(a => a.id), ["c1", "g1", "c2"]);
});

test("computeDatedRows con parentFilter + childrenOnly + statusFilter combina los tres", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "childrenOnly", statusFilter: "completed" });
  assert.deepEqual(rows.map(a => a.id), ["c2"]);
});

test("computeDatedRows con statusFilter solo, sin parentFilter", () => {
  const rows = computeDatedRows(acts, taskStatus, { statusFilter: "in_progress" });
  assert.deepEqual(rows.map(a => a.id), ["c1"]);
});

test("computeDatedRows ignora actividades sin start_date ni due_date", () => {
  const rows = computeDatedRows(acts, taskStatus, {});
  assert.ok(!rows.some(a => a.id === "nodate"));
});

test("computeDatedRows con parentFilter cuyo padre no tiene descendientes con fecha devuelve solo el padre (scope all)", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p2", scopeFilter: "all" });
  assert.deepEqual(rows.map(a => a.id), ["p2"]);
});

test("computeDatedRows con parentFilter childrenOnly cuyo padre no tiene descendientes devuelve vacío", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p2", scopeFilter: "childrenOnly" });
  assert.deepEqual(rows, []);
});

test("computeDatedRows con activities vacío/null no lanza", () => {
  assert.deepEqual(computeDatedRows([], taskStatus, {}), []);
  assert.deepEqual(computeDatedRows(null, taskStatus, {}), []);
});

// ── textFilter — búsqueda libre por nombre de actividad ───────────────────────

test("computeDatedRows con textFilter devuelve solo las actividades cuyo texto matchea", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "hija" });
  assert.deepEqual(rows.map(a => a.id).sort(), ["c1", "c2"]);
});

test("computeDatedRows con textFilter es case-insensitive y no rescata al padre", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "NIETA" });
  assert.deepEqual(rows.map(a => a.id), ["g1"]); // p1/c1 (ancestros) no matchean y no aparecen
});

test("computeDatedRows con textFilter vacío no filtra nada (mismo comportamiento que sin filtro)", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "" });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2", "p2"]);
});

test("computeDatedRows combina textFilter con statusFilter", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "hija", statusFilter: "completed" });
  assert.deepEqual(rows.map(a => a.id), ["c2"]);
});
