// AssigneeDropdown.jsx — Dropdown de asignación con buscador, soporte de
// externos y creación en popover. Usado por ActivitiesList (fila de cada
// actividad y el draft de alta rápida) y, vía la misma lista filtrada, por
// cualquier otro selector de responsable que necesite buscar por nombre en
// vez de desplazarse por un <select> largo.
//
// El menú se renderiza en un portal a document.body, NO como hijo normal de
// esta fila. .act-list (la lista de actividades) tiene overflow-y:auto con
// altura fija de solo 220px — el menú puede medir hasta 280px, así que
// ninguna orientación (arriba o abajo) cabe completa DENTRO de ese
// contenedor: un position:absolute normal queda recortado por el overflow
// del ancestro sin importar el z-index (el z-index no puede escapar el
// clipping de un overflow:hidden/auto ajeno). El portal saca el menú de ese
// árbol; su posición se calcula a mano con getBoundingClientRect porque ya
// no hereda el posicionamiento relativo del input.
import { useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../hooks/useClickOutside";
import { matchesSearch } from "../../utils/search";

const MENU_MAX_HEIGHT = 280; // debe coincidir con max-height de .assignee-dropdown__menu
const MENU_GAP = 4;

export default function AssigneeDropdown({ assignables, assignedIds, placeholder, onSelect, onCreateExternal }) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");
  const [newComp,  setNewComp]  = useState("");
  const [menuPos, setMenuPos] = useState(null); // { left, width, top?, bottom? } — solo uno de top/bottom
  const wrapRef = useRef(null);
  const menuRef = useRef(null); // nodo portal-eado — ver useClickOutside(extraRef)

  useClickOutside(wrapRef, () => { setOpen(false); setCreating(false); }, open || creating, menuRef);

  // Se mide justo antes de pintar el menú (no en el click) para que ya
  // contemple el layout actual — por ejemplo si la lista se scrolleó entre
  // que se enfocó el input y se abrió el menú. Se recalcula también en
  // scroll/resize mientras el menú está abierto, para que no se desalinee
  // del input si el usuario sigue scrolleando la lista con el menú abierto.
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

  const engineers = assignables.filter(a => a.type === "engineer" && !assignedIds.has(a.id) && matchesSearch(a.name, query));
  const externals = assignables.filter(a => a.type === "external" && !assignedIds.has(a.id) && matchesSearch(a.name, query));
  const hasResults = engineers.length > 0 || externals.length > 0;

  const pick = (id) => {
    onSelect(id);
    setQuery("");
    setOpen(false);
  };

  const startCreate = () => {
    setNewName(query.trim());
    setCreating(true);
  };

  const handleConfirmCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreateExternal(name, newComp.trim());
    setNewName(""); setNewComp(""); setCreating(false); setQuery(""); setOpen(false);
  };

  return (
    <div ref={wrapRef} className="assignee-dropdown">
      <input
        type="text"
        className="field__input act-assign-row__select"
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={e => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={e => { if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); } }}
      />

      {open && !creating && menuPos && createPortal(
        <div
          ref={menuRef}
          className="assignee-dropdown__menu"
          style={{
            position: "fixed",
            left: menuPos.left,
            width: menuPos.width,
            top: menuPos.top,
            bottom: menuPos.bottom,
          }}
        >
          {engineers.length > 0 && (
            <>
              <div className="assignee-dropdown__group">Equipo interno</div>
              {engineers.map(e => (
                <button type="button" key={e.id} className="assignee-dropdown__option" onClick={() => pick(e.id)}>
                  {e.name}
                </button>
              ))}
            </>
          )}
          {externals.length > 0 && (
            <>
              <div className="assignee-dropdown__group">Colaboradores externos</div>
              {externals.map(c => (
                <button type="button" key={c.id} className="assignee-dropdown__option" onClick={() => pick(c.id)}>
                  {c.name}{c.company ? ` (${c.company})` : ""}
                </button>
              ))}
            </>
          )}
          {!hasResults && (
            <p className="assignee-dropdown__empty">Sin coincidencias.</p>
          )}
          {onCreateExternal && (
            <button type="button" className="assignee-dropdown__new-external" onClick={startCreate}>
              + Agregar colaborador externo…
            </button>
          )}
        </div>,
        document.body
      )}

      {creating && (
        <div className="assignee-create-popover">
          <p className="assignee-create-popover__title">Nuevo colaborador externo</p>
          <input
            className="assignee-create-popover__input field__input"
            placeholder="Nombre completo…"
            value={newName}
            autoFocus
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleConfirmCreate(); } if (e.key === "Escape") setCreating(false); }}
          />
          <input
            className="assignee-create-popover__input field__input"
            placeholder="Empresa / entidad (ej: Microsoft)"
            value={newComp}
            onChange={e => setNewComp(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); handleConfirmCreate(); } if (e.key === "Escape") setCreating(false); }}
          />
          <div className="assignee-create-popover__actions">
            <button type="button" className="assignee-create-popover__cancel" onClick={() => setCreating(false)}>Cancelar</button>
            <button type="button" className="assignee-create-popover__ok" onClick={handleConfirmCreate} disabled={!newName.trim()}>Agregar</button>
          </div>
        </div>
      )}
    </div>
  );
}
