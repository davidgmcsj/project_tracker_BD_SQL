// weekPlanning.test.js — Tests del cálculo automático de tareas por semana.
//
//   node --test src/utils/weekPlanning.test.js     (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  weekRange, nextWeekRange, activityRange, overlapsWeek,
  situationInWeek, activitiesForWeek, activitiesForEngineerWeek,
  completedInWeek, recomputeWeeklyFields, SITUATION,
} from "./weekPlanning.js";

// Semana de referencia en todos los tests: lunes 2026-08-03 a domingo 2026-08-09.
const WEEK = weekRange("2026-08-05"); // un miércoles cualquiera de esa semana

function act(id, start, due, overrides = {}) {
  return { id, text: id, start_date: start, due_date: due, assigned_engineers: [], ...overrides };
}

// ── weekRange / nextWeekRange ─────────────────────────────────────────────────

test("weekRange devuelve lunes a domingo de la semana que contiene la fecha", () => {
  assert.deepEqual(WEEK, { start: "2026-08-03", end: "2026-08-09" });
});

test("weekRange sobre un domingo devuelve la semana que TERMINA ese domingo", () => {
  assert.deepEqual(weekRange("2026-08-09"), { start: "2026-08-03", end: "2026-08-09" });
});

test("weekRange sobre un lunes devuelve esa misma semana", () => {
  assert.deepEqual(weekRange("2026-08-03"), { start: "2026-08-03", end: "2026-08-09" });
});

test("nextWeekRange devuelve la semana siguiente completa", () => {
  assert.deepEqual(nextWeekRange("2026-08-05"), { start: "2026-08-10", end: "2026-08-16" });
});

test("nextWeekRange cruza correctamente el cambio de mes", () => {
  assert.deepEqual(nextWeekRange("2026-08-28"), { start: "2026-08-31", end: "2026-09-06" });
});

// ── activityRange ─────────────────────────────────────────────────────────────

test("activityRange sin ninguna fecha devuelve null", () => {
  assert.equal(activityRange(act("a", "", "")), null);
});

test("activityRange con solo inicio trata la actividad como puntual ese día", () => {
  assert.deepEqual(activityRange(act("a", "2026-08-05", "")), { from: "2026-08-05", to: "2026-08-05" });
});

test("activityRange con solo fin trata la actividad como puntual ese día", () => {
  assert.deepEqual(activityRange(act("a", "", "2026-08-05")), { from: "2026-08-05", to: "2026-08-05" });
});

test("activityRange normaliza fechas invertidas en vez de descartar la actividad", () => {
  assert.deepEqual(activityRange(act("a", "2026-08-20", "2026-08-05")), { from: "2026-08-05", to: "2026-08-20" });
});

// ── overlapsWeek — el caso multi-semana ───────────────────────────────────────

test("tarea que abarca 3 semanas aparece en las 3 (caso multi-semana)", () => {
  const larga = act("larga", "2026-07-27", "2026-08-14");
  assert.equal(overlapsWeek(larga, weekRange("2026-07-28")), true, "semana 1: la de inicio");
  assert.equal(overlapsWeek(larga, weekRange("2026-08-05")), true, "semana 2: intermedia, sin fecha propia");
  assert.equal(overlapsWeek(larga, weekRange("2026-08-12")), true, "semana 3: la de entrega");
});

test("tarea totalmente anterior a la semana no se solapa", () => {
  assert.equal(overlapsWeek(act("a", "2026-07-20", "2026-07-24"), WEEK), false);
});

test("tarea totalmente posterior a la semana no se solapa", () => {
  assert.equal(overlapsWeek(act("a", "2026-08-17", "2026-08-21"), WEEK), false);
});

test("tarea de un solo día dentro de la semana se solapa", () => {
  assert.equal(overlapsWeek(act("a", "2026-08-05", "2026-08-05"), WEEK), true);
});

test("solapamiento por el borde exacto (termina el lunes) cuenta", () => {
  assert.equal(overlapsWeek(act("a", "2026-07-28", "2026-08-03"), WEEK), true);
});

test("solapamiento por el borde exacto (empieza el domingo) cuenta", () => {
  assert.equal(overlapsWeek(act("a", "2026-08-09", "2026-08-15"), WEEK), true);
});

// ── situationInWeek ───────────────────────────────────────────────────────────

