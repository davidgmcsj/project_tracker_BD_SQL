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
  normalizeName, parseAssignees, mergePlannerImport, resolveImportedHierarchy,
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

// ── resolveImportedHierarchy ──────────────────────────────────────────────────
// Resuelve la columna opcional "Tarea padre" (parent_planner_number) del Excel
// a un mapa taskNumber → parentTaskNumber|null, detectando referencias rotas y
// ciclos ANTES de que mergePlannerImport cree ninguna actividad — así un Excel
// mal armado no deja huérfanos ni jerarquías circulares a medio aplicar.

function rowsWithParents(pairs) {
  // pairs: [[taskNumber, parentTaskNumber|null], ...]
  return pairs.map(([n, p]) => ({
    planner_task_number: n, parent_planner_number: p, text: `Tarea ${n}`,
    assigneeNames: [], start_date: "", due_date: "", progress: 0,
    planned_hours: 0, status: "not_started", notes_raw: "", _rowIndex: 0,
  }));
}

test("resolveImportedHierarchy resuelve un padre válido", () => {
  const rows = rowsWithParents([["1", null], ["2", "1"]]);
  const { parentByNumber, hierarchyErrors } = resolveImportedHierarchy(rows, true);
  assert.equal(parentByNumber.get("1"), null);
  assert.equal(parentByNumber.get("2"), "1");
  assert.deepEqual(hierarchyErrors, []);
});

test("resolveImportedHierarchy sin columna 'Tarea padre' no reporta errores y no resuelve nada", () => {
  const rows = rowsWithParents([["1", null], ["2", null]]);
  const { parentByNumber, hierarchyErrors, hasParentColumn } = resolveImportedHierarchy(rows, false);
  assert.equal(hasParentColumn, false);
  assert.equal(parentByNumber.size, 0);
  assert.deepEqual(hierarchyErrors, []);
});

test("resolveImportedHierarchy reporta una referencia a tarea padre inexistente", () => {
  const rows = rowsWithParents([["1", "99"]]);
  const { parentByNumber, hierarchyErrors } = resolveImportedHierarchy(rows, true);
  assert.equal(parentByNumber.get("1"), null); // se trata como raíz, no como huérfana
  assert.equal(hierarchyErrors.length, 1);
  assert.match(hierarchyErrors[0], /"1".*"99"/);
});

test("resolveImportedHierarchy detecta un ciclo directo (A es padre de B y B es padre de A)", () => {
  const rows = rowsWithParents([["A", "B"], ["B", "A"]]);
  const { parentByNumber, hierarchyErrors } = resolveImportedHierarchy(rows, true);
  assert.equal(parentByNumber.get("A"), null);
  assert.equal(parentByNumber.get("B"), null);
  assert.equal(hierarchyErrors.length, 1);
  assert.match(hierarchyErrors[0], /[Cc]iclo/);
});

test("resolveImportedHierarchy detecta un ciclo largo (A→B→C→A)", () => {
  const rows = rowsWithParents([["A", "C"], ["B", "A"], ["C", "B"]]);
  const { parentByNumber, hierarchyErrors } = resolveImportedHierarchy(rows, true);
  assert.equal(parentByNumber.get("A"), null);
  assert.equal(parentByNumber.get("B"), null);
  assert.equal(parentByNumber.get("C"), null);
  assert.ok(hierarchyErrors.length >= 1);
});

test("resolveImportedHierarchy no reporta ciclo para una tarea que es su propio padre", () => {
  // Caso trivial de ciclo: taskNumber === parent_planner_number.
  const rows = rowsWithParents([["1", "1"]]);
  const { parentByNumber, hierarchyErrors } = resolveImportedHierarchy(rows, true);
  assert.equal(parentByNumber.get("1"), null);
  assert.equal(hierarchyErrors.length, 1);
});

test("resolveImportedHierarchy permite una jerarquía de 3 niveles sin errores", () => {
  const rows = rowsWithParents([["1", null], ["2", "1"], ["3", "2"]]);
  const { parentByNumber, hierarchyErrors } = resolveImportedHierarchy(rows, true);
  assert.equal(parentByNumber.get("1"), null);
  assert.equal(parentByNumber.get("2"), "1");
  assert.equal(parentByNumber.get("3"), "2");
  assert.deepEqual(hierarchyErrors, []);
});

