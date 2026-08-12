// ProjectNotesPanel.jsx — Notas y comentarios fechados de un proyecto.
//
// A diferencia de status_notes (el "pulso" de una línea que se pisa en cada
// edición), estas notas viven en Proyecto_Notas: cada una tiene fecha,
// autor y tipo, y se acumulan en vez de sobreescribirse. El panel consulta
// al backend por su cuenta (mismo patrón que QuartersView.jsx) — no depende
// del estado global de App.jsx.

import { useState, useEffect } from "react";
import { loadProjectNotes, saveProjectNote, deleteProjectNote, getCurrentUser } from "../utils/storage";
import { getToday, formatDateDMY } from "../utils/formulas";
import { TIPOS_NOTA as TIPOS } from "../utils/filtroOpciones";
import DateInput from "./common/DateInput";

const AUTHOR_KEY = "wt-author";

function genNoteId() {
  return "note_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyDraft() {
  return { date: getToday(), type: "comentario", text: "", author: localStorage.getItem(AUTHOR_KEY) || "" };
}

export function ProjectNotesPanel({ proyectoAppID }) {
  const [notes, setNotes]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0); // se incrementa para forzar recarga
  const [draft, setDraft]     = useState(emptyDraft());
  const [saving, setSaving]   = useState(false);
  const [open, setOpen]       = useState(false);
  const [sessionUser, setSessionUser] = useState(null); // con sesión activa, el backend ignora el campo autor igual

  // Sin setState síncrono en el cuerpo del efecto: todo pasa dentro de
  // .then()/.finally() (mismo patrón que QuartersView.jsx).
  useEffect(() => {
    if (!proyectoAppID) return;
    loadProjectNotes(proyectoAppID)
      .then(data => setNotes(data))
      .finally(() => setLoading(false));
  }, [proyectoAppID, version]);

  useEffect(() => { getCurrentUser().then(setSessionUser); }, []);

  if (!proyectoAppID) return null;

  const handleAdd = async () => {
    if (!draft.text.trim()) return;
    setSaving(true);
    if (draft.author) localStorage.setItem(AUTHOR_KEY, draft.author);
    const ok = await saveProjectNote(proyectoAppID, { id: genNoteId(), ...draft, include_in_report: true });
    setSaving(false);
    if (ok) {
      setDraft(emptyDraft());
      setOpen(false);
      setVersion(v => v + 1);
    }
  };

  const handleDelete = async (id) => {
    setNotes(prev => prev.filter(n => n.id !== id)); // optimista
    const ok = await deleteProjectNote(id);
    if (!ok) setVersion(v => v + 1); // revertir si falló
  };

  const handleToggleInclude = async (note) => {
    const updated = { ...note, include_in_report: !note.include_in_report };
    setNotes(prev => prev.map(n => (n.id === note.id ? updated : n)));
    await saveProjectNote(proyectoAppID, updated);
  };

  return (
    <div className="field notes-panel">
      <div className="field__header">
        <label className="field__label">Notas y comentarios del proyecto</label>
        {!open && (
          <button type="button" className="pulse__edit" onClick={() => setOpen(true)}>
            + Agregar nota
          </button>
        )}
      </div>

      {open && (
        <div className="notes-panel__form">
          <div className="notes-panel__form-row">
            <select
              className="field__input notes-panel__type"
              value={draft.type}
              onChange={e => setDraft({ ...draft, type: e.target.value })}
            >
              {TIPOS.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}
            </select>
            <DateInput
              className="field__input notes-panel__date"
              value={draft.date}
              onChange={iso => setDraft({ ...draft, date: iso })}
            />
            {sessionUser ? (
              <span className="notes-panel__author-fixed" title="Con sesión activa, la nota se atribuye a tu usuario">
                Se guardará como: <strong>{sessionUser.name}</strong>
              </span>
            ) : (
              <input
                type="text" className="field__input notes-panel__author"
                placeholder="Autor (opcional)"
                value={draft.author}
                onChange={e => setDraft({ ...draft, author: e.target.value })}
              />
            )}
          </div>
          <textarea
            className="field__input notes-panel__textarea"
            rows={3}
            placeholder="Escribe la nota..."
            value={draft.text}
            onChange={e => setDraft({ ...draft, text: e.target.value })}
          />
          <div className="notes-panel__form-actions">
            <button type="button" className="btn btn--secondary" onClick={() => { setOpen(false); setDraft(emptyDraft()); }}>
              Cancelar
            </button>
            <button type="button" className="btn btn--accent" disabled={saving || !draft.text.trim()} onClick={handleAdd}>
              {saving ? "Guardando…" : "Guardar nota"}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="notes-panel__empty">Cargando notas…</p>
      ) : notes.length === 0 ? (
        !open && <p className="notes-panel__empty">Sin notas todavía.</p>
      ) : (
        <ul className="notes-panel__list">
          {notes.map(note => {
            const tipo = TIPOS.find(t => t.value === note.type) || TIPOS[0];
            return (
              <li key={note.id} className={`notes-panel__item notes-panel__item--${note.type}`}>
                <div className="notes-panel__item-head">
                  <span className="notes-panel__item-type">{tipo.icon} {tipo.label}</span>
                  <span className="notes-panel__item-date">{formatDateDMY(note.date)}</span>
                  {note.author && <span className="notes-panel__item-author">— {note.author}</span>}
                  <label className="notes-panel__item-include" title="Incluir en el reporte exportado">
                    <input type="checkbox" checked={note.include_in_report} onChange={() => handleToggleInclude(note)} />
                    En reporte
                  </label>
                  <button type="button" className="notes-panel__item-delete" onClick={() => handleDelete(note.id)} title="Borrar nota">✕</button>
                </div>
                <p className="notes-panel__item-text">{note.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
