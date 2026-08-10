"use strict";

// ── Transformación pura del reset trimestral (Fase 11 — riesgo 10.5) ────────
// Extraída de server.cjs sin cambiar el comportamiento: es la única
// operación irreversible del sistema (una vez archivado, no hay "deshacer"
// desde la app), así que su lógica central vive aquí, separada de Express y
// de SQL, para poder probarla con fixtures sin levantar servidor ni BD.

// Cuenta cuántas actividades se archivan (completadas) vs. continúan
// (en proceso + no iniciadas) en el trimestre que se cierra.
function computeQuarterStats(projects) {
  let totalArchivadas = 0;
  let totalTransferidas = 0;

  for (const p of projects) {
    const completadas = (p.task_status?.completed   || []).length;
    const enProceso   = (p.task_status?.in_progress || []).length;
    const noIniciadas = (p.task_status?.not_started || []).length;
    totalArchivadas   += completadas;
    totalTransferidas += enProceso + noIniciadas;
  }

  return { totalArchivadas, totalTransferidas };
}

// Construye el estado limpio del nuevo trimestre: archiva lo completado
// (se filtra fuera de activities_identified), conserva intactas las
// actividades en proceso / no iniciadas, y resetea los campos semanales.
function buildResetProjects(projects) {
  return projects.map(p => {
    const ts      = p.task_status || {};
    const keepIds = new Set([...(ts.in_progress || []), ...(ts.not_started || [])]);

    const newActs = (p.activities_identified || []).filter(a => keepIds.has(a.id));

    const newHistory = {};
    for (const actId of keepIds) {
      if (ts.status_history?.[actId]) newHistory[actId] = ts.status_history[actId];
    }

    const newMetrics = {
      total_tasks:           newActs.length,
      completed_tasks:       0,
      in_progress_tasks:     (ts.in_progress || []).length,
      shared_tasks_discount: 0,
    };

    const newEngineers = (p.engineers || []).map(e => ({
      ...e,
      assigned:      0,
      completed:     0,
      in_progress:   0,
      weekly_total:  0,
      weekly_detail: [],
    }));

    return {
      ...p,
      activities_identified: newActs,
      task_status: {
        completed:      [],
        in_progress:    ts.in_progress  || [],
        not_started:    ts.not_started  || [],
        status_history: newHistory,
      },
      manual_metrics:      newMetrics,
      engineers:           newEngineers,
      weekly_achievements: [],
      next_week_plan:      [],
      impediments:         [],
      show_closing_fields: false,
    };
  });
}

module.exports = { computeQuarterStats, buildResetProjects };
