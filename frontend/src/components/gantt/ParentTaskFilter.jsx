// ParentTaskFilter.jsx — Selector con buscador de UNA tarea principal, para
// filtrar el Gantt a "esta tarea padre + sus subtareas" (o solo sus
// subtareas). Mismo patrón de portal + useClickOutside que AssigneeDropdown,
// simplificado a single-select sin chips ni creación.

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { matchesSearch } from "../../utils/search";

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;

export default function ParentTaskFilter({ options, selectedId, onSelect }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuPos, setMenuPos] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

  useClickOutside(wrapRef, () => setOpen(false), open, menuRef);

  useLayoutEffect(() => {
    if (!open || !wrapRef.current) return;
    const reposition = () => {
      const rect = wrapRef.current.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom;
      const openUpward = spaceBelow < MENU_MAX_HEIGHT && rect.top > spaceBelow;
      setMenuPos({
        left: rect.left,
        width: Math.max(rect.width, 220),
        top: openUpward ? undefined : rect.bottom + MENU_GAP,
        bottom: openUpward ? window.innerHeight - rect.top + MENU_GAP : undefined,
      });
    };
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const selected = options.find(o => o.id === selectedId) || null;
  const filtered = options.filter(o => matchesSearch(o.label, query));

  const pick = (id) => {
    onSelect(id);
    setQuery("");
    setOpen(false);
  };

  return (
    <div ref={wrapRef} className="parent-task-filter">
      <input
        type="text"
        className="parent-task-filter__input"
        placeholder="Todas las tareas principales…"
        value={open ? query : (selected?.label || "")}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }}
      />
      {selected && !open && (
        <button
          type="button"
          className="parent-task-filter__clear"
          title="Quitar filtro de tarea padre"
          onClick={() => onSelect(null)}
        >✕</button>
      )}

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="parent-task-filter__menu"
          style={{ position: "fixed", left: menuPos.left, width: menuPos.width, top: menuPos.top, bottom: menuPos.bottom }}
        >
          <button type="button" className="parent-task-filter__option parent-task-filter__option--all" onClick={() => pick(null)}>
            Todas las tareas principales
          </button>
          {filtered.map(o => (
            <button key={o.id} type="button" className="parent-task-filter__option" onClick={() => pick(o.id)}>
              {o.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="parent-task-filter__empty">Sin coincidencias.</p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
