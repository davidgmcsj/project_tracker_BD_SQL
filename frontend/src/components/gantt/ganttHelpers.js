// ganttHelpers.js — Constantes y helpers puros de fecha/rango para el
// calendario Gantt. Sin hooks: todo lo que GanttChart y FilterBar necesitan
// calcular sin depender del ciclo de vida de React.

import { matchesSearch } from "../../utils/search.js";
import { formatDateDMY } from "../../utils/formulas/dateHelpers.js";

// Colores por estado. "not_started" usa el amarillo institucional (#FFCC00,
// mismo --inst-amarillo de base.css) en vez del rojo del semáforo del resto
// de la app — el usuario pidió el cambio explícitamente para el Gantt: el
// rojo se leía como "peligro/alarma" para actividades que simplemente aún no
// han arrancado, generando ruido visual innecesario. in_progress/completed
// se mantienen igual (mismo semáforo que HierarchyTable).
export const STATUS_COLOR = {
  not_started: "#FFCC00",
  in_progress: "#1a49a8",
  completed:   "#0f9d58",
};

// "#rrggbb" + alpha (0..1) → "rgba(r, g, b, alpha)" — usado para pintar la
// barra de la actividad con intensidad creciente (ver barIntensity) sin
// depender de `opacity` en CSS, que además atenuaría el texto/borde de la
// celda, no solo el relleno.
export function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export const MONTHS_SHORT = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// Ventana del rango automático: días a mostrar HACIA ATRÁS desde la ÚLTIMA
// fecha de entrega — el calendario termina justo en esa fecha (columna más a
// la derecha), sin días posteriores. 50 días (antes 35) para reducir el caso
// de actividades con start_date/due_date más atrás que quedaban fuera de la
// ventana visible al aplicar un filtro (Estado/Tarea padre) — con la barra de
// scroll horizontal ya existente, el usuario puede desplazarse dentro de la
// ventana ampliada en vez de perder filas por completo.
export const AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE = 50;

// Hasta este número de días, cada columna es un día suelto; por encima se
// agrupa en semanas (y más arriba, en meses). El rango automático abarca
// AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE + 1 días (incluye ambos extremos) — debe
// caber aquí para seguir viéndose día a día, que es el caso por defecto.
export const DAY_UNIT_MAX_DAYS = AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE + 1;

// Altura de fila: mínimo legible (igual al valor fijo de siempre), y un
// techo para que con pocas filas (ej. filtro "Nivel 1") no queden gigantes y
// vacías de contenido — más allá de ~64px una fila de una sola línea de
// texto se ve desproporcionada, no "mejor".
export const ROW_HEIGHT_MIN = 30;
export const ROW_HEIGHT_MAX = 64;
export const HEADER_HEIGHT = 30; // altura real de gantt-cal__col-head (thead)

// Altura de fila dinámica: reparte el alto disponible del contenedor entre
// las filas visibles para que el calendario llene el espacio en vez de
// dejar un hueco vacío debajo cuando hay pocas actividades (ver captura del
// usuario con "Nivel 2" — filas apretadas a 30px con medio panel en blanco).
// Nunca baja del mínimo legible ni sube del techo. Sin filas o sin alto
// medido todavía (containerHeight 0, primer render), usa el mínimo.
export function computeRowHeight(containerHeight, rowCount) {
  if (!containerHeight || rowCount <= 0) return ROW_HEIGHT_MIN;
  const available = containerHeight - HEADER_HEIGHT;
  const perRow = Math.floor(available / rowCount);
  return Math.max(ROW_HEIGHT_MIN, Math.min(ROW_HEIGHT_MAX, perRow));
}

export const LABEL_COL_MIN = 160;
export const LABEL_COL_MAX = 640;
export const LABEL_COL_DEFAULT = 320;

