// hierarchy.test.js — Tests del árbol de subtareas (formulas.js) y del motor
// de recálculo en cascada (scheduling.js).
//
// Usa el runner nativo de Node (sin dependencias extra):
//   node --test src/utils/hierarchy.test.js     (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createActivity, buildActivityTree, flattenTree, formatHierarchyNumber,
  aggregatedProgress, wouldCreateCycle, shortEngineerName,
} from "./formulas.js";
import { rescheduleAfterChange } from "./scheduling.js";

// Helper: crea una actividad con overrides directos (sin pasar por el flujo
// completo de createActivity + set manual, para tests más legibles).
function act(id, overrides = {}) {
  return { ...createActivity(overrides.text || id), id, parent_id: null, sequence_order: 0, ...overrides };
}

// ── buildActivityTree / flattenTree ───────────────────────────────────────────

test("árbol de 5 niveles: flattenTree produce el path esperado", () => {
  const acts = [
    act("a1", { text: "Raíz 1" }),
    act("a2", { text: "Hijo 1.1", parent_id: "a1" }),
    act("a3", { text: "Nieto 1.1.1", parent_id: "a2" }),
    act("a4", { text: "Bisnieto 1.1.1.1", parent_id: "a3" }),
    act("a5", { text: "Tataranieto 1.1.1.1.1", parent_id: "a4" }),
  ];
  const flat = flattenTree(acts);
  assert.equal(flat.length, 5);
  assert.deepEqual(flat[4].path, [1, 1, 1, 1, 1]);
  assert.equal(flat[4].level, 4);
  assert.equal(formatHierarchyNumber(flat[4].path), "1.1.1.1.1");
});

test("nodo sin hijos: aparece como hoja, childrenOf vacío para su id", () => {
  const acts = [act("a1"), act("a2", { parent_id: "a1" })];
  const { childrenOf } = buildActivityTree(acts);
  assert.equal((childrenOf.get("a2") || []).length, 0);
  assert.equal((childrenOf.get("a1") || []).length, 1);
});

test("ciclo detectado: parent_id que se referencia circularmente se trata como raíz, sin colgar el recorrido", () => {
  const acts = [
    act("a1", { parent_id: "a3" }),
    act("a2", { parent_id: "a1" }),
    act("a3", { parent_id: "a2" }), // a1 -> a3 -> a2 -> a1: ciclo
  ];
  const flat = flattenTree(acts); // no debe entrar en bucle infinito
  assert.equal(flat.length, 3, "las 3 actividades deben aparecer exactamente una vez cada una");
});

test("parent_id huérfano (padre borrado) se trata como raíz", () => {
  const acts = [act("a1", { parent_id: "no-existe" })];
  const { rootIds } = buildActivityTree(acts);
  assert.deepEqual(rootIds, ["a1"]);
});

test("sequence_order asignado correctamente ordena hermanas", () => {
  const acts = [
    act("a1", { sequence_order: 2 }),
    act("a2", { sequence_order: 0 }),
    act("a3", { sequence_order: 1 }),
  ];
  const { rootIds } = buildActivityTree(acts);
  assert.deepEqual(rootIds, ["a2", "a3", "a1"]);
});

test("actividades sin sequence_order usan la posición del array como fallback", () => {
  const acts = [act("a1"), act("a2"), act("a3")];
  const { rootIds } = buildActivityTree(acts);
  assert.deepEqual(rootIds, ["a1", "a2", "a3"]);
});

test("collapsedIds oculta descendientes pero conserva la propia fila", () => {
  const acts = [
    act("a1"),
    act("a2", { parent_id: "a1" }),
    act("a3", { parent_id: "a2" }),
  ];
  const flat = flattenTree(acts, { collapsedIds: new Set(["a1"]) });
  assert.equal(flat.length, 1);
  assert.equal(flat[0].activity.id, "a1");
});

// ── aggregatedProgress ────────────────────────────────────────────────────────

test("aggregatedProgress: hoja devuelve su propio progreso manual", () => {
  const acts = [act("a1", { progress: 40 })];
  const { childrenOf } = buildActivityTree(acts);
  assert.equal(aggregatedProgress(acts[0], childrenOf), 40);
});

