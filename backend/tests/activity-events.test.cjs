// activity-events.test.cjs — diffSnapshots es una función pura, sin SQL:
// se puede probar por completo sin conexión a la base de datos.
//
//   node --test tests/      (desde backend/)

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { snapshotFromRows, snapshotFromProject, diffSnapshots } = require("../activity-events.cjs");

const ctx = { proyectoAppID: "proy_1", fechaEvento: "2026-08-05", origen: "app" };

test("sin cambios entre snapshots → ningún evento", () => {
  const prev = new Map([["act_1", { estado: "in_progress", progreso: 50, fechaInicio: "2026-08-01", fechaFin: "2026-08-10", horasPlaneadas: 16 }]]);
  const next = new Map(prev);
  assert.deepEqual(diffSnapshots(prev, next, ctx), []);
});

test("cambio de estado genera un evento tipo 'estado'", () => {
  const prev = new Map([["act_1", { estado: "in_progress", progreso: 50, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
  const next = new Map([["act_1", { estado: "completed", progreso: 50, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
  const eventos = diffSnapshots(prev, next, ctx);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, "estado");
  assert.equal(eventos[0].valorAnterior, "in_progress");
  assert.equal(eventos[0].valorNuevo, "completed");
  assert.equal(eventos[0].appProyectoID, "proy_1");
  assert.equal(eventos[0].semanaISO, "2026-W32");
});

test("cambio de progreso genera un evento tipo 'progreso'", () => {
  const prev = new Map([["act_1", { estado: "in_progress", progreso: 30, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
  const next = new Map([["act_1", { estado: "in_progress", progreso: 80, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
  const eventos = diffSnapshots(prev, next, ctx);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, "progreso");
  assert.equal(eventos[0].valorAnterior, "30");
  assert.equal(eventos[0].valorNuevo, "80");
});

test("cambio de fecha de fin genera evento 'fecha_fin', fecha de inicio no cambia → sin evento de inicio", () => {
  const prev = new Map([["act_1", { estado: "in_progress", progreso: 0, fechaInicio: "2026-08-01", fechaFin: "2026-08-10", horasPlaneadas: 0 }]]);
  const next = new Map([["act_1", { estado: "in_progress", progreso: 0, fechaInicio: "2026-08-01", fechaFin: "2026-08-15", horasPlaneadas: 0 }]]);
  const eventos = diffSnapshots(prev, next, ctx);
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, "fecha_fin");
  assert.equal(eventos[0].valorAnterior, "2026-08-10");
  assert.equal(eventos[0].valorNuevo, "2026-08-15");
});

test("actividad nueva (sin snapshot previo) solo registra campos con valor real", () => {
  const prev = new Map();
  const next = new Map([["act_2", { estado: "in_progress", progreso: 20, fechaInicio: "2026-08-05", fechaFin: "", horasPlaneadas: 8 }]]);
  const eventos = diffSnapshots(prev, next, ctx);
  const tipos = eventos.map(e => e.tipo).sort();
  assert.deepEqual(tipos, ["estado", "fecha_inicio", "horas", "progreso"]);
});

test("actividad nueva en not_started sin progreso/horas → sin eventos", () => {
  const prev = new Map();
  const next = new Map([["act_3", { estado: "not_started", progreso: 0, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
  assert.deepEqual(diffSnapshots(prev, next, ctx), []);
});

test("mismo diff calculado dos veces produce el mismo HashCambio (idempotencia)", () => {
  const prev = new Map([["act_1", { estado: "in_progress", progreso: 30, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
  const next = new Map([["act_1", { estado: "completed", progreso: 30, fechaInicio: "", fechaFin: "", horasPlaneadas: 0 }]]);
  const a = diffSnapshots(prev, next, ctx);
  const b = diffSnapshots(prev, next, ctx);
  assert.equal(a[0].hashCambio, b[0].hashCambio);
});

// ── snapshotFromRows / snapshotFromProject ───────────────────────────────────

test("snapshotFromRows normaliza filas SQL (fechas Date, números)", () => {
  const rows = [{ AppActividadID: "act_1", Estado: "completed", Progreso: "75", FechaInicio: new Date("2026-08-01T00:00:00Z"), FechaFin: null, HorasPlaneadas: "12.5" }];
  const snap = snapshotFromRows(rows);
  assert.deepEqual(snap.get("act_1"), {
    estado: "completed", progreso: 75, fechaInicio: "2026-08-01", fechaFin: "", horasPlaneadas: 12.5,
  });
});

test("snapshotFromProject deriva estado desde task_status", () => {
  const project = {
    activities_identified: [{ id: "act_1", progress: 40, start_date: "2026-08-01", due_date: "2026-08-10", planned_hours: 8 }],
    task_status: { completed: [], in_progress: ["act_1"], not_started: [] },
  };
  const snap = snapshotFromProject(project);
  assert.deepEqual(snap.get("act_1"), {
    estado: "in_progress", progreso: 40, fechaInicio: "2026-08-01", fechaFin: "2026-08-10", horasPlaneadas: 8,
  });
});
