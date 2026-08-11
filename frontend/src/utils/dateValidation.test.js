import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStartEnd, validateTransitionDates } from "./dateValidation.js";

test("validateStartEnd: fin antes que inicio es inválido", () => {
  assert.match(validateStartEnd("2026-08-10", "2026-08-01"), /no puede ser anterior/);
});

test("validateStartEnd: fin igual o después de inicio es válido", () => {
  assert.equal(validateStartEnd("2026-08-01", "2026-08-01"), null);
  assert.equal(validateStartEnd("2026-08-01", "2026-08-10"), null);
});

test("validateStartEnd: con un solo extremo presente no valida (falta el otro)", () => {
  assert.equal(validateStartEnd("2026-08-01", ""), null);
  assert.equal(validateStartEnd("", "2026-08-10"), null);
  assert.equal(validateStartEnd("", ""), null);
});

test("validateTransitionDates: en proceso antes que inscrita es inválido", () => {
  const errors = validateTransitionDates({
    startDate: "", dueDate: "", added: "2026-08-05", inProgress: "2026-08-01", completed: "",
  });
  assert.match(errors.in_progress, /inscripción/);
});

test("validateTransitionDates: completada antes que inscrita es inválido", () => {
  const errors = validateTransitionDates({
    startDate: "", dueDate: "", added: "2026-08-05", inProgress: "", completed: "2026-08-01",
  });
  assert.match(errors.completed, /inscripción/);
});

test("validateTransitionDates: en proceso fuera de [inicio, fin] es inválido", () => {
  const antesDeInicio = validateTransitionDates({
    startDate: "2026-08-05", dueDate: "2026-08-20", added: "", inProgress: "2026-08-01", completed: "",
  });
  assert.match(antesDeInicio.in_progress, /anterior a la fecha de inicio/);

  const despuesDeFin = validateTransitionDates({
    startDate: "2026-08-05", dueDate: "2026-08-20", added: "", inProgress: "2026-08-25", completed: "",
  });
  assert.match(despuesDeFin.in_progress, /posterior a la fecha de fin/);
});

test("validateTransitionDates: completada antes que en proceso es inválido", () => {
  const errors = validateTransitionDates({
    startDate: "", dueDate: "", added: "", inProgress: "2026-08-10", completed: "2026-08-05",
  });
  assert.match(errors.completed, /anterior a la fecha de "en proceso"/);
});

test("validateTransitionDates: todo consistente y dentro de rango no da errores", () => {
  const errors = validateTransitionDates({
    startDate: "2026-08-01", dueDate: "2026-08-31",
    added: "2026-08-01", inProgress: "2026-08-10", completed: "2026-08-20",
  });
  assert.equal(errors, null);
});

test("validateTransitionDates: campos vacíos no generan error (nada que validar)", () => {
  const errors = validateTransitionDates({
    startDate: "", dueDate: "", added: "", inProgress: "", completed: "",
  });
  assert.equal(errors, null);
});

test("validateTransitionDates: fecha completada en el borde del rango (== fin) es válida", () => {
  const errors = validateTransitionDates({
    startDate: "2026-08-01", dueDate: "2026-08-20",
    added: "2026-08-01", inProgress: "", completed: "2026-08-20",
  });
  assert.equal(errors, null);
});
