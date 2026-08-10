// useElementWidth.js — Mide el ancho disponible del contenedor y lo mantiene
// actualizado al redimensionar la ventana. Se necesita para repartir el
// espacio sobrante entre las columnas de fecha cuando la tabla no llena el
// contenedor.

import { useEffect, useRef, useState } from "react";

export function useElementWidth() {
  const ref = useRef(null);
  const [elWidth, setElWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setElWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, elWidth];
}
