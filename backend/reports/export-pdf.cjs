"use strict";

// ── Exportador PDF (Fase 5) ───────────────────────────────────────────────────
// Función pura: recibe el resultado ya consultado, devuelve un Buffer .pdf.
// Usa las fuentes Roboto que trae el propio paquete pdfmake (node_modules/
// pdfmake/fonts/Roboto) — sin descargas externas, crítico para desplegar en
// Azure App Service Linux sin acceso a internet en build time.

const path    = require("path");
const pdfmake = require("pdfmake");
const { translateEstado } = require("./estado-labels.cjs");

const PKG_DIR  = path.dirname(require.resolve("pdfmake/package.json"));
const FONT_DIR = path.join(PKG_DIR, "fonts", "Roboto");

pdfmake.fonts = {
  Roboto: {
    normal:      path.join(FONT_DIR, "Roboto-Regular.ttf"),
    bold:        path.join(FONT_DIR, "Roboto-Medium.ttf"), // el paquete no trae un Bold real
    italics:     path.join(FONT_DIR, "Roboto-Italic.ttf"),
    bolditalics: path.join(FONT_DIR, "Roboto-MediumItalic.ttf"),
  },
};
// Nunca resolver URLs externas ni archivos fuera de FONT_DIR — el doc se
// arma siempre desde datos de la consulta, nunca desde input directo del
// usuario, pero la política queda restringida igual como segunda red.
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy(p => p.startsWith(FONT_DIR));

function humanize(key) {
  return String(key).replace(/_/g, " ").replace(/^\w/, c => c.toUpperCase());
}

function formatCell(columna, value) {
  if (value == null) return "—";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) return value.slice(0, 10);
  return String(translateEstado(columna, value));
}

// { titulo, consulta, columnas: string[], filas: object[], filtrosAplicados, total }
// filtrosAplicados NO se imprime: son campo/operador/valor crudos tal cual
// los arma el frontend (ej. "proyecto_id = mp1pu3nh8h", el id interno, no el
// nombre) — sin el catálogo de proyectos/ingenieros a mano, el backend no
// puede traducirlos a texto legible, y mostrarlos en crudo no aportaba nada
// que el título/tabla ya no dijeran.
async function toPdfBuffer({ titulo, consulta, columnas, filas, total }) {
  const tableBody = [
    columnas.map(c => ({ text: humanize(c), bold: true, color: "#ffffff", fillColor: "#003399" })),
    ...filas.map(fila => columnas.map(c => formatCell(c, fila[c]))),
  ];

  const docDefinition = {
    pageSize: "A4",
    pageOrientation: columnas.length > 5 ? "landscape" : "portrait",
    pageMargins: [30, 60, 30, 40],
    header: { text: "Seguimiento Semanal — Oficina de Tecnología", alignment: "center", margin: [0, 20, 0, 0], fontSize: 8, color: "#7d8aa3" },
    footer: (page, pages) => ({ text: `Página ${page} de ${pages}`, alignment: "center", fontSize: 8, color: "#7d8aa3" }),
    content: [
      { text: titulo || `Reporte — ${consulta}`, style: "titulo" },
      { text: `Generado: ${new Date().toLocaleString("es-CO")}   ·   ${filas.length} de ${total} registro${total !== 1 ? "s" : ""}`, style: "meta", margin: [0, 0, 0, 12] },
      {
        table: { headerRows: 1, widths: columnas.map(() => "*"), body: tableBody },
        layout: {
          fillColor: (rowIndex) => (rowIndex === 0 ? null : rowIndex % 2 === 0 ? "#f5f8fc" : null),
          hLineColor: "#dbe3ee", vLineColor: "#dbe3ee",
        },
        fontSize: 8,
      },
    ],
    styles: {
      titulo: { fontSize: 16, bold: true, color: "#003399", margin: [0, 0, 0, 4] },
      meta:   { fontSize: 8, color: "#465470" },
    },
    defaultStyle: { font: "Roboto" },
  };

  const doc = pdfmake.createPdf(docDefinition);
  return doc.getBuffer();
}

module.exports = { toPdfBuffer };
