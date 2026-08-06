// engineers.js — Agregación cross-proyecto para la vista por ingeniero.
// Funciones puras: no tocan React ni el DOM, solo leen projects/engineers ya cargados.

import { buildActivityIndex, getActivityStatus } from "./formulas.js";
import { activitiesForWeek, weekRange, nextWeekRange, SITUATION } from "./weekPlanning.js";

// Actividades del ingeniero en ese proyecto que asignadas a él, fuente de
// verdad (assigned_engineers), sin pasar por el snapshot weekly_detail.
function engineerActivitiesInProject(engineerId, project) {
  return (project.activities_identified || []).filter(a =>
    (a.assigned_engineers || []).some(e => e.id === engineerId || e.engineer_id === engineerId)
  );
}

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

// ── Variante EN VIVO de "esta semana" (vistas vivas, no reportes archivados) ──
// countActiveWeeklyTasks/getEngineerActivitiesInProject (arriba) leen el campo
// almacenado weekly_detail, que solo se refresca cuando alguien abre ese
// proyecto en EditView esa semana — dos vistas podían mostrar números
// distintos el mismo día. Estas calculan desde las fechas con el mismo motor
// de utils/weekPlanning.js que usa engineerWeekTasks más abajo.
//
// countActiveWeeklyTasks/getEngineerActivitiesInProject NO se eliminan: el
// reporte semanal archivado (MetricsTable.jsx, ReportView.jsx) debe leer el
// snapshot congelado al cerrar la semana, no recalcular en vivo.

// Cantidad de actividades del ingeniero que caen en la semana actual en ese
// proyecto, calculado en vivo desde las fechas.
export function countLiveWeeklyTasks(engineerId, project, today = new Date()) {
  return getLiveWeekActivitiesInProject(engineerId, project, today).length;
}

// True si el ingeniero tiene al menos una actividad esta semana en ese
// proyecto, calculado en vivo. Variante de hasActiveWeeklyTasks para vistas
// vivas — ver nota arriba.
export function hasLiveWeeklyTasks(engineerId, project, today = new Date()) {
  return countLiveWeeklyTasks(engineerId, project, today) > 0;
}

// Actividades del ingeniero que caen en la semana actual en ese proyecto.
// Mismo shape que getEngineerActivitiesInProject ({ id, text, position, history })
// para que sea un reemplazo directo en las vistas vivas (ActivitiesTable, etc.).
export function getLiveWeekActivitiesInProject(engineerId, project, today = new Date()) {
  const mine = engineerActivitiesInProject(engineerId, project);
  const range = weekRange(today.toISOString().slice(0, 10));
  const actIndex = buildActivityIndex(project.activities_identified);
  const history = project.task_status?.status_history || {};

  return activitiesForWeek(mine, range, project.task_status).map(({ activity }) => {
    const entry = actIndex.get(activity.id);
    return {
      id: activity.id,
      text: activity.text || "",
      position: entry?.position,
      history: history[activity.id] || {},
    };
  });
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

// ── KPIs accionables + "qué hacer ahora" (pantalla "mi semana", EngineerHub) ──
// A partir de las filas de engineerWeekTasks (que SÍ incluyen completadas
// on-time — activitiesForWeek solo excluye vencidas-ya-completadas), arma los
// contadores de la franja de KPIs y la lista priorizada de trabajo pendiente:
// vencidas primero, luego el resto por fecha de entrega ascendente.
export function buildEngineerWeekKpis(rows, projects, today = new Date()) {
  const todayIso = today.toISOString().slice(0, 10);
  const projectById = new Map((projects || []).map(p => [p.id, p]));

  const pendingRows = rows.filter(row => {
    const project = projectById.get(row.projectId);
    return getActivityStatus(project?.task_status, row.activity.id) !== "Completada";
  });

  const overdue = pendingRows.filter(r => r.situation === SITUATION.OVERDUE).length;
  const dueToday = pendingRows.filter(r => r.activity.due_date === todayIso).length;

  const todo = [...pendingRows].sort((a, b) => {
    const aOverdue = a.situation === SITUATION.OVERDUE;
    const bOverdue = b.situation === SITUATION.OVERDUE;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const da = a.activity.due_date || a.activity.start_date || "";
    const db = b.activity.due_date || b.activity.start_date || "";
    return da.localeCompare(db);
  });

  return { overdue, dueToday, thisWeek: rows.length, pending: pendingRows.length, todo };
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
