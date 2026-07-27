// ActivityFormSections.jsx — Sub-secciones reutilizables del editor de actividades.
// Extraídas de ActivityDetailModal para que también las use EngineerTaskModal.
// Comparten los estilos adm-* de App.css. Son controladas: reciben `items`/`onChange`.

import { useState, useRef, useEffect } from "react";
import { createChecklistItem, createKeyDate, formatDateDMY } from "../utils/formulas";

// Fechas de depósito según estado:
//   not_started → Inscripción (si existe)
//   in_progress → Inscripción + En proceso
//   completed   → Solo Completada
export function DateBadgesSection({ status, history }) {
  if (status === "completed") {
    return (
      <div className="adm-dates-row">
        <span className="adm-date-badge adm-date-badge--completed">
          <span className="adm-date-badge__icon">✅</span>
          <span className="adm-date-badge__label">Completada</span>
          <span className="adm-date-badge__value">{formatDateDMY(history?.completed)}</span>
        </span>
      </div>
    );
  }

  if (status === "in_progress") {
    return (
      <div className="adm-dates-row">
        <span className="adm-date-badge adm-date-badge--added">
          <span className="adm-date-badge__icon">📌</span>
          <span className="adm-date-badge__label">Inscrita</span>
          <span className="adm-date-badge__value">{formatDateDMY(history?.added)}</span>
        </span>
        <span className="adm-date-badge adm-date-badge--inprogress">
          <span className="adm-date-badge__icon">🔄</span>
          <span className="adm-date-badge__label">En proceso</span>
          <span className="adm-date-badge__value">{formatDateDMY(history?.in_progress)}</span>
        </span>
      </div>
    );
  }

  // not_started
  return (
    <div className="adm-dates-row">
      {history?.added && (
        <span className="adm-date-badge adm-date-badge--added">
          <span className="adm-date-badge__icon">📌</span>
          <span className="adm-date-badge__label">Inscrita</span>
          <span className="adm-date-badge__value">{formatDateDMY(history.added)}</span>
        </span>
      )}
    </div>
  );
}

export function ChecklistSection({ items, onChange }) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const inputRef = useRef(null);
  const dragIndex = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const toggle = (id) =>
    onChange(items.map(it => it.id === id ? { ...it, done: !it.done } : it));

  const updateText = (id, text) =>
    onChange(items.map(it => it.id === id ? { ...it, text } : it));

  const remove = (id) => onChange(items.filter(it => it.id !== id));

  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const handleDragStart = (index) => {
    dragIndex.current = index;
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (index !== dragOverIndex) setDragOverIndex(index);
  };

  const handleDrop = (index) => {
    const from = dragIndex.current;
    dragIndex.current = null;
    setDragOverIndex(null);
    if (from === null || from === index) return;
    const next = items.slice();
    const [moved] = next.splice(from, 1);
    next.splice(index, 0, moved);
    onChange(next);
  };

  const handleDragEnd = () => {
    dragIndex.current = null;
    setDragOverIndex(null);
  };

  const confirm = () => {
    const t = draft.trim();
    if (t) onChange([...items, createChecklistItem(t)]);
    setDraft("");
    setAdding(false);
  };

  const done  = items.filter(it => it.done).length;
  const total = items.length;

  return (
    <div className="adm-section">
      <div className="adm-section__header">
        <span className="adm-section__title">
          Subactividades
          {total > 0 && (
            <span className="adm-checklist-progress">
              {done}/{total}
              <span className="adm-checklist-bar">
                <span
                  className="adm-checklist-bar__fill"
                  style={{ width: `${total ? (done / total) * 100 : 0}%` }}
                />
              </span>
            </span>
          )}
        </span>
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
        <ul className="adm-checklist">
          {items.map((it, index) => (
            <li
              key={it.id}
              className={`adm-checklist__item${it.done ? " adm-checklist__item--done" : ""}${dragOverIndex === index ? " adm-checklist__item--dragover" : ""}`}
              draggable
              onDragStart={() => handleDragStart(index)}
              onDragOver={e => handleDragOver(e, index)}
              onDrop={() => handleDrop(index)}
              onDragEnd={handleDragEnd}
            >
              <span className="adm-checklist__drag-handle" title="Arrastrar para reordenar">⠿</span>
              <div className="adm-checklist__reorder-btns">
                <button
                  type="button"
                  className="adm-checklist__reorder-btn"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  title="Subir"
                >▲</button>
                <button
                  type="button"
                  className="adm-checklist__reorder-btn"
                  onClick={() => move(index, 1)}
                  disabled={index === items.length - 1}
                  title="Bajar"
                >▼</button>
              </div>
              <input
                type="checkbox"
                className="adm-checklist__chk"
                checked={it.done}
                onChange={() => toggle(it.id)}
              />
              <input
                type="text"
                className="adm-checklist__text-input"
                value={it.text}
                onChange={e => updateText(it.id, e.target.value)}
              />
              <button
                type="button"
                className="adm-checklist__remove"
                onClick={() => remove(it.id)}
                title="Eliminar"
              >✕</button>
            </li>
          ))}
        </ul>
      )}

      {adding && (
        <div className="adm-inline-draft">
          <input
            ref={inputRef}
            type="text"
            className="adm-inline-draft__input"
            placeholder="Descripción del paso…"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") { e.preventDefault(); confirm(); }
              if (e.key === "Escape") { setDraft(""); setAdding(false); }
            }}
          />
          <button type="button" className="adm-inline-draft__ok"     onClick={confirm}>✓</button>
          <button type="button" className="adm-inline-draft__cancel" onClick={() => { setDraft(""); setAdding(false); }}>✕</button>
        </div>
      )}
    </div>
  );
}

export function KeyDatesSection({ items, onChange }) {
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

export function NotesSection({ items, onChange }) {
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
              <input
                type="date"
                className="adm-note-item__date"
                value={it.date || ""}
                onChange={e => update(it.id, "date", e.target.value)}
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
