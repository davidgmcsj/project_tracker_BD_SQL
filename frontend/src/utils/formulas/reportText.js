// reportText.js — Genera el texto plano/Markdown que se copia al
// portapapeles o se descarga (reporte semanal, reporte de proyecto,
// asignaciones por ingeniero). Si quieres cambiar el formato del reporte
// exportado, edita projectBlock().

import { projectProgress, globalStats } from "./progress.js";
import { visibleActivities } from "./activityModel.js";
import { totalPlannedHours } from "./businessDays.js";
import { buildActivityIndex, activityText, activityLabel } from "./activityHierarchy.js";
import { buildEngineerIndex, engineerName } from "./engineerModel.js";
import { formatDateDMY } from "./dateHelpers.js";

const STATUS_LABELS = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado" };
const STATUS_ICONS  = { "on-track": "🟡", "at-risk": "🟠", blocked: "🔴", completed: "🟢" };
const CAT_LABELS    = { blocker: "Bloqueante", risk: "Riesgo", non_conformity: "Salida no conforme" };

const col = (str, w) => String(str).padEnd(w);

function arrToBullets(val) {
  if (!val) return "";
  const items = Array.isArray(val) ? val.filter(Boolean) : val.split("\n").map(l => l.trim()).filter(Boolean);
  return items.map(l => `  • ${l}`).join("\n");
}

function arrToNumbered(arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return arr.map((t, i) => `  ${i + 1}. ${t}`).join("\n");
}

// Resuelve un array de ids de actividad a sus textos planos, usando el índice del proyecto.
function resolveIds(index, ids) {
  return (Array.isArray(ids) ? ids : []).filter(Boolean).map(id => activityText(index, id));
}

// Igual que resolveIds pero anexa " — 60% · 8h" cuando la actividad tiene esos datos.
// Recibe el array de actividades (objetos) para leer progress/planned_hours.
function resolveIdsWithMeta(index, ids, acts) {
  const byId = new Map((Array.isArray(acts) ? acts : []).map(a => [a.id, a]));
  return (Array.isArray(ids) ? ids : []).filter(Boolean).map(id => {
    const text = activityText(index, id);
    const a    = byId.get(id);
    if (!a) return text;
    const bits = [];
    if (Number(a.progress) > 0)      bits.push(`${Math.round(Number(a.progress))}%`);
    if (Number(a.planned_hours) > 0) bits.push(`${Number(a.planned_hours)}h`);
    return bits.length ? `${text} — ${bits.join(" · ")}` : text;
  });
}

