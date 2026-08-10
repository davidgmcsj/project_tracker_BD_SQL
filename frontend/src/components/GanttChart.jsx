import { useMemo, useState } from "react";
import {
  STATUS_COLOR, LABEL_COL_MIN, LABEL_COL_MAX, LABEL_COL_DEFAULT, DATE_COL_WIDTH,
  toDate, dayDiff, fmtDay, fmtDayFull, fmtMonth, fmtDueLabel, fmtWeek,
  mondayOf, unitForRange, unitDiff, statusOf, lastDayOfMonth, rangeForMonths, computeAutoRange,
} from "./gantt/ganttHelpers";
import { useResizableColumn } from "./gantt/useResizableColumn";
import { useElementWidth } from "./gantt/useElementWidth";
import FilterBar from "./gantt/FilterBar";

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
