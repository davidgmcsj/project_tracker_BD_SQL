// search.js — Criterio de búsqueda compartido por EditView.jsx y
// CommandPalette.jsx (Fase 14). Vive fuera de cualquier archivo de
// componente a propósito: exportar una función no-componente desde un
// archivo de componente rompe Fast Refresh (react-refresh/only-export-components).

// Todas las palabras del query deben aparecer en el texto (case-insensitive).
export function matchesSearch(text, query) {
  if (!query.trim()) return true;
  const lower = text.toLowerCase();
  return query.trim().toLowerCase().split(/\s+/).every(word => lower.includes(word));
}
