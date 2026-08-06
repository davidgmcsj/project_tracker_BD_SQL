// engineers.test.js — Agregación cross-proyecto de tareas por semana para un
// ingeniero (pantalla "mi semana").
//
//   node --test src/utils/engineers.test.js     (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  engineerWeekTasks, engineerNextWeekTasks,
  countLiveWeeklyTasks, getLiveWeekActivitiesInProject, hasLiveWeeklyTasks, countActiveWeeklyTasks,
} from "./engineers.js";

// "Hoy" fijo para todos los tests: miércoles 2026-08-05.
// Semana actual: 2026-08-03 a 2026-08-09. Próxima: 2026-08-10 a 2026-08-16.
const TODAY = new Date("2026-08-05T12:00:00");

function act(id, start, due, engineerId) {
  return {
    id, text: id, start_date: start, due_date: due,
    assigned_engineers: engineerId ? [{ id: engineerId, name: engineerId }] : [],
  };
}

function project(id, name, activities, taskStatus = {}, engineerId = null) {
  return {
    id, project_name: name,
    activities_identified: activities,
    task_status: taskStatus,
    engineers: engineerId ? [{ engineer_id: engineerId }] : [],
  };
}

test("engineerWeekTasks junta tareas de VARIOS proyectos del mismo ingeniero", () => {
  const projects = [
    project("p1", "Proyecto A", [act("a1", "2026-08-04", "2026-08-06", "e1")], {}, "e1"),
    project("p2", "Proyecto B", [act("b1", "2026-08-03", "2026-08-05", "e1")], {}, "e1"),
  ];
  const rows = engineerWeekTasks("e1", projects, TODAY);
  assert.equal(rows.length, 2);
  const names = rows.map(r => r.projectName).sort();
  assert.deepEqual(names, ["Proyecto A", "Proyecto B"]);
});

test("engineerWeekTasks solo incluye proyectos donde el ingeniero participa", () => {
  const projects = [
    project("p1", "Mía",   [act("a1", "2026-08-04", "2026-08-06", "e1")], {}, "e1"),
    project("p2", "Ajena", [act("b1", "2026-08-04", "2026-08-06", "e2")], {}, "e2"),
  ];
  const rows = engineerWeekTasks("e1", projects, TODAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].projectName, "Mía");
});

test("engineerWeekTasks respeta el criterio multi-semana dentro de cada proyecto", () => {
  const projects = [
    project("p1", "Larga", [act("a1", "2026-07-27", "2026-08-14", "e1")], {}, "e1"),
  ];
  const rows = engineerWeekTasks("e1", projects, TODAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].situation, "continues");
});

test("engineerWeekTasks solo cuenta actividades asignadas a ESE ingeniero dentro del proyecto", () => {
  const projects = [
    project("p1", "Compartido", [
      act("mia",  "2026-08-04", "2026-08-06", "e1"),
      act("suya", "2026-08-04", "2026-08-06", "e2"),
    ], {}, "e1"),
  ];
  const rows = engineerWeekTasks("e1", projects, TODAY);
  assert.deepEqual(rows.map(r => r.activity.id), ["mia"]);
});

test("engineerWeekTasks incluye vencidas sin completar de cualquier proyecto", () => {
  const projects = [
    project("p1", "Con demora", [act("vieja", "2026-07-20", "2026-07-24", "e1")], {}, "e1"),
  ];
  const rows = engineerWeekTasks("e1", projects, TODAY);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].situation, "overdue");
});

test("engineerWeekTasks ordena por fecha de entrega across proyectos", () => {
  const projects = [
    project("p1", "Tarde",  [act("t", "2026-08-03", "2026-08-08", "e1")], {}, "e1"),
    project("p2", "Pronto", [act("p", "2026-08-03", "2026-08-04", "e1")], {}, "e1"),
  ];
  const rows = engineerWeekTasks("e1", projects, TODAY);
  assert.deepEqual(rows.map(r => r.activity.id), ["p", "t"]);
});

test("engineerNextWeekTasks usa la semana siguiente, no la actual", () => {
  const projects = [
    project("p1", "A", [act("actual", "2026-08-04", "2026-08-06", "e1")], {}, "e1"),
    project("p2", "B", [act("prox",   "2026-08-11", "2026-08-13", "e1")], {}, "e1"),
  ];
  const rows = engineerNextWeekTasks("e1", projects, TODAY);
  assert.deepEqual(rows.map(r => r.activity.id), ["prox"]);
});

test("engineerNextWeekTasks NO arrastra vencidas de esta semana (includeOverdue:false)", () => {
  const projects = [
    project("p1", "A", [act("vieja", "2026-07-20", "2026-07-24", "e1")], {}, "e1"),
  ];
  const rows = engineerNextWeekTasks("e1", projects, TODAY);
  assert.equal(rows.length, 0);
});

