// scheduling.test.js — Motor de recálculo en cascada de fechas.
//
// scheduling.js tenía 187 líneas y CERO cobertura pese a ser lógica de negocio
// pura y delicada: mueve fechas de tareas automáticamente. Estos tests fijan
// las 6 reglas que su propia cabecera documenta, para que la refactorización
// (o un cambio futuro del motor) no las altere en silencio.
//
//   node --test src/utils/scheduling.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import { rescheduleAfterChange } from "./scheduling.js";

// Helper: actividad con la forma mínima que el motor necesita.
function act(id, { parent = null, orden = 0, inicio = "", fin = "" } = {}) {
  return {
    id,
    text: id,
    parent_id: parent,
    sequence_order: orden,
    start_date: inicio,
    due_date: fin,
  };
}

// Devuelve el parche de una actividad concreta, o undefined.
const parcheDe = (parches, id) => parches.find(p => p.id === id);

// ── Regla 3: el adelanto NO propaga ───────────────────────────────────────────

test("adelantar una tarea no produce ningún cambio", () => {
  // Arrange — la tarea A termina ANTES de lo que terminaba antes.
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-05" }),
    act("B", { orden: 1, inicio: "2026-08-06", fin: "2026-08-10" }),
  ];

  // Act — previousDueDate posterior a la actual = adelanto.
  const parches = rescheduleAfterChange(acts, "A", "2026-08-07");

  // Assert
  assert.deepEqual(parches, [], "un adelanto no debe mover nada (regla 3)");
});

test("sin due_date en la tarea cambiada no hay cascada", () => {
  const acts = [act("A", { orden: 0 }), act("B", { orden: 1 })];
  assert.deepEqual(rescheduleAfterChange(acts, "A", ""), []);
});

test("una actividad inexistente devuelve lista vacía sin lanzar", () => {
  const acts = [act("A", { fin: "2026-08-05" })];
  assert.deepEqual(rescheduleAfterChange(acts, "NO_EXISTE", "2026-08-01"), []);
});

// ── Regla 1: atraso que solapa empuja a la hermana siguiente ──────────────────

test("atrasar una tarea empuja a la hermana que queda solapada", () => {
  // Arrange — A terminaba el 05, ahora termina el 12: pisa a B.
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-12" }),
    act("B", { orden: 1, inicio: "2026-08-06", fin: "2026-08-07" }),
  ];

  // Act
  const parches = rescheduleAfterChange(acts, "A", "2026-08-05");

  // Assert — B se corre por completo, después del nuevo fin de A.
  const b = parcheDe(parches, "B");
  assert.ok(b, "B debía recibir un parche");
  assert.ok(b.start_date > "2026-08-12", `B debe empezar tras el fin de A, empezó ${b.start_date}`);
});

