// quarter-reset.test.cjs — el reset trimestral es la ÚNICA operación
// irreversible de todo el sistema: una vez archivado, no hay "deshacer"
// desde la app. Es la prueba más urgente del riesgo 10.5.
//
//   node --test tests/      (desde backend/)

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { computeQuarterStats, buildResetProjects } = require("../quarter-reset.cjs");

function fixtureProject(overrides = {}) {
  return {
    id: "proy_1",
    project_name: "Proyecto de prueba",
    activities_identified: [
      { id: "act_done", text: "Completada" },
      { id: "act_wip",  text: "En proceso" },
      { id: "act_new",  text: "No iniciada" },
    ],
    task_status: {
      completed:   ["act_done"],
      in_progress: ["act_wip"],
      not_started: ["act_new"],
      status_history: {
        act_done: { added: "2026-01-01", in_progress: "2026-01-02", completed: "2026-01-03" },
        act_wip:  { added: "2026-01-01", in_progress: "2026-01-02" },
        act_new:  { added: "2026-01-01" },
      },
    },
    manual_metrics: { total_tasks: 3, completed_tasks: 1, in_progress_tasks: 1, shared_tasks_discount: 0 },
    engineers: [{ engineer_id: "eng_1", assigned: 3, completed: 1, in_progress: 1, weekly_total: 5, weekly_detail: ["x"] }],
    weekly_achievements: ["logro"],
    next_week_plan: ["plan"],
    impediments: [{ category: "risk", description: "riesgo" }],
    show_closing_fields: true,
    ...overrides,
  };
}

// ── computeQuarterStats ──────────────────────────────────────────────────────

test("computeQuarterStats cuenta archivadas (completadas) y transferidas (en proceso + no iniciadas)", () => {
  const stats = computeQuarterStats([fixtureProject()]);
  assert.equal(stats.totalArchivadas, 1);
  assert.equal(stats.totalTransferidas, 2);
});

test("computeQuarterStats suma across múltiples proyectos", () => {
  const stats = computeQuarterStats([fixtureProject(), fixtureProject({ id: "proy_2" })]);
  assert.equal(stats.totalArchivadas, 2);
  assert.equal(stats.totalTransferidas, 4);
});

test("computeQuarterStats con proyecto sin task_status no revienta, cuenta cero", () => {
  const stats = computeQuarterStats([{ id: "proy_vacio" }]);
  assert.deepEqual(stats, { totalArchivadas: 0, totalTransferidas: 0 });
});

test("conteo antes = archivadas + transferidas (invariante central del reset)", () => {
  const projects = [fixtureProject(), fixtureProject({ id: "proy_2" })];
  const totalAntes = projects.reduce((s, p) => s + (p.activities_identified || []).length, 0);
  const { totalArchivadas, totalTransferidas } = computeQuarterStats(projects);
  assert.equal(totalAntes, totalArchivadas + totalTransferidas);
});

// ── buildResetProjects ───────────────────────────────────────────────────────

test("archiva la actividad completada: no aparece en el proyecto nuevo", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  const ids = nuevo.activities_identified.map(a => a.id);
  assert.ok(!ids.includes("act_done"), "act_done debía archivarse, no transferirse");
});

test("transfiere intactas las actividades en proceso y no iniciadas", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  const ids = nuevo.activities_identified.map(a => a.id);
  assert.deepEqual(ids.sort(), ["act_new", "act_wip"]);
});

test("task_status.completed queda vacío; in_progress/not_started se preservan", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  assert.deepEqual(nuevo.task_status.completed, []);
  assert.deepEqual(nuevo.task_status.in_progress, ["act_wip"]);
  assert.deepEqual(nuevo.task_status.not_started, ["act_new"]);
});

test("status_history solo conserva las actividades que continúan", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  const hist = nuevo.task_status.status_history;
  assert.ok(!("act_done" in hist), "no debe sobrevivir el historial de la actividad archivada");
  assert.ok("act_wip" in hist);
  assert.ok("act_new" in hist);
});

test("manual_metrics se recalcula sobre las actividades que quedan, no las originales", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  assert.equal(nuevo.manual_metrics.total_tasks, 2);       // act_wip + act_new
  assert.equal(nuevo.manual_metrics.completed_tasks, 0);
  assert.equal(nuevo.manual_metrics.in_progress_tasks, 1); // act_wip
});

test("campos semanales se limpian: logros, plan, impedimentos, cierre", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  assert.deepEqual(nuevo.weekly_achievements, []);
  assert.deepEqual(nuevo.next_week_plan, []);
  assert.deepEqual(nuevo.impediments, []);
  assert.equal(nuevo.show_closing_fields, false);
});

test("ingenieros se resetean a cero pero el catálogo (engineer_id) se conserva", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  assert.equal(nuevo.engineers.length, 1);
  assert.equal(nuevo.engineers[0].engineer_id, "eng_1");
  assert.equal(nuevo.engineers[0].assigned, 0);
  assert.equal(nuevo.engineers[0].completed, 0);
  assert.equal(nuevo.engineers[0].weekly_total, 0);
  assert.deepEqual(nuevo.engineers[0].weekly_detail, []);
});

test("proyecto con TODO completado queda con activities_identified vacío, no revienta", () => {
  const p = fixtureProject({
    activities_identified: [{ id: "act_done", text: "Completada" }],
    task_status: { completed: ["act_done"], in_progress: [], not_started: [], status_history: {} },
  });
  const [nuevo] = buildResetProjects([p]);
  assert.deepEqual(nuevo.activities_identified, []);
  assert.equal(nuevo.manual_metrics.total_tasks, 0);
});

test("proyecto sin ninguna actividad completada: todo se transfiere intacto", () => {
  const p = fixtureProject({
    activities_identified: [{ id: "act_wip", text: "En proceso" }, { id: "act_new", text: "No iniciada" }],
    task_status: { completed: [], in_progress: ["act_wip"], not_started: ["act_new"], status_history: {} },
  });
  const [nuevo] = buildResetProjects([p]);
  assert.equal(nuevo.activities_identified.length, 2);
});

test("otros campos del proyecto (id, project_name) se preservan sin tocar", () => {
  const [nuevo] = buildResetProjects([fixtureProject()]);
  assert.equal(nuevo.id, "proy_1");
  assert.equal(nuevo.project_name, "Proyecto de prueba");
});

test("no muta el array/objetos originales de entrada", () => {
  const original = fixtureProject();
  const originalActsCount = original.activities_identified.length;
  buildResetProjects([original]);
  assert.equal(original.activities_identified.length, originalActsCount);
  assert.deepEqual(original.task_status.completed, ["act_done"]);
});
