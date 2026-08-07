// storage.js — Capa de persistencia de la aplicación.
//
// Estrategia de escritura dual:
//   1. Siempre escribe en localStorage (instantáneo, sin red).
//   2. Intenta sincronizar con el servidor Node (/api/...).
//      Si el servidor no responde, el fallo es silencioso y localStorage
//      actúa como caché offline hasta que vuelva a estar disponible.
//
// En carga inicial, el servidor tiene prioridad sobre localStorage.
// Si el servidor devuelve datos válidos, los sobreescribe en localStorage
// para que ambas fuentes queden sincronizadas.

// API_BASE y authHeaders viven en utils/api.js — fuente única, antes estaban
// duplicados aquí y en otros 4 archivos. Se re-exporta authHeaders para no
// romper los imports existentes que ya lo traen desde storage.js.
import { API_BASE, authHeaders } from "./api.js";
import { getToday } from "./formulas.js";
export { authHeaders };

const LS_PROJECTS = "wt-projects";
const LS_WEEK     = "wt-week";
const LS_HISTORY  = "wt-history";

async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  // credentials: "include" — manda/recibe la cookie de sesión (Fase 9) aunque
  // frontend y backend vivan en orígenes distintos.
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers, credentials: "include" });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

function isNewFormat(projects) {
  if (!Array.isArray(projects) || !projects.length) return true;
  const p = projects[0];
  if (!("project_name" in p) || !("manual_metrics" in p)) return false;
  // activities_identified pasó de array de strings a array de {id, text}.
  // Si quedó una caché local vieja, se descarta para que se recargue del servidor ya migrado.
  const acts = p.activities_identified;
  if (Array.isArray(acts) && acts.length && typeof acts[0] === "string") return false;
  return true;
}

// ── Carga inicial ─────────────────────────────────────────────────────────────

export async function loadProjects() {
  try {
    const data = await apiFetch("/api/projects");
    if (data.projects?.length) {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(data.projects));
      if (data.weekLabel) localStorage.setItem(LS_WEEK, data.weekLabel);
      return { projects: data.projects, weekLabel: data.weekLabel, engineers: data.engineers || [], externalContacts: data.externalContacts || [] };
    }
  } catch {
    // servidor no disponible — intentar localStorage
  }

  const cached = JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]");
  if (!isNewFormat(cached)) {
    // Datos en formato antiguo (pre-BD): limpiar para evitar errores de parse
    localStorage.removeItem(LS_PROJECTS);
    localStorage.removeItem(LS_WEEK);
    return { projects: [], weekLabel: null, engineers: [] };
  }
  return { projects: cached, weekLabel: localStorage.getItem(LS_WEEK), engineers: [] };
}

// ── Persistencia base ─────────────────────────────────────────────────────────

// expectedVersion es opcional: solo los guardados que lo mandan activan el
// chequeo de versión optimista en el backend (Fase 8). Sin él, se guarda
// igual que siempre — último guardado gana, comportamiento sin cambios.
//
// Devuelve { ok, conflict, serverProject?, version? } en vez de lanzar error
// para que el llamador pueda distinguir "hubo un conflicto de edición" (409,
// con el estado del servidor para que el usuario elija) de "el servidor no
// respondió" (el guardado local ya quedó completado, no hay nada que hacer).
export async function saveProjects(projects, weekLabel, engineers, externalContacts, changedProjectId, expectedVersion) {
  // localStorage primero: garantiza que el usuario no pierde datos
  // aunque la llamada al servidor falle
  localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
  if (weekLabel !== undefined) localStorage.setItem(LS_WEEK, weekLabel ?? "");

  try {
    const res = await fetch(`${API_BASE}/api/projects`, {
      method:  "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      credentials: "include",
      body: JSON.stringify({
        projects, weekLabel, engineers, externalContacts: externalContacts || [],
        changedProjectId: changedProjectId || null,
        expectedVersion:  expectedVersion ?? null,
      }),
    });

    if (res.status === 409) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, conflict: true, serverProject: data.serverProject || null };
    }
    if (!res.ok) return { ok: false, conflict: false };

    const data = await res.json().catch(() => ({}));
    return { ok: true, conflict: false, version: data.version };
  } catch {
    return { ok: false, conflict: false }; // servidor no disponible — guardado local completado
  }
}

// ── Snapshot semanal (historial) ──────────────────────────────────────────────

