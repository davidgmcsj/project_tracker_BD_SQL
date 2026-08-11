// EngineerRow.jsx — Fila de ingeniero asignado al proyecto, con su tabla de
// "esta semana" calculada automáticamente desde las fechas de sus actividades.

import { useState, useEffect, useMemo } from "react";
import { activitiesForEngineerWeek } from "../../utils/weekPlanning";
import { safeArr, CURRENT_WEEK } from "./shared";
import WeekActivitiesTable from "./WeekActivitiesTable";

const CREATE_ENGINEER_OPTION = "__create__";

export default function EngineerRow({ eng, index, onChange, onRemove, activities, taskStatus, engineerCatalog, onCreateEngineer, onOpenActivity }) {
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");

  // "Esta semana" ya no se selecciona a mano: se deduce de las fechas de
  // inicio/fin de las actividades asignadas a este ingeniero, por
  // solapamiento con la semana actual (ver utils/weekPlanning.js). Una tarea
  // de varias semanas aparece sola en cada una que atraviesa.
  const weekRows = useMemo(() => {
    if (!eng.engineer_id) return [];
    return activitiesForEngineerWeek(activities, CURRENT_WEEK, taskStatus, eng.engineer_id);
  }, [activities, taskStatus, eng.engineer_id]);
  const weekIds = weekRows.map(r => r.activity.id);
  // Comparación por contenido (no por referencia): el array se recalcula en
  // cada render pero solo debe escribirse en el proyecto cuando cambia lo
  // que contiene, para no disparar guardados/renders de más.
  const weekIdsKey = weekIds.join(",");

  useEffect(() => {
    const current = safeArr(eng.weekly_detail);
    if (current.join(",") === weekIdsKey) return;
    onChange(index, "weekly_detail", weekIds);
    if (eng.weekly_total !== weekIds.length) onChange(index, "weekly_total", weekIds.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- se recalcula por weekIdsKey (contenido), no por identidad de weekIds
  }, [weekIdsKey]);

  const confirmCreate = () => {
    const name = newName.trim();
    if (!name) return;
    const id = onCreateEngineer(name, "");
    onChange(index, "engineer_id", id);
    setCreating(false);
    setNewName("");
  };

  return (
    <div className="engineer-card">
      <div className="engineer-card__header">
        <div className="engineer-row__name">
          {creating ? (
            <div className="list-field-draft">
              <input
                className="field__input list-field-draft__input"
                autoFocus value={newName}
                placeholder="Nombre del nuevo ingeniero…"
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") { e.preventDefault(); confirmCreate(); }
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <button type="button" className="list-field-draft__ok"     onClick={confirmCreate}            title="Crear">✓</button>
              <button type="button" className="list-field-draft__cancel" onClick={() => setCreating(false)} title="Cancelar">✕</button>
            </div>
          ) : (
            <select
              className="field__input"
              value={eng.engineer_id}
              onChange={e => {
                if (e.target.value === CREATE_ENGINEER_OPTION) setCreating(true);
                else onChange(index, "engineer_id", e.target.value);
              }}
            >
              <option value="">Seleccionar ingeniero…</option>
              {(engineerCatalog || []).filter(e => e.active || e.id === eng.engineer_id).map(e => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
              <option value={CREATE_ENGINEER_OPTION}>+ Crear nuevo ingeniero…</option>
            </select>
          )}
        </div>
        <button
          type="button" className="btn btn--danger"
          style={{ padding: "4px 14px", fontSize: "12px", alignSelf: "flex-start" }}
          onClick={() => onRemove(index)}
        >
          Quitar
        </button>
      </div>

      <div className="engineer-card__sections engineer-card__sections--single">
        <div className="engineer-section">
          <div className="engineer-section__title">
            Esta semana
            {weekRows.length > 0 && <span className="engineer-selected__count">{weekRows.length}</span>}
            <span className="engineer-week-auto-hint" title="Calculado automáticamente desde las fechas de inicio/fin de cada actividad">
              🔄 automático
            </span>
          </div>
          {!eng.engineer_id ? (
            <p className="engineer-selected__empty">Selecciona un ingeniero para ver sus tareas de la semana.</p>
          ) : weekRows.length === 0 ? (
            <p className="engineer-selected__empty">Sin actividades asignadas que crucen esta semana.</p>
          ) : (
            <WeekActivitiesTable rows={weekRows} onOpenActivity={onOpenActivity} />
          )}
        </div>
      </div>
    </div>
  );
}
