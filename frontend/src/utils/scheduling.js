// scheduling.js — Motor de recálculo en cascada de fechas para la jerarquía de
// subtareas (parent_id / sequence_order en formulas.js).
//
// Reglas de negocio (decididas explícitamente, no inventadas):
// 1. Las subtareas de un mismo padre están ordenadas por sequence_order. Si una
//    se ATRASA (su due_date pasa a ser posterior a la due_date que tenía antes
//    del cambio) y eso hace que se solape con la siguiente hermana, la
//    siguiente se recorre completa (misma duración, nuevo inicio) — como
//    fichas de dominó, encadenado hasta la última hermana que quede afectada.
// 2. La tarea madre se AUTO-EXTIENDE en silencio: su due_date pasa a ser el
//    máximo due_date de sus hijas directas. Esto se repite recursivamente
//    hacia arriba (la abuela también puede extenderse si la madre creció).
// 3. El ADELANTO (una tarea termina antes de lo previsto) NO propaga hacia
//    atrás — no corre a las hermanas siguientes ni acorta a la madre. Es una
//    decisión deliberada: evita que fechas se muevan solas sin que el usuario
//    lo pida. Adelantar manualmente cada tarea es una acción explícita.
// 4. Si dos hermanas no están solapadas (la siguiente ya empezaba después de
//    que la actual, atrasada, termine), no se produce ningún corrimiento.
// 5. Un día de "atraso" es un día HÁBIL real (reutiliza businessDaysBetween /
//    el calendario de festivos de Colombia ya existente en formulas.js), no
//    un día calendario.
// 6. El motor es PURO: recibe el array completo de actividades y el id que
//    cambió, devuelve la lista de parches { id, start_date, due_date } a
//    aplicar — nunca muta el array de entrada. Es idempotente: correrlo dos
//    veces seguidas sobre su propio resultado no produce cambios adicionales.

import { buildActivityTree } from "./formulas.js";

const toDate = (str) => (str ? new Date(str + "T12:00:00") : null);
const toISO  = (d) => d.toISOString().slice(0, 10);

// Festivos de Colombia — mismo calendario que formulas.js (duplicado aquí
// porque no está exportado desde allí; ver nota de mantenimiento al final).
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

// Suma `n` días hábiles a partir de `date` (no cuenta `date` mismo salvo n=0).
function addBusinessDays(date, n) {
  let d = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (isBusinessDay(d)) remaining--;
  }
  return d;
}

