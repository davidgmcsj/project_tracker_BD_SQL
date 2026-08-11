// progress.js — Cálculo de avance por proyecto y agregado global.

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
