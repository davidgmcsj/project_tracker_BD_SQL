// useElementWidth.js — Mide el ancho (y alto) disponible del contenedor y lo
// mantiene actualizado al redimensionar la ventana. El ancho se usa para
// repartir el espacio sobrante entre las columnas de fecha cuando la tabla
// no llena el contenedor; el alto (agregado después) para repartir el
// espacio sobrante entre las FILAS cuando hay pocas (ej. filtro de nivel en
// "Nivel 1/2") en vez de dejarlas apretadas arriba con un hueco vacío debajo.
import { useEffect, useRef, useState } from "react";

export function useElementWidth() {
  const ref = useRef(null);
  const [elWidth, setElWidth] = useState(0);
  const [elHeight, setElHeight] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => { setElWidth(el.clientWidth); setElHeight(el.clientHeight); };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, elWidth, elHeight];
}
