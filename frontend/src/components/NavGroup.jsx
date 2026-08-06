// NavGroup.jsx — Botón de navegación con desplegable, para agrupar varias
// claves de `view` bajo un solo botón en la barra principal (Fase 4:
// "Ingenieros" y "Reportes" agrupan lo que antes eran pestañas separadas).

import { useEffect, useRef, useState } from "react";

export default function NavGroup({ label, options, activeKey, onSelect, active }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onEscape = e => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  return (
    <div className="nav-group" ref={ref}>
      <button
        type="button"
        className={`tab-btn nav-group__trigger ${active ? "tab-btn--active" : ""}`}
        onClick={() => setOpen(o => !o)}
      >
        {label} <span className="nav-group__caret">▾</span>
      </button>
      {open && (
        <div className="nav-group__menu">
          {options.map(o => (
            <button
              key={o.key}
              type="button"
              className={`nav-group__item ${activeKey === o.key ? "nav-group__item--active" : ""}`}
              onClick={() => { onSelect(o.key); setOpen(false); }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