test("situación: la entrega cae dentro de la semana", () => {
  assert.equal(situationInWeek(act("a", "2026-08-04", "2026-08-06"), WEEK, {}), SITUATION.DUE);
});

test("situación: arranca en la semana pero termina después", () => {
  assert.equal(situationInWeek(act("a", "2026-08-06", "2026-08-20"), WEEK, {}), SITUATION.STARTS);
});

test("situación: semana intermedia de una tarea larga (ni inicia ni vence)", () => {
  assert.equal(situationInWeek(act("a", "2026-07-27", "2026-08-14"), WEEK, {}), SITUATION.CONTINUES);
});

test("situación: venció antes y sigue sin completarse → en demora", () => {
  assert.equal(situationInWeek(act("a", "2026-07-20", "2026-07-24"), WEEK, {}), SITUATION.OVERDUE);
});

test("situación: venció antes pero ya está completada → no aparece", () => {
  const ts = { completed: ["a"] };
  assert.equal(situationInWeek(act("a", "2026-07-20", "2026-07-24"), WEEK, ts), null);
});

test("situación: solo fecha de inicio (sin due_date), inicio en el pasado → Continúa, NO en demora", () => {
  // Sin fecha de fin no hay plazo que pueda estar vencido — ver comentario
  // de situationInWeek. Antes se etiquetaba OVERDUE solo porque activityRange
  // usa start_date como "to" a falta de due_date.
  assert.equal(situationInWeek(act("a", "2026-07-20", ""), WEEK, {}), SITUATION.CONTINUES);
});

test("situación: solo fecha de inicio Y con due_date real vencido → sigue siendo OVERDUE", () => {
  assert.equal(situationInWeek(act("a", "2026-07-20", "2026-07-24"), WEEK, {}), SITUATION.OVERDUE);
});

// ── activitiesForWeek ─────────────────────────────────────────────────────────

test("activitiesForWeek incluye solapadas y vencidas, excluye futuras", () => {
  const acts = [
    act("vencida",   "2026-07-20", "2026-07-24"),
    act("vence",     "2026-08-04", "2026-08-06"),
    act("continua",  "2026-07-27", "2026-08-14"),
    act("futura",    "2026-08-17", "2026-08-21"),
  ];
  const ids = activitiesForWeek(acts, WEEK, {}).map(r => r.activity.id);
  assert.deepEqual(ids.sort(), ["continua", "vence", "vencida"]);
});

test("activitiesForWeek con includeOverdue:false omite el arrastre", () => {
  const acts = [act("vencida", "2026-07-20", "2026-07-24"), act("vence", "2026-08-04", "2026-08-06")];
  const ids = activitiesForWeek(acts, WEEK, {}, { includeOverdue: false }).map(r => r.activity.id);
  assert.deepEqual(ids, ["vence"]);
});

test("activitiesForWeek sigue arrastrando una actividad sin due_date con inicio pasado (como Continúa, no se pierde de vista)", () => {
  const acts = [act("sin-fin", "2026-07-20", "")];
  const rows = activitiesForWeek(acts, WEEK, {});
  assert.deepEqual(rows.map(r => r.activity.id), ["sin-fin"]);
  assert.equal(rows[0].situation, SITUATION.CONTINUES);
});

test("activitiesForWeek ordena por fecha de entrega ascendente", () => {
  const acts = [
    act("tarde",   "2026-08-03", "2026-08-08"),
    act("pronto",  "2026-08-03", "2026-08-04"),
    act("medio",   "2026-08-03", "2026-08-06"),
  ];
  const ids = activitiesForWeek(acts, WEEK, {}).map(r => r.activity.id);
  assert.deepEqual(ids, ["pronto", "medio", "tarde"]);
});

test("activitiesForWeek ignora actividades sin ninguna fecha", () => {
  const acts = [act("sinfecha", "", ""), act("confecha", "2026-08-04", "2026-08-06")];
  const ids = activitiesForWeek(acts, WEEK, {}).map(r => r.activity.id);
  assert.deepEqual(ids, ["confecha"]);
});

// ── activitiesForEngineerWeek ─────────────────────────────────────────────────

