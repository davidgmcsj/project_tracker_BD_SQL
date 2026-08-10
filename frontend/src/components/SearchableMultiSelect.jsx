// SearchableMultiSelect.jsx — combo de selección múltiple con buscador.
// Usado por ReportesFilterPanel.jsx para campos "lista" cuyas opciones se
// conocen de antemano (proyectos/ingenieros ya cargados, o enums fijos de
// filtroOpciones.js): elegir de una lista evita errores de tipeo y no obliga
// a recordar IDs internos o el valor exacto que espera SQL. Sin librería
// externa a propósito, mismo criterio que CommandPalette.jsx.

import { useState, useRef, useEffect } from "react";
import { matchesSearch } from "../utils/search";

const MAX_OPCIONES_VISIBLES = 100;

export function SearchableMultiSelect({ options, placeholder, onAdd }) {
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState("");
  const [seleccion, setSeleccion] = useState([]);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const filtradas = options.filter(o => matchesSearch(o.label, query)).slice(0, MAX_OPCIONES_VISIBLES);

  const toggleValor = (value) => {
    setSeleccion(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const confirmar = () => {
    if (!seleccion.length) return;
    onAdd({ operador: seleccion.length > 1 ? "in" : "=", valor: seleccion.length > 1 ? seleccion : seleccion[0] });
    setSeleccion([]);
    setQuery("");
    setOpen(false);
  };

  const etiquetaDe = (value) => options.find(o => o.value === value)?.label ?? value;

  return (
    <div className="searchable-select" ref={wrapRef}>
      <div className="searchable-select__row">
        <input
          type="text" className="report-filters__search"
          placeholder={placeholder || "Buscar…"}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
        />
        <button type="button" className="btn btn--secondary btn--sm" onClick={confirmar} disabled={!seleccion.length}>
          Agregar{seleccion.length > 1 ? ` (${seleccion.length})` : ""}
        </button>
      </div>

      {seleccion.length > 0 && (
        <div className="searchable-select__chips">
          {seleccion.map(v => (
            <span key={v} className="reportes-chip reportes-chip--pending">
              {etiquetaDe(v)}
              <button type="button" className="reportes-chip__remove" onClick={() => toggleValor(v)}>✕</button>
            </span>
          ))}
        </div>
      )}

      {open && (
        <div className="searchable-select__dropdown">
          {filtradas.length === 0 && <p className="searchable-select__empty">Sin resultados.</p>}
          {filtradas.map(o => (
            <button
              type="button" key={o.value}
              className={`searchable-select__option ${seleccion.includes(o.value) ? "searchable-select__option--on" : ""}`}
              onClick={() => toggleValor(o.value)}
            >
              <span className="searchable-select__check">{seleccion.includes(o.value) ? "✓" : ""}</span>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
