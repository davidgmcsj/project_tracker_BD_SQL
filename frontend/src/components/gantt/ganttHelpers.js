// ganttHelpers.js — Constantes y helpers puros de fecha/rango para el
// calendario Gantt. Sin hooks: todo lo que GanttChart y FilterBar necesitan
// calcular sin depender del ciclo de vida de React.

import { matchesSearch } from "../../utils/search.js";

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

// Qué niveles de la jerarquía se listan como filas del calendario. Sin una
// tarea padre elegida en parentFilter, "Solo principales" tiene sentido
// (recorta a las raíces); con un padre elegido, esa opción sobra (la lista
// quedaría con 0 o 1 fila) — SCOPE_FILTERS_WITH_PARENT la reemplaza por
// "Solo subtareas" (oculta la fila del propio padre).
export const SCOPE_FILTERS = [
  { value: "all",   label: "Principales y subtareas" },
  { value: "roots", label: "Solo principales" },
];
export const SCOPE_FILTERS_WITH_PARENT = [
  { value: "all",       label: "Padre y subtareas" },
  { value: "childrenOnly", label: "Solo subtareas" },
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

// Todos los descendientes (todos los niveles, no solo hijos directos) de
// parentId — necesario para "Padre y subtareas"/"Solo subtareas": una
// subtarea de 2do nivel también debe entrar cuando se filtra por su abuela.
export function descendantIdsOf(activities, parentId) {
  if (!parentId) return new Set();
  const childrenOf = new Map();
  (activities || []).forEach(a => {
    if (!a.parent_id) return;
    if (!childrenOf.has(a.parent_id)) childrenOf.set(a.parent_id, []);
    childrenOf.get(a.parent_id).push(a.id);
  });
  const ids = new Set();
  const walk = (id) => (childrenOf.get(id) || []).forEach(childId => { ids.add(childId); walk(childId); });
  walk(parentId);
  return ids;
}

// Filas del calendario, en orden jerárquico (cada subtarea debajo de su
// tarea principal) en vez del orden crudo del array. Solo incluye
// actividades con alguna fecha — una fila sin fechas no tiene celda que
// pintar. statusFilter + parentFilter + scopeFilter + textFilter se combinan
// para los 3 casos de filtro compuesto ya existentes ("solo principales" sin
// parentFilter+scope=roots, "un padre con sus subtareas" parentFilter+
// scope=all, "solo las subtareas de tal padre" parentFilter+
// scope=childrenOnly) MÁS el filtro de texto libre por nombre — mismo
// criterio simple que statusFilter: filtra la fila propia, sin rescatar
// ancestros que no matcheen (una subtarea que matchea puede quedar "colgada"
// sin su padre visible, igual que ya pasa hoy con statusFilter).
export function computeDatedRows(activities, taskStatus, { statusFilter = "all", scopeFilter = "all", parentFilter = null, textFilter = "" } = {}) {
  const acts = activities || [];
  const descendantIds = descendantIdsOf(acts, parentFilter);
  const visible = acts.filter(a => {
    if (!(a.start_date || a.due_date)) return false;
    if (statusFilter !== "all" && statusOf(taskStatus, a.id) !== statusFilter) return false;
    if (!matchesSearch(a.text || "", textFilter)) return false;
    if (parentFilter) {
      const isTheParent = a.id === parentFilter;
      const isDescendant = descendantIds.has(a.id);
      if (!isTheParent && !isDescendant) return false;
      if (scopeFilter === "childrenOnly" && isTheParent) return false;
      return true;
    }
    return scopeFilter === "all" || !a.parent_id;
  });
  if (scopeFilter === "roots" && !parentFilter) return visible;

  // Ordena por jerarquía: raíces (o la tarea padre elegida) en su orden
  // original y, tras cada una, sus descendientes. Las huérfanas (padre
  // inexistente o filtrado por estado) se listan al final para que nunca
  // desaparezcan del calendario.
  const byId = new Map(visible.map(a => [a.id, a]));
  const childrenOf = new Map();
  visible.forEach(a => {
    const parentId = a.parent_id && byId.has(a.parent_id) ? a.parent_id : null;
    if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
    childrenOf.get(parentId).push(a);
  });
  const ordered = [];
  const walk = (parentId) => {
    (childrenOf.get(parentId) || []).forEach(a => {
      ordered.push(a);
      walk(a.id);
    });
  };
  // Con parentFilter + childrenOnly, la propia tarea padre NO está en
  // `visible` (se excluyó arriba) — byId.has(a.parent_id) da false para sus
  // hijos directos, así que childrenOf ya los cuelga de null (parentId
  // "huérfano" cae ahí, línea de arriba), nunca de childrenOf.get(parentFilter)
  // (que quedaría vacío porque el padre no está indexado). walk arranca en
  // null en AMBOS casos — arrancar en parentFilter cuando childrenOnly es un
  // id sin hijos indexados y produce una tabla vacía (bug corregido).
  walk(null);
  return ordered;
}

// Arma las filas exportables del Gantt a partir de las mismas filas ya
// visibles en pantalla (`dated`, después de los filtros de estado/tarea
// padre/texto activos) — lo que exporta el usuario es exactamente lo que
// está viendo, nunca datos ocultos por sus propios filtros. numberById y
// depthById ya los calcula GanttChart (numeración jerárquica sobre TODAS
// las actividades, no solo las visibles, para que el número no cambie al
// filtrar). La sangría se simula con espacios porque el PDF es tabla plana
// (sin indentación real de celda).
export function buildGanttExportRows(dated, numberById, depthById, taskStatus) {
  return dated.map(a => ({
    numero:    numberById.get(a.id) || "",
    actividad: "  ".repeat(depthById.get(a.id) || 0) + (a.text || "(sin nombre)"),
    inicio:    a.start_date || "",
    fin:       a.due_date || "",
    estado:    statusOf(taskStatus, a.id),
    avance:    `${Math.max(0, Math.min(100, Number(a.progress) || 0))}%`,
  }));
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
