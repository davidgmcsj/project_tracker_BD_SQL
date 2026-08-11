// businessDays.js — Cálculo de horas hábiles. Cuenta días hábiles (lun-vie,
// excluyendo festivos de Colombia) entre dos fechas inclusive y multiplica
// por la jornada. Sirve para SUGERIR horas planeadas.

const HOURS_PER_DAY = 8;

// Festivos de Colombia. Formato "MM-DD" para los fijos + fechas completas para
// los que dependen del año (Semana Santa, etc.). Actualizar por año según cambien.
// Para simplicidad usamos un set de fechas completas "YYYY-MM-DD" que cubre los
// años en uso; los fijos se generan por año on-the-fly.
const FIXED_HOLIDAYS_MMDD = [
  "01-01", // Año nuevo
  "05-01", // Día del trabajo
  "07-20", // Independencia
  "08-07", // Batalla de Boyacá
  "12-08", // Inmaculada Concepción
  "12-25", // Navidad
];

// Festivos móviles / trasladables por año (Ley Emiliani y Semana Santa).
// Se pueden ampliar por año. Vacío por defecto = solo se usan los fijos.
const MOVABLE_HOLIDAYS = {
  2026: [
    "01-12","03-23","03-30","04-02","04-03","05-18","06-08","06-15",
    "06-29","08-17","10-12","11-02","11-16",
  ],
};

function isColombianHoliday(date) {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (FIXED_HOLIDAYS_MMDD.includes(mmdd)) return true;
  const year = date.getFullYear();
  return (MOVABLE_HOLIDAYS[year] || []).includes(mmdd);
}

// Devuelve el número de días hábiles entre start y due (ambos inclusive).
export function businessDaysBetween(startStr, dueStr) {
  if (!startStr || !dueStr) return 0;
  const start = new Date(startStr + "T12:00:00");
  const end   = new Date(dueStr   + "T12:00:00");
  if (isNaN(start) || isNaN(end) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6 && !isColombianHoliday(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// Horas hábiles sugeridas = días hábiles × jornada.
export function suggestedWorkHours(startStr, dueStr, hoursPerDay = HOURS_PER_DAY) {
  return businessDaysBetween(startStr, dueStr) * hoursPerDay;
}

// Suma de horas planeadas de todas las actividades del proyecto.
export function totalPlannedHours(activities) {
  return (Array.isArray(activities) ? activities : [])
    .reduce((s, a) => s + (Number(a.planned_hours) || 0), 0);
}

// Promedio de % de cumplimiento sobre las actividades que tienen fechas o progreso.
// Devuelve null si no hay ninguna actividad con progreso definido.
export function avgActivityProgress(activities) {
  const acts = (Array.isArray(activities) ? activities : [])
    .filter(a => a.start_date || a.due_date || Number(a.progress) > 0);
  if (!acts.length) return null;
  const sum = acts.reduce((s, a) => s + (Number(a.progress) || 0), 0);
  return Math.round(sum / acts.length);
}
