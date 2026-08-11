// dateValidation.js — Reglas de consistencia entre fechas de una actividad o
// tarea: inicio/fin y las tres fechas de transición de estado
// (inscrita/en proceso/completada). Puras, sin React — usadas por
// ActivityDetailModal y EngineerTaskModal.
//
// Deliberadamente NO se aplican a datos ya guardados (Gantt, Kanban,
// reportes siguen mostrando actividades viejas con fechas inconsistentes sin
// romper nada) — solo entran a jugar cuando alguien vuelve a editar esas
// fechas desde uno de los dos modales de detalle.

// Fechas vacías nunca son un error: la regla solo aplica cuando AMBOS
// extremos están presentes. Dejar un campo en blanco sigue siendo válido
// (ej. una actividad sin fecha de fin todavía).
function bothPresent(a, b) {
  return !!a && !!b;
}

// Fecha fin no puede ser anterior a fecha inicio.
export function validateStartEnd(startDate, dueDate) {
  if (!bothPresent(startDate, dueDate)) return null;
  if (dueDate < startDate) return "La fecha fin no puede ser anterior a la fecha de inicio.";
  return null;
}

// Las fechas de transición (en proceso / completada) no pueden ser
// anteriores a "inscrita", ni caer fuera de [start_date, due_date] cuando
// esas dos están definidas. "en proceso" tampoco puede ser posterior a
// "completada" si ambas existen.
export function validateTransitionDates({ startDate, dueDate, added, inProgress, completed }) {
  const errors = {};

  const inRange = (label, dateStr) => {
    if (!dateStr) return null;
    if (added && dateStr < added) return `${label} no puede ser anterior a la fecha de inscripción.`;
    if (startDate && dateStr < startDate) return `${label} no puede ser anterior a la fecha de inicio.`;
    if (dueDate && dateStr > dueDate) return `${label} no puede ser posterior a la fecha de fin.`;
    return null;
  };

  const inProgressErr = inRange("La fecha de \"en proceso\"", inProgress);
  if (inProgressErr) errors.in_progress = inProgressErr;

  const completedErr = inRange("La fecha de \"completada\"", completed);
  if (completedErr) errors.completed = completedErr;

  if (!errors.completed && bothPresent(inProgress, completed) && completed < inProgress) {
    errors.completed = "La fecha de \"completada\" no puede ser anterior a la fecha de \"en proceso\".";
  }

  return Object.keys(errors).length ? errors : null;
}
