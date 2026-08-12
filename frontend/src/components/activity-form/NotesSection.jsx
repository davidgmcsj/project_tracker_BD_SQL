// NotesSection.jsx — Lista de notas libres de una actividad (fecha opcional
// + texto), independiente de las notas del proyecto (ProjectPulseField).

import { useState } from "react";
import DateInput from "../common/DateInput";

export default function NotesSection({ items, onChange }) {
  const [draftDate, setDraftDate]   = useState("");
  const [draftText, setDraftText]   = useState("");
  const [adding, setAdding] = useState(false);

  const genId = () => "note_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  const update = (id, field, val) =>
    onChange(items.map(it => it.id === id ? { ...it, [field]: val } : it));

  const remove = (id) => onChange(items.filter(it => it.id !== id));

  const handleConfirm = () => {
    const t = draftText.trim();
    if (t) onChange([...items, { id: genId(), date: draftDate, text: t }]);
    setDraftDate(""); setDraftText(""); setAdding(false);
  };

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">Notas</span>
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
        <ul className="adm-notes-list">
          {items.map(it => (
            <li key={it.id} className="adm-note-item">
              <DateInput
                className="adm-note-item__date"
                value={it.date || ""}
                onChange={iso => update(it.id, "date", iso)}
              />
              <input
                type="text"
                className="adm-note-item__text"
                value={it.text || ""}
                placeholder="Nota…"
                onChange={e => update(it.id, "text", e.target.value)}
              />
              <button
                type="button"
                className="adm-note-item__remove"
                onClick={() => remove(it.id)}
                title="Eliminar"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="adm-inline-draft adm-inline-draft--keydate">
          <DateInput
            className="adm-inline-draft__date"
            value={draftDate}
            onChange={iso => setDraftDate(iso)}
            autoFocus
          />
          <input
            type="text"
            className="adm-inline-draft__input"
            placeholder="Escribe la nota…"
            value={draftText}
            onChange={e => setDraftText(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); handleConfirm(); }
              if (e.key === "Escape") { setDraftDate(""); setDraftText(""); setAdding(false); }
            }}
          />
          <button type="button" className="adm-inline-draft__ok"     onClick={handleConfirm}>✓</button>
          <button type="button" className="adm-inline-draft__cancel" onClick={() => { setDraftDate(""); setDraftText(""); setAdding(false); }}>✕</button>
        </div>
      )}
    </div>
  );
}
