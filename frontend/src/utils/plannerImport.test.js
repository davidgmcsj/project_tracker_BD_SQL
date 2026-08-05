// plannerImport.test.js — Tests del motor de importación de Planner.
//
// Usa el runner nativo de Node (sin dependencias extra):
//   node --test src/utils/plannerImport.test.js     (desde frontend/)
//
// Cubre las funciones puras y el merge/sync completo (idempotencia,
// preservación de datos del PMO y archivado de desaparecidas).

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  excelSerialToDate, parseEsfuerzo, parseProgress, bucketToStatus,
  normalizeName, parseAssignees, mergePlannerImport,
} from "./plannerImport.js";
import { createActivity } from "./formulas.js";

// ── excelSerialToDate ─────────────────────────────────────────────────────────

test("excelSerialToDate convierte serial de Planner a ISO", () => {
  assert.equal(excelSerialToDate(46224.375), "2026-07-21");
});

test("excelSerialToDate tolera vacío y nulo sin romper", () => {
  assert.equal(excelSerialToDate(""), "");
  assert.equal(excelSerialToDate(null), "");
  assert.equal(excelSerialToDate("no-numero"), "");
});

// ── parseEsfuerzo ─────────────────────────────────────────────────────────────

test("parseEsfuerzo extrae horas de distintos formatos", () => {
  assert.equal(parseEsfuerzo("24 horas"), 24);
  assert.equal(parseEsfuerzo("8 h"), 8);
  assert.equal(parseEsfuerzo("30,8 horas"), 30.8);
  assert.equal(parseEsfuerzo(12), 12);
  assert.equal(parseEsfuerzo(""), 0);
  assert.equal(parseEsfuerzo("—"), 0);
});

// ── parseProgress ─────────────────────────────────────────────────────────────

test("parseProgress convierte decimal de Planner a 0-100", () => {
  assert.equal(parseProgress(0.16), 16);
  assert.equal(parseProgress(1), 100);
  assert.equal(parseProgress(0), 0);
  assert.equal(parseProgress(""), 0);
  assert.equal(parseProgress("55%"), 55);
});

// ── bucketToStatus ────────────────────────────────────────────────────────────

test("bucketToStatus mapea los depósitos reales de Planner a estado", () => {
  assert.equal(bucketToStatus("Tareas Completadas"), "completed");
  assert.equal(bucketToStatus("Tareas en Ejecución"), "in_progress");
  assert.equal(bucketToStatus("Tareas Identificadas"), "not_started");
  assert.equal(bucketToStatus("Actividades en seguimiento"), "in_progress");
  assert.equal(bucketToStatus("Cualquier otra cosa"), "not_started");
});

test("bucketToStatus conserva compatibilidad con depósitos antiguos 'Actividades'", () => {
  assert.equal(bucketToStatus("Actividades Completadas"), "completed");
  assert.equal(bucketToStatus("Actividades en Ejecución"), "in_progress");
  assert.equal(bucketToStatus("Actividad identificadas "), "not_started");
});

test("bucketToStatus resuelve Reuniones por su % completado", () => {
  assert.equal(bucketToStatus("Reuniones", 100), "completed");
  assert.equal(bucketToStatus("Reuniones", 40), "in_progress");
  assert.equal(bucketToStatus("Reuniones", 0), "not_started");
});

// ── normalizeName ─────────────────────────────────────────────────────────────

test("normalizeName quita tildes, mayúsculas y colapsa espacios", () => {
  assert.equal(normalizeName("Moisés  SUÁREZ Gámez"), "moises suarez gamez");
  assert.equal(normalizeName("  Cristian   Ortegón "), "cristian ortegon");
});

// ── parseAssignees ────────────────────────────────────────────────────────────

test("parseAssignees separa nombres por coma", () => {
  assert.deepEqual(parseAssignees("A Uno, B Dos"), ["A Uno", "B Dos"]);
  assert.deepEqual(parseAssignees(""), []);
});

