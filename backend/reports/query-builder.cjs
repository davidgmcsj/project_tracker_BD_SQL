"use strict";

// ── Constructor de SQL parametrizado (Fase 2) ────────────────────────────────
// buildQuery({consulta, filtros, columnas, orden, limite, offset}) valida todo
// contra query-registry.cjs y devuelve { dataSql, countSql, bind } sin tocar
// la base de datos — así se puede probar sin conexión (tests/query-builder.test.cjs).
// bind(request) liga los valores a un mssql.Request concreto; el llamador
// decide cuándo y con qué pool ejecutar dataSql/countSql.

const sql = require("mssql");
const { REGISTRY } = require("./query-registry.cjs");

class ReportQueryError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReportQueryError";
    this.status = 400;
  }
}

const OPERATOR_SQL = { "=": "=", ">=": ">=", "<=": "<=" };
const MAX_LIMITE_QUERY = 5000;
const MAX_LIMITE_EXPORT = 50000;

function getConsulta(nombre) {
  const consulta = REGISTRY[nombre];
  if (!consulta) throw new ReportQueryError(`Consulta desconocida: "${nombre}"`);
  return consulta;
}

function resolveColumnas(consulta, columnas) {
  const permitidas = consulta.columnasPermitidas;
  const pedidas = Array.isArray(columnas) && columnas.length ? columnas : consulta.columnasDefault;
  const invalidas = pedidas.filter(c => !permitidas[c]);
  if (invalidas.length) throw new ReportQueryError(`Columna(s) no permitida(s): ${invalidas.join(", ")}`);
  return pedidas;
}

function buildCondiciones(consulta, filtros, bindings) {
  const condiciones = consulta.where ? [consulta.where] : [];

  (Array.isArray(filtros) ? filtros : []).forEach((f, i) => {
    const def = consulta.filtros[f?.campo];
    if (!def) throw new ReportQueryError(`Campo de filtro no permitido: "${f?.campo}"`);
    if (!def.operador.includes(f.operador)) throw new ReportQueryError(`Operador "${f.operador}" no permitido para "${f.campo}"`);

    if (f.operador === "in") {
      const valores = Array.isArray(f.valor) ? f.valor : [f.valor];
      if (!valores.length) throw new ReportQueryError(`"in" requiere al menos un valor para "${f.campo}"`);
      const nombres = valores.map((v, j) => {
        const nombre = `f${i}_${j}`;
        bindings.push({ nombre, sqlType: def.sqlType, valor: v });
        return `@${nombre}`;
      });
      condiciones.push(`${def.columna} IN (${nombres.join(",")})`);
    } else if (f.operador === "between") {
      const [desde, hasta] = Array.isArray(f.valor) ? f.valor : [];
      if (desde == null || hasta == null) throw new ReportQueryError(`"between" requiere [desde, hasta] para "${f.campo}"`);
      bindings.push({ nombre: `f${i}_desde`, sqlType: def.sqlType, valor: desde });
      bindings.push({ nombre: `f${i}_hasta`, sqlType: def.sqlType, valor: hasta });
      condiciones.push(`${def.columna} BETWEEN @f${i}_desde AND @f${i}_hasta`);
    } else {
      bindings.push({ nombre: `f${i}`, sqlType: def.sqlType, valor: f.valor });
      condiciones.push(`${def.columna} ${OPERATOR_SQL[f.operador]} @f${i}`);
    }
  });

  return condiciones.length ? `WHERE ${condiciones.join(" AND ")}` : "";
}

function buildOrderBy(consulta, orden) {
  const pedido = Array.isArray(orden) && orden.length ? orden : consulta.ordenDefault;
  if (!pedido || !pedido.length) return "ORDER BY (SELECT NULL)";
  const partes = pedido.map(o => {
    const columna = consulta.columnasPermitidas[o.campo];
    if (!columna) throw new ReportQueryError(`Columna de orden no permitida: "${o.campo}"`);
    const direccion = String(o.direccion || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
    return `${columna} ${direccion}`;
  });
  return `ORDER BY ${partes.join(", ")}`;
}

function buildQuery(body, { maxLimite = MAX_LIMITE_QUERY } = {}) {
  const { consulta: nombreConsulta, filtros, columnas, orden, limite, offset } = body || {};
  const consulta = getConsulta(nombreConsulta);
  const columnasPedidas = resolveColumnas(consulta, columnas);

  const bindings = [];
  const where = buildCondiciones(consulta, filtros, bindings);
  const orderBy = buildOrderBy(consulta, orden);

  const off = Math.max(0, Number(offset) || 0);
  const lim = Math.min(maxLimite, Math.max(1, Number(limite) || maxLimite));
  bindings.push({ nombre: "__offset", sqlType: sql.Int, valor: off });
  bindings.push({ nombre: "__limite", sqlType: sql.Int, valor: lim });

  const selectClause = columnasPedidas.map(c => `${consulta.columnasPermitidas[c]} AS [${c}]`).join(", ");

  const dataSql = `
    SELECT ${selectClause}
    FROM ${consulta.from}
    ${where}
    ${orderBy}
    OFFSET @__offset ROWS FETCH NEXT @__limite ROWS ONLY;
  `;
  const countSql = `SELECT COUNT(*) AS total FROM ${consulta.from} ${where};`;

  function bind(request) {
    bindings.forEach(b => request.input(b.nombre, b.sqlType, b.valor));
    return request;
  }

  return { dataSql, countSql, bind, columnas: columnasPedidas, limite: lim, offset: off };
}

module.exports = { buildQuery, ReportQueryError, MAX_LIMITE_QUERY, MAX_LIMITE_EXPORT };
