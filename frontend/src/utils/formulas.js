// formulas.js — Toda la lógica de cálculo y generación de texto del reporte.
//
// Si quieres cambiar CÓMO se calcula el avance → edita projectProgress().
// Si quieres cambiar el TEXTO del reporte copiado al portapapeles → edita projectBlock() y generateReportText().
// Si quieres cambiar las fechas/labels del encabezado → edita getWeekLabel() y getWeekRangeLabel().
// Si quieres cambiar la estructura de un proyecto nuevo → edita createDefaultProject().

// ── Fecha ────────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

export function getWeekLabel() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week  = Math.ceil((now - start) / 604800000);
  return `Semana ${week} — ${now.getDate()} ${MONTHS_SHORT[now.getMonth()]} ${now.getFullYear()}`;
}

export function getToday() {
  return new Date().toISOString().slice(0, 10);
}

export function getMondayOf(dateStr) {
  const d    = new Date(dateStr + "T12:00:00");
  const diff = d.getDay() === 0 ? -6 : 1 - d.getDay();
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

export function isSameWeek(dateA, dateB) {
  return getMondayOf(dateA) === getMondayOf(dateB);
}

export function getNextFriday() {
  const now  = new Date();
  const day  = now.getDay();
  // Si hoy es antes del viernes, saltar al viernes de la PRÓXIMA semana
  const diff = day < 5 ? 5 - day + 7 : day === 5 ? 7 : 6;
  const fri  = new Date(now);
  fri.setDate(now.getDate() + diff);
  return fri.toISOString().slice(0, 10);
}

export function getWeekRangeLabel(dateStr) {
  const fri = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  const dayOfWeek = fri.getDay();
  fri.setDate(fri.getDate() + (dayOfWeek <= 5 ? 5 - dayOfWeek : -(dayOfWeek - 5)));
  const mon = new Date(fri);
  mon.setDate(fri.getDate() - 4);
  const fmt = (d) => `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return `Semana del ${fmt(mon)} – ${fmt(fri)} ${fri.getFullYear()}`;
}

// ── Cálculos ──────────────────────────────────────────────────────────────────

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

// ── Modelo de datos ───────────────────────────────────────────────────────────

// ESTRUCTURA DE UN PROYECTO: aquí se definen todos los campos con sus valores por defecto.
// Si necesitas agregar un campo nuevo a todos los proyectos, agrégalo aquí.
// Los proyectos existentes NO tendrán el campo hasta que se editen y guarden.
export function createDefaultProject() {
  return {
    id:           Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    project_name: "",
    status:       "on-track",
    planner_url:  "",
    report_date:  getToday(),
    manual_metrics: {
      total_tasks:           0,
      completed_tasks:       0,
      in_progress_tasks:     0,
      shared_tasks_discount: 0,
    },
    activities_identified: [],
    weekly_achievements:   [],
    next_week_plan:        [],
    show_closing_fields:   false,
    task_status: { completed: [], in_progress: [], not_started: [] },
    milestones:  [],
    comments:    [],
    engineers:   [],
    indicators:  [],
    impediments: [],
  };
}

// ── Actividades (modelo basado en IDs estables) ───────────────────────────────
// Cada actividad es { id, text }. El id se genera una sola vez y nunca cambia,
// así que borrar o reordenar actividades no afecta a las demás (comentarios,
// fechas clave, estado, logros, etc. referencian el id, no la posición ni el texto).

export function genActivityId() {
  return "act_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createActivity(text = "") {
  return { id: genActivityId(), text };
}

// Construye un índice id → { text, position } a partir de activities_identified.
// "position" es siempre la posición ACTUAL (1-based), nunca se guarda.
export function buildActivityIndex(activities) {
  const map = new Map();
  (Array.isArray(activities) ? activities : []).forEach((a, i) => {
    if (a && a.id != null) map.set(a.id, { text: a.text || "", position: i + 1 });
  });
  return map;
}

// Resuelve un id a su texto plano. Si no se encuentra (referencia huérfana), devuelve el id tal cual.
export function activityText(index, id) {
  return index.get(id)?.text ?? id ?? "";
}

// Resuelve un id a su label numerado "N. texto" para mostrar en reportes/listas.
export function activityLabel(index, id) {
  const entry = index.get(id);
  return entry ? `${entry.position}. ${entry.text}` : (id || "");
}

export const createDefaultMilestone  = () => ({ activity: "", date: "", note: "" });
export const createDefaultComment    = () => ({ activity: "", date: "", text: "" });
export const createDefaultEngineer   = () => ({
  engineer_id:   "",
  assigned:      0,
  completed:     0,
  in_progress:   0,
  weekly_total:  0,
  weekly_detail: [],
});
export const createDefaultIndicator  = () => ({ name: "", total: 0, completed: 0, in_progress: 0 });
export const createDefaultImpediment = (category = "blocker") => ({ category, description: "", impact: "" });

// ── Catálogo de ingenieros (modelo basado en IDs estables) ────────────────────
// Cada ingeniero del catálogo tiene un id estable. engineers[].engineer_id dentro
// de un proyecto referencia ese id, nunca un nombre libre — mismo patrón que las
// actividades: borrar/desactivar un ingeniero no rompe referencias existentes.

export function genEngineerId() {
  return "eng_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createEngineer(name = "", role = "") {
  return { id: genEngineerId(), name, role, active: true, created_at: getToday(), tasks: [] };
}

// Construye un índice id → nombre a partir del catálogo de ingenieros.
export function buildEngineerIndex(engineers) {
  const map = new Map();
  (Array.isArray(engineers) ? engineers : []).forEach(e => {
    if (e && e.id != null) map.set(e.id, e.name || "");
  });
  return map;
}

// Resuelve un id de ingeniero a su nombre. Si no se encuentra, devuelve el id tal cual.
export function engineerName(index, id) {
  return index.get(id) ?? id ?? "";
}

export function genEngineerTaskId() {
  return "etask_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createEngineerTask(description = "") {
  return { id: genEngineerTaskId(), description, status: "not_started", date: "" };
}

// ── Reporte ASCII ─────────────────────────────────────────────────────────────
// Estas funciones generan el texto plano que se copia al portapapeles.
// Si quieres cambiar el formato del reporte exportado, edita projectBlock().

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
  const acts     = Array.isArray(p.activities_identified) ? p.activities_identified : [];
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
  const tsDone = resolveIds(actIndex, ts.completed);
  const tsWip  = resolveIds(actIndex, ts.in_progress);
  const tsNot  = resolveIds(actIndex, ts.not_started);
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

  if (p.show_closing_fields) {
    const ach  = resolveIds(actIndex, p.weekly_achievements);
    const plan = resolveIds(actIndex, p.next_week_plan);
    if (ach.length)  txt += `✓ Qué se hizo esta semana:\n${arrToBullets(ach)}\n\n`;
    if (plan.length) txt += `→ Plan para la próxima semana:\n${arrToBullets(plan)}\n\n`;
  }

  const milestones = Array.isArray(p.milestones) ? p.milestones.filter(m => m.date || m.note) : [];
  if (milestones.length) {
    txt += `📅 Fechas clave:\n`;
    milestones.forEach(m => {
      txt += `  • [${m.date || "Sin fecha"}] ${m.activity ? activityLabel(actIndex, m.activity) : "—"}`;
      if (m.note) txt += ` — ${m.note}`;
      txt += `\n`;
    });
    txt += `\n`;
  }

  const comments = Array.isArray(p.comments) ? p.comments.filter(c => c.text) : [];
  if (comments.length) {
    txt += `💬 Comentarios:\n`;
    comments.forEach(c => {
      txt += `  • [${c.date || "Sin fecha"}] ${c.activity ? activityLabel(actIndex, c.activity) : "—"}`;
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
