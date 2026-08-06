// engineers.test.js — Agregación cross-proyecto de tareas por semana para un
// ingeniero (pantalla "mi semana").
//
//   node --test src/utils/engineers.test.js     (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { engineerWeekTasks, engineerNextWeekTasks } from "./engineers.js";

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
