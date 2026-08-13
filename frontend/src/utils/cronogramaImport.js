// cronogramaImport.js — Motor de importación de los Excel "Cronograma por
// entregable" (hoja "Cronograma Detalle"), formato distinto al export nativo
// de Planner (ver plannerImport.js): agrupa las tareas bajo Entregables con
// una columna "#" jerárquica propia (1, 1.4.1, 1.6.2.1…) y trae Notas de
// cierre solo en las filas de entregable.
//
// Diseño deliberadamente SIMPLE y ADITIVO (decidido con el usuario): esta
// importación SIEMPRE crea actividades nuevas, nunca empareja con las que ya
// existen en el proyecto ni las modifica ni las borra/archiva. No hay clave
// estable de emparejamiento (el Excel no trae ningún id) y el usuario no la
// quiere — cada importación agrega un árbol nuevo de Entregable → Tarea →
// Subtareas, tal como está estructurado en el archivo.
//
// Todo aquí es PURO (sin React, sin DOM) y testeable de forma aislada.
// Flujo: parseCronogramaWorkbook(arrayBuffer) → filas normalizadas con
//        jerarquía por "#" ya resuelta → buildCronogramaActivities(...) →
//        { activities[], task_status parcial } listo para fusionar con el
//        proyecto.

import { getToday } from "./formulas.js";

const SHEET_NAME = "Cronograma Detalle";

// Encabezados esperados en la fila de títulos de la tabla (fila 4 en el
// archivo de referencia, pero se busca por texto — no por índice fijo — para
// tolerar que Excel agregue/quite una fila de metadata arriba).
const COLUMN_LABELS = {
  "#":          "number",
  "tarea":      "text",
  "asignado":   "assignee",
  "inicio":     "start",
  "fin":        "due",
  "estado":     "status",
  "% progreso": "progress",
  "notas":      "notes",
};

// Estado en español del Excel → clave interna. Coincide con
// ESTADOS_ACTIVIDAD_OPERACIONAL (utils/filtroOpciones.js) — mismo
// vocabulario que ya usa el resto de la app, así que no hace falta más
// mapeo que normalizar tildes/mayúsculas.
const STATUS_LABEL_TO_KEY = {
  "no iniciada":          "not_started",
  "en proceso":           "in_progress",
  "ambiente pruebas":     "ambiente_pruebas",
  "ambiente produccion":  "ambiente_produccion",
  "completada":           "completed",
};

// ── Normalización ─────────────────────────────────────────────────────────

