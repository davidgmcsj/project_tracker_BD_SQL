// filtroOpciones.test.js — cubre los derivados del vocabulario de estados de
// actividad. Antes este vocabulario estaba repetido a mano en 10 componentes
// (incluidos dos mapas inversos escritos por separado); estos tests fijan el
// contrato de la fuente única para que una futura edición de las etiquetas no
// rompa en silencio la traducción inversa.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ESTADOS_ACTIVIDAD_OPERACIONAL,
  ESTADO_ACTIVIDAD_LABEL,
  ESTADO_ACTIVIDAD_KEY,
  estadoActividadLabel,
  estadoActividadKey,
} from "./filtroOpciones.js";

test("ESTADO_ACTIVIDAD_LABEL traduce cada clave a su etiqueta", () => {
  assert.equal(ESTADO_ACTIVIDAD_LABEL.not_started, "No iniciada");
  assert.equal(ESTADO_ACTIVIDAD_LABEL.in_progress, "En proceso");
  assert.equal(ESTADO_ACTIVIDAD_LABEL.completed, "Completada");
});

test("ESTADO_ACTIVIDAD_KEY es el inverso exacto de ESTADO_ACTIVIDAD_LABEL", () => {
  // Arrange / Act / Assert — la propiedad que evita el bug de los dos mapas
  // inversos que existían escritos a mano por separado.
  for (const { value, label } of ESTADOS_ACTIVIDAD_OPERACIONAL) {
    assert.equal(ESTADO_ACTIVIDAD_KEY[label], value);
    assert.equal(ESTADO_ACTIVIDAD_LABEL[value], label);
  }
});

test("los derivados cubren exactamente los 3 estados, sin extras", () => {
  assert.equal(Object.keys(ESTADO_ACTIVIDAD_LABEL).length, 3);
  assert.equal(Object.keys(ESTADO_ACTIVIDAD_KEY).length, 3);
});

test("estadoActividadLabel acepta la clave interna", () => {
  assert.equal(estadoActividadLabel("in_progress"), "En proceso");
  assert.equal(estadoActividadLabel("completed"), "Completada");
});

test("estadoActividadLabel acepta una etiqueta ya traducida", () => {
  // Los datos llegan en ambos formatos según la fuente (RawDataJSON trae
  // español; Actividades_Detalle trae la clave interna).
  assert.equal(estadoActividadLabel("En proceso"), "En proceso");
  assert.equal(estadoActividadLabel("Completada"), "Completada");
});

test("estadoActividadLabel cae en 'No iniciada' ante valor nulo o desconocido", () => {
  assert.equal(estadoActividadLabel(null), "No iniciada");
  assert.equal(estadoActividadLabel(undefined), "No iniciada");
  assert.equal(estadoActividadLabel(""), "No iniciada");
  assert.equal(estadoActividadLabel("estado_inventado"), "No iniciada");
});

test("estadoActividadKey normaliza desde etiqueta en español", () => {
  assert.equal(estadoActividadKey("En proceso"), "in_progress");
  assert.equal(estadoActividadKey("No iniciada"), "not_started");
  assert.equal(estadoActividadKey("Completada"), "completed");
});

test("estadoActividadKey deja intacta una clave que ya es interna", () => {
  assert.equal(estadoActividadKey("in_progress"), "in_progress");
  assert.equal(estadoActividadKey("completed"), "completed");
});

test("estadoActividadKey cae en 'not_started' ante valor nulo o desconocido", () => {
  assert.equal(estadoActividadKey(null), "not_started");
  assert.equal(estadoActividadKey("otra cosa"), "not_started");
});

test("ida y vuelta clave → etiqueta → clave conserva el valor", () => {
  for (const { value } of ESTADOS_ACTIVIDAD_OPERACIONAL) {
    assert.equal(estadoActividadKey(estadoActividadLabel(value)), value);
  }
});