// Ancho aproximado por carácter a font-size 13px (.gantt-cal__row-text, ver
// gantt.css) — heurística de medición (no canvas real, para que sea puro y
// testeable) suficiente porque el CSS ya trunca con ellipsis: si la
// estimación se queda corta en algún caso raro (fuente muy ancha, etc.), el
// texto simplemente se ve truncado en vez de desbordar, nunca rompe el layout.
const CHAR_WIDTH_PX = 6.5;
const LABEL_COL_PADDING_PX = 44; // padding horizontal + número "1.2.3." + sangría base

// Ancho ideal de la columna "Actividad": el necesario para mostrar SIN
// truncar la fila más larga entre las visibles (número + sangría por nivel +
// texto), acotado entre LABEL_COL_MIN y LABEL_COL_MAX — pasado el máximo, el
// texto se trunca con ellipsis (ya lo hace .gantt-cal__row-text) en vez de
// seguir creciendo la columna sin límite. Devuelve LABEL_COL_DEFAULT si no
// hay filas (nada que medir).
export function computeIdealLabelWidth(dated, numberById, depthById) {
  if (!dated || !dated.length) return LABEL_COL_DEFAULT;
  let maxChars = 0;
  dated.forEach(a => {
    const number = numberById.get(a.id) || "";
    const depth = depthById.get(a.id) || 0;
    const text = a.text || "(sin nombre)";
    // La sangría (depth * 14px, ver paddingLeft inline en GanttChart.jsx) se
    // traduce a "caracteres equivalentes" para sumarla a la misma heurística.
    const indentChars = (depth * 14) / CHAR_WIDTH_PX;
    const chars = indentChars + number.length + 2 + text.length; // +2 por ". " tras el número
    if (chars > maxChars) maxChars = chars;
  });
  const ideal = Math.ceil(maxChars * CHAR_WIDTH_PX) + LABEL_COL_PADDING_PX;
  return Math.max(LABEL_COL_MIN, Math.min(LABEL_COL_MAX, ideal));
}

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

