// query-builder.test.cjs — buildQuery es puro (no abre conexión), así que se
// prueba por completo sin base de datos.
//
//   node --test tests/      (desde backend/)

"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { buildQuery, ReportQueryError } = require("../reports/query-builder.cjs");

// Mock mínimo de mssql.Request: solo necesita .input() acumulando lo que le pasan.
function fakeRequest() {
  const inputs = {};
  return { inputs, input(name, type, value) { inputs[name] = value; return this; } };
}

test("consulta desconocida lanza ReportQueryError", () => {
  assert.throws(() => buildQuery({ consulta: "no_existe" }), ReportQueryError);
});

test("campo de filtro no permitido lanza ReportQueryError", () => {
  assert.throws(
    () => buildQuery({ consulta: "vencidas", filtros: [{ campo: "nombre; DROP TABLE Proyectos", operador: "=", valor: "x" }] }),
    ReportQueryError
  );
});

test("operador no permitido para el campo lanza ReportQueryError", () => {
  assert.throws(
    () => buildQuery({ consulta: "actividades", filtros: [{ campo: "semana_iso", operador: "in", valor: ["2026-W01"] }] }),
    ReportQueryError
  );
});

test("columna de proyección no permitida lanza ReportQueryError", () => {
  assert.throws(() => buildQuery({ consulta: "proyectos", columnas: ["proyecto", "1; DROP TABLE Proyectos"] }), ReportQueryError);
});

test("columna de orden no permitida lanza ReportQueryError", () => {
  assert.throws(() => buildQuery({ consulta: "proyectos", orden: [{ campo: "campo_falso", direccion: "asc" }] }), ReportQueryError);
});

test("operador 'in' con array vacío lanza ReportQueryError", () => {
  assert.throws(
    () => buildQuery({ consulta: "actividades", filtros: [{ campo: "tipo", operador: "in", valor: [] }] }),
    ReportQueryError
  );
});

test("dirección de orden arbitraria no rompe: cae a ASC", () => {
  const built = buildQuery({ consulta: "proyectos", orden: [{ campo: "proyecto", direccion: "'; DROP TABLE Proyectos; --" }] });
  assert.match(built.dataSql, /ORDER BY p\.NombreProyecto ASC/);
});

test("sin filtros usa columnas y orden por defecto de la consulta", () => {
  const built = buildQuery({ consulta: "vencidas" });
  assert.deepEqual(built.columnas, ["proyecto", "actividad", "estado", "fecha_fin"]);
  assert.match(built.dataSql, /ORDER BY ad\.FechaFin ASC/);
  // "vencidas" tiene un WHERE fijo (no viene de input del usuario) además del filtro dinámico
  assert.match(built.dataSql, /ad\.FechaFin < CAST\(GETDATE\(\) AS DATE\)/);
});

test("acumulatividad: agregar un filtro nunca amplía el WHERE, solo lo reduce con AND", () => {
  const sinFiltro = buildQuery({ consulta: "actividades" });
  const conUnFiltro = buildQuery({ consulta: "actividades", filtros: [{ campo: "semana_iso", operador: "=", valor: "2026-W32" }] });
  const conDosFiltros = buildQuery({
    consulta: "actividades",
    filtros: [
      { campo: "semana_iso", operador: "=", valor: "2026-W32" },
      { campo: "tipo", operador: "=", valor: "estado" },
    ],
  });

  assert.doesNotMatch(sinFiltro.dataSql, /WHERE/);
  assert.match(conUnFiltro.dataSql, /WHERE ae\.SemanaISO = @f0/);
  assert.match(conDosFiltros.dataSql, /WHERE ae\.SemanaISO = @f0 AND ae\.Tipo = @f1/);
});

test("filtro 'in' liga un parámetro por valor y arma IN (...)", () => {
  const built = buildQuery({ consulta: "actividades", filtros: [{ campo: "tipo", operador: "in", valor: ["estado", "progreso"] }] });
  assert.match(built.dataSql, /ae\.Tipo IN \(@f0_0,@f0_1\)/);
  const req = fakeRequest();
  built.bind(req);
  assert.equal(req.inputs.f0_0, "estado");
  assert.equal(req.inputs.f0_1, "progreso");
});

test("filtro 'between' sin [desde, hasta] lanza ReportQueryError", () => {
  assert.throws(
    () => buildQuery({ consulta: "actividades", filtros: [{ campo: "fecha_evento", operador: "between", valor: "2026-08-01" }] }),
    ReportQueryError
  );
});

test("filtro 'between' válido liga dos parámetros", () => {
  const built = buildQuery({ consulta: "actividades", filtros: [{ campo: "fecha_evento", operador: "between", valor: ["2026-08-01", "2026-08-31"] }] });
  const req = fakeRequest();
  built.bind(req);
  assert.equal(req.inputs.f0_desde, "2026-08-01");
  assert.equal(req.inputs.f0_hasta, "2026-08-31");
});

test("bind() liga offset y límite además de los filtros", () => {
  const built = buildQuery({ consulta: "vencidas", limite: 10, offset: 20 });
  const req = fakeRequest();
  built.bind(req);
  assert.equal(req.inputs.__offset, 20);
  assert.equal(req.inputs.__limite, 10);
});

test("límite se acota al máximo permitido, aunque se pida más", () => {
  const built = buildQuery({ consulta: "vencidas", limite: 999999 }, { maxLimite: 5000 });
  assert.equal(built.limite, 5000);
});
