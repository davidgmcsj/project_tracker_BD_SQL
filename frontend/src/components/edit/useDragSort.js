// useDragSort.js — Hook de drag-and-drop para reordenar items dentro de una
// lista. Usado por TaskStatusSelector (reordenamiento dentro de una columna).

import { useRef, useCallback } from "react";

export function useDragSort(items, onChange) {
  const dragIdx = useRef(null);
  const onDragStart = useCallback((i) => { dragIdx.current = i; }, []);
  const onDrop      = useCallback((i) => {
    const src = dragIdx.current;
    if (src === null || src === i) return;
    const next = [...items];
    const [moved] = next.splice(src, 1);
    next.splice(i, 0, moved);
    onChange(next);
    dragIdx.current = null;
  }, [items, onChange]);
  return { onDragStart, onDrop };
}
