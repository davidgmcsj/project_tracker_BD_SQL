// shared.test.js — transitionActivityStatus (flujo de ambientes de
// despliegue: desarrollo → pruebas → producción).
//
//   node --test src/components/edit/shared.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { transitionActivityStatus } from "./shared.js";

function baseActs() {
  return [{ id: "a", parent_id: null, es_desarrollo: false, assigned_engineers: [] }];
}

// ── Caso base: actividad normal (regresión — mismo comportamiento del antiguo moveTaskStatus) ──

test("transitionActivityStatus mueve una actividad normal de in_progress a completed", () => {
  const acts = baseActs();
  const ts = { in_progress: ["a"], not_started: [], completed: [] };
  const result = transitionActivityStatus(ts, acts, "a", "completed");
  assert.deepEqual(result.taskStatus.completed, ["a"]);
  assert.deepEqual(result.taskStatus.in_progress, []);
  assert.equal(result.newActivities, acts); // sin subtareas de despliegue, el array no cambia
  assert.equal(result.openActivityId, null);
});

test("transitionActivityStatus registra status_history/completed_dates al completar", () => {
  const acts = baseActs();
  const ts = { in_progress: ["a"], not_started: [], completed: [] };
  const result = transitionActivityStatus(ts, acts, "a", "completed");
  assert.ok(result.taskStatus.completed_dates.a);
  assert.ok(result.taskStatus.status_history.a.completed);
});

test("transitionActivityStatus es no-op si hay subtareas normales pendientes", () => {
  const acts = [
    { id: "padre", parent_id: null, es_desarrollo: false },
    { id: "hijo",  parent_id: "padre" },
  ];
  const ts = { in_progress: ["padre"], not_started: ["hijo"], completed: [] };
  const result = transitionActivityStatus(ts, acts, "padre", "completed");
  assert.deepEqual(result.taskStatus, ts);
  assert.equal(result.newActivities, acts);
  assert.equal(result.openActivityId, null);
});

// ── ambiente_pruebas: crea la 1ra subtarea automática ─────────────────────────

test("transitionActivityStatus a ambiente_pruebas crea 'Paso a servidor de pruebas' con deployment_role y abre su tarjeta", () => {
  const acts = [{ id: "padre", parent_id: null, es_desarrollo: true }];
  const ts = { in_progress: ["padre"], not_started: [], completed: [] };
  const result = transitionActivityStatus(ts, acts, "padre", "ambiente_pruebas");

  assert.deepEqual(result.taskStatus.ambiente_pruebas, ["padre"]);
  assert.equal(result.newActivities.length, 2);
  const subtask = result.newActivities.find(a => a.parent_id === "padre");
  assert.ok(subtask);
  assert.equal(subtask.text, "Paso a servidor de pruebas");
  assert.equal(subtask.deployment_role, "test_deploy");
  assert.ok(result.taskStatus.not_started.includes(subtask.id));
  assert.equal(result.openActivityId, subtask.id);
});

test("transitionActivityStatus a ambiente_pruebas es no-op sin es_desarrollo", () => {
  const acts = [{ id: "padre", parent_id: null, es_desarrollo: false }];
  const ts = { in_progress: ["padre"], not_started: [], completed: [] };
  const result = transitionActivityStatus(ts, acts, "padre", "ambiente_pruebas");
  assert.deepEqual(result.taskStatus, ts);
  assert.equal(result.newActivities.length, 1);
  assert.equal(result.openActivityId, null);
});

// ── Cadena completa: test_deploy completado → ambiente_produccion + 2da subtarea ──

test("transitionActivityStatus completando la subtarea test_deploy mueve al padre a ambiente_produccion y crea la 2da subtarea", () => {
  const padre = { id: "padre", parent_id: null, es_desarrollo: true };
  const testDeploy = { id: "sub1", parent_id: "padre", deployment_role: "test_deploy", assigned_engineers: [] };
  const acts = [padre, testDeploy];
  const ts = { ambiente_pruebas: ["padre"], not_started: ["sub1"], in_progress: [], completed: [] };

  const result = transitionActivityStatus(ts, acts, "sub1", "completed");

  assert.deepEqual(result.taskStatus.completed, ["sub1"]);
  assert.deepEqual(result.taskStatus.ambiente_produccion, ["padre"]);
  assert.equal(result.newActivities.length, 3);
  const prodSubtask = result.newActivities.find(a => a.deployment_role === "prod_deploy");
  assert.ok(prodSubtask);
  assert.equal(prodSubtask.text, "Paso a servidor de producción");
  assert.equal(prodSubtask.parent_id, "padre");
  assert.ok(result.taskStatus.not_started.includes(prodSubtask.id));
  assert.equal(result.openActivityId, prodSubtask.id);
});

// ── Cadena completa: prod_deploy completado → completed 100% ─────────────────

test("transitionActivityStatus completando la subtarea prod_deploy mueve al padre a completed con progress 100", () => {
  const padre = { id: "padre", parent_id: null, es_desarrollo: true, progress: 40 };
  const prodDeploy = { id: "sub2", parent_id: "padre", deployment_role: "prod_deploy", assigned_engineers: [] };
  const acts = [padre, prodDeploy];
  const ts = { ambiente_produccion: ["padre"], not_started: ["sub2"], in_progress: [], completed: [] };

  const result = transitionActivityStatus(ts, acts, "sub2", "completed");

  assert.deepEqual(result.taskStatus.completed.sort(), ["padre", "sub2"].sort());
  const updatedParent = result.newActivities.find(a => a.id === "padre");
  assert.equal(updatedParent.progress, 100);
  assert.equal(result.newActivities.length, 2); // no crea ninguna subtarea más
  assert.equal(result.openActivityId, null);
});

// ── Bloqueo: no se puede completar a mano desde un ambiente ───────────────────

test("transitionActivityStatus es no-op al intentar completar a mano desde ambiente_pruebas", () => {
  const acts = [{ id: "padre", parent_id: null, es_desarrollo: true }];
  const ts = { ambiente_pruebas: ["padre"], not_started: [], in_progress: [], completed: [] };
  const result = transitionActivityStatus(ts, acts, "padre", "completed");
  assert.deepEqual(result.taskStatus, ts);
  assert.equal(result.openActivityId, null);
});
