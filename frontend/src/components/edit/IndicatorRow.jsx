// IndicatorRow.jsx — Fila de indicador (total/completadas/en proceso + %).

import { projectProgress } from "../../utils/formulas";

export default function IndicatorRow({ ind, index, onChange, onRemove }) {
  const pct    = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
  const noInit = Math.max(0, ind.total - ind.completed - ind.in_progress);
  const isOver = ind.completed + ind.in_progress > ind.total;

  const pctColor = pct >= 75
    ? { background: "var(--green-bg)", color: "var(--green)"  }
    : pct >= 40
    ? { background: "var(--amber-bg)", color: "var(--amber)"  }
    : { background: "var(--red-bg)",   color: "var(--red)"    };

  return (
    <div className="indicator-row">
      <div className="indicator-row__top">
        <input
          className="field__input indicator-row__name"
          placeholder="Nombre del indicador…"
          value={ind.name || ""}
          onChange={e => onChange(index, "name", e.target.value)}
        />
        <div className="indicator-row__pct" style={pctColor}>{pct}%</div>
        <button
          type="button" className="btn btn--danger"
          style={{ padding: "4px 12px", fontSize: "12px" }}
          onClick={() => onRemove(index)}
        >
          Quitar
        </button>
      </div>
      <div className="indicator-row__nums">
        {[
          { lbl: "Total actividades", field: "total"       },
          { lbl: "Completadas",       field: "completed"   },
          { lbl: "En proceso",        field: "in_progress" },
        ].map(({ lbl, field }) => (
          <div className="field" key={field}>
            <label className="field__label" style={{ fontSize: "11px" }}>{lbl}</label>
            <input
              className="field__input" type="number" min="0"
              value={ind[field]}
              onFocus={e => e.target.select()}
              style={{ borderColor: isOver && field !== "total" ? "var(--red)" : undefined }}
              onChange={e => onChange(index, field, e.target.value === "" ? "" : Number(e.target.value))}
            />
          </div>
        ))}
        <div className="field">
          <label className="field__label" style={{ fontSize: "11px" }}>No iniciadas (Auto)</label>
          <input
            className="field__input" type="number" readOnly value={noInit}
            style={{ background: "#f8fafc", fontWeight: "bold", color: isOver ? "var(--red)" : "var(--text)" }}
          />
        </div>
      </div>
      {isOver && <div style={{ color: "var(--red)", fontSize: "12px", fontWeight: 600 }}>⚠ Completadas + en proceso supera el total.</div>}
    </div>
  );
}
