// StatusBadge.jsx — pastilla de estado (completada/en proceso/no iniciada)
// reutilizada por las tablas de actividades del ingeniero.

const STATUS_META = {
  completed:   { label: "Completada",  cls: "eng-badge--done"    },
  in_progress: { label: "En proceso",  cls: "eng-badge--wip"     },
  not_started: { label: "No iniciada", cls: "eng-badge--pending" },
};

export function statusFromSets(id, completedSet, inProgressSet) {
  if (completedSet?.has(id)) return "completed";
  if (inProgressSet?.has(id)) return "in_progress";
  return "not_started";
}

export default function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.not_started;
  return <span className={`eng-badge ${meta.cls}`}>{meta.label}</span>;
}
