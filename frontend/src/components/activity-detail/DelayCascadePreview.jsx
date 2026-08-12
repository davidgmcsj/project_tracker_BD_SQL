// DelayCascadePreview.jsx — Pantalla de vista previa del retraso en cascada
// cronológico (ver utils/delayCascade.js). Se abre desde el botón "Agregar
// retraso" de ActivityDetailModal. Muestra TODAS las actividades candidatas
// (cualquiera del proyecto que termine el mismo día o después de la
// actividad de referencia, sin importar jerarquía), con checkbox de
// selección (todas preseleccionadas), y aplica los patches de fecha
// seleccionados por el mismo canal que ya usa HierarchyTable
// (onApplyDateChange). Incluye "Deshacer" mientras la pantalla sigue
// montada — no es un historial persistente, solo una ventana de
// arrepentimiento inmediato tras aplicar.

import { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { computeDelayCandidates, buildReferencePatch } from "../../utils/delayCascade";
import { buildActivityIndex, activityLabel, formatDateDMY } from "../../utils/formulas";

export default function DelayCascadePreview({
  activity,       // actividad de referencia (con due_date)
  allActivities,  // array completo del proyecto
  taskStatus,
  initialDays,    // días precargados desde el diálogo del modal
  onApplyPatches, // (patches[]) => void — mismo canal que onApplyDateChange
  onClose,
}) {
  const [days, setDays] = useState(initialDays || 1);
  const [selectedIds, setSelectedIds] = useState(null); // null = "todas" hasta que el usuario toque algo
  const [applied, setApplied] = useState(null); // { patches, previous } — para Deshacer

  const actIndex = useMemo(() => buildActivityIndex(allActivities), [allActivities]);

  const candidates = useMemo(
    () => computeDelayCandidates(allActivities, taskStatus, activity.id, days),
    [allActivities, taskStatus, activity.id, days]
  );

  // Hasta que el usuario desmarque algo, todas las candidatas están
  // seleccionadas — selectedIds solo se materializa (deja de ser null) en
  // cuanto el usuario interactúa, para no tener que sincronizar un Set con
  // cada recálculo de `candidates` (cambiar `days` recalcula candidates;
  // si ya hay una selección explícita, se preserva solo para los ids que
  // siguen existiendo en el nuevo cálculo).
  const isSelected = (id) => (selectedIds === null ? true : selectedIds.has(id));
  const toggleSelected = (id) => {
    setSelectedIds(prev => {
      const base = prev === null ? new Set(candidates.map(c => c.id)) : new Set(prev);
      if (base.has(id)) base.delete(id); else base.add(id);
      return base;
    });
  };
  const selectedCount = candidates.filter(c => isSelected(c.id)).length;

  const handleApply = () => {
    const refPatch = buildReferencePatch(activity, days);
    const candidatePatches = candidates.filter(c => isSelected(c.id)).map(c => ({
      id: c.id, start_date: c.newStartDate, due_date: c.newDueDate,
    }));
    const patches = refPatch ? [refPatch, ...candidatePatches] : candidatePatches;
    if (!patches.length) return;

    // Captura las fechas ANTERIORES de cada actividad afectada, para poder
    // deshacer — se toma de allActivities (el estado real antes de aplicar),
    // no de `candidates` (que ya trae las fechas propuestas).
    const byId = new Map(allActivities.map(a => [a.id, a]));
    const previous = patches.map(p => {
      const a = byId.get(p.id);
      return { id: p.id, start_date: a?.start_date || "", due_date: a?.due_date || "" };
    });

    onApplyPatches(patches);
    setApplied({ patches, previous });
  };

  const handleUndo = () => {
    if (!applied) return;
    onApplyPatches(applied.previous);
    setApplied(null);
  };

  return createPortal(
    <div className="delay-cascade-overlay">
      <div className="delay-cascade-panel">
        <div className="delay-cascade-header">
          <div>
            <h2 className="delay-cascade-title">Retraso en cascada</h2>
            <p className="delay-cascade-subtitle">{activityLabel(actIndex, activity.id)}</p>
          </div>
          <button type="button" className="delay-cascade-close" onClick={onClose} title="Cerrar">✕</button>
        </div>

        <div className="delay-cascade-controls">
          <label className="delay-cascade-days-label">
            Retraso de
            <input
              type="number"
              min={1}
              className="delay-cascade-days-input"
              value={days}
              onChange={e => { setDays(Math.max(1, Number(e.target.value) || 1)); setSelectedIds(null); }}
            />
            día(s) hábil(es)
          </label>
          <span className="delay-cascade-count">
            {candidates.length} actividad{candidates.length !== 1 ? "es" : ""} candidata{candidates.length !== 1 ? "s" : ""}
            {" · "}{selectedCount} seleccionada{selectedCount !== 1 ? "s" : ""}
          </span>
        </div>

        {applied && (
          <div className="delay-cascade-applied">
            ✓ Se movieron {applied.patches.length} actividad{applied.patches.length !== 1 ? "es" : ""}.
            <button type="button" className="delay-cascade-undo" onClick={handleUndo}>Deshacer</button>
          </div>
        )}

        <div className="delay-cascade-body">
          {candidates.length === 0 ? (
            <p className="delay-cascade-empty">
              Ninguna otra actividad termina el mismo día o después de esta (o todas las candidatas ya están completadas).
              Aun así, se puede aplicar el retraso a esta actividad sola.
            </p>
          ) : (
            <table className="delay-cascade-table">
              <thead>
                <tr>
                  <th></th>
                  <th>Actividad</th>
                  <th>Fin actual</th>
                  <th></th>
                  <th>Fin nuevo</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map(c => (
                  <tr key={c.id} className={isSelected(c.id) ? "" : "delay-cascade-row--unselected"}>
                    <td>
                      <input
                        type="checkbox"
                        checked={isSelected(c.id)}
                        onChange={() => toggleSelected(c.id)}
                      />
                    </td>
                    <td>{activityLabel(actIndex, c.id)}</td>
                    <td>{formatDateDMY(c.currentDueDate)}</td>
                    <td className="delay-cascade-arrow">→</td>
                    <td className="delay-cascade-new-date">{formatDateDMY(c.newDueDate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="delay-cascade-footer">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {applied ? "Listo" : "Cancelar"}
          </button>
          {!applied && (
            <button type="button" className="btn btn--accent" onClick={handleApply}>
              Aplicar a {selectedCount + 1} actividad{selectedCount + 1 !== 1 ? "es" : ""} (incluida esta)
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
