"use strict";

// ── Exportador Excel (Fase 5) ────────────────────────────────────────────────
// Función pura: recibe el resultado ya consultado, devuelve un Buffer .xlsx.
// No repite lógica de consulta — nunca puede mostrar datos distintos a los
// que ya se vieron en pantalla, porque recibe exactamente las mismas filas.

const ExcelJS = require("exceljs");

function humanize(key) {
  return String(key).replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

function formatCell(value) {
  if (value == null) return "";
  if (value instanceof Date) return value;
  return value;
}

// { titulo, consulta, columnas: string[], filas: object[], filtrosAplicados, total }
async function toXlsxBuffer({ titulo, consulta, columnas, filas, filtrosAplicados, total }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Seguimiento Semanal — Oficina de Tecnología";
  wb.created = new Date();

  // ── Hoja 1: datos ──
  const hoja = wb.addWorksheet(titulo || "Datos", { views: [{ state: "frozen", ySplit: 1 }] });
  hoja.columns = columnas.map(c => ({ header: humanize(c), key: c, width: Math.max(14, humanize(c).length + 4) }));
  filas.forEach(fila => {
    const row = {};
    columnas.forEach(c => { row[c] = formatCell(fila[c]); });
    hoja.addRow(row);
  });
  hoja.getRow(1).font = { bold: true };
  hoja.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF003399" } };
  hoja.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
  hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };

  // ── Hoja 2: parámetros — de dónde salió este Excel ──
  const params = wb.addWorksheet("Parámetros");
  params.columns = [{ header: "Campo", key: "campo", width: 22 }, { header: "Valor", key: "valor", width: 60 }];
  params.getRow(1).font = { bold: true };
  params.addRow({ campo: "Consulta", valor: consulta });
  params.addRow({ campo: "Generado", valor: new Date().toISOString() });
  params.addRow({ campo: "Total de registros", valor: total });
  params.addRow({ campo: "Filas exportadas", valor: filas.length });
  (filtrosAplicados || []).forEach(f => {
    const valor = Array.isArray(f.valor) ? f.valor.join(", ") : String(f.valor);
    params.addRow({ campo: `Filtro: ${f.campo} (${f.operador})`, valor });
  });
  if (!(filtrosAplicados || []).length) params.addRow({ campo: "Filtros", valor: "Ninguno" });

  return wb.xlsx.writeBuffer();
}

module.exports = { toXlsxBuffer };
