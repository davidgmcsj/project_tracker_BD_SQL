import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── Constantes ────────────────────────────────────────────────────────────────

// Colores por estado — mismo semáforo que HierarchyTable (rojo/azul/verde).
const STATUS_COLOR = {
  not_started: "#d3323c",
  in_progress: "#1a49a8",
  completed:   "#0f9d58",
};

const MONTHS_SHORT = ["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];

// Ventana del rango automático: días a mostrar HACIA ATRÁS desde la ÚLTIMA
// fecha de entrega — el calendario termina justo en esa fecha (columna más a
// la derecha), sin días posteriores.
const AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE = 35;

// Hasta este número de días, cada columna es un día suelto; por encima se
// agrupa en semanas (y más arriba, en meses). El rango automático abarca
// AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE + 1 días (incluye ambos extremos) — debe
// caber aquí para seguir viéndose día a día, que es el caso por defecto.
const DAY_UNIT_MAX_DAYS = AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE + 1;

const LABEL_COL_MIN = 160;
const LABEL_COL_MAX = 640;
const LABEL_COL_DEFAULT = 320;

// Ancho mínimo de cada columna de fecha según la unidad (crecen si sobra
// espacio). El mínimo de "day" contempla la fecha rotulada sobre el bloque de
// entrega ("14/07"), no solo el número del encabezado ("14").
const DATE_COL_WIDTH = { day: 46, week: 84, month: 96 };

const STATUS_FILTERS = [
  { value: "all",         label: "Todas" },
  { value: "not_started", label: "No iniciadas" },
  { value: "in_progress", label: "En proceso" },
  { value: "completed",   label: "Completadas" },
];

// Qué niveles de la jerarquía se listan como filas del calendario.
const SCOPE_FILTERS = [
  { value: "all",   label: "Principales y subtareas" },
  { value: "roots", label: "Solo principales" },
];

// Un único panel de rango de fechas reemplaza al "Zoom" — cada atajo YA
// define su propia granularidad de columna (unit), así el usuario elige
// UNA cosa ("qué periodo quiero ver") en vez de dos controles separados que
// antes se superponían (Zoom + panel de fechas mostraban la misma idea).
const QUARTERS = [
  { key: "T1", label: "T1 (Ene-Mar)", months: [0, 2] },
  { key: "T2", label: "T2 (Abr-Jun)", months: [3, 5] },
  { key: "T3", label: "T3 (Jul-Sep)", months: [6, 8] },
  { key: "T4", label: "T4 (Oct-Dic)", months: [9, 11] },
];
const SEMESTERS = [
  { key: "S1", label: "S1 (Ene-Jun)", months: [0, 5] },
  { key: "S2", label: "S2 (Jul-Dic)", months: [6, 11] },
];

// ── Helpers de fecha ──────────────────────────────────────────────────────────

const toDate = (str) => (str ? new Date(str + "T12:00:00") : null);
const dayDiff = (a, b) => Math.round((b - a) / 86400000);
const toISO = (d) => d.toISOString().slice(0, 10);
const fmtDay = (d) => `${d.getDate()}`;
const fmtDayFull = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
const fmtMonth = (d) => `${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
// Fecha de entrega rotulada DENTRO del bloque de color. Formato corto (14/07)
// para que quepa incluso en la columna de día, que es la más angosta.
const fmtDueLabel = (d) => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
const fmtWeek = (d) => {
  const end = new Date(d); end.setDate(end.getDate() + 6);
  return `${d.getDate()}-${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`;
};

// Lunes de la semana ISO que contiene `d`.
function mondayOf(d) {
  const x = new Date(d);
  const diff = x.getDay() === 0 ? -6 : 1 - x.getDay();
  x.setDate(x.getDate() + diff);
  return x;
}

// Decide la unidad de columna (día/semana/mes) según cuántos días abarca el
// rango efectivo — reemplaza al selector de "Zoom" independiente: la
// granularidad se deriva del propio rango elegido, no de un botón aparte.
function unitForRange(days) {
  if (days <= DAY_UNIT_MAX_DAYS) return "day";
  if (days <= 210) return "week";
  return "month";
}

// Diferencia entre dos fechas medida en la unidad dada — decide en qué
// COLUMNA cae una fecha. day: días calendario. week: semanas ISO completas
// (lunes a lunes). month: meses calendario completos (1º de cada mes).
function unitDiff(unit, from, to) {
  if (unit === "day") return dayDiff(from, to);
  if (unit === "week") {
    const a = mondayOf(from), b = mondayOf(to);
    return Math.round((b - a) / (7 * 86400000));
  }
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function statusOf(taskStatus, actId) {
  if (!taskStatus) return "not_started";
  if ((taskStatus.completed   || []).includes(actId)) return "completed";
  if ((taskStatus.in_progress || []).includes(actId)) return "in_progress";
  return "not_started";
}

function lastDayOfMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0);
}

function rangeForMonths(year, [startMonth, endMonth]) {
  return { start: new Date(year, startMonth, 1), end: lastDayOfMonth(year, endMonth) };
}

// Rango automático por defecto al abrir la vista: termina exactamente en la
// ÚLTIMA fecha de entrega del proyecto (columna más a la derecha) y muestra
// AUTO_RANGE_DAYS_BACK_FROM_LAST_DUE días hacia atrás desde ahí — no hacia
// adelante. Así la vista aterriza donde está el cierre del trabajo, sin
// columnas vacías después de la última entrega.
function computeAutoRange(dated) {
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

// ── Columna de nombre redimensionable (arrastre con el mouse) ───────────────
//
// El primer intento usaba un divisor flotante (position:absolute) separado
// de la tabla, anclado con `left: labelWidth` — en teoría cubría toda la
// altura, pero en la práctica el usuario no lograba agarrarlo parado en
// ninguna fila (probablemente por depender de que un ancestro sin altura
// propia le heredara la altura vía top:0/bottom:0, algo fràgil entre
// navegadores con sticky + overflow mixto). Se reemplaza por el enfoque
// directo: el propio <td>/<th> de la columna "Actividad" — CADA fila, no
// solo el header — escucha mousedown, y si el clic cae en los últimos 10px
// de su borde derecho (medido con getBoundingClientRect, no depende de
// z-index ni overlays), arranca el arrastre. Así "pararse en cualquier
// fila" funciona de forma literal, sin nada flotando encima que pueda fallar
// en alinearse.
const RESIZE_EDGE_PX = 10;

function useResizableColumn(initial, min, max) {
  const [width, setWidth] = useState(initial);
  const dragRef = useRef(null); // { startX, startWidth }

  const onCellMouseDown = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.right - e.clientX > RESIZE_EDGE_PX) return; // clic lejos del borde: no es un intento de resize
    dragRef.current = { startX: e.clientX, startWidth: width };
    e.preventDefault();
  }, [width]);

  // Cursor col-resize solo cuando el mouse está cerca del borde (sin esto,
  // toda la celda mostraría cursor de redimensionar aunque el clic ahí no
  // haga nada, lo cual confunde más de lo que ayuda).
  const onCellMouseMoveHint = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.cursor = (rect.right - e.clientX <= RESIZE_EDGE_PX) ? "col-resize" : "";
  }, []);
  const onCellMouseLeaveHint = useCallback((e) => { e.currentTarget.style.cursor = ""; }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      setWidth(Math.max(min, Math.min(max, dragRef.current.startWidth + delta)));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [min, max]);

  return { width, onCellMouseDown, onCellMouseMoveHint, onCellMouseLeaveHint };
}

// Mide el ancho disponible del contenedor y lo mantiene actualizado al
// redimensionar la ventana. Se necesita para repartir el espacio sobrante
// entre las columnas de fecha cuando la tabla no llena el contenedor.
function useElementWidth() {
  const ref = useRef(null);
  const [elWidth, setElWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setElWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, elWidth];
}

// ── Panel unificado de rango de fechas + estado ─────────────────────────────
// Único punto de control del calendario: reemplaza a los antiguos "Zoom"
// (arriba) y "panel de fechas" (abajo), que mostraban la misma idea dos veces.

function FilterBar({ range, statusFilter, scopeFilter, counts, onPickCustomRange, onPickPreset, onSetStatusFilter, onSetScopeFilter, onClearCustom, hasCustom, today, weekAnchor, onWeekNav, isWeekPreset }) {
  const year = today.getFullYear();

  // Al editar un solo extremo a mano, el otro extremo del `range` puede venir
  // todavía del auto-range (si el usuario no había elegido nada explícito) —
  // heredar ese valor sin más producía rangos absurdos (p.ej. fijar "Desde"
  // en julio pero conservar un "Hasta" de auto-range en octubre, saltando
  // varios meses de columnas vacías). Mientras no haya un rango explícito ya
  // fijado, el otro extremo se ancla a ~1 mes desde el que se acaba de editar.
  const DEFAULT_SPAN_DAYS = 30;
  const handleFromChange = (value) => {
    if (!value) return;
    const start = toDate(value);
    let end = hasCustom ? range.end : null;
    if (!end || end < start) { end = new Date(start); end.setDate(end.getDate() + DEFAULT_SPAN_DAYS); }
    onPickCustomRange({ start, end });
  };
  const handleToChange = (value) => {
    if (!value) return;
    const end = toDate(value);
    let start = hasCustom ? range.start : null;
    if (!start || start > end) { start = new Date(end); start.setDate(start.getDate() - DEFAULT_SPAN_DAYS); }
    onPickCustomRange({ start, end });
  };

  return (
    <div className="gantt-filterbar">
      <div className="gantt-filterbar__row">
        <span className="gantt-filterbar__label">Ver:</span>
        <button type="button" className="gantt-date-filter__chip" onClick={() => onPickPreset("week")}>Semana actual</button>
        {isWeekPreset && (
          <span className="gantt__week-nav">
            <button type="button" className="gantt__week-nav-btn" onClick={() => onWeekNav(-7)} title="Semana anterior">◀</button>
            <span className="gantt__week-nav-label">{fmtDayFull(weekAnchor)}</span>
            <button type="button" className="gantt__week-nav-btn" onClick={() => onWeekNav(7)} title="Semana siguiente">▶</button>
          </span>
        )}
        <button type="button" className="gantt-date-filter__chip" onClick={() => onPickPreset("month")}>Mes actual</button>
        {QUARTERS.map(q => (
          <button key={q.key} type="button" className="gantt-date-filter__chip" onClick={() => onPickPreset("quarter", q)}>{q.label}</button>
        ))}
        {SEMESTERS.map(s => (
          <button key={s.key} type="button" className="gantt-date-filter__chip" onClick={() => onPickPreset("semester", s)}>{s.label}</button>
        ))}
        <button type="button" className="gantt-date-filter__chip" onClick={() => onPickPreset("year")}>Año {year}</button>
        <button type="button" className="gantt-date-filter__chip" onClick={() => onPickPreset("all")}>Todo</button>
      </div>

      <div className="gantt-filterbar__row">
        <span className="gantt-filterbar__label">Rango:</span>
        <label className="gantt-date-filter__label">
          Desde <input type="date" className="gantt-date-filter__input" value={toISO(range.start)} onChange={e => handleFromChange(e.target.value)} />
        </label>
        <label className="gantt-date-filter__label">
          Hasta <input type="date" className="gantt-date-filter__input" value={toISO(range.end)} onChange={e => handleToChange(e.target.value)} />
        </label>
        {hasCustom && (
          <button type="button" className="gantt-date-filter__clear" onClick={onClearCustom}>✕ Volver al rango automático</button>
        )}

        <span className="gantt__toolbar-sep" />
        <span className="gantt-filterbar__label">Estado:</span>
        {STATUS_FILTERS.map(f => (
          <button
            key={f.value} type="button"
            className={`gantt__filter-chip${statusFilter === f.value ? " gantt__filter-chip--on" : ""}`}
            onClick={() => onSetStatusFilter(f.value)}
          >
            {f.label}{f.value !== "all" ? ` (${counts[f.value]})` : ""}
          </button>
        ))}

        <span className="gantt__toolbar-sep" />
        <span className="gantt-filterbar__label">Mostrar:</span>
        {SCOPE_FILTERS.map(f => (
          <button
            key={f.value} type="button"
            className={`gantt__filter-chip${scopeFilter === f.value ? " gantt__filter-chip--on" : ""}`}
            onClick={() => onSetScopeFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Componente ────────────────────────────────────────────────────────────────

export default function GanttChart({ activities, taskStatus, onOpenActivity }) {
  const [statusFilter, setStatusFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all"); // "all" | "roots" — ver SCOPE_FILTERS
  const [hoverRow, setHoverRow] = useState(null);
  const [hoverCol, setHoverCol] = useState(null);
  const [weekAnchor, setWeekAnchor] = useState(null); // no-null = modo "semana navegable" activo
  const [customRange, setCustomRange] = useState(null); // {start,end} fijado a mano o por atajo — tiene prioridad sobre el automático
  const [forceAll, setForceAll] = useState(false); // "Todo" — rango real de TODAS las actividades, sin recorte de +3 días
  const { width: labelWidth, onCellMouseDown: onLabelCellMouseDown, onCellMouseMoveHint: onLabelCellMouseMove, onCellMouseLeaveHint: onLabelCellMouseLeave } =
    useResizableColumn(LABEL_COL_DEFAULT, LABEL_COL_MIN, LABEL_COL_MAX);
  const [scrollRef, containerWidth] = useElementWidth();

  const today = useMemo(() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }, []);

  // Numeración jerárquica ("1", "1.1", "1.1.2") calculada sobre TODAS las
  // actividades, no solo las visibles: así el número de una fila no cambia al
  // aplicar filtros — sigue siendo el mismo que en la planificación completa.
  const { numberById, depthById } = useMemo(() => {
    const acts = activities || [];
    const ids = new Set(acts.map(a => a.id));
    const childrenOf = new Map();
    acts.forEach(a => {
      const parentId = a.parent_id && ids.has(a.parent_id) ? a.parent_id : null;
      if (!childrenOf.has(parentId)) childrenOf.set(parentId, []);
      childrenOf.get(parentId).push(a);
    });
    const numbers = new Map(), depths = new Map();
    const walk = (parentId, prefix, depth) => {
      (childrenOf.get(parentId) || []).forEach((a, i) => {
        const label = prefix ? `${prefix}.${i + 1}` : `${i + 1}`;
        numbers.set(a.id, label);
        depths.set(a.id, depth);
        walk(a.id, label, depth + 1);
      });
    };
    walk(null, "", 0);
    return { numberById: numbers, depthById: depths };
  }, [activities]);

  const counts = useMemo(() => {
    const c = { not_started: 0, in_progress: 0, completed: 0 };
    (activities || []).forEach(a => {
      if (!(a.start_date || a.due_date)) return;
      c[statusOf(taskStatus, a.id)]++;
    });
    return c;
  }, [activities, taskStatus]);

  // Filas del calendario, en orden jerárquico (cada subtarea debajo de su
  // tarea principal) en vez del orden crudo del array. Solo se listan las que
  // tienen alguna fecha — una fila sin fechas no tiene celda que pintar.
  const dated = useMemo(() => {
    const acts = activities || [];
    const visible = acts.filter(a =>
      (a.start_date || a.due_date) &&
      (statusFilter === "all" || statusOf(taskStatus, a.id) === statusFilter) &&
      (scopeFilter === "all" || !a.parent_id)
    );
    if (scopeFilter === "roots") return visible;

    // Ordena por jerarquía: raíces en su orden original y, tras cada una, sus
    // descendientes. Las huérfanas (padre inexistente o filtrado por estado)
    // se listan al final para que nunca desaparezcan del calendario.
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
    walk(null);
    return ordered;
  }, [activities, taskStatus, statusFilter, scopeFilter]);

  // Rango efectivo, en orden de prioridad:
  // 1. weekAnchor — modo semana navegable, 7 días fijos, ◀/▶ para moverse.
  // 2. customRange — el usuario fijó una fecha a mano o eligió un atajo de período.
  // 3. por defecto — rango automático ajustado al contenido (computeAutoRange).
  const range = useMemo(() => {
    if (weekAnchor) {
      const end = new Date(weekAnchor); end.setDate(end.getDate() + 6);
      return { start: weekAnchor, end };
    }
    if (customRange) return customRange;
    return computeAutoRange(dated);
  }, [weekAnchor, customRange, dated]);

  const unit = range ? unitForRange(dayDiff(range.start, range.end) + 1) : "day";

  const handlePickPreset = (kind, item) => {
    const year = today.getFullYear();
    if (kind === "week")     { setWeekAnchor(mondayOf(today)); setCustomRange(null); setForceAll(false); return; }
    // Mes actual: fija el mes calendario completo (1º a último día), no el
    // auto-range recortado — el usuario pidió ver el mes entero al elegirlo
    // explícitamente; el recorte de +3 días solo aplica quien no elige nada.
    if (kind === "month")    { setWeekAnchor(null); setCustomRange({ start: new Date(year, today.getMonth(), 1), end: lastDayOfMonth(year, today.getMonth()) }); setForceAll(false); return; }
    if (kind === "all")      { setWeekAnchor(null); setCustomRange(null); setForceAll(true); return; }
    if (kind === "quarter")  { setWeekAnchor(null); setCustomRange(rangeForMonths(year, item.months)); setForceAll(false); return; }
    if (kind === "semester") { setWeekAnchor(null); setCustomRange(rangeForMonths(year, item.months)); setForceAll(false); return; }
    if (kind === "year")     { setWeekAnchor(null); setCustomRange({ start: new Date(year, 0, 1), end: new Date(year, 11, 31) }); setForceAll(false); return; }
  };

  // "Todo" necesita el rango real de TODAS las actividades con fecha (sin
  // recorte de +3 días), independiente del filtro de estado activo.
  const allActivitiesRange = useMemo(() => {
    if (!forceAll) return null;
    let min = null, max = null;
    (activities || []).forEach(a => {
      const d = toDate(a.due_date) || toDate(a.start_date);
      if (d && (!min || d < min)) min = d;
      if (d && (!max || d > max)) max = d;
    });
    return min && max ? { start: min, end: max } : null;
  }, [forceAll, activities]);

  const effectiveRange = forceAll && allActivitiesRange ? allActivitiesRange : range;
  const effectiveUnit = forceAll && allActivitiesRange ? unitForRange(dayDiff(allActivitiesRange.start, allActivitiesRange.end) + 1) : unit;

  const handleWeekNav = (deltaDays) => {
    setWeekAnchor(d => { const n = new Date(d); n.setDate(n.getDate() + deltaDays); return n; });
  };

  const handleClearCustom = () => { setCustomRange(null); setWeekAnchor(null); setForceAll(false); };

  const handleCustomRangeInput = (r) => {
    setForceAll(false);
    setWeekAnchor(null);
    setCustomRange(r);
  };

  if (!dated.length) {
    const totalDated = (activities || []).filter(a => a.start_date || a.due_date).length;
    if (statusFilter !== "all" && totalDated > 0) {
      return (
        <div className="gantt-empty">
          Ninguna actividad con fechas coincide con el filtro seleccionado.{" "}
          <button type="button" className="gantt-empty__link" onClick={() => setStatusFilter("all")}>Mostrar todas</button>
        </div>
      );
    }
    return (
      <div className="gantt-empty">
        Ninguna actividad tiene fechas de inicio o fin. Asigna fechas en el detalle de cada
        actividad para verlas en el calendario.
      </div>
    );
  }

  if (!effectiveRange) {
    return <div className="gantt-empty">No hay actividades con fechas en el rango seleccionado.</div>;
  }

  const totalUnits = unitDiff(effectiveUnit, effectiveRange.start, effectiveRange.end) + 1;

  // En modo semana, la columna 0 debe ser el LUNES real de la semana que
  // contiene effectiveRange.start — no ese día exacto. unitDiff() ya usa
  // mondayOf(from) como ancla para decidir en qué columna cae cada actividad
  // (semanas calendario reales, lunes-domingo); si las columnas visuales
  // arrancaran en un día suelto (ej. "Desde" = un sábado), cada bloque de 7
  // días quedaría desalineado de la semana calendario real que unitDiff usa
  // para ubicar las actividades — el bug exacto de la captura: una tarea del
  // 6/jul (lunes) se ubicaba en la columna "11-17 jul" en vez de "6-12 jul".
  const weekAnchorDate = effectiveUnit === "week" ? mondayOf(effectiveRange.start) : null;

  const columns = [];
  for (let i = 0; i < totalUnits; i++) {
    let d;
    if (effectiveUnit === "day") { d = new Date(effectiveRange.start); d.setDate(d.getDate() + i); }
    else if (effectiveUnit === "week") { d = new Date(weekAnchorDate); d.setDate(d.getDate() + i * 7); }
    else { d = new Date(effectiveRange.start.getFullYear(), effectiveRange.start.getMonth() + i, 1); }
    const isWeekend = effectiveUnit === "day" && (d.getDay() === 0 || d.getDay() === 6);
    columns.push({
      date: d,
      label: effectiveUnit === "day" ? fmtDay(d) : effectiveUnit === "week" ? fmtWeek(d) : fmtMonth(d),
      fullLabel: effectiveUnit === "day" ? fmtDayFull(d) : effectiveUnit === "week" ? fmtWeek(d) : fmtMonth(d),
      isWeekend,
    });
  }

  const todayColIndex = (today >= effectiveRange.start && today <= effectiveRange.end)
    ? unitDiff(effectiveUnit, effectiveRange.start, today)
    : null;

  // Las columnas de fecha reparten el espacio que sobra tras la columna
  // "Actividad", sin bajar nunca del mínimo legible de su unidad. Si no caben
  // ni en el mínimo, se usa el mínimo y .gantt__scroll aporta scroll
  // horizontal. containerWidth es 0 en el primer render (antes de medir): ahí
  // se usa el mínimo para evitar un parpadeo de columnas gigantes.
  const minDateCol = DATE_COL_WIDTH[effectiveUnit];
  const freeSpace = containerWidth - labelWidth;
  const dateColWidth = (containerWidth > 0 && columns.length > 0)
    ? Math.max(minDateCol, Math.floor(freeSpace / columns.length))
    : minDateCol;

  return (
    <div className="gantt">
      <FilterBar
        range={effectiveRange}
        statusFilter={statusFilter}
        scopeFilter={scopeFilter}
        counts={counts}
        onPickCustomRange={handleCustomRangeInput}
        onPickPreset={handlePickPreset}
        onSetStatusFilter={setStatusFilter}
        onSetScopeFilter={setScopeFilter}
        onClearCustom={handleClearCustom}
        hasCustom={!!customRange || !!weekAnchor || forceAll}
        today={today}
        weekAnchor={weekAnchor}
        onWeekNav={handleWeekNav}
        isWeekPreset={!!weekAnchor}
      />

      <div className="gantt__scroll" ref={scrollRef}>
        {/* Las columnas de fecha se estiran para llenar el espacio que deja la
            columna "Actividad", y nunca bajan de su ancho mínimo legible. Así,
            al angostar "Actividad" el calendario se ensancha (en vez de dejar
            un hueco en blanco), y al ensancharla las fechas se encogen hasta
            el mínimo y recién entonces aparece scroll horizontal. */}
        <table className="gantt-cal" style={{ width: Math.max(containerWidth, labelWidth + columns.length * dateColWidth) }}>
          {/* Los anchos se fijan aquí: con table-layout:fixed el <colgroup> es
              lo único que el navegador respeta (ignora min-width en celdas). */}
          <colgroup>
            <col style={{ width: labelWidth }} />
            {columns.map((_, i) => <col key={i} style={{ width: dateColWidth }} />)}
          </colgroup>
          <thead>
            <tr>
              {/* Redimensionable desde CUALQUIER fila, no solo aquí: cada
                  <td>/<th> de esta columna (header y filas, más abajo)
                  escucha su propio borde derecho — ver useResizableColumn. */}
              <th
                className="gantt-cal__label-col gantt-cal__label-col--resizable"
                onMouseDown={onLabelCellMouseDown}
                onMouseMove={onLabelCellMouseMove}
                onMouseLeave={onLabelCellMouseLeave}
                title="Actividad — arrastra el borde derecho para ensanchar"
              >
                Actividad
              </th>
              {columns.map((c, i) => (
                <th
                  key={i}
                  className={`gantt-cal__col-head${c.isWeekend ? " gantt-cal__col-head--weekend" : ""}${todayColIndex === i ? " gantt-cal__col-head--today" : ""}`}
                  title={c.fullLabel}
                  onMouseEnter={() => setHoverCol(i)}
                  onMouseLeave={() => setHoverCol(null)}
                >
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {dated.map(a => {
              const due = toDate(a.due_date) || toDate(a.start_date);
              const dueColIndex = due ? unitDiff(effectiveUnit, effectiveRange.start, due) : null;
              const st = statusOf(taskStatus, a.id);
              const prog = Math.max(0, Math.min(100, Number(a.progress) || 0));
              const isRowHover = hoverRow === a.id;

              return (
                <tr
                  key={a.id}
                  className={`gantt-cal__row${isRowHover ? " gantt-cal__row--hover" : ""}`}
                  onClick={() => onOpenActivity?.(a.id)}
                  onMouseEnter={() => setHoverRow(a.id)}
                  onMouseLeave={() => setHoverRow(null)}
                >
                  <td
                    className="gantt-cal__label-col gantt-cal__label-col--resizable"
                    title={`${numberById.get(a.id)}. ${a.text}`}
                    onMouseDown={e => { onLabelCellMouseDown(e); if (e.defaultPrevented) e.stopPropagation(); }}
                    onMouseMove={onLabelCellMouseMove}
                    onMouseLeave={onLabelCellMouseLeave}
                  >
                    {/* Sangría por nivel: las subtareas se ven colgando de su
                        tarea principal, como en la planificación completa. */}
                    <span style={{ paddingLeft: (depthById.get(a.id) || 0) * 14 }}>
                      <span className="gantt-cal__row-num">{numberById.get(a.id)}.</span>
                      <span className="gantt-cal__row-text">{a.text || "(sin nombre)"}</span>
                    </span>
                  </td>
                  {columns.map((c, i) => {
                    const isDue = i === dueColIndex;
                    const isColHover = hoverCol === i;
                    return (
                      <td
                        key={i}
                        className={[
                          "gantt-cal__cell",
                          c.isWeekend && "gantt-cal__cell--weekend",
                          isColHover && "gantt-cal__cell--col-hover",
                          isDue && `gantt-cal__cell--due gantt-cal__cell--due-${st}`,
                        ].filter(Boolean).join(" ")}
                        style={isDue ? { background: STATUS_COLOR[st] } : undefined}
                        title={isDue ? `${a.text}\nEntrega: ${a.due_date || a.start_date} · ${prog}% avance` : undefined}
                      >
                        {isDue && <span className="gantt-cal__due-label">{fmtDueLabel(due)}</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="gantt__legend">
        <span className="gantt__legend-item"><span className="gantt__legend-swatch gantt__legend-swatch--today" /> Hoy</span>
        <span className="gantt__legend-item"><span className="gantt__legend-swatch" style={{ background: STATUS_COLOR.not_started }} /> No iniciada</span>
        <span className="gantt__legend-item"><span className="gantt__legend-swatch" style={{ background: STATUS_COLOR.in_progress }} /> En proceso</span>
        <span className="gantt__legend-item"><span className="gantt__legend-swatch" style={{ background: STATUS_COLOR.completed }} /> Completada</span>
        <span className="gantt__legend-item gantt__legend-item--hint">Cada fila pinta la columna de su fecha de entrega. Arrastra el borde de "Actividad" para ensancharla. Clic en una fila para editar.</span>
      </div>
    </div>
  );
}