export async function saveWeekReport(projects, weekLabel) {
  const payload = { projects, weekLabel, saved_at: new Date().toISOString() };
  try {
    await apiFetch("/api/report", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    });
  } catch {
    // Si el servidor no está disponible, guardar el snapshot en localStorage
    const history    = JSON.parse(localStorage.getItem(LS_HISTORY) || "[]");
    const reportDate = projects[0]?.report_date ?? getToday();
    const entry      = { report_date: reportDate, ...payload };
    const idx        = history.findIndex(h => h.report_date === reportDate);
    if (idx >= 0) history[idx] = entry; else history.push(entry);
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
  }
}

// ── WeekLabel helpers ─────────────────────────────────────────────────────────

export const getStoredWeekLabel = () => localStorage.getItem(LS_WEEK);
export const storeWeekLabel     = (label) => localStorage.setItem(LS_WEEK, label);

// ── Sincronización de ingenieros con SQL ──────────────────────────────────────
// Crea/actualiza el ingeniero en la tabla SQL Ingenieros y devuelve su IngenieroID
// real (sql_id). Si el servidor o la BD no responden, devuelve null — el cambio
// local ya quedó guardado por saveProjects, así que no se pierde nada.
export async function syncEngineerToSQL(engineer) {
  try {
    const data = await apiFetch("/api/engineers/sync-one", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ engineer }),
    });
    return data.sql_id ?? null;
  } catch {
    return null;
  }
}

// ── Sincronización de tareas sueltas del ingeniero con SQL ────────────────────
// Mismo principio: el cambio local ya quedó guardado por saveProjects antes de
// llamar esto, así que un fallo de red/BD aquí no pierde datos del usuario.
export async function syncEngineerTaskToSQL(engineer, task) {
  try {
    await apiFetch("/api/engineers/tasks/sync-one", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ engineer, task }),
    });
  } catch { /* el cambio local ya quedó guardado */ }
}

// ── Sincronización de colaboradores externos con SQL ─────────────────────────
export async function syncExternalContactToSQL(contact) {
  try {
    const data = await apiFetch("/api/external-contacts/sync-one", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ contact }),
    });
    return data.sql_id ?? null;
  } catch {
    return null;
  }
}

export async function deleteEngineerTaskFromSQL(taskId) {
  try {
    await apiFetch("/api/engineers/tasks/delete-one", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ taskId }),
    });
  } catch { /* el cambio local ya quedó guardado */ }
}

// ── Notas de proyecto ──────────────────────────────────────────────────────────
// Viven solo en SQL (Proyecto_Notas), no en data.json — a diferencia de
// status_notes, que sigue siendo el "pulso" de una línea dentro del proyecto.

export async function loadProjectNotes(proyectoAppID) {
  try {
    return await apiFetch(`/api/reports/notes/${encodeURIComponent(proyectoAppID)}`);
  } catch {
    return [];
  }
}

// `nota` es { id, date, author, type, text, include_in_report }. Devuelve
// true si se guardó, false si falló (el llamador decide cómo avisar).
export async function saveProjectNote(proyectoAppID, nota) {
  try {
    await apiFetch("/api/reports/notes", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ nota: { ...nota, proyectoAppID } }),
    });
    return true;
  } catch {
    return false;
  }
}

export async function deleteProjectNote(appNotaID) {
  try {
    await apiFetch("/api/reports/notes/delete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id: appNotaID }),
    });
    return true;
  } catch {
    return false;
  }
}

// ── Motor de reportes ──────────────────────────────────────────────────────────
// El registro dice qué consultas y filtros existen (para dibujar el panel de
// facetas sin campos hardcodeados); runReportQuery ejecuta una combinación
// consulta+filtros y devuelve { total, filas }.

export async function loadReportRegistry() {
  try {
    return await apiFetch("/api/reports/registry");
  } catch {
    return {};
  }
}

// No usa apiFetch: si el filtro es inválido el backend responde 400 con un
// mensaje concreto ("Campo de filtro no permitido: ...") que el panel de
// reportes necesita mostrar tal cual, no un genérico "API ... → 400".
export async function runReportQuery(body) {
  const res = await fetch(`${API_BASE}/api/reports/query`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "include",
    body:    JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ── Reportes guardados ─────────────────────────────────────────────────────

export async function loadSavedReports() {
  try {
    return await apiFetch("/api/reports/saved");
  } catch {
    return [];
  }
}

export async function saveReportCombination(nombre, config) {
  return apiFetch("/api/reports/saved", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ nombre, config }),
  });
}

export async function deleteSavedReport(id) {
  try {
    await apiFetch("/api/reports/saved/delete", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ id }),
    });
    return true;
  } catch {
    return false;
  }
}