function normalize(s) {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

// "31/08/2026" → "2026-08-31". Formato dd/mm/aaaa como texto (no serial de
// Excel: estos archivos traen la columna ya formateada como texto/fecha
// legible, a diferencia del export de Planner). Vacío o irreconocible → "".
export function parseDMYDate(raw) {
  const s = String(raw ?? "").trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return "";
  const [, d, mo, y] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// "20%" | 0.2 | 20 → 20 (entero 0-100).
export function parseProgressPct(raw) {
  if (raw === "" || raw == null) return 0;
  let n = typeof raw === "number" ? raw : Number(String(raw).replace(/[%\s]/g, "").replace(",", "."));
  if (!isFinite(n)) return 0;
  if (n <= 1) n = n * 100;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// "David A." → estado interno, tolerando "Sin asignar" / vacío → null (sin
// responsable). El nombre se resuelve contra el catálogo más adelante
// (buildCronogramaActivities), aquí solo se limpia el texto crudo.
export function parseAssigneeName(raw) {
  const s = String(raw ?? "").trim();
  if (!s || normalize(s) === "sin asignar") return "";
  return s;
}

export function statusFromLabel(raw) {
  return STATUS_LABEL_TO_KEY[normalize(raw)] || "not_started";
}

// ── Jerarquía por columna "#" ────────────────────────────────────────────
// El "#" ya es jerárquico ("1", "1.4.1", "1.6.2.1"): un Entregable es una
// fila con "#" de UN solo segmento (sin puntos); toda fila con más de un
// segmento es tarea/subtarea. El PADRE de una fila con "#" de N segmentos es
// la fila visible INMEDIATAMENTE ANTERIOR con N-1 segmentos — el mismo
// criterio con el que Excel dibuja la sangría, sin depender de esa sangría
// (columna B trae espacios en blanco a mano, no fiables como dato).
//
// OJO: el "#" de este archivo NO refleja la profundidad real de cada fila —
// es un número heredado de una jerarquía distinta (por ejemplo "1.8.1" puede
// convivir con "1.5" al mismo nivel visual bajo un Entregable). Verificado
// contra el archivo de referencia: toda fila de Entregable no tiene sangría
// en la columna "Tarea" y toda fila de tarea/subtarea tiene la MISMA
// sangría entre sí — es decir, este formato es de exactamente 2 niveles
// (Entregable → Tarea), sin importar cuántos puntos traiga el "#". La
// profundidad real se mide por la sangría (espacios en blanco al inicio del
// texto de la columna "Tarea"), no por el número.
//
// El "#" tampoco es un id global estable entre archivos — por eso esta
// importación nunca lo usa para emparejar con actividades ya existentes
// (ver cabecera del archivo): solo queda disponible en cada fila por si se
// necesita mostrarlo, pero no gobierna la jerarquía.
function resolveHierarchy(rows) {
  // stack[i] = índice de fila (en `rows`) del ancestro más reciente con
  // nivel de sangría i. Al ver una fila con sangría s, su padre es el tope
  // MÁS PROFUNDO con sangría estrictamente menor — soporta tanto el caso
  // real (2 niveles) como una sangría más profunda si algún archivo futuro
  // la trae, sin asumir un incremento fijo de espacios por nivel.
  const stack = []; // [{ indent, rowIndex }]
  return rows.map(row => {
    while (stack.length && stack[stack.length - 1].indent >= row.indent) stack.pop();
    const parentRowIndex = stack.length ? stack[stack.length - 1].rowIndex : null;
    stack.push({ indent: row.indent, rowIndex: row._rowIndex });
    return { ...row, parentRowIndex };
  });
}

// ── Parseo del libro completo ─────────────────────────────────────────────

function buildColumnMap(headerRow) {
  const map = {};
  (headerRow || []).forEach((cell, idx) => {
    const key = COLUMN_LABELS[normalize(cell)];
    if (key && map[key] === undefined) map[key] = idx;
  });
  // "number" y "text" son obligatorias — sin ellas no hay fila de encabezados válida.
  return (map.number !== undefined && map.text !== undefined) ? map : null;
}

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const colMap = buildColumnMap(rows[i]);
    if (colMap) return { headerIndex: i, colMap };
  }
  return null;
}

// arrayBuffer del .xlsx → { rows: ParsedRow[], errors[] }.
// ParsedRow: { number, indent, parentRowIndex, text, assigneeName, start_date,
//   due_date, status, progress, notes, isEntregable, _rowIndex }.
export async function parseCronogramaWorkbook(arrayBuffer) {
  const errors = [];
  const XLSX = await import("xlsx"); // carga diferida — igual criterio que plannerImport.js
  const wb = XLSX.read(arrayBuffer, { type: "array" });

  let sheet = wb.Sheets[SHEET_NAME];
  if (!sheet) {
    const firstName = wb.SheetNames[0];
    sheet = wb.Sheets[firstName];
    errors.push(`No se encontró la hoja "${SHEET_NAME}"; se usó "${firstName}".`);
  }
  if (!sheet) {
    return { rows: [], errors: ["El archivo no contiene hojas legibles."] };
  }

  const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" });
  const header = findHeaderRow(rawRows);
  if (!header) {
    return {
      rows: [],
      errors: ['No se reconoció la fila de encabezados ("#", "Tarea"…). ¿El archivo tiene el formato de Cronograma por entregable?'],
    };
  }

  const { headerIndex, colMap } = header;
  const cell = (row, key) => (colMap[key] !== undefined ? row[colMap[key]] : "");

  const flat = [];
  for (let i = headerIndex + 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!Array.isArray(row) || row.every(c => c === "" || c == null)) continue;

    const number  = String(cell(row, "number") ?? "").trim();
    const rawText = String(cell(row, "text") ?? "");
    const text    = rawText.trim();
    if (!number && !text) continue; // fila decorativa/vacía

    if (!number) { errors.push(`Fila ${i + 1} ("${text}") ignorada: sin número jerárquico en "#".`); continue; }

    // Nivel real = sangría de la columna "Tarea" (ver resolveHierarchy). Una
    // fila de Entregable siempre llega sin sangría (indent 0); cualquier
    // sangría mayor es tarea/subtarea.
    const indent = rawText.length - rawText.trimStart().length;
    const isEntregableRow = indent === 0;

    // La columna "Asignado" de una fila de Entregable no trae un responsable
    // individual: Excel la usa para un resumen agregado ("2/10 tareas al
    // 100%") — tratarla como nombre crearía "ingenieros" falsos con ese texto.
    flat.push({
      number,
      indent,
      text,
      assigneeName: isEntregableRow ? "" : parseAssigneeName(cell(row, "assignee")),
      start_date:   parseDMYDate(cell(row, "start")),
      due_date:     parseDMYDate(cell(row, "due")),
      status:       statusFromLabel(cell(row, "status")),
      progress:     parseProgressPct(cell(row, "progress")),
      notes:        String(cell(row, "notes") ?? "").trim(),
      isEntregable: isEntregableRow,
      _rowIndex:    i,
    });
  }

  if (!flat.length) errors.push("No se encontraron tareas debajo de los encabezados.");

  const rows = resolveHierarchy(flat);
  return { rows, errors };
}

