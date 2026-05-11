export function projectProgress(total, completed, inProgress) {
  if (!total || total <= 0) return 0;
  const score = (Number(completed) * 1) + (Number(inProgress) * 0.5);
  return Math.min((score / Number(total)) * 100, 100);
}

export function globalProgress(projects) {
  const active = projects.filter(p => Number(p.totalActivities || 0) > 0);
  if (active.length === 0) return 0;
  const sum = active.reduce((s, p) =>
    s + projectProgress(p.totalActivities, p.completedActivities, p.inProgressActivities), 0);
  return sum / active.length;
}

export function globalStats(projects) {
  const total      = projects.reduce((s, p) => s + Number(p.totalActivities    || 0), 0);
  const completed  = projects.reduce((s, p) => s + Number(p.completedActivities || 0), 0);
  const inProgress = projects.reduce((s, p) => s + Number(p.inProgressActivities || 0), 0);
  return { total, completed, inProgress, percent: globalProgress(projects) };
}

export function getWeekLabel() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const week  = Math.ceil((now - start) / 604800000);
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `Semana ${week} — ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;
}

// ── Helpers internos de reporte ──────────────────────────────────────────────

function col(str, w) { return String(str).padEnd(w); }

function textToBullets(text) {
  if (!text) return "";
  return text.split("\n").filter(l => l.trim()).map(l => `  • ${l.trim()}`).join("\n");
}

const STATUS_LABELS = { "on-track": "En curso", "at-risk": "En riesgo", blocked: "Bloqueado", completed: "Completado" };
const STATUS_ICONS  = { "on-track": "🟡", "at-risk": "🟠", blocked: "🔴", completed: "🟢" };

function reportProjectBlock(p, i) {
  const pct      = Math.round(projectProgress(p.totalActivities, p.completedActivities, p.inProgressActivities));
  const pPending = Math.max(0, p.totalActivities - p.completedActivities - p.inProgressActivities);
  const icon     = STATUS_ICONS[p.status]  || "🟡";
  const label    = STATUS_LABELS[p.status] || p.status;

  let txt = `──── ${icon} ${p.name || `Proyecto ${i + 1}`} ────\n`;
  txt += `Estado: ${label}\n`;
  if (p.plannerUrl) txt += `Planner: ${p.plannerUrl}\n`;
  txt += "\n";

  txt += `${"─".repeat(72)}\n`;
  txt += `${col("Métrica", 22)}${col("Valor", 18)}Observaciones\n`;
  txt += `${"─".repeat(72)}\n`;
  txt += `${col("Avance", 22)}${col(pct + "%", 18)}${p.completedActivities} completadas · ${p.inProgressActivities} en proceso (basado en tareas identificadas).\n`;
  txt += `${col("Estado de Tareas", 22)}${col(`${p.completedActivities} de ${p.totalActivities}`, 18)}${pPending} no iniciado${pPending !== 1 ? "s" : ""}${pPending === 0 ? " — todo completado." : "."}\n`;
  txt += `${col("Riesgos Activos", 22)}${col(p.blockers ? 1 : 0, 18)}${p.blockers ? p.blockers.split("\n").filter(Boolean)[0] : "Sin bloqueantes."}\n`;
  txt += `${"─".repeat(72)}\n\n`;

  if (p.indicators && p.indicators.length > 0) {
    txt += `INDICADORES\n`;
    txt += `${"─".repeat(88)}\n`;
    txt += `${col("Indicador", 28)}${col("Avance", 10)}${col("Total", 9)}${col("Completadas", 14)}${col("En proceso", 13)}No iniciadas\n`;
    txt += `${"─".repeat(88)}\n`;
    p.indicators.forEach(ind => {
      const indPct    = Math.round(projectProgress(ind.total, ind.completed, ind.inProgress));
      const indNoInit = Math.max(0, ind.total - ind.completed - ind.inProgress);
      txt += `${col(ind.name || "—", 28)}${col(indPct + "%", 10)}${col(ind.total, 9)}${col(ind.completed, 14)}${col(ind.inProgress, 13)}${indNoInit}\n`;
    });
    txt += `${"─".repeat(88)}\n\n`;
  }

  if (p.engineers && p.engineers.length > 0) {
    const sharedTasks   = Number(p.sharedTasks || 0);
    const assignedTotal = p.engineers.reduce((s, e) => s + Number(e.assigned || 0), 0);
    txt += `INGENIEROS — GLOBAL\n`;
    txt += `${"─".repeat(88)}\n`;
    txt += `${col("Ingeniero", 28)}${col("Asignadas", 12)}${col("Completadas", 14)}${col("En proceso", 13)}No iniciadas\n`;
    txt += `${"─".repeat(88)}\n`;
    p.engineers.forEach(eng => {
      const engName = eng.name === "Otro..." ? (eng.customName || "—") : (eng.name || "—");
      const noInit  = Math.max(0, eng.assigned - eng.completed - eng.inProgress);
      txt += `${col(engName, 28)}${col(eng.assigned, 12)}${col(eng.completed, 14)}${col(eng.inProgress, 13)}${noInit}\n`;
    });
    if (sharedTasks > 0) {
      txt += `${"─".repeat(88)}\n`;
      txt += `${col("Tareas compartidas (descuento)", 28)}${col("-" + sharedTasks, 12)}\n`;
      txt += `${col("Total real", 28)}${col(assignedTotal - sharedTasks, 12)}\n`;
    }
    txt += `${"─".repeat(88)}\n\n`;

    const hasWeekData = p.engineers.some(e => e.weekTotal > 0 || e.weekActivities);
    if (hasWeekData) {
      txt += `INGENIEROS — ESTA SEMANA\n`;
      txt += `${"─".repeat(60)}\n`;
      txt += `${col("Ingeniero", 28)}Tareas sem.\n`;
      txt += `${"─".repeat(60)}\n`;
      p.engineers.forEach(eng => {
        if (!eng.weekTotal && !eng.weekActivities) return;
        const engName = eng.name === "Otro..." ? (eng.customName || "—") : (eng.name || "—");
        txt += `${col(engName, 28)}${eng.weekTotal || 0}\n`;
        if (eng.weekActivities) txt += `${textToBullets(eng.weekActivities)}\n`;
      });
      txt += `${"─".repeat(60)}\n\n`;
    }
  }

  if (p.activitiesOfTheWeek) txt += `• Actividades Identificadas:\n${textToBullets(p.activitiesOfTheWeek)}\n`;
  if (p.pendingActivities)   txt += `• Actividades no iniciadas:\n${textToBullets(p.pendingActivities)}\n`;
  if (p.blockers)            txt += `⚠ Bloqueantes:\n${textToBullets(p.blockers)}\n`;
  if (p.blockers && p.blockersImpact) txt += `• Impacto de los bloqueantes:\n${textToBullets(p.blockersImpact)}\n`;
  if (p.nonConformances)     txt += `⚠ Salidas no conformes:\n${textToBullets(p.nonConformances)}\n`;
  if (p.risks)               txt += `⚠ Riesgos:\n${textToBullets(p.risks)}\n`;
  if (p.showFridayFields) {
    if (p.weekAccomplishments) txt += `✓ Qué se hizo esta semana:\n${textToBullets(p.weekAccomplishments)}\n`;
    if (p.weekPlanned)         txt += `→ Plan para la próxima semana:\n${textToBullets(p.weekPlanned)}\n`;
  }
  if (p.keyDates)  txt += `📅 Fechas clave:\n${textToBullets(p.keyDates)}\n`;
  if (p.comments)  txt += `💬 Comentarios:\n${textToBullets(p.comments)}\n`;
  txt += "\n";

  return txt;
}

export function generateReportText(projects, weekLabel) {
  const stats   = globalStats(projects);
  const pending = projects.reduce(
    (s, p) => s + Math.max(0, p.totalActivities - p.completedActivities - p.inProgressActivities), 0
  );
  const blockedProjects = projects.filter(p => p.blockers);
  const avgPct = Math.round(stats.percent);

  let txt = `═══ REPORTE SEMANAL DE PROYECTOS ═══\n${weekLabel}\n\n`;
  txt += `RESUMEN GLOBAL\n`;
  txt += `${"─".repeat(72)}\n`;
  txt += `${col("Métrica", 22)}${col("Valor", 18)}Observaciones\n`;
  txt += `${"─".repeat(72)}\n`;
  txt += `${col("Avance Promedio", 22)}${col(avgPct + "%", 18)}Promedio de avance de proyectos activos (con tareas).\n`;
  txt += `${col("Estado de Tareas", 22)}${col(`${stats.completed} de ${stats.total}`, 18)}${pending} no iniciado${pending !== 1 ? "s" : ""}.\n`;
  txt += `${col("Riesgos Activos", 22)}${col(blockedProjects.length, 18)}${
    blockedProjects.length === 0 ? "Sin bloqueantes activos." : blockedProjects.map(p => p.name).join(", ")
  }\n`;
  txt += `${"─".repeat(72)}\n`;
  txt += `* El porcentaje de avance se calcula según las tareas identificadas.\n\n`;

  projects.forEach((p, i) => { txt += reportProjectBlock(p, i); });
  return txt;
}

export function generateSingleProjectReportText(p, weekLabel) {
  const icon  = STATUS_ICONS[p.status]  || "🟡";
  const label = STATUS_LABELS[p.status] || p.status;

  let txt = `═══ REPORTE DE PROYECTO ═══\n${weekLabel}\n\n`;
  txt += `${icon} ${p.name || "Proyecto"}\nEstado: ${label}\n`;
  if (p.plannerUrl) txt += `Planner: ${p.plannerUrl}\n`;
  txt += "\n";
  txt += `* El porcentaje de avance se calcula según las tareas identificadas.\n\n`;
  txt += reportProjectBlock(p, 0);
  return txt;
}

export function createDefaultProject() {
  return {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: "",
    totalActivities: 0,
    completedActivities: 0,
    inProgressActivities: 0,
    activitiesOfTheWeek: "",
    pendingActivities: "",
    blockers: "",
    blockersImpact: "",
    weekAccomplishments: "",
    weekPlanned: "",
    keyDates: "",
    plannerUrl: "",
    status: "on-track",
    showFridayFields: false,
    engineers: [],
    sharedTasks: 0,
    indicators: [],
    nonConformances: "",
    risks: "",
    comments: "",
  };
}
