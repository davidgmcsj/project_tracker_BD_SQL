// delayCascade.js — Motor de retraso en cascada CRONOLÓGICO (a diferencia
// del motor jerárquico de scheduling.js, que solo mueve hermanas/ancestros
// de la misma jerarquía). Este motor propone mover TODAS las actividades del
// proyecto —sin importar su parentesco— cuya due_date caiga en o después de
// la due_date de la actividad de referencia, cuando esa actividad se atrasa.
//
// Reglas de negocio (decididas explícitamente con el usuario):
// 1. Candidatas: cualquier actividad del proyecto (jerarquía irrelevante)
//    cuya due_date >= due_date ORIGINAL de la actividad de referencia.
// 2. Se excluye la propia actividad de referencia (su retraso se aplica
//    directo, no es una "candidata a revisar") y cualquier actividad sin
//    due_date (no hay nada que mover).
// 3. Se excluye toda actividad con estado "completed" — Ambiente Pruebas y
//    Ambiente Producción SÍ son candidatas (siguen siendo trabajo activo).
// 4. El desplazamiento son N días HÁBILES (mismo calendario de festivos de
//    Colombia que scheduling.js — duplicado aquí a propósito, mismo
//    criterio que ese archivo documenta: no vale la pena una abstracción
//    compartida para una lista de fechas).
// 5. Cada candidata se desplaza N días hábiles desde SU PROPIA due_date
//    original — no se encadena candidata-sobre-candidata (evita que un
//    desplazamiento de una candidata cambie el desplazamiento de otra).
// 6. start_date se recalcula solo si la actividad tenía AMBAS fechas
//    (start_date y due_date) — se preserva la duración en días hábiles,
//    desplazando el inicio la misma cantidad de días hábiles que el fin.
// 7. Motor PURO: nunca muta `activities`, solo lee. Devuelve datos —
//    la UI decide qué aplicar y cómo.

const toDate = (str) => (str ? new Date(str + "T12:00:00") : null);
const toISO = (d) => d.toISOString().slice(0, 10);

// Festivos de Colombia — mismo calendario duplicado en scheduling.js (ver
// su nota de mantenimiento: actualizar en AMBOS archivos si cambian).
const FIXED_HOLIDAYS_MMDD = ["01-01", "05-01", "07-20", "08-07", "12-08", "12-25"];
const MOVABLE_HOLIDAYS = {
  2026: [
    "01-12", "03-23", "03-30", "04-02", "04-03", "05-18", "06-08", "06-15",
    "06-29", "08-17", "10-12", "11-02", "11-16",
  ],
};

function isColombianHoliday(date) {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (FIXED_HOLIDAYS_MMDD.includes(mmdd)) return true;
  return (MOVABLE_HOLIDAYS[date.getFullYear()] || []).includes(mmdd);
}

function isBusinessDay(date) {
  const dow = date.getDay();
  return dow !== 0 && dow !== 6 && !isColombianHoliday(date);
}

// Suma `n` días hábiles a partir de `date` (no cuenta `date` mismo).
function addBusinessDays(date, n) {
  let d = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}

// Cuenta días hábiles entre dos fechas (inclusive ambos extremos) — usado
// para preservar la duración al recalcular start_date.
function businessDaysBetweenDates(start, due) {
  let count = 0;
  const cur = new Date(start);
  while (cur <= due) {
    if (isBusinessDay(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// Estado resuelto de una actividad — clave interna, mismo criterio que
// activity-detail/shared.js (getActivityStatus), duplicado aquí para no
// crear un acoplamiento cruzado entre utils/ y components/ por una sola
// función de 5 líneas.
function statusOf(taskStatus, actId) {
  const ts = taskStatus || {};
  if ((ts.completed            || []).includes(actId)) return "completed";
  if ((ts.ambiente_produccion  || []).includes(actId)) return "ambiente_produccion";
  if ((ts.ambiente_pruebas     || []).includes(actId)) return "ambiente_pruebas";
  if ((ts.in_progress          || []).includes(actId)) return "in_progress";
  return "not_started";
}

// Calcula las actividades candidatas a mover por un retraso de `days` días
// hábiles originado en `referenceActivityId`. Devuelve un array de:
//   { id, text, currentStartDate, currentDueDate, newStartDate, newDueDate }
// ordenado por currentDueDate ascendente. Array vacío si la actividad de
// referencia no existe, no tiene due_date, o days no es un entero positivo.
export function computeDelayCandidates(activities, taskStatus, referenceActivityId, days) {
  const acts = Array.isArray(activities) ? activities : [];
  const n = Number(days);
  if (!Number.isInteger(n) || n <= 0) return [];

  const reference = acts.find(a => a.id === referenceActivityId);
  const refDue = reference ? toDate(reference.due_date) : null;
  if (!refDue) return [];

  const candidates = acts
    .filter(a => a.id !== referenceActivityId)
    .filter(a => statusOf(taskStatus, a.id) !== "completed")
    .map(a => {
      const currentDue = toDate(a.due_date);
      if (!currentDue || currentDue < refDue) return null;

      const newDue = addBusinessDays(currentDue, n);
      const currentStart = toDate(a.start_date);
      let newStart = null;
      if (currentStart) {
        // Preserva la duración en días hábiles: desplaza el inicio la misma
        // cantidad de días hábiles que se desplazó el fin.
        const duration = businessDaysBetweenDates(currentStart, currentDue);
        newStart = addBusinessDays(currentDue, n - duration + 1);
      }

      return {
        id: a.id,
        text: a.text || "(sin nombre)",
        currentStartDate: a.start_date || "",
        currentDueDate: a.due_date || "",
        newStartDate: newStart ? toISO(newStart) : (a.start_date || ""),
        newDueDate: toISO(newDue),
      };
    })
    .filter(Boolean);

  candidates.sort((x, y) => (x.currentDueDate < y.currentDueDate ? -1 : x.currentDueDate > y.currentDueDate ? 1 : 0));
  return candidates;
}

// Arma el patch de la propia actividad de referencia (su retraso directo,
// no pasa por la lista de "candidatas a revisar") — mismo formato
// {id, start_date, due_date} que onApplyDateChange ya acepta.
export function buildReferencePatch(activity, days) {
  const n = Number(days);
  const currentDue = toDate(activity?.due_date);
  if (!currentDue || !Number.isInteger(n) || n <= 0) return null;

  const newDue = addBusinessDays(currentDue, n);
  const currentStart = toDate(activity.start_date);
  let newStart = null;
  if (currentStart) {
    const duration = businessDaysBetweenDates(currentStart, currentDue);
    newStart = addBusinessDays(currentDue, n - duration + 1);
  }

  return {
    id: activity.id,
    start_date: newStart ? toISO(newStart) : (activity.start_date || ""),
    due_date: toISO(newDue),
  };
}
