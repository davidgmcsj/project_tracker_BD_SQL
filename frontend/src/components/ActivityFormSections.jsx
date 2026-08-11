// ActivityFormSections.jsx — Barrel de las sub-secciones reutilizables del
// editor de actividades (implementación en components/activity-form/).
// Extraídas de ActivityDetailModal para que también las use EngineerTaskModal.
// Comparten los estilos adm-* de App.css. Son controladas: reciben `items`/`onChange`.

export { default as DateBadgesSection } from "./activity-form/DateBadgesSection";
export { default as ChecklistSection }  from "./activity-form/ChecklistSection";
export { default as SubtasksSection }   from "./activity-form/SubtasksSection";
export { default as KeyDatesSection }   from "./activity-form/KeyDatesSection";
export { default as NotesSection }      from "./activity-form/NotesSection";
