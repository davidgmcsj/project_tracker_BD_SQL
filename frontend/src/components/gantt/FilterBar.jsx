// FilterBar.jsx — Panel unificado de rango de fechas + estado + alcance.
// Único punto de control del calendario: reemplaza a los antiguos "Zoom"
// (arriba) y "panel de fechas" (abajo), que mostraban la misma idea dos veces.

import { toDate, toISO, fmtDayFull, QUARTERS, SEMESTERS } from "./ganttHelpers";
import TokenFilterBar from "./TokenFilterBar";
import DateInput from "../common/DateInput";

export default function FilterBar({
  range, statusFilter, scopeFilter, parentOptions, parentFilter, textFilter, levelFilter, counts,
  onPickCustomRange, onPickPreset, onSetStatusFilter, onSetScopeFilter, onSetParentFilter, onSetTextFilter, onSetLevelFilter, onClearAllFilters, onClearCustom,
  hasCustom, today, weekAnchor, onWeekNav, isWeekPreset,
  onExportPdf, exporting, onExportImage, exportingImage,
}) {
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
        <span className="gantt__toolbar-sep" />
        <button type="button" className="gantt-date-filter__chip" onClick={onExportPdf} disabled={exporting}>
          {exporting ? "Generando…" : "📄 Exportar PDF"}
        </button>
        <button type="button" className="gantt-date-filter__chip" onClick={onExportImage} disabled={exportingImage}>
          {exportingImage ? "Generando…" : "🖼️ Exportar imagen"}
        </button>
      </div>

      <div className="gantt-filterbar__row">
        <span className="gantt-filterbar__label">Buscar:</span>
        <input
          type="text"
          className="gantt-date-filter__input gantt-text-filter__input"
          placeholder="Nombre de actividad…"
          value={textFilter}
          onChange={e => onSetTextFilter(e.target.value)}
        />
        {textFilter.trim() && (
          <button type="button" className="gantt-date-filter__clear" onClick={() => onSetTextFilter("")}>✕ Limpiar</button>
        )}
      </div>

      <div className="gantt-filterbar__row">
        <span className="gantt-filterbar__label">Rango:</span>
        <label className="gantt-date-filter__label">
          Desde <DateInput className="gantt-date-filter__input" value={toISO(range.start)} onChange={handleFromChange} />
        </label>
        <label className="gantt-date-filter__label">
          Hasta <DateInput className="gantt-date-filter__input" value={toISO(range.end)} onChange={handleToChange} />
        </label>
        {hasCustom && (
          <button type="button" className="gantt-date-filter__clear" onClick={onClearCustom}>✕ Volver al rango automático</button>
        )}
      </div>

      <div className="gantt-filterbar__row">
        <span className="gantt-filterbar__label">Filtros:</span>
        <TokenFilterBar
          statusFilter={statusFilter}
          onSetStatusFilter={onSetStatusFilter}
          parentOptions={parentOptions}
          parentFilter={parentFilter}
          onSetParentFilter={onSetParentFilter}
          scopeFilter={scopeFilter}
          onSetScopeFilter={onSetScopeFilter}
          levelFilter={levelFilter}
          onSetLevelFilter={onSetLevelFilter}
          onClearAll={onClearAllFilters}
          counts={counts}
        />
      </div>
    </div>
  );
}
