// shared.js — Helpers y constantes usados por varios de los componentes en
// que se dividió EditView.jsx (Fase 4 de la refactorización).
//
// Solo vive aquí lo que cruza más de un componente destino. Lo que un solo
// componente usa se queda en su propio archivo.

import { getToday } from "../../utils/formulas";
import { weekRange, nextWeekRange, SITUATION_LABEL } from "../../utils/weekPlanning";

// Semana en curso, calculada una vez al cargar el módulo — suficiente para
// una sesión de trabajo normal (el caso extremo de dejar la pestaña abierta
// cruzando la medianoche del domingo se corrige con un refresco de página).
// Usada por EngineerRow y NextWeekPlanningSection.
export const CURRENT_WEEK = weekRange(getToday());

// Usada solo por NextWeekPlanningSection.
export const NEXT_WEEK = nextWeekRange(getToday());

// "completed" no es una situación del motor de clasificación (weekPlanning.js
// solo describe pendientes) — es la vista de "esto ya se hizo" que usa
// NextWeekPlanningSection para el bloque de logros de la semana. Usada por
// WeekActivitiesTable para traducir la columna "Situación".
export const ROW_STATUS_LABEL = { ...SITUATION_LABEL, completed: "Completada" };

// ── Helpers ───────────────────────────────────────────────────────────────────

export function safeArr(val) {
  if (Array.isArray(val)) return val;
  if (!val) return [];
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

// activities_identified es un array de objetos {id, text}, nunca un string suelto.
export function safeActs(val) {
  return Array.isArray(val) ? val : [];
}

// Mezcla ingenieros activos + externos activos en un único array para dropdowns de asignación.
// type: 'engineer' | 'external' permite distinguirlos visualmente.
export function buildAssignables(engineerCatalog, externalContacts) {
  const engineers = (engineerCatalog || []).filter(e => e.active).map(e => ({
    id: e.id, name: e.name, type: "engineer",
  }));
  const externals = (externalContacts || []).filter(c => c.active).map(c => ({
    id: c.id, name: c.name, company: c.company || "", type: "external",
  }));
  return [...engineers, ...externals];
}

// ── Constantes ────────────────────────────────────────────────────────────────

export const IMPEDIMENT_TYPES = [
  { category: "blocker",        label: "Bloqueante",         icon: "🚫", hasImpact: true  },
  { category: "risk",           label: "Riesgo",             icon: "🔶", hasImpact: true  },
  { category: "non_conformity", label: "Salida no conforme", icon: "⚠️", hasImpact: false },
];
export const IMPEDIMENT_META = Object.fromEntries(IMPEDIMENT_TYPES.map(t => [t.category, t]));
