// useResizableColumn.js — Columna de nombre redimensionable (arrastre con el
// mouse).
//
// El primer intento usaba un divisor flotante (position:absolute) separado
// de la tabla, anclado con `left: labelWidth` — en teoría cubría toda la
// altura, pero en la práctica el usuario no lograba agarrarlo parado en
// ninguna fila (probablemente por depender de que un ancestro sin altura
// propia le heredara la altura vía top:0/bottom:0, algo fràgil entre
// navegadores con sticky + overflow mixto). Se reemplaza por el enfoque
// directo: el propio <td>/<th> de la columna "Actividad" — CADA fila, no
// solo el header — escucha mousedown, y si el clic cae en los últimos 10px
// de su borde derecho (medido con getBoundingClientRect, no depende de
// z-index ni overlays), arranca el arrastre. Así "pararse en cualquier
// fila" funciona de forma literal, sin nada flotando encima que pueda fallar
// en alinearse.

import { useCallback, useEffect, useRef, useState } from "react";

const RESIZE_EDGE_PX = 10;

export function useResizableColumn(initial, min, max) {
  const [width, setWidth] = useState(initial);
  const dragRef = useRef(null); // { startX, startWidth }

  const onCellMouseDown = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.right - e.clientX > RESIZE_EDGE_PX) return; // clic lejos del borde: no es un intento de resize
    dragRef.current = { startX: e.clientX, startWidth: width };
    e.preventDefault();
  }, [width]);

  // Cursor col-resize solo cuando el mouse está cerca del borde (sin esto,
  // toda la celda mostraría cursor de redimensionar aunque el clic ahí no
  // haga nada, lo cual confunde más de lo que ayuda).
  const onCellMouseMoveHint = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.cursor = (rect.right - e.clientX <= RESIZE_EDGE_PX) ? "col-resize" : "";
  }, []);
  const onCellMouseLeaveHint = useCallback((e) => { e.currentTarget.style.cursor = ""; }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const delta = e.clientX - dragRef.current.startX;
      setWidth(Math.max(min, Math.min(max, dragRef.current.startWidth + delta)));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [min, max]);

  return { width, onCellMouseDown, onCellMouseMoveHint, onCellMouseLeaveHint };
}
