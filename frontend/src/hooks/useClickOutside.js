import { useEffect } from "react";

// extraRef: segundo ref opcional que también cuenta como "adentro" — para
// contenido renderizado vía createPortal (ej. un menú en document.body que
// visualmente pertenece al componente pero vive fuera de `ref` en el DOM).
// Sin esto, un clic en ese contenido portal-eado se trataría como "afuera"
// y cerraría el menú antes de que su propio onClick llegara a procesarse.
export function useClickOutside(ref, onClose, enabled = true, extraRef = null) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      if (extraRef?.current && extraRef.current.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, onClose, enabled, extraRef]);
}
