// progress.js — Cálculo de avance por proyecto y agregado global.

import { visibleActivities } from "./activityModel.js";
import { leafActivities } from "./activityHierarchy.js";

// Tolerante a valores no-array (task_status recién creado, o un campo legado
// en formato string) — mismo criterio que safeArr en components/edit/shared.js,
// duplicado aquí (una función de 3 líneas) para no crear una dependencia de
// utils/ hacia components/ (utils es la capa base).
function safeArr(val) {
  return Array.isArray(val) ? val : [];
}

// Recalcula total/completadas/en_proceso de manual_metrics desde activities y
// task_status — cuenta solo actividades visibles (las archivadas por Planner
// no inflan el total) Y solo hojas (un padre con subtareas es un contenedor
// organizativo, no una unidad de trabajo medible). Extraída de
// useActivityHandlers.js (antes una closure privada `buildAutoMetrics`, ver
// su comentario) para poder reutilizarla fuera de ese hook — concretamente
// desde autoAdvanceOverdueActivities (App.jsx), que recalcula métricas de
// TODOS los proyectos al arrancar, no solo del proyecto que el usuario tiene
// abierto en el editor.
export function buildAutoMetrics(previousMetrics, newActs, newTs) {
  const visibles    = visibleActivities(newActs);
  const leafIdsNext = new Set(leafActivities(visibles).map(a => a.id));
  return {
    ...(previousMetrics || {}),
    total_tasks:       leafIdsNext.size,
    completed_tasks:   safeArr(newTs.completed).filter(id => leafIdsNext.has(id)).length,
    in_progress_tasks: safeArr(newTs.in_progress).filter(id => leafIdsNext.has(id)).length,
  };
}

// FÓRMULA DE AVANCE POR PROYECTO:
// Las tareas en proceso cuentan como 0.5 (medio punto) porque están iniciadas
// pero no terminadas. Esto da un avance más realista que contar solo completadas.
// Para cambiar el peso de "en proceso", modifica el 0.5 por el valor deseado.
export function projectProgress(total, completed, inProgress) {
  if (!total || total <= 0) return 0;
  return Math.min(((Number(completed) + Number(inProgress) * 0.5) / Number(total)) * 100, 100);
}

// AVANCE GLOBAL: promedio simple de todos los proyectos que tienen tareas definidas.
// Proyectos sin tareas (total_tasks = 0) se excluyen para no distorsionar el promedio.
export function globalProgress(projects) {
  const active = projects.filter(p => Number(p.manual_metrics?.total_tasks || 0) > 0);
  if (!active.length) return 0;
  const sum = active.reduce((s, p) => {
    const m = p.manual_metrics;
    return s + projectProgress(m.total_tasks, m.completed_tasks, m.in_progress_tasks);
  }, 0);
  return sum / active.length;
}

export function globalStats(projects) {
  const total      = projects.reduce((s, p) => s + Number(p.manual_metrics?.total_tasks       || 0), 0);
  const completed  = projects.reduce((s, p) => s + Number(p.manual_metrics?.completed_tasks   || 0), 0);
  const inProgress = projects.reduce((s, p) => s + Number(p.manual_metrics?.in_progress_tasks || 0), 0);
  return { total, completed, inProgress, percent: globalProgress(projects) };
}
