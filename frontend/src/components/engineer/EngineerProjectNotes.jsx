// EngineerProjectNotes.jsx — Notas y comentarios del proyecto, solo lectura,
// para la vista del ingeniero (EngineerReportBody.jsx). Antes las notas de
// Proyecto_Notas solo se veían desde Editar (ProjectNotesPanel.jsx, con
// formulario de alta/edición) — el ingeniero no tenía forma de verlas.
//
// A propósito NO reutiliza ProjectNotesPanel: ese componente trae el
// formulario de alta y los controles de borrar/incluir-en-reporte, que aquí
// no aplican — el ingeniero consulta, no administra notas de proyecto.

import { useState, useEffect } from "react";
import { loadProjectNotes } from "../../utils/storage";
import { formatDateDMY } from "../../utils/formulas";
import { TIPOS_NOTA as TIPOS } from "../../utils/filtroOpciones";

export default function EngineerProjectNotes({ proyectoAppID }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!proyectoAppID) return;
    let vigente = true;
    loadProjectNotes(proyectoAppID)
      .then(data => { if (vigente) setNotes(data); })
      .finally(() => { if (vigente) setLoading(false); });
    return () => { vigente = false; };
  }, [proyectoAppID]);

  if (!proyectoAppID) return null;
  if (loading) return <p className="notes-panel__empty">Cargando notas…</p>;
  if (!notes.length) return <p className="notes-panel__empty">Sin notas registradas.</p>;

  return (
    <ul className="notes-panel__list">
      {notes.map(note => {
        const tipo = TIPOS.find(t => t.value === note.type) || TIPOS[0];
        return (
          <li key={note.id} className={`notes-panel__item notes-panel__item--${note.type}`}>
            <div className="notes-panel__item-head">
              <span className="notes-panel__item-type">{tipo.icon} {tipo.label}</span>
              <span className="notes-panel__item-date">{formatDateDMY(note.date)}</span>
              {note.author && <span className="notes-panel__item-author">— {note.author}</span>}
            </div>
            <p className="notes-panel__item-text">{note.text}</p>
          </li>
        );
      })}
    </ul>
  );
}
