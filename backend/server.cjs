// server.cjs — Servidor Express que expone la API REST.
//
// RUTAS DE LA API:
//   GET  /api/projects        → devuelve el estado actual (data.json)
//   POST /api/projects        → sobreescribe el estado actual
//   POST /api/report          → guarda un snapshot semanal (history.json + SQL Server)
//   GET  /api/history         → lista de fechas de reportes guardados
//   GET  /api/history/:date   → datos completos de un reporte por fecha
//
// ARCHIVOS DE DATOS:
//   data.json    → estado actual de todos los proyectos (se sobreescribe en cada guardado)
//   history.json → historial de snapshots semanales (nunca se borra, solo se acumula)
//
// ESCRITURA DUAL:
//   Cada POST /api/report escribe en history.json Y en SQL Server en paralelo.
//   Si SQL Server falla, el error se loguea pero NO interrumpe la respuesta al cliente.
//   El JSON actúa como respaldo ante caídas de la BD.
//
// CORS:
//   FRONTEND_URL en .env limita el origen permitido en producción.
//   Si no está definido, acepta cualquier origen (útil en desarrollo local).
//
// VARIABLE DE ENTORNO PORT: si no está definida, usa 3001 por defecto.
// En Azure App Service, PORT se inyecta automáticamente.

const express = require("express");
const fs      = require("fs").promises;
const path    = require("path");
require("dotenv/config");

const { saveWeekReportToDB } = (() => {
  try {
    const mod = require("./db-operations.cjs");
    console.log("[DB] db-operations.cjs cargado correctamente");
    return mod;
  } catch (e) {
    console.error("[DB] Error cargando db-operations.cjs:", e.message);
    return { saveWeekReportToDB: null };
  }
})();

// ── Configuración ─────────────────────────────────────────────────────────────

function getDataDir() {
  // En Azure App Service Linux, HOME=/home y /home es el único directorio
  // con escritura persistente entre reinicios. En local, usa el directorio del proyecto.
  return process.env.HOME === "/home" ? "/home/data" : __dirname;
}

const DATA_DIR     = getDataDir();
const DATA_FILE    = path.join(DATA_DIR, "data.json");
const HISTORY_FILE = path.join(DATA_DIR, "history.json");
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
// Esta función corre UNA SOLA VEZ al inicio si detecta datos en formato antiguo.
// Una vez migrados, los datos tienen el campo en array y no vuelve a correr.
// Se puede eliminar cuando se tenga certeza de que no hay datos pre-migración.

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

// CORS activo siempre: el frontend vive en un repo y servidor separado,
// por lo que el navegador necesita permiso explícito para llamar a esta API.
// FRONTEND_URL en .env limita el acceso a un origen específico en producción.
// Si no está definido, permite cualquier origen (útil en desarrollo local).
const cors = require("cors");
app.use(cors({
  origin: process.env.FRONTEND_URL || "*",
}));

// ── API: Diagnóstico de conexión BD (solo desarrollo) ────────────────────────

app.get("/api/db-ping", async (req, res) => {
  if (!saveWeekReportToDB) {
    return res.json({ ok: false, error: "db-operations.cjs no cargó (módulo no encontrado)" });
  }
  try {
    const sql  = require("mssql");
    require("dotenv/config");
    const cfg = {
      user:     process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      server:   process.env.DB_SERVER || "localhost",
      database: process.env.DB_NAME,
      options:  { encrypt: false, trustServerCertificate: true },
      connectionTimeout: 5000,
    };
    console.log("[DB-PING] Intentando conectar con:", { server: cfg.server, database: cfg.database, user: cfg.user });
    const pool   = await sql.connect(cfg);
    const result = await pool.request().query("SELECT @@SERVERNAME AS srv, DB_NAME() AS db");
    await pool.close();
    res.json({ ok: true, ...result.recordset[0] });
  } catch (e) {
    console.error("[DB-PING] Fallo:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

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

// Normaliza cualquier fecha a su lunes de semana (YYYY-MM-DD).
// Sirve como clave única por semana: dos reportes de la misma semana
// se sobreescriben en lugar de duplicarse.
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

    // UPSERT por semana: si ya existe un reporte de esa semana, lo reemplaza
    const idx = data.reports.findIndex(r => (r.week_key || r.report_date) === weekKey);
    if (idx >= 0) data.reports[idx] = entry;
    else          data.reports.push(entry);

    data.reports.sort((a, b) => (b.week_key || b.report_date || "").localeCompare(a.week_key || a.report_date || ""));
    await writeJson(HISTORY_FILE, data);
    console.log("[API] Reporte guardado en history.json:", reportDate, weekKey);

    // Escritura en SQL Server: fallo silencioso para no bloquear al usuario
    if (saveWeekReportToDB) {
      saveWeekReportToDB(projects, weekLabel, entry.saved_at)
        .then(() => console.log("[SQL] Reporte guardado en base de datos"))
        .catch(e => console.error("[SQL] Error guardando reporte:", e.message));
    }

    res.json({ ok: true, report_date: reportDate, week_key: weekKey });
  } catch (e) {
    console.error("[API] Error en POST /api/report:", e.message, e.stack);
    res.status(500).json({ error: "Error guardando reporte", detail: e.message });
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

app.listen(PORT, "0.0.0.0", async () => {
  await init();
  console.log(`Servidor en puerto ${PORT}`);
});
