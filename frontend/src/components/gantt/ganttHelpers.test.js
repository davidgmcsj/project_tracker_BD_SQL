// ganttHelpers.test.js — computeDatedRows (filtros compuestos del Gantt:
// estado + tarea padre + alcance).
//
//   node --test src/components/gantt/ganttHelpers.test.js    (desde frontend/)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeDatedRows, computeBarSpan, barIntensity, hexToRgba, computeRowHeight, ROW_HEIGHT_MIN, ROW_HEIGHT_MAX,
  computeIdealLabelWidth, LABEL_COL_MIN, LABEL_COL_MAX, LABEL_COL_DEFAULT,
} from "./ganttHelpers.js";

const acts = [
  { id: "p1", parent_id: null, text: "Padre 1", start_date: "2026-01-01" },
  { id: "c1", parent_id: "p1", text: "Hija 1",  start_date: "2026-01-02" },
  { id: "c2", parent_id: "p1", text: "Hija 2",  start_date: "2026-01-03" },
  { id: "g1", parent_id: "c1", text: "Nieta 1", start_date: "2026-01-04" }, // subtarea de 2do nivel
  { id: "p2", parent_id: null, text: "Padre 2", start_date: "2026-01-05" },
  { id: "nodate", parent_id: null, text: "Sin fecha" }, // no debe aparecer nunca
];

const taskStatus = { completed: ["c2"], in_progress: ["c1"], not_started: ["p1", "g1", "p2"] };

test("computeDatedRows sin filtros devuelve todas las actividades con fecha, en orden jerárquico", () => {
  const rows = computeDatedRows(acts, taskStatus, {});
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2", "p2"]);
});

test("computeDatedRows con scope roots devuelve solo raíces", () => {
  const rows = computeDatedRows(acts, taskStatus, { scopeFilter: "roots" });
  assert.deepEqual(rows.map(a => a.id).sort(), ["p1", "p2"]);
});

test("computeDatedRows con parentFilter + scope all devuelve el padre y TODOS sus descendientes (multi-nivel)", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "all" });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2"]);
});

// Bug reportado: "Solo subtareas" con una tarea padre elegida devolvía una
// tabla vacía en vez de las subtareas — walk() arrancaba en parentFilter (un
// id que quedó sin hijos indexados porque el padre se excluyó de `visible`)
// en vez de null (donde childrenOf SÍ cuelga esos hijos huérfanos).
test("computeDatedRows con parentFilter + scope childrenOnly devuelve solo las subtareas, sin la fila del padre", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "childrenOnly" });
  assert.deepEqual(rows.map(a => a.id), ["c1", "g1", "c2"]);
});

test("computeDatedRows con parentFilter + childrenOnly + statusFilter combina los tres", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "childrenOnly", statusFilter: "completed" });
  assert.deepEqual(rows.map(a => a.id), ["c2"]);
});

test("computeDatedRows con statusFilter solo, sin parentFilter", () => {
  const rows = computeDatedRows(acts, taskStatus, { statusFilter: "in_progress" });
  assert.deepEqual(rows.map(a => a.id), ["c1"]);
});

// ── statusFilter como array — múltiples valores con OR interno (estilo GitLab) ──

test("computeDatedRows con statusFilter array de un valor se comporta igual que string único", () => {
  const rows = computeDatedRows(acts, taskStatus, { statusFilter: ["in_progress"] });
  assert.deepEqual(rows.map(a => a.id), ["c1"]);
});

test("computeDatedRows con statusFilter array de varios valores combina con OR", () => {
  const rows = computeDatedRows(acts, taskStatus, { statusFilter: ["in_progress", "completed"] });
  assert.deepEqual(rows.map(a => a.id).sort(), ["c1", "c2"]);
});

test("computeDatedRows con statusFilter array vacío no filtra (igual que \"all\")", () => {
  const rows = computeDatedRows(acts, taskStatus, { statusFilter: [] });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2", "p2"]);
});

test("computeDatedRows ignora actividades sin start_date ni due_date", () => {
  const rows = computeDatedRows(acts, taskStatus, {});
  assert.ok(!rows.some(a => a.id === "nodate"));
});

test("computeDatedRows con parentFilter cuyo padre no tiene descendientes con fecha devuelve solo el padre (scope all)", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p2", scopeFilter: "all" });
  assert.deepEqual(rows.map(a => a.id), ["p2"]);
});

test("computeDatedRows con parentFilter childrenOnly cuyo padre no tiene descendientes devuelve vacío", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p2", scopeFilter: "childrenOnly" });
  assert.deepEqual(rows, []);
});

test("computeDatedRows con activities vacío/null no lanza", () => {
  assert.deepEqual(computeDatedRows([], taskStatus, {}), []);
  assert.deepEqual(computeDatedRows(null, taskStatus, {}), []);
});

// ── textFilter — búsqueda libre por nombre de actividad ───────────────────────

test("computeDatedRows con textFilter devuelve solo las actividades cuyo texto matchea", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "hija" });
  assert.deepEqual(rows.map(a => a.id).sort(), ["c1", "c2"]);
});

