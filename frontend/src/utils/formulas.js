// formulas.js — Barrel. Toda la lógica de cálculo y generación de texto del
// reporte vive en utils/formulas/*, dividida por responsabilidad:
//   dateHelpers.js       — fecha: labels de semana, ISO/DMY, lunes, viernes
//   progress.js          — projectProgress, globalProgress, globalStats
//   activityModel.js     — createDefaultProject/createActivity y factories
//   businessDays.js      — días hábiles, horas sugeridas
//   activityHierarchy.js — índice/árbol de actividades (parent_id)
//   engineerModel.js     — catálogo de ingenieros y tareas sueltas
//   reportText.js        — texto/Markdown de reportes y asignaciones
//
// Si quieres cambiar CÓMO se calcula el avance → progress.js.
// Si quieres cambiar el TEXTO del reporte copiado al portapapeles → reportText.js.
// Si quieres cambiar las fechas/labels del encabezado → dateHelpers.js.
// Si quieres cambiar la estructura de un proyecto nuevo → activityModel.js.

export * from "./formulas/dateHelpers.js";
export * from "./formulas/progress.js";
export * from "./formulas/activityModel.js";
export * from "./formulas/businessDays.js";
export * from "./formulas/activityHierarchy.js";
export * from "./formulas/engineerModel.js";
export * from "./formulas/reportText.js";
