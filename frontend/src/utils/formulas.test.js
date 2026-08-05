// formulas.test.js — funciones de cálculo puras de formulas.js.
//
//   node --test src/utils/formulas.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectProgress, globalProgress, businessDaysBetween, suggestedWorkHours } from "./formulas.js";

// ── projectProgress ───────────────────────────────────────────────────────────

test("projectProgress con total 0 devuelve 0 en vez de dividir por cero", () => {
  assert.equal(projectProgress(0, 0, 0), 0);
});

test("projectProgress con total negativo/undefined también devuelve 0", () => {
  assert.equal(projectProgress(-5, 0, 0), 0);
  assert.equal(projectProgress(undefined, 0, 0), 0);
});

test("projectProgress cuenta 'en proceso' como medio punto", () => {
  // 4 completadas + 2*0.5 en proceso = 5 de 10 = 50%
  assert.equal(projectProgress(10, 4, 2), 50);
});

test("projectProgress no puede pasar de 100 aunque completadas+enProceso excedan el total", () => {
  // dato inconsistente (más completadas que el total) — el tope de 100 debe sostenerse
  assert.equal(projectProgress(5, 10, 5), 100);
});

test("projectProgress todo completado da exactamente 100", () => {
  assert.equal(projectProgress(8, 8, 0), 100);
});

// ── globalProgress ─────────────────────────────────────────────────────────────

test("globalProgress excluye proyectos sin tareas definidas del promedio", () => {
  const projects = [
    { manual_metrics: { total_tasks: 10, completed_tasks: 10, in_progress_tasks: 0 } }, // 100%
    { manual_metrics: { total_tasks: 0,  completed_tasks: 0,  in_progress_tasks: 0 } },  // excluido
  ];
  assert.equal(globalProgress(projects), 100); // si el vacío contara, bajaría a 50
});

test("globalProgress sin proyectos activos devuelve 0, no NaN", () => {
  assert.equal(globalProgress([]), 0);
  assert.equal(globalProgress([{ manual_metrics: { total_tasks: 0, completed_tasks: 0, in_progress_tasks: 0 } }]), 0);
});

test("globalProgress promedia varios proyectos activos", () => {
  const projects = [
    { manual_metrics: { total_tasks: 10, completed_tasks: 10, in_progress_tasks: 0 } }, // 100%
    { manual_metrics: { total_tasks: 10, completed_tasks: 0,  in_progress_tasks: 0 } },  // 0%
  ];
  assert.equal(globalProgress(projects), 50);
});

// ── businessDaysBetween (festivos de Colombia) ─────────────────────────────────

test("businessDaysBetween sin fechas devuelve 0", () => {
  assert.equal(businessDaysBetween("", "2026-08-10"), 0);
  assert.equal(businessDaysBetween("2026-08-10", ""), 0);
});

test("businessDaysBetween con fin antes que inicio devuelve 0", () => {
  assert.equal(businessDaysBetween("2026-08-10", "2026-08-01"), 0);
});

test("businessDaysBetween misma fecha entre semana cuenta 1 día", () => {
  // 2026-08-03 es lunes
  assert.equal(businessDaysBetween("2026-08-03", "2026-08-03"), 1);
});

test("businessDaysBetween excluye sábado y domingo", () => {
  // lunes 10 a domingo 16 de agosto 2026 (semana sin festivos): 5 días hábiles
  assert.equal(businessDaysBetween("2026-08-10", "2026-08-16"), 5);
});

test("businessDaysBetween excluye el 7 de agosto (Batalla de Boyacá, festivo fijo)", () => {
  // lunes 3 a viernes 7: normalmente 5 días hábiles, pero el 7 es festivo -> 4
  assert.equal(businessDaysBetween("2026-08-03", "2026-08-07"), 4);
});

test("businessDaysBetween excluye festivos móviles cargados para 2026 (ej. 17 de agosto)", () => {
  // lunes 17 a lunes 17 de agosto 2026 está en MOVABLE_HOLIDAYS[2026] -> 0 días hábiles
  assert.equal(businessDaysBetween("2026-08-17", "2026-08-17"), 0);
});

// ── suggestedWorkHours ───────────────────────────────────────────────────────

test("suggestedWorkHours multiplica días hábiles por la jornada", () => {
  // lunes 3 a viernes 7 de agosto: 4 días hábiles (7 es festivo) x 8h = 32h
  assert.equal(suggestedWorkHours("2026-08-03", "2026-08-07"), 32);
});
