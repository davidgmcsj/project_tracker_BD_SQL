// engineers.js — Agregación cross-proyecto para la vista por ingeniero.
// Funciones puras: no tocan React ni el DOM, solo leen projects/engineers ya cargados.

import { buildActivityIndex } from "./formulas";

// Proyectos donde el ingeniero aparece en engineers[].
export function getProjectsForEngineer(engineerId, projects) {
  return (projects || []).filter(p => (p.engineers || []).some(e => e.engineer_id === engineerId));
}

// Para un ingeniero y un proyecto donde participa, resuelve su weekly_detail
// (ids de actividad) a { id, text, position, history } usando el índice de
// actividades del proyecto y las fechas de task_status.status_history.
export function getEngineerActivitiesInProject(engineerId, project) {
  const engEntry = (project.engineers || []).find(e => e.engineer_id === engineerId);
  if (!engEntry) return [];

  const actIndex = buildActivityIndex(project.activities_identified);
  const history   = project.task_status?.status_history || {};

  return (engEntry.weekly_detail || [])
    .map(id => {
      const entry = actIndex.get(id);
      if (!entry) return null;
      return { id, text: entry.text, position: entry.position, history: history[id] || {} };
    })
    .filter(Boolean);
}
