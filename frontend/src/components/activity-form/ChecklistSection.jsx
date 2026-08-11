// ChecklistSection.jsx — Lista de subactividades (texto plano con check),
// reordenable por arrastre o botones ▲▼. Distinta de SubtasksSection
// (actividades hijas reales con su propia tarjeta) — ver ese archivo.

import { useState, useRef, useEffect } from "react";
import { createChecklistItem } from "../../utils/formulas";

export default function ChecklistSection({ items, onChange }) {
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
