// delayCascade.test.js — motor de retraso en cascada cronológico.
//
//   node --test src/utils/delayCascade.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDelayCandidates, buildReferencePatch } from "./delayCascade.js";

// 2026-08-10 es lunes. Sin festivos colombianos en esa semana según el
// calendario duplicado en delayCascade.js (17-ago sí es festivo movible).
function acts() {
  return [
    { id: "ref",  text: "Referencia", start_date: "2026-08-10", due_date: "2026-08-11" }, // lunes-martes
    { id: "same", text: "Termina mismo día", start_date: "2026-08-11", due_date: "2026-08-11" },
    { id: "after", text: "Termina después", start_date: "2026-08-12", due_date: "2026-08-13" },
    { id: "before", text: "Termina antes", start_date: "2026-08-05", due_date: "2026-08-07" },
    { id: "nodate", text: "Sin fecha de fin", start_date: "2026-08-11" },
  ];
}

const taskStatus = { completed: [], in_progress: ["ref", "same", "after", "before"], not_started: [] };

test("computeDelayCandidates incluye actividades que terminan el mismo día o después, excluye las anteriores", () => {
  const candidates = computeDelayCandidates(acts(), taskStatus, "ref", 1);
  const ids = candidates.map(c => c.id).sort();
  assert.deepEqual(ids, ["after", "same"]); // "before" queda fuera, "nodate" no tiene fecha, "ref" es la propia referencia
});

test("computeDelayCandidates excluye actividades completadas", () => {
  const ts = { completed: ["same"], in_progress: ["ref", "after", "before"], not_started: [] };
  const candidates = computeDelayCandidates(acts(), ts, "ref", 1);
  assert.ok(!candidates.some(c => c.id === "same"));
});

test("computeDelayCandidates incluye actividades en ambiente_pruebas/ambiente_produccion (no son 'terminadas')", () => {
  const ts = { completed: [], ambiente_pruebas: ["same"], ambiente_produccion: ["after"], in_progress: ["ref"], not_started: [] };
  const candidates = computeDelayCandidates(acts(), ts, "ref", 1);
  const ids = candidates.map(c => c.id).sort();
  assert.deepEqual(ids, ["after", "same"]);
});

test("computeDelayCandidates desplaza due_date por N días hábiles", () => {
  const candidates = computeDelayCandidates(acts(), taskStatus, "ref", 1);
  const same = candidates.find(c => c.id === "same");
  // 2026-08-11 (martes) + 1 día hábil = 2026-08-12 (miércoles)
  assert.equal(same.newDueDate, "2026-08-12");
});

test("computeDelayCandidates preserva la duración en días hábiles al recalcular start_date", () => {
  const candidates = computeDelayCandidates(acts(), taskStatus, "ref", 1);
  const after = candidates.find(c => c.id === "after");
  // "after": start 08-12 (miércoles), due 08-13 (jueves) = 2 días hábiles de duración.
  // due se mueve a 08-14 (viernes, +1 día hábil). El nuevo start debe seguir
  // dando 2 días hábiles de duración terminando en el nuevo due.
  const start = new Date(after.newStartDate + "T12:00:00");
  const due = new Date(after.newDueDate + "T12:00:00");
  let count = 0;
  const cur = new Date(start);
  while (cur <= due) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  assert.equal(count, 2);
});

test("computeDelayCandidates deja start_date vacío intacto cuando la actividad no tenía inicio", () => {
  const candidates = computeDelayCandidates(
    [
      { id: "ref", text: "Ref", due_date: "2026-08-11" },
      { id: "c1", text: "Sin inicio", due_date: "2026-08-11" },
    ],
    { completed: [] },
    "ref",
    1
  );
  const c1 = candidates.find(c => c.id === "c1");
  assert.equal(c1.newStartDate, "");
});

test("computeDelayCandidates devuelve vacío si la actividad de referencia no tiene due_date", () => {
  const candidates = computeDelayCandidates(
    [{ id: "ref", text: "Sin fin", start_date: "2026-08-10" }],
    taskStatus,
    "ref",
    1
  );
  assert.deepEqual(candidates, []);
});

test("computeDelayCandidates devuelve vacío con days inválido (0, negativo, no entero)", () => {
  assert.deepEqual(computeDelayCandidates(acts(), taskStatus, "ref", 0), []);
  assert.deepEqual(computeDelayCandidates(acts(), taskStatus, "ref", -1), []);
  assert.deepEqual(computeDelayCandidates(acts(), taskStatus, "ref", 1.5), []);
});

test("computeDelayCandidates ordena por currentDueDate ascendente", () => {
  const candidates = computeDelayCandidates(acts(), taskStatus, "ref", 1);
  const dues = candidates.map(c => c.currentDueDate);
  assert.deepEqual(dues, [...dues].sort());
});

// ── buildReferencePatch ────────────────────────────────────────────────────

test("buildReferencePatch desplaza la propia actividad de referencia", () => {
  const patch = buildReferencePatch({ id: "ref", start_date: "2026-08-10", due_date: "2026-08-11" }, 1);
  assert.equal(patch.id, "ref");
  assert.equal(patch.due_date, "2026-08-12");
});

test("buildReferencePatch devuelve null sin due_date o con days inválido", () => {
  assert.equal(buildReferencePatch({ id: "a", start_date: "2026-08-10" }, 1), null);
  assert.equal(buildReferencePatch({ id: "a", due_date: "2026-08-10" }, 0), null);
});