test("activitiesForEngineerWeek filtra solo lo asignado a ese ingeniero", () => {
  const acts = [
    act("mia",   "2026-08-04", "2026-08-06", { assigned_engineers: [{ id: "e1", name: "Ana" }] }),
    act("suya",  "2026-08-04", "2026-08-06", { assigned_engineers: [{ id: "e2", name: "Beto" }] }),
    act("nadie", "2026-08-04", "2026-08-06"),
  ];
  const ids = activitiesForEngineerWeek(acts, WEEK, {}, "e1").map(r => r.activity.id);
  assert.deepEqual(ids, ["mia"]);
});

test("activitiesForEngineerWeek incluye actividades con varios responsables", () => {
  const acts = [
    act("compartida", "2026-08-04", "2026-08-06", {
      assigned_engineers: [{ id: "e1", name: "Ana" }, { id: "e2", name: "Beto" }],
    }),
  ];
  assert.equal(activitiesForEngineerWeek(acts, WEEK, {}, "e2").length, 1);
});

// ── completedInWeek ───────────────────────────────────────────────────────────

test("completedInWeek toma solo las completadas dentro del rango", () => {
  const acts = [act("a", "", "2026-08-04"), act("b", "", "2026-07-20"), act("c", "", "2026-08-06")];
  const ts = { completed_dates: { a: "2026-08-05", b: "2026-07-22", c: "2026-08-09" } };
  const ids = completedInWeek(acts, WEEK, ts).map(a => a.id);
  assert.deepEqual(ids, ["a", "c"]);
});

test("completedInWeek sin completed_dates devuelve vacío", () => {
  assert.deepEqual(completedInWeek([act("a", "", "2026-08-04")], WEEK, {}), []);
});

// ── recomputeWeeklyFields — snapshot explícito para "Nueva semana" ────────────
// TODAY fijo: miércoles 2026-08-05 (misma semana que WEEK arriba).

const TODAY = new Date("2026-08-05T12:00:00");

test("recomputeWeeklyFields llena weekly_achievements/next_week_plan aunque el proyecto NUNCA se haya abierto en pantalla", () => {
  const project = {
    activities_identified: [
      act("hecha",  "", "2026-08-04"),
      act("futura", "2026-08-11", "2026-08-13"),
    ],
    task_status: { completed_dates: { hecha: "2026-08-04" } },
    engineers: [],
    // Campos "viejos" que un useEffect nunca tuvo oportunidad de actualizar:
    weekly_achievements: ["algo-de-la-semana-pasada"],
    next_week_plan: [],
  };
  const result = recomputeWeeklyFields(project, TODAY);
  assert.deepEqual(result.weekly_achievements, ["hecha"]);
  assert.deepEqual(result.next_week_plan, ["futura"]);
});

test("recomputeWeeklyFields recalcula weekly_detail/weekly_total por ingeniero", () => {
  const project = {
    activities_identified: [
      act("mia", "2026-08-04", "2026-08-06", { assigned_engineers: [{ id: "e1", name: "Ana" }] }),
    ],
    task_status: {},
    engineers: [{ engineer_id: "e1", weekly_detail: [], weekly_total: 0 }],
  };
  const result = recomputeWeeklyFields(project, TODAY);
  assert.deepEqual(result.engineers[0].weekly_detail, ["mia"]);
  assert.equal(result.engineers[0].weekly_total, 1);
});

test("recomputeWeeklyFields deja intacta la fila de un ingeniero sin engineer_id (placeholder vacío)", () => {
  const project = {
    activities_identified: [],
    task_status: {},
    engineers: [{ engineer_id: "", weekly_detail: [], weekly_total: 0 }],
  };
  const result = recomputeWeeklyFields(project, TODAY);
  assert.deepEqual(result.engineers[0], { engineer_id: "", weekly_detail: [], weekly_total: 0 });
});

test("recomputeWeeklyFields no muta el proyecto original", () => {
  const project = {
    activities_identified: [act("a", "", "2026-08-04")],
    task_status: { completed_dates: { a: "2026-08-04" } },
    engineers: [],
    weekly_achievements: [],
  };
  recomputeWeeklyFields(project, TODAY);
  assert.deepEqual(project.weekly_achievements, []);
});

test("recomputeWeeklyFields con proyecto sin actividades no falla", () => {
  const project = { activities_identified: [], task_status: {}, engineers: [] };
  const result = recomputeWeeklyFields(project, TODAY);
  assert.deepEqual(result.weekly_achievements, []);
  assert.deepEqual(result.next_week_plan, []);
});
