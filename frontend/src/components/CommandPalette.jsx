// CommandPalette.jsx — Ctrl+K / Cmd+K para saltar a cualquier proyecto o
// ingeniero escribiendo (Fase 14 — Planner C). Útil cuando la cantidad de
// proyectos crece y buscarlos manualmente por pestaña se vuelve lento.
//
// Índice armado desde projects/engineers que ya tiene App.jsx en memoria —
// sin llamar al backend. Sin la librería cmdk a propósito: el manejo de
// foco/teclado que hace falta acá son ~120 líneas; se instala cmdk solo si
// esto resulta insuficiente en accesibilidad real.

import { useState, useEffect, useRef, useMemo } from "react";
import { matchesSearch } from "../utils/search";

export function CommandPalette({ projects, engineers, onGoToProject, onGoToView }) {
  const [open, setOpen]         = useState(false);
  const [query, setQuery]       = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);

  const items = useMemo(() => {
    const proyectos = (projects || []).map((p, idx) => ({
      key: `p-${p.id}`, type: "proyecto", icon: "📁",
      label: p.project_name || "Proyecto sin nombre",
      action: () => onGoToProject(idx),
    }));
    const ingenieros = (engineers || []).filter(e => e.active !== false).map(e => ({
      key: `e-${e.id}`, type: "ingeniero", icon: "🧑‍💻", label: e.name,
      action: () => onGoToView("engineers"),
    }));
    return [...proyectos, ...ingenieros];
  }, [projects, engineers, onGoToProject, onGoToView]);

  const filtered = useMemo(
    () => items.filter(it => matchesSearch(it.label, query)).slice(0, 30),
    [items, query]
  );

  // Abrir/cerrar con Ctrl+K (Cmd+K en Mac) desde cualquier parte de la app.
  // El reset de query/activeIdx pasa DENTRO del handler del evento (no en el
  // cuerpo síncrono de un efecto) — se re-suscribe con `open` en deps para
  // leer siempre el valor actual, sin closure obsoleto.
  useEffect(() => {
    function handleKeyDown(e) {
      if ((e.key === "k" || e.key === "K") && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (!open) { setQuery(""); setActiveIdx(0); }
        setOpen(o => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Foco del input al abrir: manipulación imperativa del DOM, no setState —
  // este sí es un uso correcto de efecto.
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0); // el input aún no está montado en este tick
    return () => clearTimeout(id);
  }, [open]);

  if (!open) return null;

  const handleQueryChange = (e) => {
    setQuery(e.target.value);
    setActiveIdx(0); // reset en el handler, no en un efecto separado
  };

  const handleKeyNav = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActiveIdx(i => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActiveIdx(i => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[activeIdx];
      if (it) { it.action(); setOpen(false); }
    }
  };

  return (
    <div className="cmdk-overlay" onClick={e => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="cmdk-panel">
        <input
          ref={inputRef} className="cmdk-input" type="text"
          placeholder="Buscar proyecto o ingeniero…"
          value={query} onChange={handleQueryChange}
          onKeyDown={handleKeyNav}
        />
        <div className="cmdk-list">
          {filtered.length === 0 && <p className="cmdk-empty">Sin resultados.</p>}
          {filtered.map((it, i) => (
            <button
              key={it.key} type="button"
              className={`cmdk-item ${i === activeIdx ? "cmdk-item--active" : ""}`}
              onMouseEnter={() => setActiveIdx(i)}
              onClick={() => { it.action(); setOpen(false); }}
            >
              <span className="cmdk-item__icon">{it.icon}</span>
              <span className="cmdk-item__label">{it.label}</span>
              <span className="cmdk-item__type">{it.type}</span>
            </button>
          ))}
        </div>
        <div className="cmdk-footer">
          <span>↑↓ moverse</span><span>↵ ir</span><span>Esc cerrar</span>
        </div>
      </div>
    </div>
  );
}