test("aggregatedProgress: padre con 2 hijos promedia", () => {
  const acts = [
    act("a1"),
    act("a2", { parent_id: "a1", progress: 100 }),
    act("a3", { parent_id: "a1", progress: 0 }),
  ];
  const { childrenOf } = buildActivityTree(acts);
  assert.equal(aggregatedProgress(acts[0], childrenOf), 50);
});

// ── wouldCreateCycle ──────────────────────────────────────────────────────────

test("wouldCreateCycle: mover una tarea a ser hija de su propia nieta es rechazado", () => {
  const acts = [
    act("a1"),
    act("a2", { parent_id: "a1" }),
    act("a3", { parent_id: "a2" }),
  ];
  assert.equal(wouldCreateCycle(acts, "a1", "a3"), true);
});

test("wouldCreateCycle: mover a un padre válido no relacionado no es ciclo", () => {
  const acts = [act("a1"), act("a2")];
  assert.equal(wouldCreateCycle(acts, "a1", "a2"), false);
});

test("wouldCreateCycle: una tarea no puede ser su propio padre", () => {
  const acts = [act("a1")];
  assert.equal(wouldCreateCycle(acts, "a1", "a1"), true);
});

// ── rescheduleAfterChange — motor de cascada ──────────────────────────────────

test("cadena de 3 hermanas: la primera se atrasa y empuja a las 2 siguientes, la madre se extiende", () => {
  const acts = [
    act("madre", { start_date: "2026-01-05", due_date: "2026-01-16" }),
    act("h1", { parent_id: "madre", sequence_order: 0, start_date: "2026-01-05", due_date: "2026-01-07" }),
    act("h2", { parent_id: "madre", sequence_order: 1, start_date: "2026-01-08", due_date: "2026-01-09" }),
    act("h3", { parent_id: "madre", sequence_order: 2, start_date: "2026-01-12", due_date: "2026-01-16" }),
  ];
  // h1 se atrasa: su due_date pasa de 2026-01-07 a 2026-01-14 (7 días hábiles de atraso)
  acts[1].due_date = "2026-01-14";
  const patches = rescheduleAfterChange(acts, "h1", "2026-01-07");
  const byId = Object.fromEntries(patches.map(p => [p.id, p]));

  assert.ok(byId.h2, "h2 debía recorrerse porque estaba solapada con el nuevo rango de h1");
  assert.ok(new Date(byId.h2.start_date + "T12:00:00") >= new Date("2026-01-14T12:00:00"));
  assert.ok(byId.h3, "h3 también debía recorrerse en cadena");
  assert.ok(byId.madre, "la madre debía auto-extenderse para seguir conteniendo a h3");
  assert.ok(new Date(byId.madre.due_date + "T12:00:00") >= new Date(byId.h3.due_date + "T12:00:00"));
});

test("cadena de 3 hermanas SIN solape: el atraso de la primera no mueve a las demás", () => {
  const acts = [
    act("madre", { start_date: "2026-01-05", due_date: "2026-02-27" }),
    act("h1", { parent_id: "madre", sequence_order: 0, start_date: "2026-01-05", due_date: "2026-01-07" }),
    act("h2", { parent_id: "madre", sequence_order: 1, start_date: "2026-02-01", due_date: "2026-02-05" }),
    act("h3", { parent_id: "madre", sequence_order: 2, start_date: "2026-02-20", due_date: "2026-02-27" }),
  ];
  // h1 se atrasa un poco, pero sigue terminando mucho antes de que empiece h2
  acts[1].due_date = "2026-01-09";
  const patches = rescheduleAfterChange(acts, "h1", "2026-01-07");
  const byId = Object.fromEntries(patches.map(p => [p.id, p]));

  assert.equal(byId.h2, undefined, "h2 no debía moverse: no había solape");
  assert.equal(byId.h3, undefined, "h3 no debía moverse");
  assert.equal(byId.madre, undefined, "la madre ya contenía el rango, no necesitaba extenderse");
});