// ── Construcción de actividades ───────────────────────────────────────────

// Resuelve un nombre de responsable a {id,name} contra el catálogo de
// ingenieros. Nombre vacío o no encontrado → null (actividad sin asignar;
// se reporta aparte como "ingenieros por crear", igual que plannerImport.js).
function resolveAssignee(name, nameToId) {
  if (!name) return null;
  const id = nameToId.get(normalize(name));
  return id ? { id, name } : null;
}

// Construye las actividades nuevas a partir de las filas ya jerarquizadas.
// SIEMPRE crea (createActivityFn) — nunca busca ni reutiliza actividades
// existentes del proyecto, por diseño (ver cabecera del archivo).
//
// engineerCatalog: catálogo completo, para resolver responsables ya conocidos.
// resolvedNameToId: (opcional) mapa nombre→id ya completo, incluyendo los
//   recién creados — mismo patrón en dos pasadas que mergePlannerImport
//   (dry-run sin resolver → aplicar con el mapa completo).
//
// Devuelve { activities: Activity[], statusByActivityId: Map<id,status>,
//   newEngineersToCreate: [{key,name}], summary: {entregables, tareas} }.
export function buildCronogramaActivities(parsedRows, engineerCatalog, createActivityFn, resolvedNameToId) {
  const nameToId = new Map();
  (engineerCatalog || []).forEach(e => { if (e?.name) nameToId.set(normalize(e.name), e.id); });
  if (resolvedNameToId) resolvedNameToId.forEach((id, key) => nameToId.set(key, id));

  const toCreate = new Map();
  parsedRows.forEach(row => {
    if (!row.assigneeName) return;
    const key = normalize(row.assigneeName);
    if (!nameToId.has(key) && !toCreate.has(key)) toCreate.set(key, row.assigneeName);
  });
  const newEngineersToCreate = [...toCreate.entries()].map(([key, name]) => ({ key, name }));

  // rowIndex (posición en el archivo) → id real de actividad ya creada, para
  // resolver parent_id de las filas que vienen después en el recorrido.
  const idByRowIndex = new Map();
  const nextOrderByParent = new Map(); // parentId (o "root") → siguiente sequence_order
  const activities = [];
  const statusByActivityId = new Map();
  let entregables = 0, tareas = 0;

  parsedRows.forEach(row => {
    const parentId = row.parentRowIndex != null ? idByRowIndex.get(row.parentRowIndex) ?? null : null;
    const orderKey = parentId ?? "root";
    const order = nextOrderByParent.get(orderKey) ?? 0;
    nextOrderByParent.set(orderKey, order + 1);

    const base = createActivityFn(row.text, parentId, order);
    const assignee = resolveAssignee(row.assigneeName, nameToId);
    const activity = {
      ...base,
      start_date:         row.start_date,
      due_date:            row.due_date,
      progress:            row.progress,
      assigned_engineers:  assignee ? [assignee] : [],
      assigned_date:       assignee ? (row.start_date || getToday()) : null,
      // Las filas de Entregable traen la nota de cierre ("Cierre: …") en vez
      // de una tarea real — se guarda como descripción del propio nodo
      // agrupador para no perder ese contexto.
      description:         row.isEntregable ? row.notes : "",
    };

    activities.push(activity);
    statusByActivityId.set(activity.id, row.status);
    idByRowIndex.set(row._rowIndex, activity.id);
    if (row.isEntregable) entregables++; else tareas++;
  });

  return {
    activities,
    statusByActivityId,
    newEngineersToCreate,
    summary: { entregables, tareas, total: activities.length, engineersToCreate: newEngineersToCreate.length },
  };
}

// Fusiona las actividades nuevas dentro de un task_status existente —
// agrega cada id al bucket correspondiente a su estado importado, sin tocar
// los buckets/ids que ya había (aditivo puro, nunca reemplaza ni archiva).
export function mergeCronogramaTaskStatus(existingTaskStatus, statusByActivityId) {
  const ts = existingTaskStatus && typeof existingTaskStatus === "object" ? existingTaskStatus : {};
  const ALL_KEYS = ["completed", "in_progress", "not_started", "ambiente_pruebas", "ambiente_produccion"];
  const next = {};
  ALL_KEYS.forEach(k => { next[k] = [...(Array.isArray(ts[k]) ? ts[k] : [])]; });

  const cDates = { ...(ts.completed_dates || {}) };
  const hist = { ...(ts.status_history || {}) };
  const today = getToday();

  statusByActivityId.forEach((status, id) => {
    next[status].push(id);
    hist[id] = { added: today };
    if (status === "completed") cDates[id] = today;
  });

  return { ...ts, ...next, completed_dates: cDates, status_history: hist };
}
