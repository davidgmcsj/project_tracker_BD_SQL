// engineers.js — Agregación cross-proyecto para la vista por ingeniero.
// Funciones puras: no tocan React ni el DOM, solo leen projects/engineers ya cargados.

import { buildActivityIndex } from "./formulas.js";
import { activitiesForWeek, weekRange, nextWeekRange } from "./weekPlanning.js";

// Proyectos donde el ingeniero aparece en engineers[].
export function getProjectsForEngineer(engineerId, projects) {
  return (projects || []).filter(p => (p.engineers || []).some(e => e.engineer_id === engineerId));
}

// Cantidad de actividades asignadas esta semana (weekly_detail) al ingeniero en ese proyecto.
export function countActiveWeeklyTasks(engineerId, project) {
  const engEntry = (project.engineers || []).find(e => e.engineer_id === engineerId);
  return engEntry?.weekly_detail?.length || 0;
}

// Cantidad de actividades actualmente asignadas al ingeniero en ese proyecto.
// Se cuenta desde assigned_engineers de cada actividad (fuente de verdad), no del campo histórico.
export function countTotalAssignedTasks(engineerId, project) {
  return (project.activities_identified || []).filter(a =>
    (a.assigned_engineers || []).some(e => e.engineer_id === engineerId || e.id === engineerId)
  ).length;
}


// True si el ingeniero tiene al menos una actividad asignada esta semana (weekly_detail)
// en ese proyecto. Se usa para resaltar el proyecto como "activo esta semana".
export function hasActiveWeeklyTasks(engineerId, project) {
  return countActiveWeeklyTasks(engineerId, project) > 0;
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

// Resuelve el estado (completed/in_progress/not_started) de una actividad según
// las listas de project.task_status.
function activityStatusIn(project, actId) {
  const ts = project.task_status || {};
  if ((ts.completed   || []).includes(actId)) return "completed";
  if ((ts.in_progress || []).includes(actId)) return "in_progress";
  return "not_started";
}

// Todas las actividades del proyecto asignadas al ingeniero (fuente de verdad:
// assigned_engineers de cada actividad), independientemente de si están o no en
// el weekly_detail de la semana. Devuelve { id, text, position, history, status }.
export function getAllAssignedActivitiesInProject(engineerId, project) {
  const history = project.task_status?.status_history || {};

  return (project.activities_identified || [])
    .map((a, i) => ({ a, position: i + 1 }))
    .filter(({ a }) =>
      (a.assigned_engineers || []).some(e => e.engineer_id === engineerId || e.id === engineerId)
    )
    .map(({ a, position }) => ({
      id: a.id,
      text: a.text || "",
      position,
      history: history[a.id] || {},
      status: activityStatusIn(project, a.id),
    }));
}

// ── Agregación semanal cross-proyecto (pantalla "mi semana" del ingeniero) ────
// Junta las tareas de un ingeniero de TODOS sus proyectos y las clasifica por
// semana (mismo motor de solapamiento de utils/weekPlanning.js), con el
// nombre del proyecto agregado a cada fila para distinguir el origen.

// { activity, situation, projectName, projectId } por cada actividad del
// ingeniero, en cualquier proyecto, que caiga en `range`.
function engineerActivitiesForRange(engineerId, projects, range, opts) {
  const rows = [];
  getProjectsForEngineer(engineerId, projects).forEach(project => {
    const mine = (project.activities_identified || []).filter(a =>
      (a.assigned_engineers || []).some(e => e.id === engineerId || e.engineer_id === engineerId)
    );
    activitiesForWeek(mine, range, project.task_status, opts).forEach(row => {
      rows.push({ ...row, projectName: project.project_name || "Proyecto", projectId: project.id });
    });
  });
  return rows.sort((a, b) => {
    const da = a.activity.due_date || a.activity.start_date || "";
    const db = b.activity.due_date || b.activity.start_date || "";
    return da.localeCompare(db);
  });
}

// Tareas de esta semana, de todos los proyectos del ingeniero.
export function engineerWeekTasks(engineerId, projects, today = new Date()) {
  return engineerActivitiesForRange(engineerId, projects, weekRange(today.toISOString().slice(0, 10)));
}

// Tareas de la próxima semana (sin arrastre de vencidas de esta semana, que
// ya se ven en engineerWeekTasks).
export function engineerNextWeekTasks(engineerId, projects, today = new Date()) {
  return engineerActivitiesForRange(
    engineerId, projects, nextWeekRange(today.toISOString().slice(0, 10)), { includeOverdue: false }
  );
}

// ── Reporte por ingeniero (texto plano para copiar) ───────────────────────────

const STATUS_TXT = { completed: "Completada", in_progress: "En proceso", not_started: "No iniciada" };
const fmt = d => d || "—";

// Genera un reporte de texto plano para un ingeniero: sus actividades por proyecto
// (con estado y fechas de transición) y sus tareas adicionales.
export function generateEngineerReportText(engineer, projects) {
  if (!engineer) return "";
  const lines = [];
  lines.push(`REPORTE POR INGENIERO — ${engineer.name}`);
  if (engineer.role) lines.push(engineer.role);
  lines.push("═".repeat(60));
  lines.push("");

  const projs = getProjectsForEngineer(engineer.id, projects);

  lines.push(`PROYECTOS ASIGNADOS (${projs.length})`);
  lines.push("");

  if (projs.length === 0) {
    lines.push("  Sin proyectos asignados.");
  }

  for (const p of projs) {
    const acts = getAllAssignedActivitiesInProject(engineer.id, p);
    lines.push(`▸ ${p.project_name || "Proyecto"}`);
    if (acts.length === 0) {
      lines.push("    Sin actividades asignadas.");
    } else {
      for (const a of acts) {
        const h = a.history || {};
        lines.push(`    ${a.position}. ${a.text}  [${STATUS_TXT[a.status]}]`);
        lines.push(`       Inscrita: ${fmt(h.added)} · En proceso: ${fmt(h.in_progress)} · Completada: ${fmt(h.completed)}`);
      }
    }
    lines.push("");
  }

  const tasks = engineer.tasks || [];
  lines.push("─".repeat(60));
  lines.push(`TAREAS ADICIONALES (${tasks.length})`);
  lines.push("");

  if (tasks.length === 0) {
    lines.push("  Sin tareas adicionales.");
  } else {
    for (const t of tasks) {
      const h = { added: t.date || "", in_progress: "", completed: "", ...(t.history || {}) };
      const st = STATUS_TXT[t.status] || STATUS_TXT.not_started;
      const pct = Number(t.progress) ? ` · ${t.progress}%` : "";
      lines.push(`• ${t.description}  [${st}${pct}]`);
      lines.push(`     Inscrita: ${fmt(h.added)} · En proceso: ${fmt(h.in_progress)} · Completada: ${fmt(h.completed)}`);
      if (t.objectives) lines.push(`     Objetivos: ${t.objectives}`);
      if (t.solution)   lines.push(`     Solución: ${t.solution}`);
      const done = (t.checklist || []).filter(c => c.done).length;
      if ((t.checklist || []).length) lines.push(`     Subactividades: ${done}/${t.checklist.length}`);
    }
  }

  return lines.join("\n");
}
