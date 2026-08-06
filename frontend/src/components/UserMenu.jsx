// UserMenu.jsx — Avatar circular con iniciales en el header. Al hacer clic
// despliega el nombre completo, el switch de tema claro/oscuro y "Cerrar
// sesión" — antes esos tres elementos vivían siempre expuestos en la barra.

import { useEffect, useRef, useState } from "react";

function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

export default function UserMenu({ user, theme, onToggleTheme, onLogout }) {
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
    <div className="user-menu" ref={ref}>
      <button
        type="button"
        className="user-menu__avatar"
        onClick={() => setOpen(o => !o)}
        title={user.name}
      >
        {initials(user.name)}
      </button>
      {open && (
        <div className="user-menu__panel">
          <div className="user-menu__name">{user.name}</div>
          <button type="button" className="user-menu__item" onClick={onToggleTheme}>
            <span>{theme === "dark" ? "☀ Modo claro" : "🌙 Modo oscuro"}</span>
          </button>
          <button type="button" className="user-menu__item user-menu__item--danger" onClick={onLogout}>
            Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}