// Exporta el mismo filtro ya aplicado a Excel o PDF y dispara la descarga.
// POST + blob: apiFetchBlob (abajo) solo hace GET, así que esto no la reutiliza.
export async function exportReport(body, formato) {
  const res = await fetch(`${API_BASE}/api/reports/export`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "include",
    body:    JSON.stringify({ ...body, formato }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `${body.consulta || "reporte"}.${formato}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Administración de usuarios (solo admins — ver requireAdmin en server.cjs) ─
// A diferencia de syncEngineerToSQL (que traga errores porque el guardado
// local ya ocurrió antes de llamarlo), aquí NO hay guardado local previo —
// si la petición falla, quien usa la pantalla de administración necesita
// saberlo (usuario duplicado, contraseña corta, sin permiso), así que se
// lanza el error con el mensaje del backend en vez de devolver null/[].
async function usersFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(options.headers || {}) },
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function loadUsers() {
  return usersFetch("/api/users");
}

export async function createUser(user) {
  return usersFetch("/api/users", { method: "POST", body: JSON.stringify(user) });
}

export async function updateUser(userId, patch) {
  return usersFetch(`/api/users/${userId}`, { method: "POST", body: JSON.stringify(patch) });
}

// ── Login por base de datos (Fase 9 revisada) ───────────────────────────────
// Sesión en cookie httpOnly (el backend la pone/lee, el frontend nunca toca
// el token directamente) — por eso ninguna de estas funciones lo maneja.

export async function login(username, password) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method:  "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "include",
    body:    JSON.stringify({ username, password }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.user;
}

export async function logout() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST" });
  } catch { /* la cookie puede haber expirado ya; no hay nada más que hacer */ }
}

// Devuelve el usuario logueado, o null si no hay sesión válida.
export async function getCurrentUser() {
  try {
    const data = await apiFetch("/api/auth/me");
    return data.user || null;
  } catch {
    return null;
  }
}

// ── Adjuntos de actividades ───────────────────────────────────────────────────
// Los bytes se guardan SOLO en SQL. En la actividad (data.json) queda la metadata.

// Convierte un File a base64 (sin el prefijo data:...;base64,).
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(String(reader.result).split(",")[1] || "");
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Sube un archivo asociado a una actividad. Devuelve la metadata del adjunto
// (para guardar en activity.attachments) o lanza error si falla.
export async function uploadAttachment(file, { appActividadID, proyectoAppID }) {
  const appAdjuntoID = "att_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const dataBase64   = await fileToBase64(file);
  await apiFetch("/api/attachments/upload", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      appAdjuntoID, appActividadID, proyectoAppID,
      nombre: file.name, mime: file.type, dataBase64,
    }),
  });
  return {
    id:          appAdjuntoID,
    filename:    file.name,
    mime:        file.type,
    size:        file.size,
    uploaded_at: new Date().toISOString(),
  };
}

// Descarga un adjunto y dispara el guardado en el navegador. Reemplaza al
// antiguo enlace <a href> directo: un <a> no puede enviar el header
// X-API-Key, así que la descarga ahora pasa por fetch (vía apiFetchBlob)
// y se guarda con un <a> temporal apuntando a un blob: URL local.
async function apiFetchBlob(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders(), credentials: "include" });
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.blob();
}

export async function downloadAttachment(appAdjuntoID, filename) {
  const blob = await apiFetchBlob(`/api/attachments/${appAdjuntoID}`);
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename || "adjunto";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function deleteAttachment(appAdjuntoID) {
  await apiFetch("/api/attachments/delete", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ appAdjuntoID }),
  });
}

// ── Operaciones de trimestre ──────────────────────────────────────────────────

// Ejecuta el reset trimestral en el backend.
// Devuelve { ok, quarterLabel, activitiesArchived, activitiesTransferred, totalProyectos }.
// Lanza error si el backend falla — el llamador debe manejarlo.
export async function executeQuarterReset(payload) {
  return apiFetch("/api/quarter-reset", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload),
  });
}

// Trae la lista de trimestres archivados (sin el JSON completo, solo metadatos).
export async function loadQuartersList() {
  return apiFetch("/api/quarters");
}

// Trae el JSON completo de un trimestre archivado por su ID.
export async function loadQuarterById(id) {
  return apiFetch(`/api/quarters/${id}`);
}

// Recarga el estado actual desde el servidor (usado después del reset para tener el estado limpio).
export async function reloadProjectsFromServer() {
  return apiFetch("/api/projects");
}

// Limpia estadísticas semanales e historial del trimestre actual sin archivar nada.
export async function cleanCurrentStats() {
  return apiFetch("/api/clean-stats", { method: "POST" });
}