function projectBlock(p, i, engineerIndex) {
  const m        = p.manual_metrics || {};
  const total    = m.total_tasks       || 0;
  const done     = m.completed_tasks   || 0;
  const wip      = m.in_progress_tasks || 0;
  const pct      = Math.round(projectProgress(total, done, wip));
  const pending  = Math.max(0, total - done - wip);
  const icon     = STATUS_ICONS[p.status]  || "🟡";
  const label    = STATUS_LABELS[p.status] || p.status;
  const blockers = (p.impediments || []).filter(im => im.category === "blocker");
  const acts     = visibleActivities(p.activities_identified); // excluye archivadas de Planner
  const actIndex = buildActivityIndex(acts);
  const actTexts = acts.map(a => a.text || "");

  let txt = `──── ${icon} ${p.project_name || `Proyecto ${i + 1}`} ────\n`;
  txt += `Estado: ${label}   |   Fecha de reporte: ${p.report_date || "—"}\n`;
  if (p.planner_url) txt += `Planner: ${p.planner_url}\n`;
  txt += "\n";

  txt += `${"─".repeat(72)}\n${col("Métrica",22)}${col("Valor",18)}Observaciones\n${"─".repeat(72)}\n`;
  txt += `${col("Avance",22)}${col(pct+"%",18)}${done} completadas · ${wip} en proceso.\n`;
  txt += `${col("Estado de Tareas",22)}${col(`${done} de ${total}`,18)}${pending} no iniciado${pending !== 1 ? "s" : ""}${pending === 0 ? " — todo completado." : "."}\n`;
  txt += `${col("Bloqueantes",22)}${col(blockers.length,18)}${blockers.length === 0 ? "Sin bloqueantes." : blockers[0].description.split("\n")[0]}\n`;
  const plannedHrs = totalPlannedHours(acts);
  if (plannedHrs > 0) {
    const nWithHrs = acts.filter(a => Number(a.planned_hours) > 0).length;
    txt += `${col("Horas planeadas",22)}${col(plannedHrs+" h",18)}${nWithHrs} actividad${nWithHrs !== 1 ? "es" : ""} con horas estimadas.\n`;
  }
  txt += `${"─".repeat(72)}\n\n`;

  if (p.indicators?.length) {
    txt += `INDICADORES\n${"─".repeat(88)}\n`;
    txt += `${col("Indicador",28)}${col("Avance",10)}${col("Total",9)}${col("Completadas",14)}${col("En proceso",13)}No iniciadas\n`;
    txt += `${"─".repeat(88)}\n`;
    p.indicators.forEach(ind => {
      const ip = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
      const ni = Math.max(0, ind.total - ind.completed - ind.in_progress);
      txt += `${col(ind.name||"—",28)}${col(ip+"%",10)}${col(ind.total,9)}${col(ind.completed,14)}${col(ind.in_progress,13)}${ni}\n`;
    });
    txt += `${"─".repeat(88)}\n\n`;
  }

  if (p.engineers?.length) {
    const shared   = Number(m.shared_tasks_discount || 0);
    const assigned = p.engineers.reduce((s, e) => s + Number(e.assigned || 0), 0);
    txt += `INGENIEROS — GLOBAL\n${"─".repeat(88)}\n`;
    txt += `${col("Ingeniero",28)}${col("Asignadas",12)}${col("Completadas",14)}${col("En proceso",13)}No iniciadas\n${"─".repeat(88)}\n`;
    p.engineers.forEach(e => {
      const name = e.engineer_id ? engineerName(engineerIndex, e.engineer_id) : "—";
      txt += `${col(name,28)}${col(e.assigned,12)}${col(e.completed,14)}${col(e.in_progress,13)}${Math.max(0, e.assigned - e.completed - e.in_progress)}\n`;
    });
    if (shared > 0) {
      txt += `${"─".repeat(88)}\n${col("Tareas compartidas (descuento)",28)}${col("-"+shared,12)}\n`;
      txt += `${col("Total real",28)}${col(assigned - shared,12)}\n`;
    }
    txt += `${"─".repeat(88)}\n\n`;

    const hasWeek = p.engineers.some(e => e.weekly_total > 0 || (Array.isArray(e.weekly_detail) ? e.weekly_detail.length : e.weekly_detail));
    if (hasWeek) {
      txt += `INGENIEROS — ESTA SEMANA\n${"─".repeat(60)}\n${col("Ingeniero",28)}Tareas sem.\n${"─".repeat(60)}\n`;
      p.engineers.forEach(e => {
        const detail = resolveIds(actIndex, e.weekly_detail);
        if (!e.weekly_total && !detail.length) return;
        const name = e.engineer_id ? engineerName(engineerIndex, e.engineer_id) : "—";
        txt += `${col(name,28)}${e.weekly_total || 0}\n`;
        if (detail.length) txt += `${arrToBullets(detail)}\n`;
      });
      txt += `${"─".repeat(60)}\n\n`;
    }
  }

  if (acts.length) txt += `• Actividades Identificadas:\n${arrToNumbered(actTexts)}\n\n`;

  const ts = p.task_status || {};
  const tsDone = resolveIdsWithMeta(actIndex, ts.completed,    acts);
  const tsWip  = resolveIdsWithMeta(actIndex, ts.in_progress,  acts);
  const tsNot  = resolveIdsWithMeta(actIndex, ts.not_started,  acts);
  if (tsDone.length || tsWip.length || tsNot.length) {
    txt += `ESTADO DE ACTIVIDADES\n${"─".repeat(60)}\n`;
    if (tsDone.length) { txt += `✅ Completadas (${tsDone.length}):\n${arrToBullets(tsDone)}\n\n`; }
    if (tsWip.length)  { txt += `🔄 En proceso (${tsWip.length}):\n${arrToBullets(tsWip)}\n\n`; }
    if (tsNot.length)  { txt += `○ No iniciadas (${tsNot.length}):\n${arrToBullets(tsNot)}\n\n`; }
  }

  const byCategory = {};
  (p.impediments || []).forEach(im => { (byCategory[im.category] ||= []).push(im); });
  for (const [cat, items] of Object.entries(byCategory)) {
    txt += `⚠ ${CAT_LABELS[cat] || cat}s:\n`;
    items.forEach(im => {
      txt += `  • ${im.description}\n`;
      if (im.impact) txt += `    → Impacto: ${im.impact}\n`;
    });
    txt += "\n";
  }

  // weekly_achievements/next_week_plan se calculan automáticamente (ver
  // NextWeekPlanningSection en EditView.jsx) — ya no dependen del antiguo
  // checkbox show_closing_fields, cada bloque se omite solo si queda vacío.
  {
    const ach  = resolveIds(actIndex, p.weekly_achievements);
    const plan = resolveIds(actIndex, p.next_week_plan);
    if (ach.length)  txt += `✓ Qué se hizo esta semana:\n${arrToBullets(ach)}\n\n`;
    if (plan.length) txt += `→ Plan para la próxima semana:\n${arrToBullets(plan)}\n\n`;
  }

  const milestones = Array.isArray(p.milestones) ? p.milestones.filter(m => m.date || m.note) : [];
  if (milestones.length) {
    txt += `📅 Fechas clave:\n`;
    milestones.forEach(m => {
      txt += `  • [${m.date ? formatDateDMY(m.date) : "Sin fecha"}] ${m.activity ? activityLabel(actIndex, m.activity) : "—"}`;
      if (m.note) txt += ` — ${m.note}`;
      txt += `\n`;
    });
    txt += `\n`;
  }

  const comments = Array.isArray(p.comments) ? p.comments.filter(c => c.text) : [];
  if (comments.length) {
    txt += `💬 Comentarios:\n`;
    comments.forEach(c => {
      txt += `  • [${c.date ? formatDateDMY(c.date) : "Sin fecha"}] ${c.activity ? activityLabel(actIndex, c.activity) : "—"}`;
      if (c.text) txt += `: ${c.text}`;
      txt += `\n`;
    });
    txt += `\n`;
  }

  txt += "\n";
  return txt;
}

