// URLs relativas → funciona igual con el proxy de Vite en dev y en Azure en prod.

const LS_PROJECTS = "wt-projects";
const LS_WEEK     = "wt-week";

async function apiFetch(path, options) {
  const res = await fetch(path, options);
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`);
  return res.json();
}

// ── Carga inicial ─────────────────────────────────────────────────────────────

function isNewFormat(projects) {
  // Descarta datos legados que usen los nombres de campo viejos (name, totalActivities, etc.)
  if (!Array.isArray(projects) || !projects.length) return true;
  const p = projects[0];
  return 'project_name' in p && 'manual_metrics' in p;
}

export async function loadProjects() {
  try {
    const data = await apiFetch('/api/projects');
    if (data.projects?.length) {
      localStorage.setItem(LS_PROJECTS, JSON.stringify(data.projects));
      if (data.weekLabel) localStorage.setItem(LS_WEEK, data.weekLabel);
      return { projects: data.projects, weekLabel: data.weekLabel };
    }
  } catch {
    // servidor no disponible — intentar localStorage
  }
  const cached = JSON.parse(localStorage.getItem(LS_PROJECTS) || '[]');
  if (!isNewFormat(cached)) {
    // Cache en formato legado — descartarlo para evitar errores
    localStorage.removeItem(LS_PROJECTS);
    localStorage.removeItem(LS_WEEK);
    return { projects: [], weekLabel: null };
  }
  return {
    projects:  cached,
    weekLabel: localStorage.getItem(LS_WEEK),
  };
}

// ── Guardar estado base ───────────────────────────────────────────────────────

export async function saveProjects(projects, weekLabel) {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(projects));
  if (weekLabel !== undefined) localStorage.setItem(LS_WEEK, weekLabel ?? "");
  try {
    await apiFetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects, weekLabel }),
    });
  } catch { /* guardado local completado */ }
}

// ── Guardar snapshot semanal (historial) ──────────────────────────────────────

// Upsert por report_date — el servidor no sobrescribe otras fechas.
export async function saveWeekReport(projects, weekLabel) {
  try {
    await apiFetch('/api/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects, weekLabel, saved_at: new Date().toISOString() }),
    });
  } catch {
    // Fallback a localStorage si el servidor no está disponible
    const history    = JSON.parse(localStorage.getItem('wt-history') || '[]');
    const reportDate = projects[0]?.report_date ?? new Date().toISOString().slice(0, 10);
    const entry      = { report_date: reportDate, weekLabel, saved_at: new Date().toISOString(), projects };
    const idx        = history.findIndex(h => h.report_date === reportDate);
    if (idx >= 0) history[idx] = entry; else history.push(entry);
    localStorage.setItem('wt-history', JSON.stringify(history));
  }
}

// ── WeekLabel helpers ─────────────────────────────────────────────────────────

export function getStoredWeekLabel() { return localStorage.getItem(LS_WEEK); }
export function storeWeekLabel(label) { localStorage.setItem(LS_WEEK, label); }
