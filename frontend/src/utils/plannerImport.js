// plannerImport.js — Motor de importación del Excel exportado de Microsoft Planner.
//
// Todo aquí es PURO (sin React, sin DOM) y testeable de forma aislada.
// Flujo: parsePlannerWorkbook(arrayBuffer) → filas normalizadas →
//        mergePlannerImport(...) → { activities, task_status, ... } listo para persistir.
//
// Política de sincronización (decidida con el usuario):
//   • El Excel MANDA en los campos que vienen de Planner: nombre, responsable,
//     fechas, % avance, esfuerzo y estado (depósito/bucket).
//   • La app CONSERVA lo que solo vive en ella: objetivos, solución, checklist,
//     notas, fechas clave, adjuntos. Nunca se tocan.
//   • Se emparejan tareas por "Número de tarea" de Planner (planner_task_number).
//   • Tarea que estaba en la app y ya no está en el Excel → se ARCHIVA (no se borra).
//   • Actividad creada a mano en la app (sin planner_task_number) → intacta, nunca se archiva.
//
// Nota: la librería xlsx (SheetJS, ~590 KB) se carga de forma DINÁMICA solo cuando
// el usuario importa un archivo, para no engordar el bundle inicial de la app.

// ── Constantes de mapeo ───────────────────────────────────────────────────────

const SHEET_NAME = "Tareas de proyecto";

// Etiquetas de columna de Planner (en español) → clave interna. Se emparejan por
// texto normalizado del encabezado, no por posición fija (el export tiene columnas
// intermedias que no usamos).
const COLUMN_LABELS = {
  "numero de tarea": "task_number",
  "nombre":          "text",
  "asignado a":      "assignees",
  "inicio":          "start",
  "finalizacion":    "finish",
  "esfuerzo":        "effort",
  "deposito":        "bucket",
  "% completado":    "progress",
  "notas":           "notes",
};

// Depósito (bucket) de Planner → estado de actividad de la app.
// Todos los planes usan los mismos depósitos: "Tareas Identificadas",
// "Tareas en Ejecución", "Tareas Completadas", "Reuniones" y
// "Actividades en seguimiento". Se conservan las variantes antiguas
// ("Actividades ...") por compatibilidad con exports previos.
const BUCKET_TO_STATUS = {
  // Nombres reales de los depósitos de Planner
  "tareas completadas":        "completed",
  "tareas en ejecucion":       "in_progress",
  "tareas identificadas":      "not_started",
  "actividades en seguimiento": "in_progress",
  // Variantes antiguas (compatibilidad)
  "actividades completadas":   "completed",
  "actividades en ejecucion":  "in_progress",
  "actividad identificadas":   "not_started",
  "actividades identificadas": "not_started",
};

// Depósitos cuyo estado se resuelve por el % completado en lugar de una
// correspondencia fija. Las Reuniones son actividades que se marcan como
// completadas al 100%; con avance parcial quedan en proceso.
const PROGRESS_BASED_BUCKETS = new Set(["reuniones"]);

// Estado derivado del % de avance: 100 → completada, 1-99 → en proceso, 0 → no iniciada.
function statusFromProgress(progress) {
  if (progress >= 100) return "completed";
  if (progress > 0) return "in_progress";
  return "not_started";
}

// ── Utilidades de normalización y parseo de celdas ────────────────────────────

