// cronogramaImport.test.js — Tests del motor de importación de Excel
// "Cronograma por entregable" (hoja "Cronograma Detalle").
//
//   node --test src/utils/cronogramaImport.test.js     (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDMYDate, parseProgressPct, parseAssigneeName, statusFromLabel,
  buildCronogramaActivities, mergeCronogramaTaskStatus,
} from "./cronogramaImport.js";
import { createActivity } from "./formulas.js";

// ── parseDMYDate ────────────────────────────────────────────────────────────

test("parseDMYDate convierte dd/mm/aaaa a ISO", () => {
  assert.equal(parseDMYDate("31/08/2026"), "2026-08-31");
  assert.equal(parseDMYDate("5/1/2026"), "2026-01-05");
});

test("parseDMYDate tolera vacío e irreconocible sin romper", () => {
  assert.equal(parseDMYDate(""), "");
  assert.equal(parseDMYDate(null), "");
  assert.equal(parseDMYDate("Por definir"), "");
});

// ── parseProgressPct ──────────────────────────────────────────────────────────

test("parseProgressPct acepta porcentaje, decimal y entero", () => {
  assert.equal(parseProgressPct("20%"), 20);
  assert.equal(parseProgressPct(0.2), 20);
  assert.equal(parseProgressPct(80), 80);
  assert.equal(parseProgressPct(""), 0);
});

// ── parseAssigneeName ─────────────────────────────────────────────────────────

test('parseAssigneeName trata "Sin asignar" y vacío como sin responsable', () => {
  assert.equal(parseAssigneeName("Sin asignar"), "");
  assert.equal(parseAssigneeName(""), "");
  assert.equal(parseAssigneeName("David A."), "David A.");
});

// ── statusFromLabel ────────────────────────────────────────────────────────────

test("statusFromLabel traduce las etiquetas en español del Excel", () => {
  assert.equal(statusFromLabel("No iniciada"), "not_started");
  assert.equal(statusFromLabel("En proceso"), "in_progress");
  assert.equal(statusFromLabel("Completada"), "completed");
  assert.equal(statusFromLabel("Ambiente Pruebas"), "ambiente_pruebas");
  assert.equal(statusFromLabel("Ambiente Producción"), "ambiente_produccion");
});

test("statusFromLabel cae a not_started ante una etiqueta desconocida", () => {
  assert.equal(statusFromLabel("¿?"), "not_started");
});

// ── buildCronogramaActivities: jerarquía por sangría real ────────────────────
// El "#" del archivo NO refleja la profundidad real (ver comentario en
// resolveHierarchy) — la profundidad se mide por la sangría de la columna
// "Tarea". Estas filas replican el caso real encontrado en el archivo de
// referencia: "1.5" (1 punto) y "1.8.1" (2 puntos) están al MISMO nivel
// visual bajo el Entregable "3", no uno dentro del otro.
function makeParsedRows() {
  return [
    { number: "3", indent: 0, text: "Estructura de Datos", assigneeName: "", start_date: "", due_date: "", status: "not_started", progress: 0, notes: "Cierre: listo", isEntregable: true, _rowIndex: 21 },
    { number: "1.5", indent: 4, text: "Convenciones de identificadores", assigneeName: "David A.", start_date: "2026-09-14", due_date: "2026-09-16", status: "not_started", progress: 0, notes: "", isEntregable: false, _rowIndex: 22 },
    { number: "1.8.1", indent: 4, text: "Creación campos adicionales", assigneeName: "David A.", start_date: "2026-08-17", due_date: "2026-08-17", status: "not_started", progress: 0, notes: "", isEntregable: false, _rowIndex: 23 },
  ].map((row, i, arr) => ({ ...row, parentRowIndex: row.indent === 0 ? null : arr[0]._rowIndex }));
}

