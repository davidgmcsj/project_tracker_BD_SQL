const API_URL = '/api/data';
const LS_PROJECTS = "weekly-tracker-projects";
const LS_WEEK     = "weekly-tracker-week";
const LS_HISTORY  = "weekly-tracker-history";

async function fetchData() {
  try {
    const res = await fetch(API_URL);
    if (res.ok) return await res.json();
  } catch {
    // servidor no disponible, usa localStorage
  }
  return {
    projects: JSON.parse(localStorage.getItem(LS_PROJECTS) || '[]'),
    weekLabel: localStorage.getItem(LS_WEEK),
    history: JSON.parse(localStorage.getItem(LS_HISTORY) || '[]'),
  };
}

async function persistData(data) {
  localStorage.setItem(LS_PROJECTS, JSON.stringify(data.projects));
  if (data.weekLabel !== undefined) localStorage.setItem(LS_WEEK, data.weekLabel);
  if (data.history)  localStorage.setItem(LS_HISTORY, JSON.stringify(data.history));
  try {
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch {
    // guardado local completado; servidor no disponible
  }
}

export async function loadAllData() {
  return fetchData();
}

export async function loadProjects() {
  return (await fetchData()).projects;
}

export async function loadWeekLabel() {
  return (await fetchData()).weekLabel;
}

export async function saveAllData(projects, weekLabel, history = null) {
  const current = history ?? JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
  await persistData({ projects, weekLabel, history: current });
}

export async function saveProjects(projects) {
  const weekLabel = localStorage.getItem(LS_WEEK);
  await saveAllData(projects, weekLabel);
}

export async function saveWeekLabel(label) {
  const projects = JSON.parse(localStorage.getItem(LS_PROJECTS) || '[]');
  await saveAllData(projects, label);
}

export async function saveWeekSnapshot(weekLabel, projects) {
  const data    = await fetchData();
  const history = data.history || [];
  history.push({
    week: weekLabel,
    date: new Date().toISOString(),
    projects: projects.map(p => ({
      name:           p.name,
      total:          p.totalActivities,
      completed:      p.completedActivities,
      inProgress:     p.inProgressActivities,
      status:         p.status,
      accomplishments: p.weekAccomplishments,
    })),
  });
  await persistData({ projects, weekLabel, history });
}