// Duración en días hábiles de una tarea (inclusive ambos extremos, mínimo 1).
function businessDuration(start, due) {
  if (!start || !due) return 1;
  let count = 0;
  const cur = new Date(start);
  while (cur <= due) {
    if (isBusinessDay(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return Math.max(1, count);
}

// Recalcula fechas tras un cambio en UNA actividad. Devuelve un array de
// parches { id, start_date, due_date } — solo las actividades cuyas fechas
// realmente cambiaron como efecto de la cascada (nunca incluye la propia
// actividad que originó el cambio, salvo que sea también un padre afectado
// por sus propios hijos en un caso de reordenamiento).
//
// `activities`: array plano completo del proyecto (con parent_id/sequence_order).
// `changedActivityId`: id de la actividad que el usuario acaba de editar.
// `previousDueDate`: due_date que tenía ANTES del cambio (string "YYYY-MM-DD" o
//   "" / null si no tenía). Necesario para distinguir atraso de adelanto.
export function rescheduleAfterChange(activities, changedActivityId, previousDueDate) {
  const acts = Array.isArray(activities) ? activities : [];
  const byId = new Map(acts.map(a => [a.id, a]));
  const changed = byId.get(changedActivityId);
  if (!changed) return [];

  const newDue = toDate(changed.due_date);
  const oldDue = toDate(previousDueDate);

  // Solo un atraso real dispara la cascada (regla 3). Sin fecha nueva, o si
  // no hay atraso respecto a la fecha anterior, no hay nada que propagar.
  if (!newDue) return [];
  if (oldDue && newDue <= oldDue) return [];

  // Copia de trabajo mutable SOLO dentro de esta función — nunca se devuelve
  // ni se filtra hacia afuera; el array de entrada permanece intacto.
  const working = new Map(acts.map(a => [a.id, { ...a }]));
  const patches = new Map(); // id -> { id, start_date, due_date }

  const applyPatch = (id, start, due) => {
    const startISO = toISO(start);
    const dueISO = toISO(due);
    const w = working.get(id);
    if (w.start_date === startISO && w.due_date === dueISO) return; // sin cambio real
    w.start_date = startISO;
    w.due_date = dueISO;
    patches.set(id, { id, start_date: startISO, due_date: dueISO });
  };

  // Paso 1-2: recorre la cadena de hermanas del nivel de `changed`, empujando
  // en dominó a las siguientes que queden solapadas.
  function cascadeSiblings(activityId) {
    const activity = working.get(activityId);
    const parentId = activity.parent_id ?? null;
    const { childrenOf } = buildActivityTree([...working.values()]);
    const siblings = childrenOf.get(parentId) || [];
    const idx = siblings.findIndex(s => s.id === activityId);
    if (idx === -1) return;

    let prevEnd = toDate(working.get(activityId).due_date);
    for (let i = idx + 1; i < siblings.length; i++) {
      const sib = working.get(siblings[i].id);
      const sibStart = toDate(sib.start_date);
      const sibDue = toDate(sib.due_date);
      if (!sibStart || !sibDue) continue; // sin fechas propias, no participa en la cadena
      if (sibStart > prevEnd) break; // regla 4: no solapada, la cadena se detiene aquí

      const duration = businessDuration(sibStart, sibDue);
      const newStart = addBusinessDays(prevEnd, 1); // día hábil siguiente al fin de la anterior, nunca el mismo día
      const newEnd = addBusinessDays(newStart, duration - 1);
      applyPatch(sib.id, newStart, newEnd);
      prevEnd = newEnd;
    }
  }

  // Paso 3-4: auto-extiende recursivamente hacia arriba. Para cada nivel,
  // due_date del padre = max(due_date) de sus hijas directas ya actualizadas.
  // Se detiene cuando no hay padre o cuando un nivel no produce cambio
  // (idempotencia — evita recorrer indefinidamente un árbol ya estable).
  function extendAncestors(activityId) {
    const activity = working.get(activityId);
    let parentId = activity.parent_id ?? null;

    while (parentId != null) {
      const parent = working.get(parentId);
      if (!parent) break;
      const { childrenOf } = buildActivityTree([...working.values()]);
      const children = childrenOf.get(parentId) || [];
      if (!children.length) break;

      let maxDue = null;
      children.forEach(c => {
        const d = toDate(working.get(c.id).due_date);
        if (d && (!maxDue || d > maxDue)) maxDue = d;
      });
      if (!maxDue) break;

      const parentDue = toDate(parent.due_date);
      if (parentDue && maxDue <= parentDue) break; // ya contiene a todos, sin cambio (idempotencia)

      const parentStart = toDate(parent.start_date) || maxDue;
      applyPatch(parentId, parentStart <= maxDue ? parentStart : maxDue, maxDue);
      parentId = parent.parent_id ?? null; // sube un nivel más
    }
  }

  cascadeSiblings(changedActivityId);
  extendAncestors(changedActivityId);

  // Si el propio cambio del usuario también generó corrimiento en cadena de
  // hermanas, esas hermanas recorridas pueden a su vez extender sus propios
  // padres si tuvieran una jerarquía distinta (mismo padre en este diseño,
  // por lo que ya quedó cubierto arriba) — no se requiere un segundo barrido.

  return Array.from(patches.values());
}

// Nota de mantenimiento: FIXED_HOLIDAYS_MMDD/MOVABLE_HOLIDAYS están duplicados
// respecto a formulas.js (mismo criterio que utils/isoWeek.js: módulos con
// dependencias/empaquetado independientes, no vale la pena una abstracción
// compartida para una lista de fechas). Si se agregan festivos de años nuevos,
// actualizar en AMBOS archivos.
