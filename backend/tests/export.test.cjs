// export.test.cjs — verifica la firma de archivo y el conteo de filas de
// los exportadores, sin conexión a BD (reciben el resultado ya armado).
//
//   node --test tests/      (desde backend/)

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const ExcelJS = require("exceljs");
const { toXlsxBuffer } = require("../reports/export-excel.cjs");
const { toPdfBuffer } = require("../reports/export-pdf.cjs");

const columnas = ["proyecto", "actividad", "estado"];
const filas = [
  { proyecto: "PRO-01", actividad: "Actividad A", estado: "in_progress" },
  { proyecto: "PRO-01", actividad: "Actividad B", estado: "completed" },
  { proyecto: "PRO-02", actividad: "Actividad C", estado: "not_started" },
];

const payload = {
  titulo: "vencidas", consulta: "vencidas", columnas, filas,
  filtrosAplicados: [{ campo: "proyecto_id", operador: "=", valor: "PRO-01" }],
  total: filas.length,
};

test("toXlsxBuffer produce un archivo con firma ZIP (PK) — xlsx es un zip", async () => {
  const buffer = await toXlsxBuffer(payload);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.slice(0, 2).toString(), "PK");
});

test("toXlsxBuffer con cero filas no revienta (solo encabezado)", async () => {
  const buffer = await toXlsxBuffer({ ...payload, filas: [], total: 0 });
  assert.ok(buffer.length > 0);
  assert.equal(buffer.slice(0, 2).toString(), "PK");
});

test("toPdfBuffer produce un archivo con firma %PDF", async () => {
  const buffer = await toPdfBuffer(payload);
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.slice(0, 5).toString(), "%PDF-");
});

test("toPdfBuffer con cero filas no revienta", async () => {
  const buffer = await toPdfBuffer({ ...payload, filas: [], total: 0 });
  assert.equal(buffer.slice(0, 5).toString(), "%PDF-");
});

// filtrosAplicados no se imprime en el PDF (ver comentario en export-pdf.cjs):
// son campo/operador/valor crudos (ej. el id interno de un proyecto, no su
// nombre) que el backend no puede traducir sin el catálogo — no aportaban
// nada que el título/tabla no dijeran ya. toPdfBuffer ni siquiera lee esa
// prop del payload, así que pasarla o no pasarla debe dar el mismo resultado.
test("toPdfBuffer ignora filtrosAplicados si viene en el payload (ya no se imprime)", async () => {
  const conFiltros = await toPdfBuffer(payload);
  const { filtrosAplicados, ...sinFiltrosProp } = payload;
  const sinFiltros = await toPdfBuffer(sinFiltrosProp);
  assert.equal(conFiltros.length, sinFiltros.length);
});

// El Excel/PDF se genera en el backend consultando SQL directo — nunca pasa
// por ReportesTable.jsx (que traduce el estado en la vista previa). Sin
// traducción propia en el exportador, la columna Estado salía en crudo
// (not_started/in_progress/completed) en el archivo descargado, aunque la
// vista previa en pantalla ya se viera bien.
test("toXlsxBuffer traduce la columna 'estado' (not_started/in_progress/completed → español)", async () => {
  const buffer = await toXlsxBuffer(payload);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const hoja = wb.getWorksheet(1);
  const valores = [];
  hoja.eachRow((row, rowNumber) => { if (rowNumber > 1) valores.push(row.getCell(3).value); });
  assert.deepEqual(valores, ["En proceso", "Completada", "No iniciada"]);
});

// El backend solo conoce la CLAVE interna de la consulta ("actividades_estado"),
// no el nombre legible ("Actividades por estado") — eso vive en
// NOMBRES_CONSULTA del frontend. reports/index.cjs ahora reenvía el título
// que mande el caller (req.body.titulo) en vez de siempre usar la clave cruda.
test("toXlsxBuffer usa el 'titulo' recibido como nombre de la hoja de datos", async () => {
  const buffer = await toXlsxBuffer({ ...payload, titulo: "Actividades por estado" });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  assert.equal(wb.getWorksheet(1).name, "Actividades por estado");
});
