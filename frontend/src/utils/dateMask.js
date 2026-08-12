// dateMask.js — Lógica pura de conversión/enmascarado para DateInput
// (components/common/DateInput.jsx). Separado del componente para poder
// testearlo con node --test sin renderizar React (este repo no tiene
// testing-library, solo tests de lógica pura).

// "YYYY-MM-DD" → "DD/MM/AAAA". Vacío/inválido → "".
export function isoToDisplay(iso) {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Fecha real (rechaza 31/02, 31/04, etc. — Date normaliza esos casos en vez
// de fallar, hay que validar a mano).
export function isValidCalendarDate(day, month, year) {
  const d = new Date(year, month - 1, day);
  return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

// "DD/MM/AAAA" completo y válido → "YYYY-MM-DD". Cualquier otro caso → null
// (típicamente mientras el usuario todavía está escribiendo).
export function displayToIso(display) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  if (!isValidCalendarDate(day, month, year)) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Inserta "/" automáticamente tras día y mes mientras el usuario teclea
// dígitos, y descarta cualquier caracter que no sea dígito (soporta pegar
// "06/08/2026" o "06082026" indistintamente).
export function maskInput(raw) {
  const digits = raw.replace(/\D/g, "").slice(0, 8);
  const parts = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  return parts.join("/");
}

// ── Grid de calendario (para el picker visual de DateInput) ────────────────
// El <input type="date"> nativo que DateInput reemplazó traía gratis un
// calendario emergente para "hacer clic y elegir" en vez de teclear —
// perderlo de golpe rompió ese flujo (ver captura del usuario: "al darle no
// me despliega el cronograma para mover fechas"). Este helper arma la grilla
// de un mes calendario (domingo a sábado, como el resto de la app — ver
// weekPlanning.js) para que DateInput pinte un picker propio sin depender de
// ninguna librería externa.

const MONTH_NAMES = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
export const WEEKDAY_LABELS = ["D","L","M","M","J","V","S"];

export function monthLabel(year, monthIndex) {
  return `${MONTH_NAMES[monthIndex]} ${year}`;
}

// Días del mes (year, monthIndex 0-11) en semanas de 7, con relleno de los
// meses adyacentes para completar la primera/última semana — mismo patrón
// visual que cualquier calendario mensual. Cada celda: { iso, day, inMonth }.
export function buildCalendarGrid(year, monthIndex) {
  const firstOfMonth = new Date(year, monthIndex, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=domingo
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();

  const cells = [];
  // Relleno inicial: días del mes anterior.
  for (let i = startWeekday - 1; i >= 0; i--) {
    const d = new Date(year, monthIndex, -i);
    cells.push({ iso: isoOf(d), day: d.getDate(), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(year, monthIndex, day);
    cells.push({ iso: isoOf(d), day, inMonth: true });
  }
  // Relleno final: completa la última semana a múltiplo de 7.
  while (cells.length % 7 !== 0) {
    const last = cells[cells.length - 1];
    const d = new Date(last.iso + "T12:00:00");
    d.setDate(d.getDate() + 1);
    cells.push({ iso: isoOf(d), day: d.getDate(), inMonth: false });
  }
  return cells;
}

function isoOf(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
