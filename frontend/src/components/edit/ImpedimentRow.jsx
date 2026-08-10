// ImpedimentRow.jsx — Fila de impedimento/riesgo/salida no conforme.

import { IMPEDIMENT_META, IMPEDIMENT_TYPES } from "./shared";

export default function ImpedimentRow({ item, index, onChange, onRemove }) {
  const meta = IMPEDIMENT_META[item.category] || IMPEDIMENT_TYPES[0];
  return (
    <div className="impediment-row">
      <div className="impediment-row__header">
        <span className="impediment-row__badge">{meta.icon} {meta.label}</span>
        <button
          type="button" className="btn btn--danger"
          style={{ padding: "3px 12px", fontSize: "12px" }}
          onClick={() => onRemove(index)}
        >
          Quitar
        </button>
      </div>
      <div className="field" style={{ marginTop: 6 }}>
        <label className="field__label" style={{ fontSize: "11px" }}>Descripción</label>
        <textarea
          className="field__textarea" rows={2}
          value={item.description || ""}
          placeholder={`Describe el ${meta.label.toLowerCase()}…`}
          onChange={e => onChange(index, "description", e.target.value)}
        />
      </div>
      {meta.hasImpact && (
        <div className="field" style={{ marginTop: 4 }}>
          <label className="field__label" style={{ fontSize: "11px" }}>Impacto</label>
          <textarea
            className="field__textarea" rows={2}
            value={item.impact || ""}
            placeholder="Describe el impacto…"
            onChange={e => onChange(index, "impact", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
