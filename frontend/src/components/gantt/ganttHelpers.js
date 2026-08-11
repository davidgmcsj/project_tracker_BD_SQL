// ganttHelpers.js — Constantes y helpers puros de fecha/rango para el
// calendario Gantt. Sin hooks: todo lo que GanttChart y FilterBar necesitan
// calcular sin depender del ciclo de vida de React.

// Colores por estado — mismo semáforo que HierarchyTable (rojo/azul/verde).
export const STATUS_COLOR = {
  not_started: "#d3323c",
  in_progress: "#1a49a8",
  completed:   "#0f9d58",
};

export const MONTHS_SHORT = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// Ventana del rango automático: días a mostrar HACIA ATRÁS desde la ÚLTIMA
// fecha de entrega — el calendario termina justo en esa fecha (columna más a
// la derecha), sin días posteriores.
export const AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE = 35;

// Hasta este número de días, cada columna es un día suelto; por encima se
// agrupa en semanas (y más arriba, en meses). El rango automático abarca
// AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE + 1 días (incluye ambos extremos) — debe
// caber aquí para seguir viéndose día a día, que es el caso por defecto.
export const DAY_UNIT_MAX_DAYS = AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE + 1;

export const LABEL_COL_MIN = 160;
export const LABEL_COL_MAX = 640;
export const LABEL_COL_DEFAULT = 320;

// Ancho mínimo de cada columna de fecha según la unidad (crecen si sobra
// espacio). El mínimo de "day" contempla la fecha rotulada sobre el bloque de
// entrega ("14/07"), no solo el número del encabezado ("14").
export const DATE_COL_WIDTH = { day: 46, week: 84, month: 96 };

export const STATUS_FILTERS = [
  { value: "all",         label: "Todas" },
  { value: "not_started", label: "No iniciadas" },
  { value: "in_progress", label: "En proceso" },
  { value: "completed",   label: "Completadas" },
];

// Qué niveles de la jerarquía se listan como filas del calendario.
export const SCOPE_FILTERS = [
  { value: "all",   label: "Principales y subtareas" },
  { value: "roots", label: "Solo principales" },
];

// Un único panel de rango de fechas reemplaza al "Zoom" — cada atajo YA
// define su propia granularidad de columna (unit), así el usuario elige
// UNA cosa ("qué periodo quiero ver") en vez de dos controles separados que
// antes se superponían (Zoom + panel de fechas mostraban la misma idea).
export const QUARTERS = [
  { key: "T1", label: "T1 (Ene-Mar)", months: [0, 2] },
  { key: "T2", label: "T2 (Abr-Jun)", months: [3, 5] },
  { key: "T3", label: "T3 (Jul-Sep)", months: [6, 8] },
  { key: "T4", label: "T4 (Oct-Dic)", months: [9, 11] },
];
export const SEMESTERS = [
  { key: "S1", label: "S1 (Ene-Jun)", months: [0, 5] },
  { key: "S2", label: "S2 (Jul-Dic)", months: [6, 11] },
];

// ── Helpers de fecha ──────────────────────────────────────────────────────────

export const toDate = (str) => (str ? new Date(str + "T12:00:00") : null);
export const dayDiff = (a, b) => Math.round((b - a) / 86400000);
export const toISO = (d) => d.toISOString().slice(0, 10);
export const fmtDay = (d) => `${d.getDate()}`;
export const fmtDayFull = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
export const fmtMonth = (d) => `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
// Fecha de entrega rotulada DENTRO del bloque de color. Formato corto (14/07)
// para que quepa incluso en la columna de día, que es la más angosta.
export const fmtDueLabel = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
export const fmtWeek = (d) => {
  const end = new Date(d); end.setDate(end.getDate() + 6);
  return `${d.getDate()}-${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`;
};

// Lunes de la semana ISO que contiene `d`.
export function mondayOf(d) {
  const x = new Date(d);
  const diff = x.getDay() === 0 ? -6 : 1 - x.getDay();
  x.setDate(x.getDate() + diff);
  return x;
}

// Decide la unidad de columna (día/semana/mes) según cuántos días abarca el
// rango efectivo — reemplaza al selector de "Zoom" independiente: la
// granularidad se deriva del propio rango elegido, no de un botón aparte.
export function unitForRange(days) {
  if (days <= DAY_UNIT_MAX_DAYS) return "day";
  if (days <= 210) return "week";
  return "month";
}

// Diferencia entre dos fechas medida en la unidad dada — decide en qué
// COLUMNA cae una fecha. day: días calendario. week: semanas ISO completas
// (lunes a lunes). month: meses calendario completos (1º de cada mes).
export function unitDiff(unit, from, to) {
  if (unit === "day") return dayDiff(from, to);
  if (unit === "week") {
    const a = mondayOf(from), b = mondayOf(to);
    return Math.round((b - a) / (7 * 86400000));
  }
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

export function statusOf(taskStatus, actId) {
  if (!taskStatus) return "not_started";
  if ((taskStatus.completed   || []).includes(actId)) return "completed";
  if ((taskStatus.in_progress || []).includes(actId)) return "in_progress";
  return "not_started";
}

export function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

export function rangeForMonths(year, [startMonth, endMonth]) {
  return { start: new Date(year, startMonth, 1), end: lastDayOfMonth(year, endMonth) };
}

// Rango automático por defecto al abrir la vista: termina exactamente en la
// ÚLTIMA fecha de entrega del proyecto (columna más a la derecha) y muestra
// AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE días hacia atrás desde ahí — no hacia
// adelante. Así la vista aterriza donde está el cierre del trabajo, sin
// columnas vacías después de la última entrega.
export function computeAutoRange(dated) {
  let lastDue = null;
  dated.forEach(a => {
    const d = toDate(a.due_date) || toDate(a.start_date);
    if (d && (!lastDue || d > lastDue)) lastDue = d;
  });
  if (!lastDue) return null;
  const start = new Date(lastDue); start.setDate(start.getDate() - AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE);
  const end   = new Date(lastDue);
  return { start, end };
}