test("sin proyectos asignados devuelve lista vacía", () => {
  assert.deepEqual(engineerWeekTasks("e1", [], TODAY), []);
  assert.deepEqual(engineerNextWeekTasks("e1", [], TODAY), []);
});

// ── countLiveWeeklyTasks / getLiveWeekActivitiesInProject ─────────────────────
// Variante EN VIVO de countActiveWeeklyTasks/getEngineerActivitiesInProject:
// esas leen el campo almacenado weekly_detail (solo se refresca si alguien
// abrió el proyecto en EditView esa semana); estas calculan desde las fechas,
// igual que engineerWeekTasks, para que EngineersView y la vista por
// ingeniero nunca muestren números distintos el mismo día.

test("countLiveWeeklyTasks cuenta en vivo aunque weekly_detail esté vacío", () => {
  const p = project("p1", "Proyecto A", [act("a1", "2026-08-04", "2026-08-06", "e1")], {}, "e1");
  p.engineers[0].weekly_detail = []; // snapshot desactualizado a propósito
  assert.equal(countLiveWeeklyTasks("e1", p, TODAY), 1);
});

test("countLiveWeeklyTasks respeta el criterio multi-semana", () => {
  const p = project("p1", "Larga", [act("a1", "2026-07-27", "2026-08-14", "e1")], {}, "e1");
  assert.equal(countLiveWeeklyTasks("e1", p, TODAY), 1);
});

test("countLiveWeeklyTasks solo cuenta actividades de ESE ingeniero en el proyecto", () => {
  const p = project("p1", "Compartido", [
    act("mia",  "2026-08-04", "2026-08-06", "e1"),
    act("suya", "2026-08-04", "2026-08-06", "e2"),
  ], {}, "e1");
  assert.equal(countLiveWeeklyTasks("e1", p, TODAY), 1);
});

test("countLiveWeeklyTasks coincide con engineerWeekTasks para el mismo ingeniero/proyecto", () => {
  const p = project("p1", "Proyecto A", [
    act("a1", "2026-08-04", "2026-08-06", "e1"),
    act("a2", "2026-07-20", "2026-07-24", "e1"), // vencida, arrastra
  ], {}, "e1");
  const live = countLiveWeeklyTasks("e1", p, TODAY);
  const fromWeekTasks = engineerWeekTasks("e1", [p], TODAY).length;
  assert.equal(live, fromWeekTasks);
});

test("getLiveWeekActivitiesInProject devuelve las mismas actividades que cuenta countLiveWeeklyTasks", () => {
  const p = project("p1", "Proyecto A", [act("a1", "2026-08-04", "2026-08-06", "e1")], {}, "e1");
  const rows = getLiveWeekActivitiesInProject("e1", p, TODAY);
  assert.deepEqual(rows.map(r => r.id), ["a1"]);
  assert.equal(rows.length, countLiveWeeklyTasks("e1", p, TODAY));
});

test("getLiveWeekActivitiesInProject devuelve el mismo shape que getEngineerActivitiesInProject (id, text, position, history)", () => {
  const p = project("p1", "Proyecto A", [act("a1", "2026-08-04", "2026-08-06", "e1")], {
    status_history: { a1: { added: "2026-08-01" } },
  }, "e1");
  const [row] = getLiveWeekActivitiesInProject("e1", p, TODAY);
  assert.deepEqual(row, { id: "a1", text: "a1", position: 1, history: { added: "2026-08-01" } });
});

test("getLiveWeekActivitiesInProject sin actividades esta semana devuelve vacío", () => {
  const p = project("p1", "Proyecto A", [act("futura", "2026-08-17", "2026-08-21", "e1")], {}, "e1");
  assert.deepEqual(getLiveWeekActivitiesInProject("e1", p, TODAY), []);
});

test("hasLiveWeeklyTasks es true cuando hay al menos una actividad en vivo esta semana", () => {
  const p = project("p1", "Proyecto A", [act("a1", "2026-08-04", "2026-08-06", "e1")], {}, "e1");
  p.engineers[0].weekly_detail = []; // snapshot desactualizado, no debe importar
  assert.equal(hasLiveWeeklyTasks("e1", p, TODAY), true);
});

test("hasLiveWeeklyTasks es false sin actividades esta semana", () => {
  const p = project("p1", "Proyecto A", [act("futura", "2026-08-17", "2026-08-21", "e1")], {}, "e1");
  assert.equal(hasLiveWeeklyTasks("e1", p, TODAY), false);
});

test("countActiveWeeklyTasks (snapshot) sigue leyendo weekly_detail sin cambios — no se rompió el reporte archivado", () => {
  const p = project("p1", "Proyecto A", [act("a1", "2026-08-04", "2026-08-06", "e1")], {}, "e1");
  p.engineers[0].weekly_detail = ["a1", "a2"]; // snapshot congelado, aunque solo "a1" siga vigente
  assert.equal(countActiveWeeklyTasks("e1", p), 2);
});