test("buildCronogramaActivities cuelga las tareas del Entregable, no unas de otras, pese a que el # sugiera anidamiento", () => {
  const rows = makeParsedRows();
  const engineerCatalog = [{ id: "eng_1", name: "David A." }];
  const res = buildCronogramaActivities(rows, engineerCatalog, createActivity, undefined);

  const entregable = res.activities.find(a => a.text === "Estructura de Datos");
  const conv = res.activities.find(a => a.text.startsWith("Convenciones"));
  const campos = res.activities.find(a => a.text.startsWith("Creación campos"));

  assert.equal(entregable.parent_id, null);
  assert.equal(conv.parent_id, entregable.id);
  assert.equal(campos.parent_id, entregable.id); // hermana de "Convenciones", NO su hija
});

test("buildCronogramaActivities no trata el resumen agregado del Entregable como responsable", () => {
  // Fila de Entregable con assigneeName vacío a propósito (mismo criterio
  // que aplica parseCronogramaWorkbook: la columna "Asignado" de un
  // Entregable trae "2/10 tareas al 100%", nunca un nombre real).
  const rows = makeParsedRows();
  const res = buildCronogramaActivities(rows, [], createActivity, undefined);
  assert.equal(res.newEngineersToCreate.length, 1); // solo "David A.", no el resumen
  assert.equal(res.newEngineersToCreate[0].name, "David A.");
});

test("buildCronogramaActivities guarda la nota de cierre del Entregable como descripción", () => {
  const rows = makeParsedRows();
  const res = buildCronogramaActivities(rows, [{ id: "eng_1", name: "David A." }], createActivity, undefined);
  const entregable = res.activities.find(a => a.text === "Estructura de Datos");
  assert.equal(entregable.description, "Cierre: listo");
});

test("buildCronogramaActivities resuelve responsables ya conocidos por id sin duplicarlos", () => {
  const rows = makeParsedRows();
  const res = buildCronogramaActivities(rows, [{ id: "eng_1", name: "David A." }], createActivity, undefined);
  const conv = res.activities.find(a => a.text.startsWith("Convenciones"));
  assert.deepEqual(conv.assigned_engineers, [{ id: "eng_1", name: "David A." }]);
});

test("buildCronogramaActivities nunca reutiliza actividades existentes: siempre crea nuevas", () => {
  // Sin importar qué exista en el proyecto, esta función solo recibe el
  // catálogo de ingenieros (para resolver responsables) — no recibe ni
  // consulta actividades existentes, por diseño (importación aditiva pura).
  const rows = makeParsedRows();
  const res1 = buildCronogramaActivities(rows, [], createActivity, undefined);
  const res2 = buildCronogramaActivities(rows, [], createActivity, undefined);
  assert.notEqual(res1.activities[0].id, res2.activities[0].id);
});

// ── mergeCronogramaTaskStatus: aditivo, nunca reemplaza ───────────────────────

test("mergeCronogramaTaskStatus agrega ids nuevos sin tocar los que ya había", () => {
  const existing = { completed: ["act_old1"], in_progress: [], not_started: ["act_old2"] };
  const statusByActivityId = new Map([["act_new1", "not_started"], ["act_new2", "completed"]]);
  const next = mergeCronogramaTaskStatus(existing, statusByActivityId);

  assert.deepEqual(next.completed.sort(), ["act_new2", "act_old1"]);
  assert.deepEqual(next.not_started.sort(), ["act_new1", "act_old2"]);
});

test("mergeCronogramaTaskStatus registra completed_dates solo para las nuevas completadas", () => {
  const existing = { completed: [], in_progress: [], not_started: [], completed_dates: { act_old: "2026-01-01" } };
  const statusByActivityId = new Map([["act_new", "completed"]]);
  const next = mergeCronogramaTaskStatus(existing, statusByActivityId);

  assert.equal(next.completed_dates.act_old, "2026-01-01"); // preservada
  assert.ok(next.completed_dates.act_new); // agregada
});

test("mergeCronogramaTaskStatus tolera task_status inexistente (proyecto vacío)", () => {
  const statusByActivityId = new Map([["act_new", "not_started"]]);
  const next = mergeCronogramaTaskStatus(undefined, statusByActivityId);
  assert.deepEqual(next.not_started, ["act_new"]);
});