// Quita tildes, pasa a minúsculas, recorta y colapsa espacios. Base para
// emparejar encabezados, depósitos y nombres de ingenieros de forma robusta.
export function normalizeName(name) {
  return String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// Serial de fecha de Excel → "YYYY-MM-DD". Vacío / no numérico → "".
// Math en UTC para evitar corrimientos de un día por zona horaria local.
export function excelSerialToDate(serial) {
  if (serial === "" || serial == null || typeof serial !== "number" || !isFinite(serial)) return "";
  const ms = Math.floor(serial - 25569) * 86400 * 1000;
  const d  = new Date(ms);
  if (isNaN(d)) return "";
  return d.toISOString().slice(0, 10);
}

// "24 horas" | "8 h" | "12,5 horas" | 24 → Number. Sin número reconocible → 0.
export function parseEsfuerzo(raw) {
  if (typeof raw === "number" && isFinite(raw)) return raw;
  const m = String(raw ?? "").match(/(\d+([.,]\d+)?)/);
  if (!m) return 0;
  return Number(m[1].replace(",", "."));
}

// "% completado" decimal (0.16) → entero 0-100 (16). También tolera 16 o "16%".
export function parseProgress(raw) {
  if (raw === "" || raw == null) return 0;
  let n = typeof raw === "number" ? raw : Number(String(raw).replace(/[%\s]/g, "").replace(",", "."));
  if (!isFinite(n)) return 0;
  if (n <= 1) n = n * 100; // decimal de Planner (0.16) → porcentaje
  return Math.max(0, Math.min(100, Math.round(n)));
}

// "Tareas en Ejecución" → "in_progress". Desconocido → "not_started".
// Para depósitos basados en avance (Reuniones), el estado sale del % completado:
// una reunión al 100% queda completada, con avance parcial en proceso.
export function bucketToStatus(deposito, progress = 0) {
  const key = normalizeName(deposito);
  if (PROGRESS_BASED_BUCKETS.has(key)) return statusFromProgress(progress);
  return BUCKET_TO_STATUS[key] || "not_started";
}

// "Nombre Uno, Nombre Dos" → ["Nombre Uno", "Nombre Dos"]. Vacío → [].
export function parseAssignees(raw) {
  return String(raw ?? "")
    .split(/[,;]/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ── Parseo del libro completo ─────────────────────────────────────────────────

// Construye un mapa { clave interna → índice de columna } a partir de la fila de
// encabezados, emparejando por texto normalizado. Devuelve null si no reconoce
// al menos "task_number" y "text" (fila de encabezados no válida).
function buildColumnMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((cell, idx) => {
    const key = COLUMN_LABELS[normalizeName(cell)];
    if (key && map[key] === undefined) map[key] = idx;
  });
  return (map.task_number !== undefined && map.text !== undefined) ? map : null;
}

// Localiza la fila de encabezados de tareas escaneando las primeras filas (el
// export tiene 0-6 metadata + fila 7 vacía + fila 8 encabezados, pero escaneamos
// por si Planner cambia el número de filas de metadata).
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const colMap = buildColumnMap(rows[i]);
    if (colMap) return { headerIndex: i, colMap };
  }
  return null;
}

// Lee metadata del proyecto (filas 0..headerIndex) escaneando la etiqueta en la
// columna A en vez de celdas fijas, para tolerar cambios de layout.
function readProjectMeta(rows, headerIndex) {
  const meta = {};
  for (let i = 0; i < headerIndex; i++) {
    const label = normalizeName(rows[i]?.[0]);
    const value = rows[i]?.[1];
    if (label === "nombre del proyecto") meta.name = String(value ?? "").trim();
    else if (label === "propietario del plan") meta.owner = String(value ?? "").trim();
  }
  return meta;
}