export function generateReportText(projects, weekLabel, engineers) {
  const stats      = globalStats(projects);
  const pending    = projects.reduce((s, p) => {
    const m = p.manual_metrics || {};
    return s + Math.max(0, (m.total_tasks || 0) - (m.completed_tasks || 0) - (m.in_progress_tasks || 0));
  }, 0);
  const withBlocker = projects.filter(p => (p.impediments || []).some(im => im.category === "blocker"));
  const engineerIndex = buildEngineerIndex(engineers);

  let txt = `═══ REPORTE SEMANAL DE PROYECTOS ═══\n${weekLabel}\n\n`;
  txt += `RESUMEN GLOBAL\n${"─".repeat(72)}\n`;
  txt += `${col("Métrica",22)}${col("Valor",18)}Observaciones\n${"─".repeat(72)}\n`;
  txt += `${col("Avance Promedio",22)}${col(Math.round(stats.percent)+"%",18)}Promedio de avance de proyectos activos.\n`;
  txt += `${col("Estado de Tareas",22)}${col(`${stats.completed} de ${stats.total}`,18)}${pending} no iniciado${pending !== 1 ? "s" : ""}.\n`;
  txt += `${col("Con bloqueantes",22)}${col(withBlocker.length,18)}${withBlocker.length === 0 ? "Sin bloqueantes activos." : withBlocker.map(p => p.project_name).join(", ")}\n`;
  txt += `${"─".repeat(72)}\n* El porcentaje de avance se calcula según las tareas identificadas.\n\n`;
  projects.forEach((p, i) => { txt += projectBlock(p, i, engineerIndex); });
  return txt;
}

export function generateSingleProjectReportText(p, weekLabel, engineers) {
  const icon  = STATUS_ICONS[p.status]  || "🟡";
  const label = STATUS_LABELS[p.status] || p.status;
  let txt = `═══ REPORTE DE PROYECTO ═══\n${weekLabel}\n\n`;
  txt += `${icon} ${p.project_name || "Proyecto"}\nEstado: ${label}   |   Fecha: ${p.report_date || "—"}\n`;
  if (p.planner_url) txt += `Planner: ${p.planner_url}\n`;
  txt += "\n";
  txt += projectBlock(p, 0, buildEngineerIndex(engineers));
  return txt;
}

// Prioridad Completada > Ambiente Producción > Ambiente Pruebas > En proceso
// > No iniciada — MISMA jerarquía duplicada (a propósito, ver comentario de
// filtroOpciones.js) en utils/engineers.js (activityStatusIn),
// activity-detail/shared.js (getActivityStatus, devuelve clave interna) y
// backend/db/activity-detail.repo.cjs (statusOf) — mantener sincronizadas.
export function getActivityStatus(ts, actId) {
  if (!ts) return "No iniciada";
  if (Array.isArray(ts.completed) && ts.completed.includes(actId)) return "Completada";
  if (Array.isArray(ts.ambiente_produccion) && ts.ambiente_produccion.includes(actId)) return "Ambiente Producción";
  if (Array.isArray(ts.ambiente_pruebas) && ts.ambiente_pruebas.includes(actId)) return "Ambiente Pruebas";
  if (Array.isArray(ts.in_progress) && ts.in_progress.includes(actId)) return "En proceso";
  if (Array.isArray(ts.not_started) && ts.not_started.includes(actId)) return "No iniciada";
  return "No iniciada";
}