// Selector de profundidad máxima — "" (sin límite) o 1..4. Nivel 1 = solo
// tareas principales; nivel 2 = +1er nivel de subtareas; etc. Mismo tope de 4
// que Planificación (HierarchyTable), en la práctica ningún proyecto real
// pasa de ahí.
export const LEVEL_FILTERS = [
  { value: "",  label: "Todos los niveles" },
  { value: "1", label: "Nivel 1 (solo principales)" },
  { value: "2", label: "Nivel 2" },
  { value: "3", label: "Nivel 3" },
  { value: "4", label: "Nivel 4" },
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

// Rango de columnas [inicio, fin] que ocupa la barra de una actividad, en la
// unidad activa (día/semana/mes) y recortado a las columnas realmente
// visibles (0..totalUnits-1) — una barra que arranca antes del rango elegido
// se corta en la columna 0 en vez de desbordar hacia índices negativos, y
// una que sigue después del rango visible se corta en la última columna.
// Sin start_date, la barra colapsa a un solo punto en dueColIndex (mismo
// comportamiento que antes de esta mejora). Devuelve null si no hay ninguna
// fecha usable.
export function computeBarSpan(activity, unit, rangeStart, totalUnits) {
  const due = toDate(activity.due_date) || toDate(activity.start_date);
  if (!due) return null;
  const dueColIndex = unitDiff(unit, rangeStart, due);

  const start = toDate(activity.start_date);
  const startColIndexRaw = start ? unitDiff(unit, rangeStart, start) : dueColIndex;
  // Una fecha de inicio posterior a la de entrega (dato inconsistente) no
  // debe invertir la barra — colapsa al punto de entrega, igual que sin inicio.
  const startColIndex = Math.min(startColIndexRaw, dueColIndex);

  const clampedStart = Math.max(0, startColIndex);
  const clampedDue = Math.min(totalUnits - 1, dueColIndex);
  if (clampedDue < 0 || clampedStart > totalUnits - 1) return null; // fuera del rango visible

  return { startColIndex: clampedStart, dueColIndex: clampedDue };
}

// Intensidad (0..1) de la celda en `colIndex` dentro de la barra
// [startColIndex, dueColIndex] — 0.35 en el primer día (visible pero suave,
// nunca invisible) creciendo LINEALMENTE hasta 1 en el día de entrega. Un
// span de un solo día (startColIndex === dueColIndex, el caso sin
// start_date) da intensidad 1 directamente, igual que el bloque sólido de
// antes de esta mejora.
export function barIntensity(colIndex, startColIndex, dueColIndex) {
  const span = dueColIndex - startColIndex;
  if (span <= 0) return 1;
  const MIN_INTENSITY = 0.35;
  const progress = (colIndex - startColIndex) / span;
  return MIN_INTENSITY + (1 - MIN_INTENSITY) * progress;
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

// Profundidad (0 = raíz, 1 = hijo directo…) de cada actividad, calculada
// sobre TODAS las actividades del proyecto (no solo las visibles tras otros
// filtros) — así el nivel de una fila no cambia según qué más esté filtrado.
// Un parent_id huérfano (apunta a un id inexistente) se trata como raíz.
function depthOf(activities) {
  const byId = new Map((activities || []).map(a => [a.id, a]));
  const depths = new Map();
  const resolve = (id, seen) => {
    if (depths.has(id)) return depths.get(id);
    const a = byId.get(id);
    const parentId = a?.parent_id;
    if (!parentId || !byId.has(parentId) || seen.has(parentId)) { depths.set(id, 0); return 0; }
    const d = resolve(parentId, new Set(seen).add(id)) + 1;
    depths.set(id, d);
    return d;
  };
  (activities || []).forEach(a => resolve(a.id, new Set()));
  return depths;
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
//
// levelFilter: profundidad MÁXIMA a mostrar (1 = solo raíces, 2 = raíces +
// hijas directas, 3 = +nietas, 4 = +bisnietas), o null = sin límite. Mismo
// criterio de "techo de profundidad fijo" que el selector de Planificación
// (HierarchyTable) — no es un colapso manual, se recalcula solo.
//
// statusFilter acepta: "all" (compat), string único ("not_started"), o array
// de valores (["not_started","in_progress"]) — un array combina con OR entre
// sí (la actividad matchea si su estado está en la lista), mismo patrón
// "estilo GitLab" que el resto de tipos de filtro token-izables (ver
// TokenFilterBar). Array vacío o "all" = sin filtrar por estado.
export function computeDatedRows(activities, taskStatus, { statusFilter = "all", scopeFilter = "all", parentFilter = null, textFilter = "", levelFilter = null } = {}) {
  const acts = activities || [];
  const statusValues = statusFilter === "all" ? [] : Array.isArray(statusFilter) ? statusFilter : [statusFilter];
  const descendantIds = descendantIdsOf(acts, parentFilter);
  // Con una "Tarea padre" elegida, el nivel se cuenta RELATIVO a ese padre
  // (su propia fila siempre es nivel 1) — así levelFilter no la excluye a
  // ella misma solo por estar en profundidad 2 o 3 del proyecto completo.
  const depths = levelFilter ? depthOf(acts) : null;
  const baseDepth = parentFilter && depths ? (depths.get(parentFilter) || 0) : 0;
  const visible = acts.filter(a => {
    if (!(a.start_date || a.due_date)) return false;
    if (statusValues.length && !statusValues.includes(statusOf(taskStatus, a.id))) return false;
    if (!matchesSearch(a.text || "", textFilter)) return false;
    if (levelFilter && (depths.get(a.id) - baseDepth) >= levelFilter) return false;
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
    inicio:    a.start_date ? formatDateDMY(a.start_date) : "",
    fin:       a.due_date ? formatDateDMY(a.due_date) : "",
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
