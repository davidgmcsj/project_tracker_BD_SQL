// ── Fecha ────────────────────────────────────────────────────────────────────

export function getWeekLabel() {
  const now    = new Date();
  const start  = new Date(now.getFullYear(), 0, 1);
  const week   = Math.ceil((now - start) / 604800000);
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `Semana ${week} — ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

// Fecha de hoy en YYYY-MM-DD
export function getToday() {
  return new Date().toISOString().slice(0, 10);
}

// Viernes de la semana actual en YYYY-MM-DD
export function getCurrentFriday() {
  const now  = new Date();
  const day  = now.getDay();
  const diff = day <= 5 ? 5 - day : 6;
  const fri  = new Date(now);
  fri.setDate(now.getDate() + diff);
  return fri.toISOString().slice(0, 10);
}

// Lunes de la semana de una fecha YYYY-MM-DD (clave de semana para upsert)
export function getMondayOf(dateStr) {
  const d   = new Date(dateStr + "T12:00:00");
  const day = d.getDay();                       // 0=dom, 1=lun … 6=sáb
  const diff = day === 0 ? -6 : 1 - day;       // retroceder al lunes
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

// true si dos fechas YYYY-MM-DD pertenecen a la misma semana lun-dom
export function isSameWeek(dateA, dateB) {
  return getMondayOf(dateA) === getMondayOf(dateB);
}

// Viernes de la semana siguiente en YYYY-MM-DD
export function getNextFriday() {
  const now  = new Date();
  const day  = now.getDay();
  // días hasta el próximo viernes (siempre avanza al menos 7 días si hoy ya es viernes)
  const diff = day < 5 ? 5 - day + 7 : day === 5 ? 7 : 6;
  const fri  = new Date(now);
  fri.setDate(now.getDate() + diff);
  return fri.toISOString().slice(0, 10);
}

// Devuelve "lunes DD Mes – viernes DD Mes YYYY" a partir de una fecha YYYY-MM-DD
export function getWeekRangeLabel(dateStr) {
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  const fri = dateStr ? new Date(dateStr + "T12:00:00") : new Date();
  // ajustar al viernes de esa semana (por si acaso no lo es)
  const dayOfWeek = fri.getDay();
  const diffToFri = dayOfWeek <= 5 ? 5 - dayOfWeek : -(dayOfWeek - 5);
  fri.setDate(fri.getDate() + diffToFri);
  const mon = new Date(fri);
  mon.setDate(fri.getDate() - 4);
  const fmt = (d) => `${d.getDate()} ${months[d.getMonth()]}`;
  return `Semana del ${fmt(mon)} – ${fmt(fri)} ${fri.getFullYear()}`;
}

// ── Cálculos ─────────────────────────────────────────────────────────────────

export function projectProgress(total, completed, inProgress) {
  if (!total || total <= 0) return 0;
  return Math.min(((Number(completed) + Number(inProgress) * 0.5) / Number(total)) * 100, 100);
}

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

// ── Modelo de datos ──────────────────────────────────────────────────────────

export function createDefaultProject() {
  return {
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    project_name: "",
    status:       "on-track",
    planner_url:  "",
    report_date:  getToday(),
    manual_metrics: {
      total_tasks:          0,
      completed_tasks:      0,
      in_progress_tasks:    0,
      shared_tasks_discount: 0,
    },
    activities_identified: [],   // ["texto actividad", ...]
    weekly_achievements:   [],   // ["texto actividad seleccionada", ...]
    next_week_plan:        [],   // ["texto actividad seleccionada", ...]
    show_closing_fields:   false,
    milestones:  [],  // [{ activity: "1. texto", date: "YYYY-MM-DD", note: "" }, ...]
    comments:    [],  // [{ activity: "1. texto", date: "YYYY-MM-DD", text: "" }, ...]
    engineers:   [],
    indicators:  [],
    impediments: [],
  };
}

export function createDefaultMilestone() {
  return { activity: "", date: "", note: "" };
}

export function createDefaultComment() {
  return { activity: "", date: "", text: "" };
}

export function createDefaultEngineer() {
  return {
    engineer_id:  "",
    custom_name:  "",
    assigned:     0,
    completed:    0,
    in_progress:  0,
    weekly_total: 0,
    weekly_detail: [],  // ["N. texto actividad", ...]
  };
}

export function createDefaultIndicator() {
  return { name: "", total: 0, completed: 0, in_progress: 0 };
}

export function createDefaultImpediment(category = "blocker") {
  return { category, description: "", impact: "" };
}

// ── Reportes en texto ASCII ───────────────────────────────────────────────────

const STATUS_LABELS = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado" };
const STATUS_ICONS  = { "on-track": "🟡", "at-risk": "🟠", blocked: "🔴", completed: "🟢" };
const CAT_LABELS    = { blocker: "Bloqueante", risk: "Riesgo", non_conformity: "Salida no conforme" };

function col(str, w) { return String(str).padEnd(w); }

// Convierte array o string a líneas de viñetas para el reporte ASCII
function arrToBullets(val) {
  if (!val) return "";
  const items = Array.isArray(val)
    ? val.filter(Boolean)
    : val.split("\n").map(l => l.trim()).filter(Boolean);
  return items.map(l => `  • ${l}`).join("\n");
}

// Formatea array de actividades numeradas: "1. texto\n2. texto\n..."
function arrToNumbered(arr) {
  if (!Array.isArray(arr) || !arr.length) return "";
  return arr.map((t, i) => `  ${i + 1}. ${t}`).join("\n");
}

function projectBlock(p, i) {
  const m       = p.manual_metrics || {};
  const total   = m.total_tasks      || 0;
  const done    = m.completed_tasks  || 0;
  const wip     = m.in_progress_tasks|| 0;
  const pct     = Math.round(projectProgress(total, done, wip));
  const pending = Math.max(0, total - done - wip);
  const icon    = STATUS_ICONS[p.status]  || "🟡";
  const label   = STATUS_LABELS[p.status] || p.status;
  const blockers = (p.impediments || []).filter(im => im.category === "blocker");
  const acts     = Array.isArray(p.activities_identified) ? p.activities_identified : [];

  let txt = `──── ${icon} ${p.project_name || `Proyecto ${i + 1}`} ────\n`;
  txt += `Estado: ${label}   |   Fecha de reporte: ${p.report_date || "—"}\n`;
  if (p.planner_url) txt += `Planner: ${p.planner_url}\n`;
  txt += "\n";

  txt += `${"─".repeat(72)}\n${col("Métrica",22)}${col("Valor",18)}Observaciones\n${"─".repeat(72)}\n`;
  txt += `${col("Avance",22)}${col(pct+"%",18)}${done} completadas · ${wip} en proceso.\n`;
  txt += `${col("Estado de Tareas",22)}${col(`${done} de ${total}`,18)}${pending} no iniciado${pending!==1?"s":""}${pending===0?" — todo completado.":"."}\n`;
  txt += `${col("Bloqueantes",22)}${col(blockers.length,18)}${blockers.length===0?"Sin bloqueantes.":blockers[0].description.split("\n")[0]}\n`;
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
    const assigned = p.engineers.reduce((s,e) => s+Number(e.assigned||0), 0);
    txt += `INGENIEROS — GLOBAL\n${"─".repeat(88)}\n`;
    txt += `${col("Ingeniero",28)}${col("Asignadas",12)}${col("Completadas",14)}${col("En proceso",13)}No iniciadas\n${"─".repeat(88)}\n`;
    p.engineers.forEach(e => {
      const name = e.engineer_id==="Otro..."?(e.custom_name||"—"):(e.engineer_id||"—");
      txt += `${col(name,28)}${col(e.assigned,12)}${col(e.completed,14)}${col(e.in_progress,13)}${Math.max(0,e.assigned-e.completed-e.in_progress)}\n`;
    });
    if (shared > 0) {
      txt += `${"─".repeat(88)}\n${col("Tareas compartidas (descuento)",28)}${col("-"+shared,12)}\n`;
      txt += `${col("Total real",28)}${col(assigned-shared,12)}\n`;
    }
    txt += `${"─".repeat(88)}\n\n`;
    const hasWeek = p.engineers.some(e => e.weekly_total>0 || (Array.isArray(e.weekly_detail)?e.weekly_detail.length:e.weekly_detail));
    if (hasWeek) {
      txt += `INGENIEROS — ESTA SEMANA\n${"─".repeat(60)}\n${col("Ingeniero",28)}Tareas sem.\n${"─".repeat(60)}\n`;
      p.engineers.forEach(e => {
        const detail = Array.isArray(e.weekly_detail) ? e.weekly_detail : [];
        if (!e.weekly_total && !detail.length) return;
        const name = e.engineer_id==="Otro..."?(e.custom_name||"—"):(e.engineer_id||"—");
        txt += `${col(name,28)}${e.weekly_total||0}\n`;
        if (detail.length) txt += `${arrToBullets(detail)}\n`;
      });
      txt += `${"─".repeat(60)}\n\n`;
    }
  }

  if (acts.length) {
    txt += `• Actividades Identificadas:\n${arrToNumbered(acts)}\n\n`;
  }

  const byCategory = {};
  (p.impediments||[]).forEach(im => { (byCategory[im.category]||=[]).push(im); });
  for (const [cat, items] of Object.entries(byCategory)) {
    txt += `⚠ ${CAT_LABELS[cat]||cat}s:\n`;
    items.forEach(im => {
      txt += `  • ${im.description}\n`;
      if (im.impact) txt += `    → Impacto: ${im.impact}\n`;
    });
    txt += "\n";
  }

  if (p.show_closing_fields) {
    const ach = Array.isArray(p.weekly_achievements) ? p.weekly_achievements : [];
    const plan = Array.isArray(p.next_week_plan) ? p.next_week_plan : [];
    if (ach.length)  txt += `✓ Qué se hizo esta semana:\n${arrToBullets(ach)}\n\n`;
    if (plan.length) txt += `→ Plan para la próxima semana:\n${arrToBullets(plan)}\n\n`;
  }
  const milestones = Array.isArray(p.milestones) ? p.milestones.filter(m => m.date || m.note) : [];
  if (milestones.length) {
    txt += `📅 Fechas clave:\n`;
    milestones.forEach(m => {
      const actLabel = m.activity ? `${m.activity}` : "—";
      txt += `  • [${m.date || "Sin fecha"}] ${actLabel}`;
      if (m.note) txt += ` — ${m.note}`;
      txt += `\n`;
    });
    txt += `\n`;
  } else if (typeof p.milestones === "string" && p.milestones) {
    txt += `📅 Fechas clave:\n${arrToBullets(p.milestones)}\n`;
  }
  const comments = Array.isArray(p.comments) ? p.comments.filter(c => c.text) : [];
  if (comments.length) {
    txt += `💬 Comentarios:\n`;
    comments.forEach(c => {
      const actLabel = c.activity ? `${c.activity}` : "—";
      txt += `  • [${c.date || "Sin fecha"}] ${actLabel}`;
      if (c.text) txt += `: ${c.text}`;
      txt += `\n`;
    });
    txt += `\n`;
  } else if (typeof p.comments === "string" && p.comments) {
    txt += `💬 Comentarios:\n${arrToBullets(p.comments)}\n`;
  }
  txt += "\n";
  return txt;
}

export function generateReportText(projects, weekLabel) {
  const stats   = globalStats(projects);
  const pending = projects.reduce((s,p) => {
    const m = p.manual_metrics||{};
    return s + Math.max(0,(m.total_tasks||0)-(m.completed_tasks||0)-(m.in_progress_tasks||0));
  }, 0);
  const withBlocker = projects.filter(p => (p.impediments||[]).some(im=>im.category==="blocker"));

  let txt = `═══ REPORTE SEMANAL DE PROYECTOS ═══\n${weekLabel}\n\n`;
  txt += `RESUMEN GLOBAL\n${"─".repeat(72)}\n`;
  txt += `${col("Métrica",22)}${col("Valor",18)}Observaciones\n${"─".repeat(72)}\n`;
  txt += `${col("Avance Promedio",22)}${col(Math.round(stats.percent)+"%",18)}Promedio de avance de proyectos activos.\n`;
  txt += `${col("Estado de Tareas",22)}${col(`${stats.completed} de ${stats.total}`,18)}${pending} no iniciado${pending!==1?"s":""}.\n`;
  txt += `${col("Con bloqueantes",22)}${col(withBlocker.length,18)}${withBlocker.length===0?"Sin bloqueantes activos.":withBlocker.map(p=>p.project_name).join(", ")}\n`;
  txt += `${"─".repeat(72)}\n* El porcentaje de avance se calcula según las tareas identificadas.\n\n`;
  projects.forEach((p,i) => { txt += projectBlock(p,i); });
  return txt;
}

export function generateSingleProjectReportText(p, weekLabel) {
  const icon  = STATUS_ICONS[p.status]  || "🟡";
  const label = STATUS_LABELS[p.status] || p.status;
  let txt = `═══ REPORTE DE PROYECTO ═══\n${weekLabel}\n\n`;
  txt += `${icon} ${p.project_name||"Proyecto"}\nEstado: ${label}   |   Fecha: ${p.report_date||"—"}\n`;
  if (p.planner_url) txt += `Planner: ${p.planner_url}\n`;
  txt += "\n";
  txt += projectBlock(p, 0);
  return txt;
}
