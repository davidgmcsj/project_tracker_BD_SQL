// useSyncedHScroll.js — Sincroniza el scrollLeft de dos elementos en ambas
// direcciones. Usado por el Gantt para que la barra de scroll horizontal
// "flotante" (sticky al fondo del viewport visible, ver .gantt__hscroll en
// gantt.css) y el contenedor real de la tabla (.gantt__scroll) se muevan
// juntos sin importar cuál de los dos arrastra el usuario.
//
// Por qué hace falta una barra aparte: .gantt__scroll no tiene su propio
// scroll vertical (crece con todas las filas, ver comentario en gantt.css),
// así que su scrollbar horizontal real vive al final de TODA la tabla — con
// muchas filas queda fuera de la vista y hay que bajar hasta el final del
// documento para encontrarla. Esta barra sintética se queda pegada abajo del
// contenedor visible (fs-overlay__body) sin importar cuánto se haya bajado.

import { useCallback, useRef } from "react";

// scrollRef: el ref de .gantt__scroll (contenido real) — se recibe en vez de
// crearse aquí porque GanttChart ya lo obtiene de useElementWidth (mide
// ancho/alto del mismo elemento) y un <div> no puede tener dos refs.
export function useSyncedHScroll(scrollRef) {
  const barRef = useRef(null);      // .gantt__hscroll — barra flotante sintética
  const syncingRef = useRef(false); // evita el eco infinito entre los dos listeners

  const onScrollFromContent = useCallback(() => {
    if (syncingRef.current) { syncingRef.current = false; return; }
    if (!scrollRef.current || !barRef.current) return;
    syncingRef.current = true;
    barRef.current.scrollLeft = scrollRef.current.scrollLeft;
  }, [scrollRef]);

  const onScrollFromBar = useCallback(() => {
    if (syncingRef.current) { syncingRef.current = false; return; }
    if (!scrollRef.current || !barRef.current) return;
    syncingRef.current = true;
    scrollRef.current.scrollLeft = barRef.current.scrollLeft;
  }, [scrollRef]);

  return { barRef, onScrollFromContent, onScrollFromBar };
}
