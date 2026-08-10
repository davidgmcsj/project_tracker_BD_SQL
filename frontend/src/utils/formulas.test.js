// formulas.test.js — funciones de cálculo puras de formulas.js.
//
//   node --test src/utils/formulas.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { projectProgress, globalProgress, businessDaysBetween, suggestedWorkHours, toISODate, getToday, leafActivities, canMarkCompleted } from "./formulas.js";

// ── toISODate ─────────────────────────────────────────────────────────────────

test("toISODate formatea un Date como YYYY-MM-DD", () => {
  assert.equal(toISODate(new Date("2026-08-06T12:00:00Z")), "2026-08-06");
});

test("toISODate descarta la parte horaria", () => {
  assert.equal(toISODate(new Date("2026-01-31T23:59:59Z")), "2026-01-31");
});

test("toISODate respeta el cambio de año", () => {
  assert.equal(toISODate(new Date("2025-12-31T00:00:00Z")), "2025-12-31");
});

test("getToday devuelve el formato YYYY-MM-DD", () => {
  assert.match(getToday(), /^\d{4}-\d{2}-\d{2}$/);
});

test("getToday coincide con toISODate aplicado a la fecha actual", () => {
  // Fija el contrato entre ambos: getToday es toISODate(new Date()).
  assert.equal(getToday(), toISODate(new Date()));
});

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

// ── leafActivities ────────────────────────────────────────────────────────────
// Un padre con subtareas es un contenedor organizativo, no una unidad de
// trabajo medible: solo las hojas (sin hijos) deben contar en los totales del
// proyecto. Ver EditView.jsx buildAutoMetrics, que consume esta función.

test("leafActivities devuelve todo si no hay jerarquía (comportamiento previo intacto)", () => {
  const acts = [
    { id: "a", parent_id: null },
    { id: "b", parent_id: null },
  ];
  const result = leafActivities(acts);
  assert.equal(result.length, 2);
});

test("leafActivities excluye una actividad que tiene un hijo directo", () => {
  const acts = [
    { id: "padre", parent_id: null },
    { id: "hijo",  parent_id: "padre" },
  ];
  const result = leafActivities(acts);
  assert.deepEqual(result.map(a => a.id), ["hijo"]);
});

test("leafActivities excluye a todos los ancestros en una jerarquía de 3 niveles", () => {
  const acts = [
    { id: "abuelo", parent_id: null },
    { id: "padre",  parent_id: "abuelo" },
    { id: "hijo",   parent_id: "padre" },
  ];
  const result = leafActivities(acts);
  // Solo "hijo" es hoja: ni abuelo ni padre carecen de hijos.
  assert.deepEqual(result.map(a => a.id), ["hijo"]);
});

test("leafActivities cuenta cada hoja de un padre con varios hijos", () => {
  const acts = [
    { id: "padre", parent_id: null },
    { id: "h1",    parent_id: "padre" },
    { id: "h2",    parent_id: "padre" },
  ];
  const result = leafActivities(acts);
  assert.deepEqual(new Set(result.map(a => a.id)), new Set(["h1", "h2"]));
});

test("leafActivities ignora parent_id huérfano (apunta a un id que no existe)", () => {
  // Una referencia rota no debe hacer desaparecer la actividad de los conteos:
  // se trata como hoja porque, para efectos prácticos, no tiene un padre real
  // presente en el array.
  const acts = [{ id: "x", parent_id: "no-existe" }];
  const result = leafActivities(acts);
  assert.deepEqual(result.map(a => a.id), ["x"]);
});

test("leafActivities con array vacío devuelve array vacío", () => {
  assert.deepEqual(leafActivities([]), []);
});

test("leafActivities tolera entrada no-array (null/undefined)", () => {
  assert.deepEqual(leafActivities(null), []);
  assert.deepEqual(leafActivities(undefined), []);
});

// ── canMarkCompleted ──────────────────────────────────────────────────────────
// Un padre no puede marcarse como completado mientras tenga subtareas
// pendientes (no completadas). Bloqueo aplicado en TaskStatusSelector.move()
// de EditView.jsx, la única función que cambia el estado de una actividad.

test("canMarkCompleted permite completar una hoja sin restricciones", () => {
  const acts = [{ id: "a", parent_id: null }];
  assert.equal(canMarkCompleted("a", acts, { completed: [] }), true);
});

test("canMarkCompleted bloquea un padre con una hija no completada", () => {
  const acts = [
    { id: "padre", parent_id: null },
    { id: "hijo",  parent_id: "padre" },
  ];
  assert.equal(canMarkCompleted("padre", acts, { completed: [] }), false);
});

test("canMarkCompleted permite un padre cuando TODAS sus hijas están completadas", () => {
  const acts = [
    { id: "padre", parent_id: null },
    { id: "h1",    parent_id: "padre" },
    { id: "h2",    parent_id: "padre" },
  ];
  assert.equal(canMarkCompleted("padre", acts, { completed: ["h1", "h2"] }), true);
});

test("canMarkCompleted bloquea un padre si SOLO ALGUNAS hijas están completadas", () => {
  const acts = [
    { id: "padre", parent_id: null },
    { id: "h1",    parent_id: "padre" },
    { id: "h2",    parent_id: "padre" },
  ];
  assert.equal(canMarkCompleted("padre", acts, { completed: ["h1"] }), false);
});

test("canMarkCompleted evalúa toda la jerarquía, no solo los hijos directos", () => {
  // abuelo -> padre -> nieto (pendiente). El abuelo también debe bloquearse.
  const acts = [
    { id: "abuelo", parent_id: null },
    { id: "padre",  parent_id: "abuelo" },
    { id: "nieto",  parent_id: "padre" },
  ];
  assert.equal(canMarkCompleted("abuelo", acts, { completed: [] }), false);
  assert.equal(canMarkCompleted("padre", acts, { completed: [] }), false);
});

test("canMarkCompleted permite el abuelo cuando toda la cadena de descendientes está completada", () => {
  const acts = [
    { id: "abuelo", parent_id: null },
    { id: "padre",  parent_id: "abuelo" },
    { id: "nieto",  parent_id: "padre" },
  ];
  assert.equal(canMarkCompleted("abuelo", acts, { completed: ["padre", "nieto"] }), true);
});
