// FullscreenOverlay.jsx — Overlay position:fixed;inset:0 genérico, no Fullscreen
// API nativa (requiere gesto de usuario, comportamiento inconsistente entre
// navegadores, complica z-index/scroll). Mismo criterio que ActivityDetailModal
// (ya usa position:fixed) — este componente es su versión de "ocupa toda la
// pantalla" en vez de panel centrado.

import { useEffect, useRef } from "react";

export default function FullscreenOverlay({ open, onClose, title, children }) {
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fs-overlay" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="fs-overlay__panel" ref={panelRef}>
        <div className="fs-overlay__header">
          <span className="fs-overlay__title">{title}</span>
          <button type="button" className="fs-overlay__close" onClick={() => onClose?.()} title="Cerrar (Esc)">✕</button>
        </div>
        <div className="fs-overlay__body">
          {children}
        </div>
      </div>
    </div>
  );
}
