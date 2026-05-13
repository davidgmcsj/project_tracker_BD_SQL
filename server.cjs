const express = require("express");
const fs      = require("fs").promises;
const path    = require("path");

// ── Configuración ─────────────────────────────────────────────────────────────

function getDataDir() {
  return process.env.HOME === "/home" ? "/home/data" : __dirname; // Azure App Service Linux
}

const DATA_DIR     = getDataDir();
const DATA_FILE    = path.join(DATA_DIR, "data.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
const DIST_PATH    = path.join(__dirname, "dist");
const PORT         = process.env.PORT || 3001;

// ── Helpers de archivo ────────────────────────────────────────────────────────

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

function toArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

// ── Migración de datos legados (string → array/objeto) ────────────────────────

async function migrateArrayFields() {
  const data = await readJson(DATA_FILE, null);
  if (!data?.projects?.length) return;

  let changed = false;
  data.projects = data.projects.map(p => {
    const needsMigration =
      typeof p.activities_identified === "string" ||
      typeof p.weekly_achievements   === "string" ||
      typeof p.next_week_plan        === "string" ||
      typeof p.milestones            === "string" ||
      typeof p.comments              === "string";

    if (!needsMigration) return p;
    changed = true;

    const milestonesArr = typeof p.milestones === "string" && p.milestones.trim()
      ? toArr(p.milestones).map(note => ({ activity: "", date: "", note }))
      : (Array.isArray(p.milestones) ? p.milestones : []);

    const commentsArr = typeof p.comments === "string" && p.comments.trim()
      ? toArr(p.comments).map(text => ({ activity: "", date: "", text }))
      : (Array.isArray(p.comments) ? p.comments : []);

    return {
      ...p,
      activities_identified: toArr(p.activities_identified),
      weekly_achievements:   toArr(p.weekly_achievements),
      next_week_plan:        toArr(p.next_week_plan),
      milestones:            milestonesArr,
      comments:              commentsArr,
      engineers: (p.engineers || []).map(e => ({
        ...e,
        weekly_detail: toArr(e.weekly_detail),
      })),
    };
  });

  if (changed) {
    await writeJson(DATA_FILE, data);
    console.log("Migración string→array/objeto completada");
  }
}

// ── Inicialización ────────────────────────────────────────────────────────────

async function init() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DATA_FILE);
  } catch {
    const localData = path.join(__dirname, "data.json");
    try {
      await fs.access(localData);
      await fs.copyFile(localData, DATA_FILE);
      console.log("data.json copiado al directorio de datos");
    } catch {
      await writeJson(DATA_FILE, { projects: [], weekLabel: null });
    }
  }

  await migrateArrayFields();

  if (!(await readJson(HISTORY_FILE, null))) {
    await writeJson(HISTORY_FILE, { reports: [] });
  }

  console.log(`Datos en: ${DATA_DIR}`);
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json({ limit: "50mb" }));

if (process.env.NODE_ENV !== "production") {
  const cors = require("cors");
  app.use(cors());
}

// ── API: Proyectos base ───────────────────────────────────────────────────────

app.get("/api/projects", async (req, res) => {
  try {
    res.json(await readJson(DATA_FILE, { projects: [], weekLabel: null }));
  } catch {
    res.status(500).json({ error: "Error leyendo proyectos" });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    await writeJson(DATA_FILE, req.body);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Error guardando proyectos" });
  }
});

// ── API: Historial semanal ────────────────────────────────────────────────────

function getMondayOf(dateStr) {
  const d    = new Date(dateStr + "T12:00:00");
  const day  = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

app.post("/api/report", async (req, res) => {
  try {
    const { projects, weekLabel, saved_at } = req.body;
    if (!projects?.length) return res.status(400).json({ error: "Sin proyectos" });

    const reportDate = projects[0].report_date || new Date().toISOString().slice(0, 10);
    const weekKey    = getMondayOf(reportDate);
    const data       = await readJson(HISTORY_FILE, { reports: [] });
    const entry      = { week_key: weekKey, report_date: reportDate, weekLabel, saved_at: saved_at || new Date().toISOString(), projects };

    const idx = data.reports.findIndex(r => (r.week_key || r.report_date) === weekKey);
    if (idx >= 0) data.reports[idx] = entry;
    else          data.reports.push(entry);

    data.reports.sort((a, b) => b.week_key.localeCompare(a.week_key));
    await writeJson(HISTORY_FILE, data);
    res.json({ ok: true, report_date: reportDate, week_key: weekKey });
  } catch {
    res.status(500).json({ error: "Error guardando reporte" });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const data = await readJson(HISTORY_FILE, { reports: [] });
    res.json({
      reports: data.reports.map(r => ({
        report_date: r.report_date,
        weekLabel:   r.weekLabel,
        saved_at:    r.saved_at,
      })),
    });
  } catch {
    res.status(500).json({ error: "Error leyendo historial" });
  }
});

app.get("/api/history/:date", async (req, res) => {
  try {
    const data  = await readJson(HISTORY_FILE, { reports: [] });
    const entry = data.reports.find(r => r.report_date === req.params.date);
    if (!entry) return res.status(404).json({ error: "Fecha no encontrada" });
    res.json(entry);
  } catch {
    res.status(500).json({ error: "Error leyendo historial" });
  }
});

// ── Estáticos y SPA fallback ──────────────────────────────────────────────────

app.use(express.static(DIST_PATH));
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api")) {
    res.sendFile(path.join(DIST_PATH, "index.html"), err => { if (err) next(err); });
  } else {
    next();
  }
});

app.listen(PORT, "0.0.0.0", async () => {
  await init();
  console.log(`Servidor en puerto ${PORT}`);
});
