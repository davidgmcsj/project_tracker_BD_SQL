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

const LS_PROJECTS = "wt-projects";
const LS_WEEK     = "wt-week";
const LS_HISTORY  = "wt-history";

// VITE_API_URL define la dirección del backend (ej: http://localhost:3001).
// En desarrollo local se configura en frontend/.env; en producción, en el servidor de despliegue.
// Si no está definida, las llamadas usan rutas relativas (funciona cuando front y back están en el mismo host).
const API_BASE = import.meta.env.VITE_API_URL || "";

async function apiFetch(path, options) {
  const res = await fetch(`${API_BASE}${path}`, options);
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
      return { projects: data.projects, weekLabel: data.weekLabel, engineers: data.engineers || [] };
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

export async function saveProjects(projects, weekLabel, engineers) {
  // localStorage primero: garantiza que el usuario no pierde datos
  // aunque la llamada al servidor falle
  localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
  if (weekLabel !== undefined) localStorage.setItem(LS_WEEK, weekLabel ?? "");
  try {
    await apiFetch("/api/projects", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ projects, weekLabel, engineers }),
    });
  } catch { /* guardado local completado */ }
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
    const reportDate = projects[0]?.report_date ?? new Date().toISOString().slice(0, 10);
    const entry      = { report_date: reportDate, ...payload };
    const idx        = history.findIndex(h => h.report_date === reportDate);
    if (idx >= 0) history[idx] = entry; else history.push(entry);
    localStorage.setItem(LS_HISTORY, JSON.stringify(history));
  }
}

// ── WeekLabel helpers ─────────────────────────────────────────────────────────

export const getStoredWeekLabel = () => localStorage.getItem(LS_WEEK);
export const storeWeekLabel     = (label) => localStorage.setItem(LS_WEEK, label);
