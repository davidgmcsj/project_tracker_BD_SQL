// ParentSelectDropdown.jsx — Selector "Es subtarea de" con buscador, para
// ActivityDetailModal. Adaptado de gantt/ParentTaskFilter.jsx (mismo
// mecanismo: input + portal a document.body + useClickOutside +
// matchesSearch) con 2 diferencias de semántica: la opción fija es "Ninguno
// (actividad principal)" (asignar, no filtrar) y vive en un formulario
// vertical del modal, no en una barra horizontal de filtros.
//
// `options` debe llegar YA filtrado (sin la propia actividad ni sus
// descendientes — wouldCreateCycle) y YA ordenado jerárquicamente
// (flattenTree) — este componente solo filtra por texto de búsqueda sobre
// lo que recibe, igual que ParentTaskFilter.

import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { matchesSearch } from "../../utils/search";

const MENU_MAX_HEIGHT = 280;
const MENU_GAP = 4;

export default function ParentSelectDropdown({ options, selectedId, onSelect }) {
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
        width: rect.width,
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
    <div ref={wrapRef} className="parent-select-dropdown">
      <input
        type="text"
        className="adm-select parent-select-dropdown__input"
        placeholder="Ninguno (actividad principal)…"
        value={open ? query : (selected?.label || "Ninguno (actividad principal)")}
        onFocus={() => { setOpen(true); setQuery(""); }}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }}
      />

      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="parent-select-dropdown__menu"
          style={{ position: "fixed", left: menuPos.left, width: menuPos.width, top: menuPos.top, bottom: menuPos.bottom }}
        >
          <button type="button" className="parent-select-dropdown__option parent-select-dropdown__option--none" onClick={() => pick(null)}>
            — Ninguno (actividad principal) —
          </button>
          {filtered.map(o => (
            <button key={o.id} type="button" className="parent-select-dropdown__option" onClick={() => pick(o.id)}>
              {o.label}
            </button>
          ))}
          {filtered.length === 0 && (
            <p className="parent-select-dropdown__empty">Sin coincidencias.</p>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
