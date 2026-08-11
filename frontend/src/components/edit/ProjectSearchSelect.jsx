// ProjectSearchSelect.jsx — Reemplaza la fila de pestañas de proyecto (una
// por cada proyecto, generaba demasiado ruido visual con muchos proyectos)
// por un campo de búsqueda: escribe, aparece una lista de coincidencias por
// nombre, clic o Enter para abrir. El reordenamiento por arrastre que tenían
// las pestañas se quitó — si hace falta más adelante, se agrega aparte (ej.
// un botón "Reordenar" separado), no como parte de este buscador.

import { useState, useRef } from "react";
import { useClickOutside } from "../../hooks/useClickOutside";

export default function ProjectSearchSelect({ projects, editingIdx, onSelectProject, onAddProject }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);

  useClickOutside(wrapRef, () => setOpen(false));

  const current = editingIdx !== null ? projects[editingIdx] : null;

  const results = query.trim()
    ? projects
        .map((p, i) => ({ p, i }))
        .filter(({ p }) => (p.project_name || `Proyecto ${p.id}`).toLowerCase().includes(query.trim().toLowerCase()))
    : projects.map((p, i) => ({ p, i }));

  const pick = (i) => {
    onSelectProject(i);
    setQuery("");
    setOpen(false);
    setHighlight(0);
  };

  const openList = () => { setOpen(true); setHighlight(0); };

  const handleKeyDown = (e) => {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "Enter") openList();
      return;
    }
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlight(h => Math.min(h + 1, results.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); if (results[highlight]) pick(results[highlight].i); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  return (
    <div className="project-search" ref={wrapRef}>
      <div className="project-search__row">
        <div className="project-search__field">
          <input
            type="text"
            className="project-search__input"
            placeholder={current ? (current.project_name || `Proyecto ${editingIdx + 1}`) : "Buscar proyecto…"}
            value={query}
            onChange={e => { setQuery(e.target.value); openList(); }}
            onFocus={openList}
            onKeyDown={handleKeyDown}
          />
          {query && (
            <button type="button" className="project-search__clear" onClick={() => setQuery("")}>✕</button>
          )}

          {open && (
            <ul className="project-search__results">
              {results.length === 0 ? (
                <li className="project-search__empty">Sin proyectos que coincidan</li>
              ) : results.map(({ p, i }, idx) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`project-search__result${i === editingIdx ? " project-search__result--active" : ""}${idx === highlight ? " project-search__result--highlight" : ""}`}
                    onMouseEnter={() => setHighlight(idx)}
                    onClick={() => pick(i)}
                  >
                    {p.project_name || `Proyecto ${i + 1}`}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button type="button" className="project-search__add" onClick={onAddProject}>+ Nuevo</button>
      </div>
    </div>
  );
}