test("computeDatedRows con textFilter es case-insensitive y no rescata al padre", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "NIETA" });
  assert.deepEqual(rows.map(a => a.id), ["g1"]); // p1/c1 (ancestros) no matchean y no aparecen
});

test("computeDatedRows con textFilter vacío no filtra nada (mismo comportamiento que sin filtro)", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "" });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2", "p2"]);
});

test("computeDatedRows combina textFilter con statusFilter", () => {
  const rows = computeDatedRows(acts, taskStatus, { textFilter: "hija", statusFilter: "completed" });
  assert.deepEqual(rows.map(a => a.id), ["c2"]);
});

// ── levelFilter — profundidad máxima (1 = solo raíces, 2 = +1er nivel…) ───────

test("computeDatedRows con levelFilter 1 devuelve solo raíces", () => {
  const rows = computeDatedRows(acts, taskStatus, { levelFilter: 1 });
  assert.deepEqual(rows.map(a => a.id).sort(), ["p1", "p2"]);
});

test("computeDatedRows con levelFilter 2 devuelve raíces + 1er nivel, sin la nieta", () => {
  const rows = computeDatedRows(acts, taskStatus, { levelFilter: 2 });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "c2", "p2"]);
});

test("computeDatedRows con levelFilter 3 incluye la nieta", () => {
  const rows = computeDatedRows(acts, taskStatus, { levelFilter: 3 });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2", "p2"]);
});

test("computeDatedRows sin levelFilter (null) no limita profundidad", () => {
  const rows = computeDatedRows(acts, taskStatus, { levelFilter: null });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "g1", "c2", "p2"]);
});

// Con una tarea padre elegida, el nivel se cuenta RELATIVO a ese padre: p1
// mismo es "nivel 1" aunque en el árbol completo también sería raíz — este
// caso ya lo era, pero confirma que parentFilter + levelFilter=1 muestra
// solo la fila del padre elegido, no a p1 general.
test("computeDatedRows combina parentFilter + levelFilter: el nivel es relativo al padre elegido", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "all", levelFilter: 1 });
  assert.deepEqual(rows.map(a => a.id), ["p1"]);
});

test("computeDatedRows combina parentFilter + levelFilter 2: padre + hijas directas, sin la nieta", () => {
  const rows = computeDatedRows(acts, taskStatus, { parentFilter: "p1", scopeFilter: "all", levelFilter: 2 });
  assert.deepEqual(rows.map(a => a.id), ["p1", "c1", "c2"]);
});

test("computeDatedRows combina levelFilter con textFilter", () => {
  const rows = computeDatedRows(acts, taskStatus, { levelFilter: 2, textFilter: "hija" });
  assert.deepEqual(rows.map(a => a.id).sort(), ["c1", "c2"]);
});

// ── computeBarSpan / barIntensity — barra continua inicio→fin del Gantt ────────

const day = (s) => new Date(s + "T12:00:00");

test("computeBarSpan con start_date y due_date devuelve el rango completo", () => {
  const a = { start_date: "2026-01-01", due_date: "2026-01-05" };
  const span = computeBarSpan(a, "day", day("2026-01-01"), 10);
  assert.deepEqual(span, { startColIndex: 0, dueColIndex: 4 });
});

test("computeBarSpan sin start_date colapsa a un solo punto en dueColIndex", () => {
  const a = { start_date: "", due_date: "2026-01-05" };
  const span = computeBarSpan(a, "day", day("2026-01-01"), 10);
  assert.deepEqual(span, { startColIndex: 4, dueColIndex: 4 });
});

test("computeBarSpan sin ninguna fecha devuelve null", () => {
  const a = { start_date: "", due_date: "" };
  assert.equal(computeBarSpan(a, "day", day("2026-01-01"), 10), null);
});

test("computeBarSpan recorta el inicio a la columna 0 si empieza antes del rango visible", () => {
  const a = { start_date: "2025-12-20", due_date: "2026-01-05" };
  const span = computeBarSpan(a, "day", day("2026-01-01"), 10);
  assert.deepEqual(span, { startColIndex: 0, dueColIndex: 4 });
});

test("computeBarSpan recorta el fin a la última columna si termina después del rango visible", () => {
  const a = { start_date: "2026-01-01", due_date: "2026-02-01" };
  const span = computeBarSpan(a, "day", day("2026-01-01"), 10); // columnas 0..9
  assert.deepEqual(span, { startColIndex: 0, dueColIndex: 9 });
});

test("computeBarSpan devuelve null si la actividad cae totalmente fuera del rango visible (antes)", () => {
  const a = { start_date: "2025-11-01", due_date: "2025-11-10" };
  assert.equal(computeBarSpan(a, "day", day("2026-01-01"), 10), null);
});

test("computeBarSpan devuelve null si la actividad cae totalmente fuera del rango visible (después)", () => {
  const a = { start_date: "2026-06-01", due_date: "2026-06-10" };
  assert.equal(computeBarSpan(a, "day", day("2026-01-01"), 10), null);
});