// ── mergePlannerImport + jerarquía ────────────────────────────────────────────

function rowsFixtureConPadre() {
  return [
    { planner_task_number: "1", parent_planner_number: null, text: "Tarea madre",
      assigneeNames: [], start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 9 },
    { planner_task_number: "2", parent_planner_number: "1", text: "Subtarea de la madre",
      assigneeNames: [], start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 10 },
  ];
}

test("mergePlannerImport asigna parent_id a partir de 'Tarea padre' en una importación nueva", () => {
  const res = mergePlannerImport([], {}, rowsFixtureConPadre(), catalog, createActivity, undefined, true);
  const madre    = res.activities.find(a => a.planner_task_number === "1");
  const subtarea = res.activities.find(a => a.planner_task_number === "2");
  assert.equal(madre.parent_id, null);
  assert.equal(subtarea.parent_id, madre.id);
});

test("mergePlannerImport asigna sequence_order incremental entre hermanas en el orden del Excel", () => {
  const rows = [
    { planner_task_number: "1", parent_planner_number: null, text: "Madre",
      assigneeNames: [], start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 9 },
    { planner_task_number: "2", parent_planner_number: "1", text: "Hija A",
      assigneeNames: [], start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 10 },
    { planner_task_number: "3", parent_planner_number: "1", text: "Hija B",
      assigneeNames: [], start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 11 },
  ];
  const res = mergePlannerImport([], {}, rows, catalog, createActivity, undefined, true);
  const hijaA = res.activities.find(a => a.planner_task_number === "2");
  const hijaB = res.activities.find(a => a.planner_task_number === "3");
  assert.ok(hijaA.sequence_order < hijaB.sequence_order,
    "el orden de aparición en el Excel debe conservarse entre hermanas");
});

test("mergePlannerImport reimportación SIN columna 'Tarea padre' preserva parent_id existentes", () => {
  const first = mergePlannerImport([], {}, rowsFixtureConPadre(), catalog, createActivity, undefined, true);
  // Reimportar las mismas filas pero SIN el flag hasParentColumn (el Excel ya no
  // trae esa columna): los parent_id ya asignados no deben tocarse.
  const rowsSinColumna = rowsFixtureConPadre().map(r => {
    const copia = { ...r };
    delete copia.parent_planner_number;
    return copia;
  });
  const second = mergePlannerImport(first.activities, first.task_status, rowsSinColumna, catalog, createActivity, undefined, false);
  const subtarea = second.activities.find(a => a.planner_task_number === "2");
  const madre    = second.activities.find(a => a.planner_task_number === "1");
  assert.equal(subtarea.parent_id, madre.id, "el parent_id previo debe conservarse intacto");
});

test("mergePlannerImport reimportación CON columna 'Tarea padre' actualiza un cambio de padre", () => {
  const first = mergePlannerImport([], {}, rowsFixtureConPadre(), catalog, createActivity, undefined, true);
  // La tarea 2 ahora aparece sin padre (columna vacía en esa fila) en la reimportación.
  const rowsReasignadas = [
    { planner_task_number: "1", parent_planner_number: null, text: "Tarea madre",
      assigneeNames: [], start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 9 },
    { planner_task_number: "2", parent_planner_number: null, text: "Subtarea de la madre",
      assigneeNames: [], start_date: "", due_date: "", progress: 0, planned_hours: 0,
      status: "not_started", notes_raw: "", _rowIndex: 10 },
  ];
  const second = mergePlannerImport(first.activities, first.task_status, rowsReasignadas, catalog, createActivity, undefined, true);
  const subtarea = second.activities.find(a => a.planner_task_number === "2");
  assert.equal(subtarea.parent_id, null, "vacío en el Excel debe volver la actividad raíz");
});

test("mergePlannerImport nunca asigna parent_id a una actividad manual (sin planner_task_number)", () => {
  const manual = { ...createActivity("Actividad manual"), parent_id: null };
  const res = mergePlannerImport([manual], {}, rowsFixtureConPadre(), catalog, createActivity, undefined, true);
  const manualResultante = res.activities.find(a => a.id === manual.id);
  assert.equal(manualResultante.parent_id, null);
});