// arrayBuffer del .xlsx → { rows: NormalizedRow[], projectMeta, errors[] }.
// NormalizedRow: { planner_task_number, text, assigneeNames[], start_date,
//   due_date, progress, planned_hours, status, notes_raw, _rowIndex }.
export async function parsePlannerWorkbook(arrayBuffer) {
  const errors = [];
  const XLSX = await import("xlsx"); // carga diferida: solo al importar un archivo
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  let sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    const firstName = wb.SheetNames[0];
    sheet = wb.Sheets[firstName];
    errors.push(`No se encontró la hoja "${SHEET_NAME}"; se usó "${firstName}".`);
  }
  if (!sheet) {
    return { rows: [], projectMeta: {}, errors: ["El archivo no contiene hojas legibles."] };
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  const header = findHeaderRow(rows);
  if (!header) {
    return {
      rows: [], projectMeta: {},
      errors: ["No se reconoció la fila de encabezados de Planner (columnas 'Número de tarea' y 'Nombre'). ¿El archivo es un export de Planner?"],
    };
  }

  const { headerIndex, colMap } = header;
  const projectMeta = readProjectMeta(rows, headerIndex);
  const cell = (row, key) => (colMap[key] !== undefined ? row[colMap[key]] : "");

  const out = [];
  const seenNumbers = new Set();

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!Array.isArray(row) || row.every(c => c === "" || c == null)) continue; // fila vacía

    const taskNumber = String(cell(row, "task_number") ?? "").trim();
    const text       = String(cell(row, "text") ?? "").trim();

    if (!taskNumber && !text) { // malformada: sin número ni nombre
      errors.push(`Fila ${i + 1} ignorada: sin número de tarea ni nombre.`);
      continue;
    }
    if (taskNumber && seenNumbers.has(taskNumber)) {
      errors.push(`Número de tarea duplicado "${taskNumber}" (fila ${i + 1}) ignorado.`);
      continue;
    }
    if (taskNumber) seenNumbers.add(taskNumber);

    const progress = parseProgress(cell(row, "progress"));

    out.push({
      planner_task_number: taskNumber || null,
      text,
      assigneeNames: parseAssignees(cell(row, "assignees")),
      start_date:    excelSerialToDate(cell(row, "start")),
      due_date:      excelSerialToDate(cell(row, "finish")),
      progress,
      planned_hours: parseEsfuerzo(cell(row, "effort")),
      status:        bucketToStatus(cell(row, "bucket"), progress),
      notes_raw:     String(cell(row, "notes") ?? "").trim(),
      _rowIndex:     i,
    });
  }

  if (!out.length) errors.push("No se encontraron tareas debajo de los encabezados.");
  return { rows: out, projectMeta, errors };
}

// ── Merge / sincronización ────────────────────────────────────────────────────

const EXCEL_OWNED = ["text", "start_date", "due_date", "progress", "planned_hours"];

// Resuelve los nombres de responsables de una fila a assigned_engineers [{id,name}]
// usando el mapa nombre-normalizado → id. Nombres no resueltos se omiten (se
// reportan aparte como ingenieros por crear).
function resolveAssignees(assigneeNames, nameToId) {
  const out = [];
  const seen = new Set();
  assigneeNames.forEach(name => {
    const id = nameToId.get(normalizeName(name));
    if (id && !seen.has(id)) { out.push({ id, name }); seen.add(id); }
  });
  return out;
}

// Aplica los campos que vienen del Excel sobre una actividad (existente o nueva),
// preservando por spread todo lo demás (objetivos, solución, checklist, etc.).
function applyExcelFields(activity, row, nameToId) {
  return {
    ...activity,
    text:                row.text || activity.text,
    start_date:          row.start_date,
    due_date:            row.due_date,
    progress:            row.progress,
    planned_hours:       row.planned_hours,
    assigned_engineers:  resolveAssignees(row.assigneeNames, nameToId),
    assigned_date:       activity.assigned_date || (row.assigneeNames.length ? row.start_date || "" : activity.assigned_date),
    planner_task_number: row.planner_task_number,
    archived:            false,      // si estaba archivada y reaparece, se des-archiva
    archived_reason:     "",
  };
}

