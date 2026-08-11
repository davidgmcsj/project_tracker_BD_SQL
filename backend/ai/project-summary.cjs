// project-summary.cjs — Construye el resumen textual de un proyecto que se
// inyecta en los prompts de IA (métricas, equipo, actividades, impedimentos).

const { toArray, buildActivityIndex } = require("../utils.cjs");
const { getProjectDescription }       = require("./project-catalog.cjs");

function resolveEngineerNames(projectEngineers, catalog) {
  if (!projectEngineers?.length) return [];
  const catMap = new Map((catalog || []).map(e => [e.id, e.name]));
  return projectEngineers.map(e => {
    if (e.engineer_id === "Otro...") return e.custom_name || "—";
    return catMap.get(e.engineer_id) || e.engineer_id || "—";
  }).filter(n => n && n !== "—");
}

function getMainEngineer(engineers, catalog) {
  const names = resolveEngineerNames(engineers, catalog);
  return names.length ? names[0] : "Equipo del proyecto";
}

function projectProgress(total, completed, inProgress) {
  if (!total || total <= 0) return 0;
  return Math.min(((Number(completed) + Number(inProgress) * 0.5) / Number(total)) * 100, 100);
}

function actText(index, id)  { return index.get(id)?.text ?? id ?? ""; }
function actLabel(index, id) { const e = index.get(id); return e ? `${e.position}. ${e.text}` : (id || ""); }
function resolveIds(index, ids) { return toArray(ids).map(id => actText(index, id)); }