test("3 niveles de profundidad: el atraso de una nieta llega hasta la abuela", () => {
  const acts = [
    // Rango inicial deliberadamente CORTO en madre/abuela para que el atraso
    // de la nieta las obligue a extenderse (si el rango ya las cubriera, no
    // habría nada que propagar — sería el caso "sin cambio" de idempotencia).
    act("abuela", { start_date: "2026-01-05", due_date: "2026-01-09" }),
    act("madre", { parent_id: "abuela", sequence_order: 0, start_date: "2026-01-05", due_date: "2026-01-09" }),
    act("nieta1", { parent_id: "madre", sequence_order: 0, start_date: "2026-01-05", due_date: "2026-01-07" }),
    act("nieta2", { parent_id: "madre", sequence_order: 1, start_date: "2026-01-08", due_date: "2026-01-09" }),
  ];
  acts[2].due_date = "2026-01-15"; // nieta1 se atrasa mucho, excede el rango de madre/abuela y se solapa con nieta2
  const patches = rescheduleAfterChange(acts, "nieta1", "2026-01-07");
  const byId = Object.fromEntries(patches.map(p => [p.id, p]));

  assert.ok(byId.nieta2, "nieta2 debía recorrerse");
  assert.ok(byId.madre, "madre debía extenderse por sus hijas");
  assert.ok(byId.abuela, "abuela debía extenderse porque la madre creció");
});

test("adelanto (due_date antes de lo previsto) NO dispara cascada", () => {
  const acts = [
    act("madre", { start_date: "2026-01-05", due_date: "2026-01-16" }),
    act("h1", { parent_id: "madre", sequence_order: 0, start_date: "2026-01-05", due_date: "2026-01-09" }),
    act("h2", { parent_id: "madre", sequence_order: 1, start_date: "2026-01-12", due_date: "2026-01-16" }),
  ];
  acts[1].due_date = "2026-01-07"; // h1 termina ANTES de lo previsto
  const patches = rescheduleAfterChange(acts, "h1", "2026-01-09");
  assert.equal(patches.length, 0, "un adelanto no debe mover nada");
});

test("idempotencia: aplicar el resultado y volver a correr el motor no produce cambios adicionales", () => {
  const acts = [
    act("madre", { start_date: "2026-01-05", due_date: "2026-01-16" }),
    act("h1", { parent_id: "madre", sequence_order: 0, start_date: "2026-01-05", due_date: "2026-01-14" }),
    act("h2", { parent_id: "madre", sequence_order: 1, start_date: "2026-01-08", due_date: "2026-01-09" }),
  ];
  const firstPass = rescheduleAfterChange(acts, "h1", "2026-01-07");
  // Aplica los parches de la primera pasada sobre una copia del array.
  const patched = acts.map(a => {
    const p = firstPass.find(x => x.id === a.id);
    return p ? { ...a, start_date: p.start_date, due_date: p.due_date } : a;
  });
  // Segunda pasada: mismo id, misma due_date "anterior" que la ya aplicada — sin atraso nuevo.
  const secondPass = rescheduleAfterChange(patched, "h1", patched.find(a => a.id === "h1").due_date);
  assert.equal(secondPass.length, 0, "una segunda pasada sobre el mismo estado no debe generar cambios");
});

// ── shortEngineerName ──────────────────────────────────────────────────────────

test("shortEngineerName: nombre completo de 2+ palabras usa primer nombre + inicial", () => {
  assert.equal(shortEngineerName("Cristian Mauricio Rodriguez"), "Cristian M.");
  assert.equal(shortEngineerName("Ana Lopez"), "Ana L.");
});

test("shortEngineerName: una sola palabra se devuelve tal cual, sin punto", () => {
  assert.equal(shortEngineerName("Cristian"), "Cristian");
});

test("shortEngineerName: cadena vacía o nula devuelve cadena vacía", () => {
  assert.equal(shortEngineerName(""), "");
  assert.equal(shortEngineerName(null), "");
  assert.equal(shortEngineerName(undefined), "");
});

test("shortEngineerName: espacios múltiples/extremos se toleran", () => {
  assert.equal(shortEngineerName("  Cristian   Mauricio  "), "Cristian M.");
});
