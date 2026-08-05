// useUrlState.js — Sincroniza un pedazo de estado con la URL usando la
// History API directamente, sin react-router: la app no tiene rutas, solo
// una pestaña activa en un useState (Fase 13 — Planner B). Sirve para que
// un enlace a la pestaña Reportes reproduzca la misma consulta+filtros+
// columnas sin que el destinatario tenga que reconfigurar nada a mano.

import { useState, useCallback, useEffect } from "react";

// Lee el valor inicial desde la URL actual (una sola vez, al montar).
function readFromUrl(param) {
  const raw = new URLSearchParams(window.location.search).get(param);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// value se serializa como JSON en el query param `param`. replaceState (no
// pushState): cambiar un filtro no debe apilar entradas en el historial del
// navegador — "atrás" en un reporte filtrado sería una sorpresa desagradable.
export function useUrlState(param, defaultValue) {
  const [value, setValue] = useState(() => readFromUrl(param) ?? defaultValue);

  useEffect(() => {
    const url = new URL(window.location.href);
    const isDefault = JSON.stringify(value) === JSON.stringify(defaultValue);
    if (isDefault) {
      url.searchParams.delete(param);
    } else {
      url.searchParams.set(param, JSON.stringify(value));
    }
    window.history.replaceState(null, "", url);
    // defaultValue puede ser un literal nuevo en cada render (ej. []) — no
    // se incluye en deps a propósito, se compara por valor (JSON.stringify) arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [param, value]);

  const update = useCallback((next) => setValue(next), []);

  return [value, update];
}
