// engineers.js — Agregación cross-proyecto para la vista por ingeniero.
// Funciones puras: no tocan React ni el DOM, solo leen projects/engineers ya cargados.

import { buildActivityIndex, getActivityStatus, toISODate, buildHierarchyIndex, ancestorChain, leafActivities } from "./formulas.js";
import { activitiesForWeek, weekRange, nextWeekRange, situationInWeek, activityRange, overlapsWeek, SITUATION, SITUATION_LABEL } from "./weekPlanning.js";
import { ESTADO_ACTIVIDAD_LABEL } from "./filtroOpciones.js";

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
// proyecto, calculado en vivo (ver nota arriba sobre snapshot vs vivo).
export function hasLiveWeeklyTasks(engineerId, project, today = new Date()) {
  return countLiveWeeklyTasks(engineerId, project, today) > 0;
}

// Actividades del ingeniero que caen en la semana actual en ese proyecto.
// Mismo shape que getEngineerActivitiesInProject ({ id, text, position, history })
// para que sea un reemplazo directo en las vistas vivas (ActivitiesTable, etc.).
export function getLiveWeekActivitiesInProject(engineerId, project, today = new Date()) {
  const mine = engineerActivitiesInProject(engineerId, project);
  const range = weekRange(toISODate(today));
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

// Resuelve el estado de una actividad según las listas de project.task_status.
// Prioridad completed > ambiente_produccion > ambiente_pruebas > in_progress >
// not_started — MISMA jerarquía duplicada (a propósito, ver comentario de
// filtroOpciones.js) en activity-detail/shared.js (getActivityStatus),
// formulas/reportText.js (getActivityStatus, devuelve label en español) y
// backend/db/activity-detail.repo.cjs (statusOf) — mantener sincronizadas.
function activityStatusIn(project, actId) {
  const ts = project.task_status || {};
  if ((ts.completed            || []).includes(actId)) return "completed";
  if ((ts.ambiente_produccion  || []).includes(actId)) return "ambiente_produccion";
  if ((ts.ambiente_pruebas     || []).includes(actId)) return "ambiente_pruebas";
  if ((ts.in_progress          || []).includes(actId)) return "in_progress";
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

// { activity, situation, projectName, projectId, number, ancestors } por cada
// actividad del ingeniero, en cualquier proyecto, que caiga en `range`.
//
// number/ancestors: mismo número jerárquico y cadena de tareas padre que
// muestra Planificación (ver activityHierarchy.js) — sin esto, una subtarea
// aparecía en la lista sin ningún indicio de que era parte de una tarea más
// grande, y si esa tarea padre TAMBIÉN caía en el rango (su fecha agregada
// suele cubrir todo el rango de sus hijas), se veían como dos filas sueltas y
// aparentemente iguales. El número + la cadena de padres le dan contexto a
// cada fila sin cambiar CUÁLES actividades se listan.
function engineerActivitiesForRange(engineerId, projects, range, opts) {
  const rows = [];
  getProjectsForEngineer(engineerId, projects).forEach(project => {
    // Solo HOJAS (sin subtareas) — mismo criterio que ya usa el resto de la
    // app para "unidad de trabajo medible" (ver leafActivities,
    // formulas/activityHierarchy.js). Sin este filtro, una tarea padre con
    // fecha agregada (ej. "Mesas de trabajo") aparecía como una fila más,
    // suelta y sin relación aparente con sus propias hijas que también
    // caían en el rango — dos entradas para lo que en realidad es una sola
    // pieza de trabajo jerárquica. El padre sigue siendo visible como
    // contexto (ancestors, más abajo), solo deja de listarse como si fuera
    // él mismo algo para "hacer".
    const leafIds = new Set(leafActivities(project.activities_identified).map(a => a.id));
    const mine = (project.activities_identified || []).filter(a =>
      leafIds.has(a.id) &&
      (a.assigned_engineers || []).some(e => e.id === engineerId || e.engineer_id === engineerId)
    );
    const hIndex = buildHierarchyIndex(project.activities_identified);
    activitiesForWeek(mine, range, project.task_status, opts).forEach(row => {
      rows.push({
        ...row,
        projectName: project.project_name || "Proyecto",
        projectId: project.id,
        number: hIndex.map.get(row.activity.id)?.number || "",
        ancestors: ancestorChain(row.activity.id, hIndex),
      });
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
  return engineerActivitiesForRange(engineerId, projects, weekRange(toISODate(today)));
}

// Tareas de la próxima semana (sin arrastre de vencidas de esta semana, que
// ya se ven en engineerWeekTasks).
export function engineerNextWeekTasks(engineerId, projects, today = new Date()) {
  return engineerActivitiesForRange(
    engineerId, projects, nextWeekRange(toISODate(today)), { includeOverdue: false }
  );
}

// Aplica el orden manual que el propio ingeniero armó a mano (arrastrar y
// soltar en EngineerProjectTable) sobre una lista ya calculada — orderIds es
// un array de activity.id en el orden elegido (engineer.orden_ahora_<sección>
// _<projectId>, ver claves en EngineerHub). Las filas que SÍ están en
// orderIds van primero, en ese orden; el resto (tareas nuevas que el
// ingeniero nunca tocó, o que cambiaron de rango) cae detrás, en el orden
// automático que ya traía `rows` — así una tarea recién aparecida no se cuela
// a mitad de un orden que el ingeniero ya fijó a propósito.
export function applyManualOrder(rows, orderIds) {
  if (!Array.isArray(orderIds) || !orderIds.length) return rows;
  const orderIndex = new Map(orderIds.map((id, i) => [id, i]));
  const known   = rows.filter(r => orderIndex.has(r.activity.id))
    .sort((a, b) => orderIndex.get(a.activity.id) - orderIndex.get(b.activity.id));
  const unknown = rows.filter(r => !orderIndex.has(r.activity.id));
  return [...known, ...unknown];
}

// ── Cola de tareas de UN proyecto, con jerarquía completa (pantalla "mi
// semana" del ingeniero, rediseño por tarjetas — ver EngineerHub) ────────────
// A diferencia de engineerWeekTasks/engineerNextWeekTasks (que solo listan
// hojas, cruzando todos los proyectos, con el breadcrumb de ancestros como
// texto plano dentro de la misma celda), esta función trabaja UN proyecto a
// la vez y devuelve TAMBIÉN los ancestros como filas propias — para que el
// ingeniero vea la tarea global/padre (nivel 0), el nivel intermedio y la
// hoja como renglones separados con su propia tipografía, igual que
// Planificación (HierarchyTable), en vez de un breadcrumb concatenado.

export const QUEUE_SECTION = { THIS_WEEK: "thisWeek", NEXT_WEEK: "nextWeek", LATER: "later" };

export const QUEUE_SECTION_LABEL = {
  [QUEUE_SECTION.THIS_WEEK]: "Esta semana",
  [QUEUE_SECTION.NEXT_WEEK]: "Próxima semana",
  [QUEUE_SECTION.LATER]:     "Más adelante",
};

// Hojas del proyecto asignadas al ingeniero, sin completar — mismo criterio
// que engineerActivitiesForRange (leafActivities + assigned_engineers) y
// buildEngineerWeekKpis (excluye "Completada").
function myPendingLeaves(engineerId, project) {
  const leafIds = new Set(leafActivities(project.activities_identified).map(a => a.id));
  return (project.activities_identified || []).filter(a =>
    leafIds.has(a.id) &&
    (a.assigned_engineers || []).some(e => e.id === engineerId || e.engineer_id === engineerId) &&
    getActivityStatus(project.task_status, a.id) !== "Completada"
  );
}

// A qué sección pertenece una hoja: primero se prueba "esta semana" (con
// arrastre de vencidas, igual que activitiesForWeek), luego "próxima semana"
// (sin arrastre — una vencida ya se contó en "esta semana"), y si ninguna
// aplica, "más adelante" con una situación derivada directamente de sus
// fechas (STARTS si arranca después de la próxima semana, CONTINUES si ya
// venía de antes sin encajar en ninguna, DUE como último recurso).
// situationInWeek(activity, range) por sí sola no basta para decidir en QUÉ
// sección cae una actividad: además del arrastre de vencidas (r.to <
// range.start, que sí es intencional), su rama STARTS solo exige "arranca en
// o después del inicio del rango", SIN techo — una tarea que empieza varias
// semanas más adelante también cumple esa condición. overlapsWeek sí exige
// solapamiento real con el rango.
function classifySection(activity, taskStatus, thisWeek, nextWeek) {
  const r = activityRange(activity);
  if (!r) return null; // sin ninguna fecha: no se puede ubicar, se descarta

  const isCarryOver = r.to < thisWeek.start; // arrastre de vencidas, ver activitiesForWeek
  if (isCarryOver || overlapsWeek(activity, thisWeek)) {
    const s1 = situationInWeek(activity, thisWeek, taskStatus);
    if (s1) return { section: QUEUE_SECTION.THIS_WEEK, situation: s1 };
  }
  if (overlapsWeek(activity, nextWeek)) {
    const s2 = situationInWeek(activity, nextWeek, taskStatus);
    if (s2) return { section: QUEUE_SECTION.NEXT_WEEK, situation: s2 };
  }

  const situation = r.from > nextWeek.end ? SITUATION.STARTS : SITUATION.CONTINUES;
  return { section: QUEUE_SECTION.LATER, situation };
}

/**
 * Cola de tareas del ingeniero en UN proyecto, con jerarquía completa lista
 * para render: por cada hoja pendiente, además de su propia fila se insertan
 * (una sola vez, aunque varias hojas compartan padre) las filas de sus
 * ancestros, inmediatamente antes de la primera hoja descendiente que
 * aparece en esa sección — así el ingeniero ve de qué tarea global/objetivo
 * viene cada pendiente sin que la tabla repita el mismo padre N veces.
 *
 * @returns {{ thisWeek: Row[], nextWeek: Row[], later: Row[] }}
 *   Row = { activity, level, number, isLeaf, situation (null en ancestros) }
 */
export function buildEngineerProjectQueue(engineerId, project, today = new Date()) {
  const thisWeek = weekRange(toISODate(today));
  const nextWeek = nextWeekRange(toISODate(today));
  const hIndex = buildHierarchyIndex(project.activities_identified);

  const bySection = { [QUEUE_SECTION.THIS_WEEK]: [], [QUEUE_SECTION.NEXT_WEEK]: [], [QUEUE_SECTION.LATER]: [] };

  myPendingLeaves(engineerId, project).forEach(activity => {
    const classified = classifySection(activity, project.task_status, thisWeek, nextWeek);
    if (!classified) return;
    bySection[classified.section].push({ activity, situation: classified.situation });
  });

  const result = {};
  Object.entries(bySection).forEach(([section, leaves]) => {
    // Prioridad: fecha de fin ascendente (la más próxima primero) — mismo
    // criterio confirmado por el usuario ("organizar de acuerdo a su fecha
    // de fin para saber cuál priorizar").
    leaves.sort((a, b) => (a.activity.due_date || a.activity.start_date || "")
      .localeCompare(b.activity.due_date || b.activity.start_date || ""));

    const emitted = new Set();
    const rows = [];
    leaves.forEach(({ activity, situation }) => {
      ancestorChain(activity.id, hIndex).forEach(anc => {
        if (emitted.has(anc.id)) return;
        emitted.add(anc.id);
        const info = hIndex.map.get(anc.id);
        rows.push({ activity: hIndex.byId.get(anc.id), level: info?.level ?? 0, number: anc.number, isLeaf: false, situation: null });
      });
      const info = hIndex.map.get(activity.id);
      rows.push({ activity, level: info?.level ?? 0, number: info?.number || "", isLeaf: true, situation });
    });
    result[section] = rows;
  });

  return result;
}

// Filtra una cola ya construida (buildEngineerProjectQueue) a solo las hojas
// que matchean `filterKey`, conservando los ancestros de contexto que esas
// hojas todavía necesitan (mismo patrón de "propagar el match hacia arriba"
// que ya usa HierarchyTable, pero aquí sobre filas ya aplanadas en vez de
// sobre el árbol completo). Una sección sin ninguna hoja que matchee queda
// como array vacío — la tabla la renderiza sin filas, no la oculta (así el
// ingeniero ve que ese proyecto no tiene nada en esa condición, en vez de que
// el proyecto entero desaparezca de la vista).
export function filterEngineerProjectQueue(queue, filterKey, todayIso) {
  if (!filterKey) return queue;

  const matchesFilter = (row) => {
    if (!row.isLeaf) return false;
    if (filterKey === "overdue")  return row.situation === SITUATION.OVERDUE;
    if (filterKey === "dueToday") return row.activity.due_date === todayIso;
    return true; // filterKey === "thisWeek": ya viene resuelto por la sección
  };

  const result = {};
  Object.entries(queue).forEach(([section, rows]) => {
    const keepIds = new Set(rows.filter(matchesFilter).map(r => r.activity.id));
    if (!keepIds.size) { result[section] = []; return; }

    // Un ancestro se conserva si alguna hoja que sobrevivió al filtro está
    // "debajo" de él en la lista ya aplanada (entre su propia posición y la
    // del siguiente ancestro/hoja del mismo nivel) — más simple: como las
    // filas ya vienen intercaladas (ancestro justo antes de su primera hoja
    // visible), basta con recorrer de atrás hacia adelante y arrastrar el
    // "necesito este ancestro" hacia arriba mientras el nivel decrece.
    const kept = [];
    let needLevel = Infinity;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (row.isLeaf) {
        if (keepIds.has(row.activity.id)) { kept.unshift(row); needLevel = row.level; }
        continue;
      }
      if (row.level < needLevel) { kept.unshift(row); needLevel = row.level; }
    }
    result[section] = kept;
  });
  return result;
}

// ── Exportar la cola a Markdown (tabla) ───────────────────────────────────────
// Una tabla por sección, en el orden EXACTO que el ingeniero ya armó (manual
// o automático, da igual — recibe las filas ya ordenadas tal como se ven en
// pantalla). fecha sin formatear a propósito (ISO): esto es para pegar en un
// chat/nota/issue, no para imprimir.
//
// "|" en el texto de una actividad rompería la tabla si no se escapa —
// escMd() lo neutraliza (y colapsa saltos de línea, que igual rompen una fila).
function escMd(s) {
  return String(s || "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

// Tabla markdown de UNA sección de una cola (buildEngineerProjectQueue): cada
// fila lleva su número jerárquico y su texto indentado con "—" según el
// nivel, para que un ancestro (isLeaf:false) se distinga de una hoja incluso
// en texto plano. La columna Situación queda vacía en las filas de ancestro
// (no tienen situación propia, son solo contexto).
function mdTableForQueueSection(rows) {
  const header = "| N° | Actividad | Inicio | Fin | Situación |";
  const sep    = "|---|---|---|---|---|";
  const body = rows.map(row => {
    const indent = row.level > 0 ? "—".repeat(row.level) + " " : "";
    const actividad = `${indent}${escMd(row.activity.text) || "(sin nombre)"}`;
    const inicio = row.activity.start_date || "?";
    const fin = row.activity.due_date || "?";
    const situacion = row.isLeaf ? (SITUATION_LABEL[row.situation] || row.situation || "") : "";
    return `| ${row.number} | ${actividad} | ${inicio} | ${fin} | ${situacion} |`;
  });
  return [header, sep, ...body].join("\n");
}

/**
 * Exporta una o más colas de proyecto (buildEngineerProjectQueue) a Markdown,
 * una sección `## Proyecto` por proyecto y, dentro, una sub-sección `###` por
 * cada QUEUE_SECTION_LABEL (Esta semana / Próxima semana / Más adelante) —
 * misma estructura que se ve en pantalla (EngineerProjectTable), para que lo
 * descargado coincida con lo que el ingeniero ya revisó.
 *
 * @param {string} engineerName
 * @param {{ project: object, queue: ReturnType<typeof buildEngineerProjectQueue> }[]} projectQueues
 */
export function buildEngineerQueueMarkdown(engineerName, projectQueues) {
  const titulo = projectQueues.length === 1
    ? `Mis tareas — ${engineerName} — ${projectQueues[0].project.project_name || "Proyecto"}`
    : `Mis tareas — ${engineerName}`;
  const lines = [`# ${titulo}`, ""];

  projectQueues.forEach(({ project, queue }) => {
    lines.push(`## ${project.project_name || "Proyecto"}`, "");
    [QUEUE_SECTION.THIS_WEEK, QUEUE_SECTION.NEXT_WEEK, QUEUE_SECTION.LATER].forEach(section => {
      const rows = queue[section] || [];
      lines.push(`### ${QUEUE_SECTION_LABEL[section]}`, "");
      if (!rows.length) {
        lines.push("_Sin actividades._", "");
      } else {
        lines.push(mdTableForQueueSection(rows), "");
      }
    });
  });

  return lines.join("\n");
}

// ── KPIs accionables + "qué hacer ahora" (pantalla "mi semana", EngineerHub) ──
// A partir de las filas de engineerWeekTasks (que SÍ incluyen completadas
// on-time — activitiesForWeek solo excluye vencidas-ya-completadas), arma los
// contadores de la franja de KPIs y la lista priorizada de trabajo pendiente:
// vencidas primero, luego el resto por fecha de entrega ascendente.
export function buildEngineerWeekKpis(rows, projects, today = new Date()) {
  const todayIso = toISODate(today);
  const projectById = new Map((projects || []).map(p => [p.id, p]));

  const pendingRows = rows.filter(row => {
    const project = projectById.get(row.projectId);
    return getActivityStatus(project?.task_status, row.activity.id) !== "Completada";
  });

  const overdue = pendingRows.filter(r => r.situation === SITUATION.OVERDUE).length;
  const dueToday = pendingRows.filter(r => r.activity.due_date === todayIso).length;

  // Urgente (marca manual del propio ingeniero sobre la actividad — ver
  // App.jsx toggleActivityUrgent) manda sobre todo lo demás, incluida una
  // vencida. Así una tarea marcada urgente siempre es la que sale de primera
  // ("Foco"), y al desmarcarla o completarla la cola vuelve sola al orden que
  // ya tenía (vencidas → fecha ascendente) sin que haya que recordar nada.
  const todo = [...pendingRows].sort((a, b) => {
    const aUrgent = a.activity.es_urgente === true;
    const bUrgent = b.activity.es_urgente === true;
    if (aUrgent !== bUrgent) return aUrgent ? -1 : 1;
    const aOverdue = a.situation === SITUATION.OVERDUE;
    const bOverdue = b.situation === SITUATION.OVERDUE;
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    const da = a.activity.due_date || a.activity.start_date || "";
    const db = b.activity.due_date || b.activity.start_date || "";
    return da.localeCompare(db);
  });

  return { overdue, dueToday, thisWeek: rows.length, pending: pendingRows.length, todo };
}

// ── Conteo agregado + vencidas históricas (hero del dashboard del ingeniero) ──
// Distinto de buildEngineerWeekKpis a propósito: ese mide la ventana semanal
// actual; esto mide TODA la carga del ingeniero en TODOS sus proyectos, sin
// importar cuándo cae la fecha — completadas/en proceso/no iniciadas +
// vencidas históricas (fecha de fin pasada, sin completar, sin importar si
// cae en la semana actual o hace meses). Se apoyan en la misma fuente de
// verdad que getAllAssignedActivitiesInProject (assigned_engineers +
// activityStatusIn), pero necesitan due_date/start_date, que ese shape no
// expone — se recorren las actividades del proyecto directo.
export function buildEngineerTotals(engineerId, projects, today = new Date()) {
  const todayIso = toISODate(today);
  let completed = 0, inProgress = 0, notStarted = 0, overdue = 0;

  getProjectsForEngineer(engineerId, projects).forEach(project => {
    engineerActivitiesInProject(engineerId, project).forEach(a => {
      const status = activityStatusIn(project, a.id);
      if (status === "completed") { completed++; return; }

      if (status === "in_progress") inProgress++;
      else notStarted++;

      // Una actividad ya en Ambiente Pruebas/Producción no cuenta como
      // vencida aunque su due_date original haya pasado: lo pendiente ahí es
      // el paso de despliegue, no "más tiempo de desarrollo" — mismo criterio
      // que TaskStatusSelector (Kanban) aplica al badge de demora.
      const isEnvironment = status === "ambiente_pruebas" || status === "ambiente_produccion";
      if (!isEnvironment) {
        const due = a.due_date || a.start_date;
        if (due && due < todayIso) overdue++;
      }
    });
  });

  return { completed, inProgress, notStarted, overdue, total: completed + inProgress + notStarted };
}

// ── Reporte por ingeniero (texto plano para copiar) ───────────────────────────

const STATUS_TXT = ESTADO_ACTIVIDAD_LABEL;
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
