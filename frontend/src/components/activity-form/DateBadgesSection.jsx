// DateBadgesSection.jsx — Fechas de transición de estado: Inscrita (added) /
// En proceso (in_progress) / Completada (completed). Se auto-registran al
// cambiar de estado en la app, PERO al importar de Planner no se conocen.
// Por eso son editables aquí: el PMO puede registrar la fecha real de cada
// hito cuando el Excel no la trae.
//
// Modo solo lectura (onChange ausente): muestra badges. Editable: date pickers.

import { formatDateDMY } from "../../utils/formulas";
import DateInput from "../common/DateInput";

const DATE_FIELDS = [
  { key: "added",       label: "Inscrita",    icon: "📌", cls: "added"      },
  { key: "in_progress", label: "En proceso",  icon: "🔄", cls: "inprogress" },
  { key: "completed",   label: "Completada",  icon: "✅", cls: "completed"   },
];

export default function DateBadgesSection({ status, history, onChange }) {
  const h = history || {};

  // Solo lectura: comportamiento original por estado.
  if (!onChange) {
    const shown = status === "completed" ? ["completed"]
      : status === "in_progress" ? ["added", "in_progress"]
      : h.added ? ["added"] : [];
    if (!shown.length) return null;
    return (
      <div className="adm-dates-row">
        {shown.map(k => {
          const f = DATE_FIELDS.find(d => d.key === k);
          return (
            <span key={k} className={`adm-date-badge adm-date-badge--${f.cls}`}>
              <span className="adm-date-badge__icon">{f.icon}</span>
              <span className="adm-date-badge__label">{f.label}</span>
              <span className="adm-date-badge__value">{formatDateDMY(h[k])}</span>
            </span>
          );
        })}
      </div>
    );
  }

  // Editable: los tres campos como date pickers.
  return (
    <div className="adm-dates-edit">
      {DATE_FIELDS.map(f => (
        <label key={f.key} className={`adm-date-edit adm-date-edit--${f.cls}`}>
          <span className="adm-date-edit__head">
            <span className="adm-date-edit__icon">{f.icon}</span>
            {f.label}
          </span>
          <DateInput
            className="adm-date-edit__input"
            value={h[f.key] || ""}
            onChange={iso => onChange({ ...h, [f.key]: iso })}
          />
        </label>
      ))}
    </div>
  );
}