export function generateAssignmentsByEngineer(projects, engineerCatalog, weekLabel) {
  // Construir mapa: engineerId → { name, actividades[] }
  const engMap = {};
  (engineerCatalog || []).forEach(e => {
    engMap[e.id] = { name: e.name || e.id, acts: [] };
  });

  const unassigned = [];

  projects.forEach(p => {
    const projectName = p.project_name || "Proyecto sin nombre";
    visibleActivities(p.activities_identified).forEach(a => {
      const assignees = a.assigned_engineers || [];
      if (assignees.length === 0) {
        unassigned.push({ project: projectName, text: a.text });
      } else {
        assignees.forEach(e => {
          if (!engMap[e.id]) engMap[e.id] = { name: e.name || e.id, acts: [] };
          engMap[e.id].acts.push({ project: projectName, text: a.text });
        });
      }
    });
  });

  let txt = `ACTIVIDADES POR INGENIERO\n`;
  txt += `Reporte: ${weekLabel}\n`;
  txt += `================================================================================\n\n`;

  const engineers = Object.values(engMap).sort((a, b) => a.name.localeCompare(b.name));

  engineers.forEach(eng => {
    txt += `${eng.name}\n`;
    txt += `${"─".repeat(Math.min(eng.name.length, 60))}\n`;
    if (eng.acts.length === 0) {
      txt += `  (Sin actividades asignadas)\n`;
    } else {
      eng.acts.forEach((a, i) => {
        txt += `  ${i + 1}. [${a.project}] ${a.text}\n`;
      });
    }
    txt += `\n`;
  });

  if (unassigned.length > 0) {
    txt += `ACTIVIDADES SIN INGENIERO ASIGNADO\n`;
    txt += `================================================================================\n`;
    unassigned.forEach((a, i) => {
      txt += `  ${i + 1}. [${a.project}] ${a.text}\n`;
    });
    txt += `\n`;
  }

  return txt;
}

export function generateAssignmentsMarkdown(projects, weekLabel) {
  let md = `# Asignación de Actividades y Responsables\n`;
  md += `**Reporte:** ${weekLabel}\n\n`;

  const escapePipe = (str) => String(str || "").replace(/\|/g, "\\|");

  projects.forEach((p, idx) => {
    md += `## Proyecto: ${p.project_name || `Proyecto ${idx + 1}`}\n`;
    const acts = visibleActivities(p.activities_identified);
    if (acts.length === 0) {
      md += `*Sin actividades registradas.*\n\n`;
      return;
    }

    md += `| # | Actividad | Responsables | Estado | Fecha Asig. |\n`;
    md += `|---|-----------|--------------|--------|-------------|\n`;

    acts.forEach((a, i) => {
      const status = getActivityStatus(p.task_status, a.id);
      const engineers = (a.assigned_engineers || []).map(e => e.name).join(", ") || "Sin asignar";
      const date = a.assigned_date || "—";
      md += `| ${i + 1} | ${escapePipe(a.text)} | ${escapePipe(engineers)} | ${escapePipe(status)} | ${escapePipe(date)} |\n`;
    });
    md += `\n`;
  });

  return md;
}

export function generateAssignmentsPlainText(projects, weekLabel) {
  let txt = `ASIGNACIÓN DE ACTIVIDADES Y RESPONSABLES\n`;
  txt += `Reporte: ${weekLabel}\n`;
  txt += `================================================================================\n\n`;

  projects.forEach((p, idx) => {
    txt += `Proyecto: ${p.project_name || `Proyecto ${idx + 1}`}\n`;
    txt += `--------------------------------------------------------------------------------\n`;
    const acts = visibleActivities(p.activities_identified);
    if (acts.length === 0) {
      txt += `  Sin actividades registradas.\n\n`;
      return;
    }

    acts.forEach((a, i) => {
      const status = getActivityStatus(p.task_status, a.id);
      const engineers = (a.assigned_engineers || []).map(e => e.name).join(", ") || "Sin asignar";
      const date = a.assigned_date || "—";
      txt += `  ${i + 1}. ${a.text}\n`;
      txt += `     Responsables : ${engineers}\n`;
      txt += `     Estado       : ${status}\n`;
      txt += `     Asignación   : ${date}\n\n`;
    });
    txt += `\n`;
  });

  return txt;
}
