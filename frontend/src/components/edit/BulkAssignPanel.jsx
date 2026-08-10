// BulkAssignPanel.jsx — Permite seleccionar un ingeniero y marcar N
// actividades de una sola vez.

import { useState } from "react";
import { estadoActividadLabel } from "../../utils/filtroOpciones";
import { safeArr, safeActs } from "./shared";

export default function BulkAssignPanel({ activities, engineerCatalog, externalContacts, taskStatus, onBulkAssign }) {
  const [expanded,      setExpanded]      = useState(false);
  const [selectedEngId, setSelectedEngId] = useState("");
  const [checked,       setChecked]       = useState(new Set());
  const [query,         setQuery]         = useState("");
  const [filterOwned,   setFilterOwned]   = useState(false); // solo sin responsable

  const acts          = safeActs(activities);
  const completedSet  = new Set(safeArr((taskStatus || {}).completed));
  const inProgressSet = new Set(safeArr((taskStatus || {}).in_progress));
  const activeEngineers = (engineerCatalog || []).filter(e => e.active);
  const activeExternals = (externalContacts || []).filter(c => c.active);

  const getActStatus = (actId) => {
    if (completedSet.has(actId))  return "completed";
    if (inProgressSet.has(actId)) return "in_progress";
    return "not_started";
  };

  // Muestra TODAS las actividades (incluyendo completadas)
  const assignable = acts;

  // Aplica filtros: búsqueda por texto + opción "sin responsable"
  const visible = assignable.filter(a => {
    if (filterOwned && (a.assigned_engineers || []).length > 0) return false;
    if (query.trim()) {
      const words = query.trim().toLowerCase().split(/\s+/);
      const hay   = `${acts.indexOf(a) + 1} ${a.text}`.toLowerCase();
      if (!words.every(w => hay.includes(w))) return false;
    }
    return true;
  });

  const toggleCheck = (id) =>
    setChecked(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectAll  = () => setChecked(new Set(visible.map(a => a.id)));
  const clearAll   = () => setChecked(new Set());

  const handleAssign = () => {
    if (!selectedEngId || checked.size === 0) return;
    onBulkAssign(selectedEngId, [...checked]);
    setChecked(new Set());
  };

  if (!assignable.length) return null;

  const selectedEng = activeEngineers.find(e => e.id === selectedEngId);
  // cuántas de las visibles están marcadas
  const allVisibleChecked = visible.length > 0 && visible.every(a => checked.has(a.id));

  return (
    <div className="bulk-assign-panel">
      {/* ── Cabecera colapsable ── */}
      <div className="bulk-assign-panel__header" onClick={() => setExpanded(e => !e)}>
        <span className="bulk-assign-panel__title">
          ⚡ Asignación Masiva de Responsables
          <span className="bulk-assign-panel__hint">
            Selecciona un ingeniero y marca varias actividades de una vez
          </span>
        </span>
        <span className="bulk-assign-panel__chevron">{expanded ? "▲" : "▼"}</span>
      </div>

      {expanded && (
        <div className="bulk-assign-panel__body">
          {/* ── Controles superiores ── */}
          <div className="bulk-assign-panel__controls">
            <select
              className="field__input bulk-assign-panel__eng-select"
              value={selectedEngId}
              onChange={e => setSelectedEngId(e.target.value)}
            >
              <option value="">— Seleccionar responsable —</option>
              {activeEngineers.length > 0 && (
                <>
                  <option disabled>── Equipo interno ──</option>
                  {activeEngineers.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </>
              )}
              {activeExternals.length > 0 && (
                <>
                  <option disabled>── Colaboradores externos ──</option>
                  {activeExternals.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` (${c.company})` : ""}</option>)}
                </>
              )}
            </select>

            <div className="bulk-assign-panel__search-wrap">
              <input
                className="bulk-assign-panel__search"
                type="text"
                placeholder="Buscar actividad…"
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
              {query && (
                <button type="button" className="bulk-assign-panel__search-clear" onClick={() => setQuery("")}>✕</button>
              )}
            </div>

            <label className="bulk-assign-panel__filter-label">
              <input
                type="checkbox"
                checked={filterOwned}
                onChange={e => setFilterOwned(e.target.checked)}
              />
              Solo sin responsable
            </label>

            <div className="bulk-assign-panel__sel-btns">
              <button
                type="button"
                className="bulk-assign-panel__sel-btn"
                onClick={allVisibleChecked ? clearAll : selectAll}
              >
                {allVisibleChecked ? "✕ Deseleccionar todo" : "✓ Seleccionar todo"}
              </button>
            </div>

            <button
              type="button"
              className={`btn bulk-assign-panel__apply-btn ${checked.size > 0 && selectedEngId ? "bulk-assign-panel__apply-btn--active" : ""}`}
              disabled={!selectedEngId || checked.size === 0}
              onClick={handleAssign}
            >
              Asignar {checked.size > 0 ? checked.size : ""} actividad{checked.size !== 1 ? "es" : ""}
              {selectedEng ? ` → ${selectedEng.name.split(" ")[0]}` : ""}
            </button>
          </div>

          {/* ── Lista de actividades ── */}
          <div className="bulk-assign-panel__list">
            {visible.length === 0 ? (
              <p className="bulk-assign-panel__empty">
                {query || filterOwned ? "Sin actividades que coincidan con los filtros." : "Sin actividades para asignar."}
              </p>
            ) : visible.map(a => {
              const origIdx    = acts.indexOf(a);
              const isChecked  = checked.has(a.id);
              const assignedEngs = a.assigned_engineers || [];
              const actStatus  = getActStatus(a.id);
              const statusLabel = estadoActividadLabel(actStatus);
              const statusMod   = actStatus === "completed" ? "bulk-assign-row__status--done" : actStatus === "in_progress" ? "bulk-assign-row__status--progress" : "bulk-assign-row__status--pending";
              return (
                <label
                  key={a.id}
                  className={`bulk-assign-row${isChecked ? " bulk-assign-row--checked" : ""}`}
                  onClick={() => toggleCheck(a.id)}
                >
                  <input
                    type="checkbox"
                    className="bulk-assign-row__chk"
                    checked={isChecked}
                    onChange={() => {}}
                    onClick={e => e.stopPropagation()}
                  />
                  <span className="bulk-assign-row__num">{origIdx + 1}.</span>
                  <span className="bulk-assign-row__text">{a.text}</span>
                  <span className={`bulk-assign-row__status ${statusMod}`}>{statusLabel}</span>
                  {assignedEngs.length > 0 ? (
                    <span className="bulk-assign-row__owner">
                      {assignedEngs.map(e => e.name.split(' ')[0]).join(' · ')}
                    </span>
                  ) : (
                    <span className="bulk-assign-row__unassigned">Sin responsable</span>
                  )}
                </label>
              );
            })}
          </div>

          {checked.size > 0 && (
            <div className="bulk-assign-panel__footer">
              <span>{checked.size} actividad{checked.size !== 1 ? "es" : ""} seleccionada{checked.size !== 1 ? "s" : ""}</span>
              <button type="button" className="bulk-assign-panel__clear-sel" onClick={clearAll}>Limpiar selección</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
