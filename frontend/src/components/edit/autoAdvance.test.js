// autoAdvance.test.js — autoAdvanceOverdueActivities (transición automática
// de "No iniciada" a "En proceso" cuando start_date ya llegó o pasó).
//
//   node --test src/components/edit/autoAdvance.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { autoAdvanceOverdueActivities } from "./shared.js";
import { getToday } from "../../utils/formulas.js";

function isoOffset(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const TODAY = getToday();
const YESTERDAY = isoOffset(-1);
const TOMORROW = isoOffset(1);

function baseProject(overrides = {}) {
  return {
    id: "p1",
    manual_metrics: { total_tasks: 0, completed_tasks: 0, in_progress_tasks: 0, shared_tasks_discount: 0 },
    activities_identified: [],
    task_status: { completed: [], in_progress: [], not_started: [] },
    ...overrides,
  };
}

test("autoAdvanceOverdueActivities mueve a in_progress una actividad cuyo start_date es HOY", () => {
  const project = baseProject({
    activities_identified: [{ id: "a", parent_id: null, start_date: TODAY, due_date: "", assigned_engineers: [] }],
    task_status: { completed: [], in_progress: [], not_started: ["a"] },
  });
  const { project: next, movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 1);
  assert.deepEqual(next.task_status.in_progress, ["a"]);
  assert.deepEqual(next.task_status.not_started, []);
});

test("autoAdvanceOverdueActivities mueve una actividad cuyo start_date ya PASÓ (ayer)", () => {
  const project = baseProject({
    activities_identified: [{ id: "a", parent_id: null, start_date: YESTERDAY, due_date: "", assigned_engineers: [] }],
    task_status: { completed: [], in_progress: [], not_started: ["a"] },
  });
  const { movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 1);
});

test("autoAdvanceOverdueActivities NO mueve una actividad cuyo start_date es MAÑANA", () => {
  const project = baseProject({
    activities_identified: [{ id: "a", parent_id: null, start_date: TOMORROW, due_date: "", assigned_engineers: [] }],
    task_status: { completed: [], in_progress: [], not_started: ["a"] },
  });
  const { project: next, movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 0);
  assert.equal(next, project); // misma referencia — sin cambios
});

test("autoAdvanceOverdueActivities NO mueve una actividad sin start_date", () => {
  const project = baseProject({
    activities_identified: [{ id: "a", parent_id: null, start_date: "", due_date: "", assigned_engineers: [] }],
    task_status: { completed: [], in_progress: [], not_started: ["a"] },
  });
  const { movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 0);
});

test("autoAdvanceOverdueActivities no toca actividades que ya están en_progress o completed", () => {
  const project = baseProject({
    activities_identified: [
      { id: "a", parent_id: null, start_date: YESTERDAY, assigned_engineers: [] },
      { id: "b", parent_id: null, start_date: YESTERDAY, assigned_engineers: [] },
    ],
    task_status: { completed: ["b"], in_progress: ["a"], not_started: [] },
  });
  const { project: next, movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 0);
  assert.equal(next, project);
});

test("autoAdvanceOverdueActivities mueve varias actividades vencidas a la vez, en un solo paso", () => {
  const project = baseProject({
    activities_identified: [
      { id: "a", parent_id: null, start_date: YESTERDAY, assigned_engineers: [] },
      { id: "b", parent_id: null, start_date: TODAY, assigned_engineers: [] },
      { id: "c", parent_id: null, start_date: TOMORROW, assigned_engineers: [] },
    ],
    task_status: { completed: [], in_progress: [], not_started: ["a", "b", "c"] },
  });
  const { project: next, movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 2);
  assert.deepEqual(next.task_status.in_progress.sort(), ["a", "b"]);
  assert.deepEqual(next.task_status.not_started, ["c"]);
});

test("autoAdvanceOverdueActivities registra status_history.in_progress con la fecha de hoy", () => {
  const project = baseProject({
    activities_identified: [{ id: "a", parent_id: null, start_date: YESTERDAY, assigned_engineers: [] }],
    task_status: { completed: [], in_progress: [], not_started: ["a"] },
  });
  const { project: next } = autoAdvanceOverdueActivities(project);
  assert.equal(next.task_status.status_history.a.in_progress, TODAY);
});

test("autoAdvanceOverdueActivities recalcula manual_metrics.in_progress_tasks", () => {
  const project = baseProject({
    activities_identified: [{ id: "a", parent_id: null, start_date: YESTERDAY, assigned_engineers: [] }],
    task_status: { completed: [], in_progress: [], not_started: ["a"] },
    manual_metrics: { total_tasks: 1, completed_tasks: 0, in_progress_tasks: 0, shared_tasks_discount: 0 },
  });
  const { project: next } = autoAdvanceOverdueActivities(project);
  assert.equal(next.manual_metrics.in_progress_tasks, 1);
  assert.equal(next.manual_metrics.shared_tasks_discount, 0); // preserva campos no recalculados
});

test("autoAdvanceOverdueActivities un padre con subtareas también avanza (no aplica el guard de canMarkCompleted, solo protege completed/ambiente)", () => {
  const project = baseProject({
    activities_identified: [
      { id: "padre", parent_id: null, start_date: YESTERDAY, assigned_engineers: [] },
      { id: "hijo",  parent_id: "padre", start_date: "", assigned_engineers: [] },
    ],
    task_status: { completed: [], in_progress: [], not_started: ["padre", "hijo"] },
  });
  const { project: next, movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 1);
  assert.ok(next.task_status.in_progress.includes("padre"));
  assert.ok(next.task_status.not_started.includes("hijo")); // el hijo no tiene start_date, no se toca
});

test("autoAdvanceOverdueActivities con proyecto sin actividades no lanza y devuelve movedCount 0", () => {
  const project = baseProject();
  const { project: next, movedCount } = autoAdvanceOverdueActivities(project);
  assert.equal(movedCount, 0);
  assert.equal(next, project);
});
