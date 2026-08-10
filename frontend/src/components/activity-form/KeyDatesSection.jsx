// KeyDatesSection.jsx — Lista de hitos/fechas clave de una actividad
// (fecha + descripción libre), distinta de las fechas de transición de
// estado (DateBadgesSection).

import { useState } from "react";
import { createKeyDate } from "../../utils/formulas";

export default function KeyDatesSection({ items, onChange }) {
  const confirm = (date, label) => {
    if (date || label) onChange([...items, createKeyDate(date, label)]);
  };

  const [draftDate,  setDraftDate]  = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const update = (id, field, val) =>
    onChange(items.map(it => it.id === id ? { ...it, [field]: val } : it));

  const remove = (id) => onChange(items.filter(it => it.id !== id));

  const handleConfirm = () => {
    confirm(draftDate, draftLabel.trim());
    setDraftDate(""); setDraftLabel(""); setAdding(false);
  };

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">Fechas clave</span>
        {!adding && (
          <button
            type="button"
            className="adm-add-btn"
            onClick={() => setAdding(true)}
          >
            + Agregar
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="adm-keydate-list">
          {items.map(it => (
            <li key={it.id} className="adm-keydate-item">
              <span className="adm-keydate-item__icon">📅</span>
              <input
                type="date"
                className="adm-keydate-item__date"
                value={it.date || ""}
                onChange={e => update(it.id, "date", e.target.value)}
              />
              <input
                type="text"
                className="adm-keydate-item__label"
                value={it.label || ""}
                placeholder="Descripción…"
                onChange={e => update(it.id, "label", e.target.value)}
              />
              <button
                type="button"
                className="adm-keydate-item__remove"
                onClick={() => remove(it.id)}
                title="Eliminar"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="adm-inline-draft adm-inline-draft--keydate">
          <input
            type="date"
            className="adm-inline-draft__date"
            value={draftDate}
            onChange={e => setDraftDate(e.target.value)}
            autoFocus
          />
          <input
            type="text"
            className="adm-inline-draft__input"
            placeholder="Descripción del hito…"
            value={draftLabel}
            onChange={e => setDraftLabel(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); handleConfirm(); }
              if (e.key === "Escape") { setDraftDate(""); setDraftLabel(""); setAdding(false); }
            }}
          />
          <button type="button" className="adm-inline-draft__ok"     onClick={handleConfirm}>✓</button>
          <button type="button" className="adm-inline-draft__cancel" onClick={() => { setDraftDate(""); setDraftLabel(""); setAdding(false); }}>✕</button>
        </div>
      )}
    </div>
  );
}