test("el corrimiento conserva la duración en días hábiles de la hermana", () => {
  // B va del martes 8 al jueves 10 de septiembre de 2026: 3 días hábiles
  // seguidos, sin fines de semana ni festivos colombianos de por medio.
  //
  // (Se evita agosto a propósito: el 7 es Batalla de Boyacá y el 17 es festivo
  // trasladado, así que ahí "3 días de calendario" no son 3 días hábiles.)
  const acts = [
    act("A", { orden: 0, inicio: "2026-09-01", fin: "2026-09-15" }),
    act("B", { orden: 1, inicio: "2026-09-08", fin: "2026-09-10" }),
  ];

  const b = parcheDe(rescheduleAfterChange(acts, "A", "2026-09-07"), "B");
  assert.ok(b, "B debía moverse");

  // Cuenta días hábiles incluyendo festivos de Colombia, igual que el motor.
  const FESTIVOS = ["01-01", "05-01", "07-20", "08-07", "12-08", "12-25"];
  const MOVIBLES_2026 = [
    "01-12", "03-23", "03-30", "04-02", "04-03", "05-18", "06-08", "06-15",
    "06-29", "08-17", "10-12", "11-02", "11-16",
  ];
  const diasHabiles = (ini, fin) => {
    let n = 0;
    const cur = new Date(ini + "T12:00:00");
    const hasta = new Date(fin + "T12:00:00");
    while (cur <= hasta) {
      const dow = cur.getDay();
      const mmdd = `${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
      const festivo = FESTIVOS.includes(mmdd) || (cur.getFullYear() === 2026 && MOVIBLES_2026.includes(mmdd));
      if (dow !== 0 && dow !== 6 && !festivo) n++;
      cur.setDate(cur.getDate() + 1);
    }
    return n;
  };

  assert.equal(diasHabiles(b.start_date, b.due_date), 3,
    `B debe seguir durando 3 días hábiles, quedó ${b.start_date}..${b.due_date}`);
});

test("el motor descuenta los festivos de Colombia al conservar la duración", () => {
  // Caso real que hizo fallar la primera versión de este test: B ocupa el
  // jueves 6 y el viernes 7 de agosto de 2026, pero el 7 es Batalla de Boyacá,
  // así que su duración REAL es de 1 día hábil, no 2. El motor lo respeta.
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-12" }),
    act("B", { orden: 1, inicio: "2026-08-06", fin: "2026-08-07" }),
  ];

  const b = parcheDe(rescheduleAfterChange(acts, "A", "2026-08-05"), "B");

  assert.equal(b.start_date, b.due_date,
    "al durar 1 día hábil, B debe quedar en un único día");
});

// ── Regla 4: sin solapamiento no hay corrimiento ──────────────────────────────

test("si la hermana siguiente ya empezaba después, no se mueve", () => {
  // A se atrasa del 05 al 07, pero B empieza el 20: no hay solape.
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-07" }),
    act("B", { orden: 1, inicio: "2026-08-20", fin: "2026-08-25" }),
  ];

  const parches = rescheduleAfterChange(acts, "A", "2026-08-05");

  assert.equal(parcheDe(parches, "B"), undefined, "B no debía moverse (regla 4)");
});

test("una hermana sin fechas propias no participa en la cadena", () => {
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-12" }),
    act("B", { orden: 1 }),   // sin fechas
  ];

  const parches = rescheduleAfterChange(acts, "A", "2026-08-05");
  assert.equal(parcheDe(parches, "B"), undefined);
});

// ── Regla 2: la madre se auto-extiende ────────────────────────────────────────

test("la tarea madre se extiende hasta cubrir a la hija atrasada", () => {
  // Arrange — la madre M terminaba el 10; su hija H se atrasa hasta el 20.
  const acts = [
    act("M", { orden: 0, inicio: "2026-08-03", fin: "2026-08-10" }),
    act("H", { parent: "M", orden: 0, inicio: "2026-08-04", fin: "2026-08-20" }),
  ];

  // Act
  const parches = rescheduleAfterChange(acts, "H", "2026-08-06");

  // Assert
  const m = parcheDe(parches, "M");
  assert.ok(m, "la madre debía extenderse (regla 2)");
  assert.equal(m.due_date, "2026-08-20", "la madre termina cuando termina su hija más tardía");
});

test("la extensión sube por toda la jerarquía (abuela incluida)", () => {
  const acts = [
    act("ABUELA", { orden: 0, inicio: "2026-08-03", fin: "2026-08-10" }),
    act("MADRE",  { parent: "ABUELA", orden: 0, inicio: "2026-08-03", fin: "2026-08-10" }),
    act("HIJA",   { parent: "MADRE",  orden: 0, inicio: "2026-08-04", fin: "2026-08-25" }),
  ];

  const parches = rescheduleAfterChange(acts, "HIJA", "2026-08-06");

  assert.equal(parcheDe(parches, "MADRE")?.due_date, "2026-08-25");
  assert.equal(parcheDe(parches, "ABUELA")?.due_date, "2026-08-25", "la abuela también se extiende");
});

test("la madre NO se encoge si ya contenía a la hija", () => {
  // La madre termina el 30; la hija se atrasa al 20, que sigue dentro.
  const acts = [
    act("M", { orden: 0, inicio: "2026-08-03", fin: "2026-08-30" }),
    act("H", { parent: "M", orden: 0, inicio: "2026-08-04", fin: "2026-08-20" }),
  ];

  const parches = rescheduleAfterChange(acts, "H", "2026-08-06");

  assert.equal(parcheDe(parches, "M"), undefined, "la madre ya contenía a la hija, no debe cambiar");
});

// ── Regla 6: pureza e idempotencia ────────────────────────────────────────────

test("no muta el array de entrada", () => {
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-12" }),
    act("B", { orden: 1, inicio: "2026-08-06", fin: "2026-08-07" }),
  ];
  const copia = JSON.parse(JSON.stringify(acts));

  rescheduleAfterChange(acts, "A", "2026-08-05");

  assert.deepEqual(acts, copia, "el motor debe ser puro (regla 6)");
});

test("aplicar los parches y volver a correr no produce cambios nuevos", () => {
  // Idempotencia: correr el motor sobre su propio resultado da lista vacía.
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-12" }),
    act("B", { orden: 1, inicio: "2026-08-06", fin: "2026-08-07" }),
  ];

  const parches = rescheduleAfterChange(acts, "A", "2026-08-05");
  const aplicados = acts.map(a => {
    const p = parcheDe(parches, a.id);
    return p ? { ...a, start_date: p.start_date, due_date: p.due_date } : a;
  });

  // Ya no hay atraso respecto a la nueva fecha: nada que propagar.
  assert.deepEqual(rescheduleAfterChange(aplicados, "A", "2026-08-12"), []);
});

test("devuelve un array aunque no haya nada que hacer", () => {
  assert.ok(Array.isArray(rescheduleAfterChange([], "X", "")));
  assert.ok(Array.isArray(rescheduleAfterChange(null, "X", "")));
  assert.ok(Array.isArray(rescheduleAfterChange(undefined, "X", "")));
});

// ── Regla 5: los días son hábiles, no calendario ──────────────────────────────

test("el corrimiento salta el fin de semana", () => {
  // A termina el viernes 7 de agosto de 2026. La hermana no puede empezar
  // sábado ni domingo.
  const acts = [
    act("A", { orden: 0, inicio: "2026-08-03", fin: "2026-08-07" }),
    act("B", { orden: 1, inicio: "2026-08-05", fin: "2026-08-06" }),
  ];

  const b = parcheDe(rescheduleAfterChange(acts, "A", "2026-08-04"), "B");

  assert.ok(b, "B debía moverse");
  const dia = new Date(b.start_date + "T12:00:00").getDay();
  assert.ok(dia !== 0 && dia !== 6, `B empezó en fin de semana (${b.start_date})`);
});