function buildProjectSummary(project, engineerCatalog) {
  const description      = getProjectDescription(project.project_name);
  const projectDisplayName = (project.project_name || "").replace(/^PRO-\d+[-:\s]*/i, "").trim() || project.project_name || "Sin nombre";
  const m       = project.manual_metrics || {};
  const total   = Number(m.total_tasks        || 0);
  const done    = Number(m.completed_tasks    || 0);
  const wip     = Number(m.in_progress_tasks  || 0);
  const pending = Math.max(0, total - done - wip);
  const pct     = Math.round(projectProgress(total, done, wip));

  const statusMap = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado", "mejora-continua": "Mejora Continua" };
  const status    = statusMap[project.status] || project.status || "—";

  const blockers = (project.impediments || []).filter(i => i.category === "blocker");
  const risks    = (project.impediments || []).filter(i => i.category === "risk");
  const nonConf  = (project.impediments || []).filter(i => i.category === "non_conformity");

  const actIndex   = buildActivityIndex(project.activities_identified);
  const ts         = project.task_status || {};
  const tsDone     = resolveIds(actIndex, ts.completed);
  const tsWip      = resolveIds(actIndex, ts.in_progress);
  const tsNotStart = resolveIds(actIndex, ts.not_started);

  const milestones = (project.milestones || []).filter(m => m.date || m.note);
  const comments   = (project.comments   || []).filter(c => c.text);

  const catMap = new Map((engineerCatalog || []).map(e => [e.id, e.name]));
  const engLines = (project.engineers || []).map(e => {
    const name = e.engineer_id === "Otro..." ? (e.custom_name || "—") : (catMap.get(e.engineer_id) || e.engineer_id || "—");
    const detail = resolveIds(actIndex, e.weekly_detail);
    return `  - ${name}: ${e.assigned || 0} asignadas, ${e.completed || 0} completadas, ${e.in_progress || 0} en proceso${detail.length ? `. Actividades esta semana: ${detail.join("; ")}` : " (sin actividades registradas esta semana)"}`;
  });

  const indicators = (project.indicators || []).map(ind => {
    const ip = Math.round(projectProgress(ind.total, ind.completed, ind.in_progress));
    return `  - ${ind.name || "Indicador"}: ${ip}% (${ind.completed}/${ind.total} completadas, ${ind.in_progress} en proceso)`;
  });

  return `
PROYECTO: ${projectDisplayName}
DESCRIPCIÓN TÉCNICA: ${description}
Fecha de reporte: ${project.report_date || "—"}
Estado: ${status}
Responsable principal: ${getMainEngineer(project.engineers, engineerCatalog)}

MÉTRICAS GENERALES:
- Total actividades: ${total}
- Completadas: ${done}
- En proceso: ${wip}
- No iniciadas: ${pending}
- Avance calculado: ${pct}%
${indicators.length ? `\nINDICADORES:\n${indicators.join("\n")}` : ""}
${engLines.length ? `\nEQUIPO DE INGENIEROS (todos los integrantes del equipo — menciónalos a todos en el informe aunque no tengan actividades registradas esta semana):\n${engLines.join("\n")}` : ""}

ACTIVIDADES IDENTIFICADAS PARA EL PERIODO:
${(project.activities_identified || []).map((a, i) => `  ${i + 1}. ${a.text}`).join("\n") || "  No registradas"}

ESTADO DETALLADO DE ACTIVIDADES:
${tsDone.length     ? `  Completadas (${tsDone.length}):\n${tsDone.map(a => `    - ${a}`).join("\n")}` : "  Sin actividades completadas registradas"}
${tsWip.length      ? `  En proceso (${tsWip.length}):\n${tsWip.map(a => `    - ${a}`).join("\n")}` : ""}
${tsNotStart.length ? `  No iniciadas (${tsNotStart.length}):\n${tsNotStart.map(a => `    - ${a}`).join("\n")}` : ""}

LOGROS DE LA SEMANA:
${resolveIds(actIndex, project.weekly_achievements).map(a => `  - ${a}`).join("\n") || "  No registrados"}

PLAN PRÓXIMA SEMANA:
${resolveIds(actIndex, project.next_week_plan).map(a => `  - ${a}`).join("\n") || "  No registrado"}

IMPEDIMENTOS Y RIESGOS:
${blockers.length ? `  Bloqueantes:\n${blockers.map(b => `    - ${b.description}${b.impact ? ` (Impacto: ${b.impact})` : ""}`).join("\n")}` : "  Sin bloqueantes"}
${risks.length    ? `  Riesgos:\n${risks.map(r => `    - ${r.description}${r.impact ? ` (Impacto: ${r.impact})` : ""}`).join("\n")}` : "  Sin riesgos registrados"}
${nonConf.length  ? `  Salidas no conformes:\n${nonConf.map(n => `    - ${n.description}${n.impact ? ` (Impacto: ${n.impact})` : ""}`).join("\n")}` : "  Sin salidas no conformes"}

FECHAS CLAVE / HITOS:
${milestones.length ? milestones.map(m => `  - [${m.date || "Sin fecha"}] ${m.activity ? actLabel(actIndex, m.activity) : "—"}${m.note ? `: ${m.note}` : ""}`).join("\n") : "  No registradas"}

COMENTARIOS:
${comments.length ? comments.map(c => `  - ${c.text}${c.date ? ` (${c.date})` : ""}`).join("\n") : "  Sin comentarios"}

ESTADO ACTUAL DEL PROYECTO (notas redactadas manualmente):
${project.status_notes && project.status_notes.trim() ? project.status_notes.trim() : "  Sin notas registradas"}

INSTRUCCIONES CONTEXTUALES ESPECÍFICAS PARA ESTE PROYECTO:
${project.status === "mejora-continua" ? `⚠ CONTEXTO MEJORA CONTINUA: Este proyecto ya fue entregado y se encuentra en operación. Las actividades registradas NO son pendientes de un desarrollo en curso — son mejoras, ajustes y evoluciones planificadas sobre un sistema funcional y en producción. El informe debe reflejar un proyecto maduro en fase de evolución continua. No uses lenguaje de proyecto en construcción ("se está desarrollando", "se avanza en la implementación") — usa lenguaje de sistema en operación que evoluciona ("se incorporó la mejora", "se optimizó el componente", "se ajustó la funcionalidad").` : ""}
${/juan|steven/i.test(project.project_name || "") ? `⚠ CONTEXTO SOPORTE TRANSVERSAL: Este no es un proyecto de desarrollo convencional. Corresponde al registro de actividades de soporte técnico transversal prestado por ingenieros a múltiples proyectos de la oficina: mejoras, ajustes, soportes, cambios y apoyo a otros equipos de desarrollo. El informe debe centrarse en el volumen y variedad de actividades ejecutadas durante el periodo, destacando la diversidad del soporte técnico brindado. No apliques la lógica de avance de proyecto ni de entregables — la métrica principal es la cantidad y tipo de actividades realizadas.` : ""}
`.trim();
}

module.exports = {
  resolveEngineerNames, getMainEngineer, projectProgress,
  actText, actLabel, resolveIds, buildProjectSummary,
};