// ── mergePlannerImport ────────────────────────────────────────────────────────

const catalog = [
  { id: "eng_a", name: "Ana Pérez", active: true },
];

function rowsFixture() {
  return [
    { planner_task_number: "1", text: "Tarea uno (renombrada)", assigneeNames: ["Ana Pérez"],
      start_date: "2026-07-21", due_date: "2026-07-25", progress: 50, planned_hours: 8,
      status: "in_progress", notes_raw: "", _rowIndex: 9 },
    { planner_task_number: "5", text: "Tarea cinco nueva", assigneeNames: ["Carlos Nuevo"],
      start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 10 },
  ];
}

test("mergePlannerImport actualiza existentes, crea nuevas, preserva lo del PMO y archiva desaparecidas", () => {
  // Estado previo: tarea 1 (de Planner, con objetivos del PMO), tarea 9 (de Planner,
  // que ya NO viene en el Excel) y una actividad manual sin número.
  const t1 = { ...createActivity("Tarea uno vieja"), planner_task_number: "1", objectives: "OBJETIVO PMO" };
  const t9 = { ...createActivity("Tarea nueve"), planner_task_number: "9" };
  const manual = { ...createActivity("Actividad manual PMO"), objectives: "MANUAL" };
  const existing = [t1, t9, manual];
  const ts = { completed: [], in_progress: [t1.id], not_started: [t9.id] };

  const res = mergePlannerImport(existing, ts, rowsFixture(), catalog, createActivity);

  // Resumen
  assert.equal(res.summary.created, 1);   // tarea 5
  assert.equal(res.summary.updated, 1);   // tarea 1
  assert.equal(res.summary.archived, 1);  // tarea 9

  // Tarea 1: campos de Planner sobrescritos, objetivos del PMO preservados
  const nt1 = res.activities.find(a => a.planner_task_number === "1");
  assert.equal(nt1.text, "Tarea uno (renombrada)");
  assert.equal(nt1.progress, 50);
  assert.equal(nt1.objectives, "OBJETIVO PMO");
  assert.deepEqual(nt1.assigned_engineers, [{ id: "eng_a", name: "Ana Pérez" }]);

  // Tarea 9: archivada pero conservada (recuperable)
  const nt9 = res.activities.find(a => a.planner_task_number === "9");
  assert.equal(nt9.archived, true);
  assert.ok(nt9.archived_reason.length > 0);

  // Actividad manual: intacta, nunca archivada
  const nm = res.activities.find(a => a.text === "Actividad manual PMO");
  assert.equal(nm.archived, false);
  assert.equal(nm.objectives, "MANUAL");

  // Carlos Nuevo no está en el catálogo → reportado para crear (dedupe)
  assert.equal(res.newEngineersToCreate.length, 1);
  assert.equal(res.newEngineersToCreate[0].name, "Carlos Nuevo");

  // task_status: ids archivados NO aparecen en ningún bucket
  const allBucketIds = [...res.task_status.completed, ...res.task_status.in_progress, ...res.task_status.not_started];
  assert.ok(!allBucketIds.includes(nt9.id));
  // La tarea 1 (in_progress) y la manual sí están
  assert.ok(res.task_status.in_progress.includes(nt1.id));
});

test("mergePlannerImport es idempotente al reimportar el mismo Excel", () => {
  const rows = rowsFixture();
  const first = mergePlannerImport([], {}, rows, catalog, createActivity);
  // Reimportar con el resultado anterior como estado existente
  const second = mergePlannerImport(first.activities, first.task_status, rows, catalog, createActivity,
    new Map([["carlos nuevo", "eng_carlos"]]));
  assert.equal(second.summary.created, 0);
  assert.equal(second.summary.archived, 0);
  assert.equal(second.summary.updated, 2);
  assert.equal(second.activities.length, 2);
});
