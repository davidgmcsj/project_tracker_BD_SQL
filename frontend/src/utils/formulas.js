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

// Formatea "YYYY-MM-DD" a "DD/MM/YYYY". Vacío → "—".
export function formatDateDMY(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
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
    priority:     false,   // proyecto prioritario (marca de estrella ⭐) para filtrar en Reporte
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
  return {
    id: genActivityId(),
    text,
    assigned_engineers: [],
    assigned_date: null,
    start_date: "",
    due_date: "",
    description: "",
    objectives: "",
    solution: "",
    progress: 0,          // % de cumplimiento manual (0-100)
    planned_hours: 0,     // horas planeadas (manual)
    checklist: [],
    notes: [],
    key_dates: [],
    attachments: [],      // metadata de adjuntos (bytes en SQL)
    planner_task_number: null, // "Número de tarea" de Planner (clave estable de sync). null = creada a mano.
    archived: false,      // true si desapareció de Planner en una importación (oculta, recuperable)
    archived_reason: "",  // motivo del archivado (p. ej. fecha de la importación que la retiró)
  };
}

// ── Actividades archivadas ────────────────────────────────────────────────────
// Una actividad archivada (archived: true) desapareció del Planner en una
// importación pero NO se borra: se oculta de listas, métricas y reportes, y
// queda recuperable en activities_identified. isArchived tolera actividades
// antiguas que aún no tienen el campo (undefined → false).

export const isArchived = (a) => !!a && a.archived === true;

export function visibleActivities(acts) {
  return (Array.isArray(acts) ? acts : []).filter(a => !isArchived(a));
}

// ── Cálculo de horas hábiles ──────────────────────────────────────────────────
// Cuenta días hábiles (lun-vie, excluyendo festivos de Colombia) entre dos fechas
// inclusive y multiplica por la jornada. Sirve para SUGERIR horas planeadas.

const HOURS_PER_DAY = 8;

// Festivos de Colombia. Formato "MM-DD" para los fijos + fechas completas para
// los que dependen del año (Semana Santa, etc.). Actualizar por año según cambien.
// Para simplicidad usamos un set de fechas completas "YYYY-MM-DD" que cubre los
// años en uso; los fijos se generan por año on-the-fly.
const FIXED_HOLIDAYS_MMDD = [
  "01-01", // Año nuevo
  "05-01", // Día del trabajo
  "07-20", // Independencia
  "08-07", // Batalla de Boyacá
  "12-08", // Inmaculada Concepción
  "12-25", // Navidad
];

// Festivos móviles / trasladables por año (Ley Emiliani y Semana Santa).
// Se pueden ampliar por año. Vacío por defecto = solo se usan los fijos.
const MOVABLE_HOLIDAYS = {
  2026: [
    "01-12","03-23","03-30","04-02","04-03","05-18","06-08","06-15",
    "06-29","08-17","10-12","11-02","11-16",
  ],
};

function isColombianHoliday(date) {
  const mmdd = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (FIXED_HOLIDAYS_MMDD.includes(mmdd)) return true;
  const year = date.getFullYear();
  return (MOVABLE_HOLIDAYS[year] || []).includes(mmdd);
}

// Devuelve el número de días hábiles entre start y due (ambos inclusive).
export function businessDaysBetween(startStr, dueStr) {
  if (!startStr || !dueStr) return 0;
  const start = new Date(startStr + "T12:00:00");
  const end   = new Date(dueStr   + "T12:00:00");
  if (isNaN(start) || isNaN(end) || end < start) return 0;
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6 && !isColombianHoliday(cur)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// Horas hábiles sugeridas = días hábiles × jornada.
export function suggestedWorkHours(startStr, dueStr, hoursPerDay = HOURS_PER_DAY) {
  return businessDaysBetween(startStr, dueStr) * hoursPerDay;
}

// Suma de horas planeadas de todas las actividades del proyecto.
export function totalPlannedHours(activities) {
  return (Array.isArray(activities) ? activities : [])
    .reduce((s, a) => s + (Number(a.planned_hours) || 0), 0);
}

// Promedio de % de cumplimiento sobre las actividades que tienen fechas o progreso.
// Devuelve null si no hay ninguna actividad con progreso definido.
export function avgActivityProgress(activities) {
  const acts = (Array.isArray(activities) ? activities : [])
    .filter(a => a.start_date || a.due_date || Number(a.progress) > 0);
  if (!acts.length) return null;
  const sum = acts.reduce((s, a) => s + (Number(a.progress) || 0), 0);
  return Math.round(sum / acts.length);
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

export function genChecklistItemId() {
  return "chk_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export const createChecklistItem = (text = "") => ({ id: genChecklistItemId(), text, done: false });

export function genKeyDateId() {
  return "kd_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
export const createKeyDate = (date = "", label = "") => ({ id: genKeyDateId(), date, label });
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

export function genExternalContactId() {
  return "ext_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function createExternalContact(name = "", company = "") {
  return { id: genExternalContactId(), name, company, active: true, created_at: getToday() };
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
  // Modelo rico, análogo a una actividad de proyecto pero con estado + fechas
  // dentro de la propia tarea (no en un task_status externo).
  // history: fechas de las 3 transiciones de estado (added = inscrita).
  // Se auto-registran al cambiar de estado. `date` se conserva por
  // compatibilidad con tareas creadas antes de que existiera el historial.
  return {
    id: genEngineerTaskId(),
    description,
    status: "not_started",
    date: "",
    history: { added: getToday(), in_progress: "", completed: "" },
    detail:        "",
    objectives:    "",
    solution:      "",
    start_date:    "",
    due_date:      "",
    progress:      0,
    planned_hours: 0,
    checklist:     [],
    notes:         [],
    key_dates:     [],
  };
}

// Normaliza una tarea (posiblemente antigua) al modelo rico completo, sin perder
// datos existentes. Úsalo al abrir el modal para garantizar todos los campos.
export function normalizeEngineerTask(task) {
  const t = task || {};
  return {
    id:            t.id || genEngineerTaskId(),
    description:   t.description || "",
    status:        t.status || "not_started",
    date:          t.date || "",
    history:       { added: t.date || "", in_progress: "", completed: "", ...(t.history || {}) },
    detail:        t.detail || "",
    objectives:    t.objectives || "",
    solution:      t.solution || "",
    start_date:    t.start_date || "",
    due_date:      t.due_date || "",
    progress:      Number(t.progress) || 0,
    planned_hours: Number(t.planned_hours) || 0,
    checklist:     Array.isArray(t.checklist) ? t.checklist : [],
    notes:         Array.isArray(t.notes)     ? t.notes     : [],
    key_dates:     Array.isArray(t.key_dates) ? t.key_dates : [],
  };
}

// Aplica un cambio de estado a una tarea suelta, auto-registrando la fecha de la
// transición si es la primera vez que se alcanza ese estado. Devuelve la tarea nueva.
// Normaliza tareas antiguas que aún no tienen `history`.
export function applyEngineerTaskStatus(task, newStatus) {
  const history = { added: "", in_progress: "", completed: "", ...(task.history || {}) };
  if (!history.added) history.added = task.date || getToday();
  if (newStatus === "in_progress" && !history.in_progress) history.in_progress = getToday();
  if (newStatus === "completed") {
    if (!history.in_progress) history.in_progress = getToday();
    if (!history.completed)   history.completed   = getToday();
  }
  return { ...task, status: newStatus, history };
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

export function getActivityStatus(ts, actId) {
  if (!ts) return "No iniciada";
  if (Array.isArray(ts.completed) && ts.completed.includes(actId)) return "Completada";
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