test("computeBarSpan con start_date posterior a due_date (dato inconsistente) colapsa a un punto, no invierte la barra", () => {
  const a = { start_date: "2026-01-10", due_date: "2026-01-05" };
  const span = computeBarSpan(a, "day", day("2026-01-01"), 10);
  assert.deepEqual(span, { startColIndex: 4, dueColIndex: 4 });
});

test("barIntensity da 1.0 en la columna de entrega", () => {
  assert.equal(barIntensity(4, 0, 4), 1);
});

test("barIntensity da la intensidad mínima (0.35) en la primera columna de un span multi-día", () => {
  assert.equal(barIntensity(0, 0, 4), 0.35);
});

test("barIntensity crece linealmente entre el mínimo y 1", () => {
  assert.equal(barIntensity(2, 0, 4), 0.35 + (1 - 0.35) * 0.5);
});

test("barIntensity con span de un solo punto (sin start_date) da 1.0 directo", () => {
  assert.equal(barIntensity(4, 4, 4), 1);
});

test("hexToRgba convierte un color hex a rgba con el alpha dado", () => {
  assert.equal(hexToRgba("#d3323c", 1), "rgba(211, 50, 60, 1)");
  assert.equal(hexToRgba("#d3323c", 0.35), "rgba(211, 50, 60, 0.35)");
});

// ── computeRowHeight — altura de fila dinámica ─────────────────────────────────

test("computeRowHeight sin alto de contenedor medido todavía devuelve el mínimo", () => {
  assert.equal(computeRowHeight(0, 10), ROW_HEIGHT_MIN);
});

test("computeRowHeight sin filas devuelve el mínimo", () => {
  assert.equal(computeRowHeight(500, 0), ROW_HEIGHT_MIN);
});

test("computeRowHeight reparte el alto sobrante entre pocas filas, hasta el techo", () => {
  // (600 - 30 header) / 3 filas = 190 → recortado al techo de 64
  assert.equal(computeRowHeight(600, 3), ROW_HEIGHT_MAX);
});

test("computeRowHeight con espacio moderado da un valor intermedio entre mínimo y techo", () => {
  // (500 - 30) / 10 filas = 47
  assert.equal(computeRowHeight(500, 10), 47);
});

test("computeRowHeight con muchas filas nunca baja del mínimo", () => {
  // (500 - 30) / 100 filas = 4.7 → recortado al mínimo de 30
  assert.equal(computeRowHeight(500, 100), ROW_HEIGHT_MIN);
});

// ── computeIdealLabelWidth — ancho dinámico de la columna "Actividad" ──────────

test("computeIdealLabelWidth sin filas devuelve el ancho por defecto", () => {
  assert.equal(computeIdealLabelWidth([], new Map(), new Map()), LABEL_COL_DEFAULT);
});

test("computeIdealLabelWidth crece con un texto más largo", () => {
  const shortRows = [{ id: "a", text: "Corto" }];
  const longRows = [{ id: "a", text: "Un nombre de actividad bastante más largo que el anterior" }];
  const numberById = new Map([["a", "1"]]);
  const depthById = new Map([["a", 0]]);
  const shortWidth = computeIdealLabelWidth(shortRows, numberById, depthById);
  const longWidth = computeIdealLabelWidth(longRows, numberById, depthById);
  assert.ok(longWidth > shortWidth);
});

test("computeIdealLabelWidth nunca baja de LABEL_COL_MIN", () => {
  const rows = [{ id: "a", text: "x" }];
  const w = computeIdealLabelWidth(rows, new Map([["a", "1"]]), new Map([["a", 0]]));
  assert.ok(w >= LABEL_COL_MIN);
});

test("computeIdealLabelWidth nunca supera LABEL_COL_MAX, incluso con un texto enorme", () => {
  const rows = [{ id: "a", text: "x".repeat(500) }];
  const w = computeIdealLabelWidth(rows, new Map([["a", "1"]]), new Map([["a", 0]]));
  assert.equal(w, LABEL_COL_MAX);
});

test("computeIdealLabelWidth toma la fila MÁS larga entre varias, no la primera ni la última", () => {
  const rows = [
    { id: "a", text: "Corto" },
    { id: "b", text: "Este es el nombre de actividad más largo de todos por bastante margen" },
    { id: "c", text: "Medio" },
  ];
  const numberById = new Map([["a", "1"], ["b", "2"], ["c", "3"]]);
  const depthById = new Map([["a", 0], ["b", 0], ["c", 0]]);
  const withLong = computeIdealLabelWidth(rows, numberById, depthById);
  const withoutLong = computeIdealLabelWidth([rows[0], rows[2]], numberById, depthById);
  assert.ok(withLong > withoutLong);
});

test("computeIdealLabelWidth suma espacio extra por nivel de sangría", () => {
  const rows = [{ id: "a", text: "Mismo texto" }];
  const numberById = new Map([["a", "1.1.1"]]);
  const shallow = computeIdealLabelWidth(rows, numberById, new Map([["a", 0]]));
  const deep = computeIdealLabelWidth(rows, numberById, new Map([["a", 5]]));
  assert.ok(deep >= shallow);
});