// Corazón de la sincronización.
// Parámetros:
//   existingActivities  – p.activities_identified (puede incluir archivadas)
//   existingTaskStatus  – p.task_status
//   importedRows        – filas normalizadas de parsePlannerWorkbook
//   engineerCatalog     – catálogo completo [{id,name,active,...}]
//   createActivityFn    – createActivity inyectada (evita import circular)
//   resolvedNameToId    – (opcional) mapa nombre-normalizado→id ya completo. En la
//                         primera pasada (dry-run) se omite: solo se reportan los
//                         ingenieros por crear. En la segunda (apply) se pasa
//                         completo y se enlazan todos los responsables.
// Devuelve: { activities, task_status, newEngineersToCreate, engineerNameToId, summary }.
export function mergePlannerImport(
  existingActivities,
  existingTaskStatus,
  importedRows,
  engineerCatalog,
  createActivityFn,
  resolvedNameToId
) {
  const existing = Array.isArray(existingActivities) ? existingActivities : [];

  // Mapa nombre-normalizado → id: parte del catálogo, se enriquece con el resuelto.
  const nameToId = new Map();
  (engineerCatalog || []).forEach(e => { if (e?.name) nameToId.set(normalizeName(e.name), e.id); });
  if (resolvedNameToId) resolvedNameToId.forEach((id, key) => nameToId.set(key, id));

  // Ingenieros por crear: nombres de responsables que no están en el mapa. Dedupe
  // por nombre normalizado, conservando la primera grafía vista.
  const toCreate = new Map();
  importedRows.forEach(row => {
    row.assigneeNames.forEach(name => {
      const key = normalizeName(name);
      if (key && !nameToId.has(key) && !toCreate.has(key)) toCreate.set(key, name);
    });
  });
  const newEngineersToCreate = [...toCreate.entries()].map(([key, name]) => ({ key, name }));

  // Índice de actividades existentes por número de tarea de Planner.
  const byNumber = new Map();
  existing.forEach(a => { if (a.planner_task_number != null) byNumber.set(String(a.planner_task_number), a); });

  const importedNumbers = new Set(importedRows.map(r => r.planner_task_number).filter(Boolean));
  const usedIds = new Set();
  const resultActivities = [];
  let created = 0, updated = 0, archived = 0;

  // 1) Recorrer filas del Excel: actualizar o crear.
  importedRows.forEach(row => {
    const match = row.planner_task_number != null ? byNumber.get(String(row.planner_task_number)) : null;
    if (match) {
      resultActivities.push(applyExcelFields(match, row, nameToId));
      usedIds.add(match.id);
      updated++;
    } else {
      const base = createActivityFn(row.text);
      resultActivities.push(applyExcelFields(base, row, nameToId));
      created++;
    }
  });

  // 2) Actividades existentes no tocadas: conservar manuales; archivar las de
  //    Planner que ya no aparecen.
  const archivedReason = `No presente en la importación de Planner del ${new Date().toISOString().slice(0, 10)}`;
  existing.forEach(a => {
    if (usedIds.has(a.id)) return;                 // ya actualizada arriba
    const fromPlanner = a.planner_task_number != null;
    if (fromPlanner && !importedNumbers.has(String(a.planner_task_number))) {
      resultActivities.push({ ...a, archived: true, archived_reason: a.archived_reason || archivedReason });
      archived++;
    } else {
      resultActivities.push(a);                     // manual (sin número) → intacta
    }
  });

  // 3) Reconstruir task_status. Solo actividades visibles (no archivadas) van a un
  //    bucket, según el estado importado (para las de Planner) o su estado previo
  //    (para las manuales). Se preservan mapas auxiliares de ids que sobreviven.
  const ts = existingTaskStatus && typeof existingTaskStatus === "object" ? existingTaskStatus : {};
  const prevStatusOf = (id) => {
    if ((ts.completed || []).includes(id)) return "completed";
    if ((ts.in_progress || []).includes(id)) return "in_progress";
    if ((ts.not_started || []).includes(id)) return "not_started";
    return "not_started";
  };
  const rowByNumber = new Map(importedRows.map(r => [String(r.planner_task_number), r]));

  const buckets = { completed: [], in_progress: [], not_started: [] };
  resultActivities.forEach(a => {
    if (a.archived) return;
    let status;
    if (a.planner_task_number != null && rowByNumber.has(String(a.planner_task_number))) {
      status = rowByNumber.get(String(a.planner_task_number)).status;
    } else {
      status = prevStatusOf(a.id);
    }
    buckets[status].push(a.id);
  });

  const validIds = new Set(resultActivities.filter(a => !a.archived).map(a => a.id));
  const pruneObj = (obj) => Object.fromEntries(Object.entries(obj || {}).filter(([id]) => validIds.has(id)));

  const task_status = {
    ...buckets,
    completed_dates: pruneObj(ts.completed_dates),
    status_history:  pruneObj(ts.status_history),
    completed_by:    pruneObj(ts.completed_by),
  };

  return {
    activities: resultActivities,
    task_status,
    newEngineersToCreate,
    engineerNameToId: nameToId,
    summary: { created, updated, archived, engineersToCreate: newEngineersToCreate.length },
  };
}
