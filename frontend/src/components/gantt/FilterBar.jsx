// FilterBar.jsx — Panel unificado de rango de fechas + estado + alcance.
// Único punto de control del calendario: reemplaza a los antiguos "Zoom"
// (arriba) y "panel de fechas" (abajo), que mostraban la misma idea dos veces.

import { toDate, toISO, fmtDayFull, QUARTERS, SEMESTERS, STATUS_FILTERS, SCOPE_FILTERS } from "./ganttHelpers";

export default function FilterBar({ range, statusFilter, scopeFilter, counts, onPickCustomRange, onPickPreset, onSetStatusFilter, onSetScopeFilter, onClearCustom, hasCustom, today, weekAnchor, onWeekNav, isWeekPreset }) {
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
