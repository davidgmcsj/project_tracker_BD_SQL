"use strict";

// format-cell.cjs — Helpers de presentación compartidos por los exportadores
// de Reportes (export-excel.cjs y export-pdf.cjs).
//
// Solo vive aquí lo que es GENUINAMENTE común. Sus dos `formatCell` NO se
// unifican a propósito, porque tienen contratos distintos por el formato
// destino:
//   - Excel recibe objetos Date nativos (ExcelJS los formatea como fecha real
//     en la celda, no como texto) y usa "" para los vacíos.
//   - PDF necesita todo como string y usa "—" para los vacíos.
// Forzarlos a una sola función obligaría a pasar un modo por parámetro y a
// ramificar dentro — más enredado que las dos versiones cortas actuales.

/** "fecha_inicio" → "Fecha inicio". Encabezados de columna legibles. */
function humanize(key) {
  return String(key).replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

module.exports = { humanize };
