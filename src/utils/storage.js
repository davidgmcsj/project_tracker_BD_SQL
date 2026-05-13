const LS_PROJECTS = "wt-projects";
const LS_WEEK     = "wt-week";
const LS_HISTORY  = "wt-history";

async function apiFetch(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

function isNewFormat(projects) {
  if (!Array.isArray(projects) || !projects.length) return true;
  const p = projects[0];
  return "project_name" in p && "manual_metrics" in p;
}

// ── Carga inicial ─────────────────────────────────────────────────────────────

export async function loadProjects() {
  try {
    const data = await apiFetch("/api/projects");
    if (data.projects?.length) {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(data.projects));
      if (data.weekLabel) localStorage.setItem(LS_WEEK, data.weekLabel);
      return { projects: data.projects, weekLabel: data.weekLabel };
    }
  } catch {
    // servidor no disponible — intentar localStorage
  }

  const cached = JSON.parse(localStorage.getItem(LS_PROJECTS) || "[]");
  if (!isNewFormat(cached)) {
    localStorage.removeItem(LS_PROJECTS);
    localStorage.removeItem(LS_WEEK);
    return { projects: [], weekLabel: null };
  }
  return { projects: cached, weekLabel: localStorage.getItem(LS_WEEK) };
}

// ── Persistencia base ─────────────────────────────────────────────────────────

export async function saveProjects(projects, weekLabel) {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
  if (weekLabel !== undefined) localStorage.setItem(LS_WEEK, weekLabel ?? "");
  try {
    await apiFetch("/api/projects", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ projects, weekLabel }),
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
