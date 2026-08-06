// StatusBadge.jsx — pastilla de estado (completada/en proceso/no iniciada)
// reutilizada por las tablas de actividades del ingeniero.

import { ESTADO_ACTIVIDAD_LABEL } from "../../utils/filtroOpciones";

// Solo la clase CSS vive aquí; la etiqueta viene de la fuente única
// (utils/filtroOpciones.js) para no volver a tener el vocabulario duplicado.
const STATUS_CLASS = {
  completed:   "eng-badge--done",
  in_progress: "eng-badge--wip",
  not_started: "eng-badge--pending",
};

export function statusFromSets(id, completedSet, inProgressSet) {
  if (completedSet?.has(id)) return "completed";
  if (inProgressSet?.has(id)) return "in_progress";
  return "not_started";
}

export default function StatusBadge({ status }) {
  const key = STATUS_CLASS[status] ? status : "not_started";
  return <span className={`eng-badge ${STATUS_CLASS[key]}`}>{ESTADO_ACTIVIDAD_LABEL[key]}</span>;
}
