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
const http    = require("http");
const fs      = require("fs").promises;
const path    = require("path");
const crypto  = require("crypto");
require("dotenv/config");
const { toArray } = require("./utils.cjs");

const { saveWeekReportToDB, syncEngineerToSQL, syncEngineerTaskToSQL, deleteEngineerTaskFromSQL, syncActividadesDetalle,
        saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB } = (() => {
  try {
    const mod = require("./db-operations.cjs");
    console.log("[DB] db-operations.cjs cargado correctamente");
    return mod;
  } catch (e) {
    console.error("[DB] Error cargando db-operations.cjs:", e.message);
    return { saveWeekReportToDB: null, syncEngineerToSQL: null, syncEngineerTaskToSQL: null, deleteEngineerTaskFromSQL: null, syncActividadesDetalle: null,
             saveAttachmentToDB: null, getAttachmentFromDB: null, deleteAttachmentFromDB: null };
  }
})();

const { generateReportWithAI, generateStatusSummaryWithAI, generateGlobalStatusWithAI } = (() => {
  try {
    return require("./gemini-report.cjs");
  } catch (e) {
    console.error("[AI] Error cargando gemini-report.cjs:", e.message);
    return { generateReportWithAI: null, generateStatusSummaryWithAI: null, generateGlobalStatusWithAI: null };
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
const PORT         = process.env.PORT || 3002;

// ── Helpers de archivo ────────────────────────────────────────────────────────

async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, "utf-8")); }
  catch { return fallback; }
}

async function writeJson(file, data) {
  await fs.writeFile(file, JSON.stringify(data, null, 2));
}

// Construye el cuerpo de una respuesta de error: el mensaje de error interno
// (e.message) solo se incluye fuera de producción, para no filtrar detalles
// de SQL/filesystem a clientes no confiables. El detalle completo siempre
// queda en el log del servidor vía console.error, sin importar el ambiente.
function errorBody(publicMessage, e) {
  return process.env.NODE_ENV === "production"
    ? { error: publicMessage }
    : { error: publicMessage, detail: e.message };
}

// toArray viene de utils.cjs

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
      ? toArray(p.milestones).map(note => ({ activity: "", date: "", note }))
      : (Array.isArray(p.milestones) ? p.milestones : []);

    const commentsArr = typeof p.comments === "string" && p.comments.trim()
      ? toArray(p.comments).map(text => ({ activity: "", date: "", text }))
      : (Array.isArray(p.comments) ? p.comments : []);

    return {
      ...p,
      activities_identified: toArray(p.activities_identified),
      weekly_achievements:   toArray(p.weekly_achievements),
      next_week_plan:        toArray(p.next_week_plan),
      milestones:            milestonesArr,
      comments:              commentsArr,
      engineers: (p.engineers || []).map(e => ({
        ...e,
        weekly_detail: toArray(e.weekly_detail),
      })),
    };
  });

  if (changed) {
    await writeJson(DATA_FILE, data);
    console.log("Migración string→array/objeto completada");
  }
}

// ── Migración: comments/milestones de proyecto → act.notes/act.key_dates ─────
// Corre UNA SOLA VEZ si detecta que algún proyecto aún tiene p.comments o
// p.milestones en formato antiguo. Mueve cada entrada al array correspondiente
// dentro de la actividad que referencia. Las entradas sin actividad asociada
// se guardan en p.orphan_notes / p.orphan_key_dates para no perder datos.

function genId(prefix) {
  return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function migrateCommentsAndMilestones() {
  const data = await readJson(DATA_FILE, null);
  if (!data?.projects?.length) return;

  let changed = false;

  data.projects = data.projects.map(p => {
    const hasOldComments   = Array.isArray(p.comments)   && p.comments.length   > 0;
    const hasOldMilestones = Array.isArray(p.milestones) && p.milestones.length > 0;
    if (!hasOldComments && !hasOldMilestones) return p;

    changed = true;

    // Construye mapa actId → actividad para asignar notas/fechas
    const actMap = new Map((p.activities_identified || []).map(a => [a.id, a]));

    // Asegura que todas las actividades tengan los campos nuevos
    const newActs = (p.activities_identified || []).map(a => ({
      ...a,
      notes:     Array.isArray(a.notes)     ? a.notes     : [],
      key_dates: Array.isArray(a.key_dates) ? a.key_dates : [],
    }));
    const newActMap = new Map(newActs.map(a => [a.id, a]));

    const orphanNotes    = [...(p.orphan_notes    || [])];
    const orphanKeyDates = [...(p.orphan_key_dates || [])];

    // Migrar p.comments → act.notes
    if (hasOldComments) {
      (p.comments || []).forEach(c => {
        const note = { id: genId("note"), date: c.date || "", text: c.text || "" };
        if (c.activity && newActMap.has(c.activity)) {
          newActMap.get(c.activity).notes.push(note);
        } else {
          orphanNotes.push(note);
        }
      });
    }

    // Migrar p.milestones → act.key_dates
    if (hasOldMilestones) {
      (p.milestones || []).forEach(m => {
        const kd = { id: genId("kd"), date: m.date || "", label: m.note || "" };
        if (m.activity && newActMap.has(m.activity)) {
          newActMap.get(m.activity).key_dates.push(kd);
        } else {
          orphanKeyDates.push(kd);
        }
      });
    }

    const result = {
      ...p,
      activities_identified: newActs,
      comments:   undefined,
      milestones: undefined,
    };
    delete result.comments;
    delete result.milestones;
    if (orphanNotes.length)    result.orphan_notes    = orphanNotes;
    if (orphanKeyDates.length) result.orphan_key_dates = orphanKeyDates;
    return result;
  });

  if (changed) {
    await writeJson(DATA_FILE, data);
    console.log("Migración comments/milestones → act.notes/key_dates completada");
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
      await writeJson(DATA_FILE, { projects: [], weekLabel: null, engineers: [] });
    }
  }

  await migrateArrayFields();
  await migrateCommentsAndMilestones();

  if (!(await readJson(HISTORY_FILE, null))) {
    await writeJson(HISTORY_FILE, { reports: [] });
  }

  console.log(`Datos en: ${DATA_DIR}`);
}

// ── Express ───────────────────────────────────────────────────────────────────

const app = express();
const helmet = require("helmet");
app.use(helmet());
// El body parser NO se registra a nivel global: la ruta de adjuntos necesita
// un límite mucho mayor (base64 de hasta 10MB de archivo) que el resto de
// rutas, que solo mueven JSON de proyectos/reportes (data.json actual: ~80KB).
// Cada grupo de rutas monta su propio express.json() con el límite adecuado.
const jsonParser           = express.json({ limit: "2mb" });
const attachmentJsonParser = express.json({ limit: "14mb" }); // 10MB archivo + overhead base64/JSON

// CORS activo siempre: el frontend vive en un repo y servidor separado,
// por lo que el navegador necesita permiso explícito para llamar a esta API.
// FRONTEND_URL en .env limita el acceso a un origen específico.
// En producción es obligatorio (el servidor no arranca sin él); en desarrollo
// local, si no está definido, cae a localhost:5173 (puerto por defecto de Vite).
const cors = require("cors");
const isProduction = process.env.NODE_ENV === "production";

if (isProduction && !process.env.FRONTEND_URL) {
  console.error("[FATAL] FRONTEND_URL debe estar definido en producción (NODE_ENV=production).");
  process.exit(1);
}

app.use(cors({
  origin: process.env.FRONTEND_URL || "http://localhost:5173",
}));

// ── Autenticación: API key compartida ─────────────────────────────────────────
// Herramienta interna: todos los clientes autorizados comparten la misma clave,
// enviada en el header X-API-Key. No distingue usuarios individuales — para eso
// se necesitaría un sistema de login completo, fuera del alcance actual.
//
// API_KEY debe estar definida en .env. Sin ella, el servidor no arranca en
// producción (falla cerrado). En desarrollo, si falta, se loguea una advertencia
// y la API queda abierta — solo para no bloquear el flujo local de un dev nuevo.
const API_KEY = process.env.API_KEY || "";

if (!API_KEY) {
  if (isProduction) {
    console.error("[FATAL] API_KEY debe estar definida en producción (NODE_ENV=production).");
    process.exit(1);
  }
  console.warn("[WARN] API_KEY no definida — la API queda sin autenticación (solo aceptable en desarrollo local).");
}

function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // solo en desarrollo, ver advertencia arriba
  const provided = req.headers["x-api-key"] || "";
  const a = Buffer.from(String(provided));
  const b = Buffer.from(API_KEY);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!valid) return res.status(401).json({ error: "No autorizado" });
  next();
}

app.use("/api", requireApiKey);

// Body parser: límite pequeño para toda la API excepto /api/attachments/upload,
// que monta su propio parser con límite ampliado (ver esa ruta más abajo) antes
// de que el body llegue aquí. Express ejecuta los parsers en orden de registro,
// así que basta con excluir esa ruta del parser genérico para que no choquen.
app.use((req, res, next) => {
  if (req.path === "/api/attachments/upload") return next();
  jsonParser(req, res, next);
});

// ── Rate limiting ──────────────────────────────────────────────────────────
// Las rutas que llaman a proveedores de IA de pago (Gemini/Groq/OpenRouter) y
// las operaciones destructivas de trimestre reciben límites propios y más
// estrictos que el resto de la API, ya que cada llamada tiene costo real
// (dinero en el caso de IA, pérdida de datos en el caso de quarter-reset).
const rateLimit = require("express-rate-limit");

const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas solicitudes de generación con IA, intenta de nuevo más tarde" },
});

const destructiveLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Demasiadas operaciones destructivas, intenta de nuevo más tarde" },
});

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api", generalLimiter);
app.use(["/api/generate-report", "/api/project-status", "/api/generate-global-status"], aiLimiter);
app.use(["/api/quarter-reset", "/api/clean-stats"], destructiveLimiter);

// ── API: Diagnóstico de conexión BD (solo desarrollo) ────────────────────────
// Deshabilitada en producción: expone nombre de servidor/BD y detalle de error.

app.get("/api/db-ping", async (req, res) => {
  if (isProduction) {
    return res.status(404).json({ error: "No encontrado" });
  }
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
      port:     1433,
      database: process.env.DB_NAME,
      options:  { encrypt: true, trustServerCertificate: process.env.NODE_ENV !== "production" },
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

    // Sync operacional: solo el proyecto que cambió (identificado por changedProjectId)
    if (syncActividadesDetalle) {
      const projects = Array.isArray(req.body?.projects) ? req.body.projects : [];
      const changedId = req.body?.changedProjectId;
      const toSync = changedId
        ? projects.filter(p => p.id === changedId)
        : projects;

      for (const project of toSync) {
        syncActividadesDetalle(project)
          .then(() => console.log(`[SQL] ✓ Actividades sincronizadas — proyecto ${project.id}`))
          .catch(e => {
            console.warn(`[SQL] ⚠ Reintentando sync proyecto ${project.id} en 5s:`, e.message);
            setTimeout(() => {
              syncActividadesDetalle(project)
                .then(() => console.log(`[SQL] ✓ Actividades sincronizadas (reintento) — proyecto ${project.id}`))
                .catch(e2 => console.error(`[SQL] ✗ Error definitivo sync proyecto ${project.id}:`, e2.message));
            }, 5000);
          });
      }
    }
  } catch {
    res.status(500).json({ error: "Error guardando proyectos" });
  }
});

// ── API: Sincronización de colaboradores externos ─────────────────────────────

app.post("/api/external-contacts/sync-one", async (req, res) => {
  const { syncExternalContactToSQL } = (() => {
    try { return require("./db-operations.cjs"); } catch { return {}; }
  })();

  if (!syncExternalContactToSQL) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const { contact } = req.body;
    if (!contact?.name) return res.status(400).json({ error: "Falta el nombre del colaborador" });
    const sqlId = await syncExternalContactToSQL(contact);
    res.json({ ok: true, sql_id: sqlId });
  } catch (e) {
    console.error("[SQL] Error sincronizando colaborador externo:", e.message);
    res.status(500).json(errorBody("Error sincronizando colaborador externo", e));
  }
});

// ── API: Sincronización de un ingeniero con la tabla SQL Ingenieros ───────────
// Se llama cada vez que se crea/edita/desactiva un ingeniero en la app, para que
// la tabla Ingenieros de Azure SQL quede al día de inmediato (nombre, cargo, estado).
// Devuelve el IngenieroID real de SQL para guardarlo en el catálogo local (sql_id).

app.post("/api/engineers/sync-one", async (req, res) => {
  if (!syncEngineerToSQL) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const { engineer } = req.body;
    if (!engineer?.name) return res.status(400).json({ error: "Falta el ingeniero" });
    const sqlId = await syncEngineerToSQL(engineer);
    res.json({ ok: true, sql_id: sqlId });
  } catch (e) {
    console.error("[SQL] Error sincronizando ingeniero:", e.message);
    res.status(500).json(errorBody("Error sincronizando ingeniero", e));
  }
});

// ── API: Sincronización de tareas sueltas del ingeniero ───────────────────────
// Las tareas sueltas no están asociadas a ningún proyecto/reporte, así que viven
// en su propia tabla (Tareas_Sueltas_Ingeniero), upsert por AppTaskID (el id local
// "etask_xxx"). Si el ingeniero aún no tiene sql_id (nunca se le había guardado
// nada en SQL), se crea/resuelve primero.

app.post("/api/engineers/tasks/sync-one", async (req, res) => {
  if (!syncEngineerTaskToSQL) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const { engineer, task } = req.body;
    if (!engineer?.name || !task?.id) return res.status(400).json({ error: "Falta el ingeniero o la tarea" });

    const engineerSqlId = engineer.sql_id || await syncEngineerToSQL(engineer);
    await syncEngineerTaskToSQL(engineerSqlId, task);
    res.json({ ok: true, sql_id: engineerSqlId });
  } catch (e) {
    console.error("[SQL] Error sincronizando tarea suelta:", e.message);
    res.status(500).json(errorBody("Error sincronizando tarea suelta", e));
  }
});

app.post("/api/engineers/tasks/delete-one", async (req, res) => {
  if (!deleteEngineerTaskFromSQL) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: "Falta el id de la tarea" });
    await deleteEngineerTaskFromSQL(taskId);
    res.json({ ok: true });
  } catch (e) {
    console.error("[SQL] Error borrando tarea suelta:", e.message);
    res.status(500).json(errorBody("Error borrando tarea suelta", e));
  }
});

// ── API: Adjuntos de actividades ──────────────────────────────────────────────
// Los archivos se guardan como bytes en SQL (tabla Actividad_Adjuntos).
// El frontend envía el contenido en base64. Límite ~10 MB por archivo.

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

app.post("/api/attachments/upload", attachmentJsonParser, async (req, res) => {
  if (!saveAttachmentToDB) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const { appAdjuntoID, appActividadID, proyectoAppID, nombre, mime, dataBase64 } = req.body || {};
    if (!appAdjuntoID || !appActividadID || !nombre || !dataBase64) {
      return res.status(400).json({ error: "Faltan campos del adjunto" });
    }
    const buffer = Buffer.from(dataBase64, "base64");
    if (buffer.length > MAX_ATTACHMENT_BYTES) {
      return res.status(413).json({ error: `El archivo supera el límite de ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB` });
    }
    await saveAttachmentToDB({
      appAdjuntoID, appActividadID, proyectoAppID,
      nombre, mime, size: buffer.length, buffer,
    });
    res.json({ ok: true, size: buffer.length });
  } catch (e) {
    console.error("[SQL] Error guardando adjunto:", e.message);
    res.status(500).json(errorBody("Error guardando adjunto", e));
  }
});

app.get("/api/attachments/:id", async (req, res) => {
  if (!getAttachmentFromDB) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const att = await getAttachmentFromDB(req.params.id);
    if (!att || !att.buffer) return res.status(404).json({ error: "Adjunto no encontrado" });
    res.setHeader("Content-Type", att.mime || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(att.nombre)}"`);
    res.setHeader("Content-Length", att.buffer.length);
    res.send(att.buffer);
  } catch (e) {
    console.error("[SQL] Error descargando adjunto:", e.message);
    res.status(500).json(errorBody("Error descargando adjunto", e));
  }
});

app.post("/api/attachments/delete", async (req, res) => {
  if (!deleteAttachmentFromDB) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const { appAdjuntoID } = req.body || {};
    if (!appAdjuntoID) return res.status(400).json({ error: "Falta el id del adjunto" });
    await deleteAttachmentFromDB(appAdjuntoID);
    res.json({ ok: true });
  } catch (e) {
    console.error("[SQL] Error borrando adjunto:", e.message);
    res.status(500).json(errorBody("Error borrando adjunto", e));
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

    // Responde al frontend inmediatamente — el JSON ya está guardado
    res.json({ ok: true, report_date: reportDate, week_key: weekKey });

    // Escritura en SQL Server en segundo plano con reintento automático
    if (saveWeekReportToDB) {
      const currentData = await readJson(DATA_FILE, { engineers: [] });
      const engineersCatalog = currentData.engineers || [];
      saveWeekReportToDB(projects, weekLabel, entry.saved_at, engineersCatalog)
        .then(() => console.log("[SQL] ✓ Reporte guardado en base de datos:", reportDate))
        .catch(e => {
          console.warn("[SQL] ⚠ Primer intento fallido, reintentando en 5s:", e.message);
          setTimeout(() => {
            saveWeekReportToDB(projects, weekLabel, entry.saved_at, engineersCatalog)
              .then(() => console.log("[SQL] ✓ Reporte guardado en base de datos (reintento):", reportDate))
              .catch(e2 => console.error("[SQL] ✗ Error definitivo guardando en BD:", e2.message));
          }, 5000);
        });
    }
  } catch (e) {
    console.error("[API] Error en POST /api/report:", e.message, e.stack);
    res.status(500).json(errorBody("Error guardando reporte", e));
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

// ── API: Generación de informe con IA ─────────────────────────────────────────

app.post("/api/generate-report", async (req, res) => {
  if (!generateReportWithAI) {
    return res.status(503).json({ error: "Módulo de IA no disponible" });
  }
  try {
    const { project, quarterLabel, engineerCatalog } = req.body;
    if (!project) return res.status(400).json({ error: "Falta el proyecto" });

    console.log("[AI] Generando informe para:", project.project_name);
    const analysis = await generateReportWithAI(project, quarterLabel || "", engineerCatalog || []);
    console.log("[AI] Informe generado OK");
    res.json({ ok: true, analysis });
  } catch (e) {
    console.error("[AI] Error generando informe:", e.message);
    res.status(500).json(errorBody("Error generando informe con IA", e));
  }
});

// ── API: Status semanal con IA ────────────────────────────────────────────────

app.post("/api/project-status", async (req, res) => {
  if (!generateStatusSummaryWithAI) {
    return res.status(503).json({ error: "Módulo de IA no disponible" });
  }
  try {
    const { project } = req.body;
    if (!project) return res.status(400).json({ error: "Falta el proyecto" });
    console.log("[AI-STATUS] Generando status para:", project.project_name);
    const status = await generateStatusSummaryWithAI(project);
    console.log("[AI-STATUS] OK");
    res.json({ ok: true, status });
  } catch (e) {
    console.error("[AI-STATUS] Error:", e.message);
    res.status(500).json(errorBody("Error generando status", e));
  }
});

// ── API: Status Global con IA ─────────────────────────────────────────────────

app.post("/api/generate-global-status", async (req, res) => {
  if (!generateGlobalStatusWithAI) {
    return res.status(503).json({ error: "Módulo de IA no disponible" });
  }
  try {
    const { projects, weekLabel, engineerCatalog, mode } = req.body;
    if (!projects?.length) return res.status(400).json({ error: "Sin proyectos para analizar" });
    console.log(`[AI-GLOBAL] Generando status ${mode || "full"} para ${projects.length} proyectos...`);
    const analysis = await generateGlobalStatusWithAI(projects, weekLabel || "", engineerCatalog || [], mode || "full");
    console.log("[AI-GLOBAL] OK");
    res.json({ ok: true, analysis });
  } catch (e) {
    console.error("[AI-GLOBAL] Error:", e.message);
    res.status(500).json(errorBody("Error generando status global", e));
  }
});

// ── API: Restaurar desde BD ───────────────────────────────────────────────────

app.post("/api/restore-from-db", async (req, res) => {
  if (!saveWeekReportToDB) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const { sql, connect } = require("mssql");
    const config = {
      user:              process.env.DB_USER,
      password:          process.env.DB_PASSWORD,
      server:            process.env.DB_SERVER || "localhost",
      port:              1433,
      database:          process.env.DB_NAME,
      connectionTimeout: 60000,
      requestTimeout:    60000,
      options:           { encrypt: true, trustServerCertificate: process.env.NODE_ENV !== "production" },
    };
    const pool = await connect(config);

    // Trae el RawDataJSON más reciente de cada proyecto
    const result = await pool.request().query(`
      SELECT r.RawDataJSON
      FROM ReportesSemanales r
      INNER JOIN (
        SELECT ProyectoID, MAX(SavedAt) AS UltimoGuardado
        FROM ReportesSemanales
        GROUP BY ProyectoID
      ) latest ON r.ProyectoID = latest.ProyectoID AND r.SavedAt = latest.UltimoGuardado
      WHERE r.RawDataJSON IS NOT NULL AND r.RawDataJSON != ''
    `);

    await pool.close();

    const projects = result.recordset
      .map(row => { try { return JSON.parse(row.RawDataJSON); } catch { return null; } })
      .filter(Boolean);

    if (!projects.length) {
      return res.status(404).json({ error: "No hay datos de respaldo en la base de datos" });
    }

    // Sobreescribe el data.json con los proyectos restaurados
    const currentData = await readJson(DATA_FILE, { projects: [], weekLabel: null });
    await writeJson(DATA_FILE, { ...currentData, projects });

    console.log(`[RESTORE] ✓ Restaurados ${projects.length} proyectos desde la BD`);
    res.json({ ok: true, restored: projects.length });
  } catch (e) {
    console.error("[RESTORE] Error:", e.message);
    res.status(500).json(errorBody("Error restaurando desde BD", e));
  }
});

// ── API: Reinicio de trimestre ────────────────────────────────────────────────
//
// POST /api/quarter-reset
//   Recibe el estado actual completo (projects, engineers, externalContacts, weekLabel).
//   Ejecuta en orden:
//     1. Calcula estadísticas del trimestre que se cierra.
//     2. Guarda snapshot completo en SQL (Trimestres_Archivo) y en archivo físico.
//     3. Construye el nuevo estado limpio (solo actividades no terminadas).
//     4. Sobreescribe data.json con el estado nuevo.
//   Responde con un resumen del resultado para mostrar al usuario.
//
// Estrategia de limpieza por proyecto:
//   - activities_identified: se conservan SOLO las in_progress y not_started
//   - task_status.completed: se vacía
//   - task_status.in_progress / not_started: se conservan sin cambios
//   - task_status.status_history: se conservan solo las entradas de actos que continúan
//   - engineers[].weekly_total y weekly_detail: se resetean a 0 / []
//   - weekly_achievements, next_week_plan, impediments: se vacían
//   - manual_metrics: se recalcula basado en las actividades que quedan
//   - La actividad en sí (checklist, notas, fechas clave, prioridad, etc.): se conserva intacta

app.post("/api/quarter-reset", async (req, res) => {
  try {
    const { projects = [], engineers = [], externalContacts = [], weekLabel = "", quarterLabel = "", quarterStart = "" } = req.body;

    if (!quarterLabel) return res.status(400).json({ error: "Falta quarterLabel (ej: 'Q2 2026')" });

    // ── 1. Calcular estadísticas del trimestre que se cierra ───────────────
    let totalArchivadas  = 0;
    let totalTransferidas = 0;

    for (const p of projects) {
      const completadas = (p.task_status?.completed   || []).length;
      const enProceso   = (p.task_status?.in_progress || []).length;
      const noIniciadas = (p.task_status?.not_started || []).length;
      totalArchivadas   += completadas;
      totalTransferidas += enProceso + noIniciadas;
    }

    // ── 2. Guardar snapshot completo en archivo físico de respaldo ─────────
    const archiveDir  = path.join(__dirname, "archive");
    const archiveFile = path.join(archiveDir, `quarter_${quarterLabel.replace(/\s/g, "_")}.json`);

    // Crear directorio archive si no existe
    const fs = require("fs");
    if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

    const snapshotData = { projects, engineers, externalContacts, weekLabel, quarterLabel, archivedAt: new Date().toISOString() };
    await writeJson(archiveFile, snapshotData);
    console.log(`[QUARTER] ✓ Snapshot guardado en archivo: ${archiveFile}`);

    // ── 3. Guardar snapshot en SQL (Trimestres_Archivo) ────────────────────
    //    Usamos el pool de db-operations si está disponible.
    //    Si falla SQL, el archivo físico ya tiene el backup — no bloqueamos el reset.
    try {
      const mssql  = require("mssql");
      const config = {
        user:              process.env.DB_USER,
        password:          process.env.DB_PASSWORD,
        server:            process.env.DB_SERVER || "localhost",
        port:              1433,
        database:          process.env.DB_NAME,
        connectionTimeout: 30000,
        requestTimeout:    30000,
        options:           { encrypt: true, trustServerCertificate: process.env.NODE_ENV !== "production" },
      };
      const pool = await mssql.connect(config);
      await pool.request()
        .input("quarterLabel",  mssql.NVarChar(50),   quarterLabel)
        .input("fechaInicio",   mssql.Date,           quarterStart ? new Date(quarterStart) : new Date())
        .input("totalProy",     mssql.Int,             projects.length)
        .input("archivadas",    mssql.Int,             totalArchivadas)
        .input("transferidas",  mssql.Int,             totalTransferidas)
        .input("jsonData",      mssql.NVarChar,        JSON.stringify(snapshotData))
        .query(`
          INSERT INTO Trimestres_Archivo
            (QuarterLabel, FechaInicio, TotalProyectos, ActividadesArchivadas, ActividadesTransferidas, ArchivedDataJSON)
          VALUES
            (@quarterLabel, @fechaInicio, @totalProy, @archivadas, @transferidas, @jsonData)
        `);
      await pool.close();
      console.log(`[QUARTER] ✓ Snapshot guardado en SQL: ${quarterLabel}`);
    } catch (sqlErr) {
      // SQL falló pero el archivo físico ya está guardado — el reset continúa igual
      console.warn(`[QUARTER] ⚠ SQL falló (archivo físico disponible como respaldo): ${sqlErr.message}`);
    }

    // ── 4. Construir el nuevo estado limpio para el nuevo trimestre ─────────
    const newProjects = projects.map(p => {
      const ts          = p.task_status || {};
      const keepIds     = new Set([...(ts.in_progress || []), ...(ts.not_started || [])]);

      // Solo conservar actividades que NO están completadas
      const newActs = (p.activities_identified || []).filter(a => keepIds.has(a.id));

      // Conservar solo las entradas de status_history de las actividades que continúan
      const newHistory  = {};
      for (const actId of keepIds) {
        if (ts.status_history?.[actId]) newHistory[actId] = ts.status_history[actId];
      }

      // Recalcular métricas basadas en las actividades que quedan
      const newMetrics = {
        total_tasks:           newActs.length,
        completed_tasks:       0,
        in_progress_tasks:     (ts.in_progress || []).length,
        shared_tasks_discount: 0,
      };

      // Resetear ingenieros: limpiar contadores históricos y estadísticas semanales
      const newEngineers = (p.engineers || []).map(e => ({
        ...e,
        assigned:      0,
        completed:     0,
        in_progress:   0,
        weekly_total:  0,
        weekly_detail: [],
      }));

      return {
        ...p,
        activities_identified: newActs,
        task_status: {
          completed:      [],
          in_progress:    ts.in_progress  || [],
          not_started:    ts.not_started  || [],
          status_history: newHistory,
        },
        manual_metrics:      newMetrics,
        engineers:           newEngineers,
        weekly_achievements: [],
        next_week_plan:      [],
        impediments:         [],
        show_closing_fields: false,
      };
    });

    // ── 5. Sobreescribir data.json con el estado del nuevo trimestre ───────
    const currentData = await readJson(DATA_FILE, {});
    await writeJson(DATA_FILE, {
      ...currentData,
      projects:        newProjects,
      engineers,
      externalContacts,
      weekLabel,
    });

    console.log(`[QUARTER] ✓ Reset trimestral completado. Archivadas: ${totalArchivadas}, Transferidas: ${totalTransferidas}`);

    res.json({
      ok:                   true,
      quarterLabel,
      archivedAt:           new Date().toISOString(),
      totalProyectos:       projects.length,
      activitiesArchived:   totalArchivadas,
      activitiesTransferred: totalTransferidas,
    });

  } catch (e) {
    console.error("[QUARTER] Error en reset:", e.message);
    res.status(500).json(errorBody("Error ejecutando el reset trimestral", e));
  }
});

// ── API: Limpiar estadísticas del trimestre actual ────────────────────────────
//
// POST /api/clean-stats
//   Borra weekly_total, weekly_detail, status_history, weekly_achievements,
//   next_week_plan e impediments de todos los proyectos actuales.
//   NO archiva nada. Úsalo cuando el reset ya se ejecutó pero quedaron datos sucios.

app.post("/api/clean-stats", async (req, res) => {
  try {
    const currentData = await readJson(DATA_FILE, {});

    const projects = (currentData.projects || []).map(p => {
      const ts = p.task_status || {};

      // Actividades que NO están completadas (se conservan intactas)
      const keepIds = new Set([...(ts.in_progress || []), ...(ts.not_started || [])]);
      const newActs = (p.activities_identified || []).filter(a => keepIds.has(a.id));

      // Recalcular métricas basadas en las actividades que quedan
      const newMetrics = {
        total_tasks:           newActs.length,
        completed_tasks:       0,
        in_progress_tasks:     (ts.in_progress || []).length,
        shared_tasks_discount: 0,
      };

      return {
        ...p,
        // Estado del proyecto → neutro
        status:              "on-track",
        status_notes:        "",
        show_closing_fields: false,
        // Métricas → recalculadas limpias
        manual_metrics:      newMetrics,
        // Indicadores → vaciados
        indicators:          (p.indicators || []).map(ind => ({
          ...ind,
          total: 0, completed: 0, in_progress: 0,
        })),
        // Semana → limpia
        weekly_achievements: [],
        next_week_plan:      [],
        impediments:         [],
        comments:            [],
        milestones:          (p.milestones || []).map(m => ({ ...m, completed: false })),
        // Solo actividades no completadas, sin historial de fechas
        activities_identified: newActs,
        task_status: {
          completed:      [],
          in_progress:    ts.in_progress || [],
          not_started:    ts.not_started || [],
          status_history: {},
        },
        // Ingenieros por proyecto → limpiar estadísticas semanales e histórico de contadores
        engineers: (p.engineers || []).map(e => ({
          ...e,
          assigned:      0,
          completed:     0,
          in_progress:   0,
          weekly_total:  0,
          weekly_detail: [],
        })),
      };
    });

    await writeJson(DATA_FILE, { ...currentData, projects });
    console.log(`[CLEAN-STATS] ✓ Limpieza completa: ${projects.length} proyectos`);
    res.json({ ok: true, projectsCleaned: projects.length });
  } catch (e) {
    console.error("[CLEAN-STATS] Error:", e.message);
    res.status(500).json(errorBody("Error limpiando estadísticas", e));
  }
});

// ── API: Lista de trimestres archivados ───────────────────────────────────────
//
// GET /api/quarters
//   Primero intenta leer desde SQL (fuente primaria).
//   Si SQL no está disponible, lee los archivos JSON físicos del directorio archive/.
//   Devuelve lista ordenada de más reciente a más antiguo.

app.get("/api/quarters", async (req, res) => {
  // Intentar desde SQL primero
  try {
    const mssql  = require("mssql");
    const config = {
      user:              process.env.DB_USER,
      password:          process.env.DB_PASSWORD,
      server:            process.env.DB_SERVER || "localhost",
      port:              1433,
      database:          process.env.DB_NAME,
      connectionTimeout: 15000,
      requestTimeout:    15000,
      options:           { encrypt: true, trustServerCertificate: process.env.NODE_ENV !== "production" },
    };
    const pool   = await mssql.connect(config);
    const result = await pool.request().query(`
      SELECT TrimestreID, QuarterLabel, FechaInicio, FechaReset,
             TotalProyectos, ActividadesArchivadas, ActividadesTransferidas, CreadoEn
      FROM Trimestres_Archivo
      ORDER BY FechaReset DESC
    `);
    await pool.close();
    return res.json({ ok: true, source: "sql", quarters: result.recordset });
  } catch (sqlErr) {
    console.warn("[QUARTER] SQL no disponible para listar trimestres, leyendo archivos físicos:", sqlErr.message);
  }

  // Fallback: leer archivos físicos del directorio archive/
  try {
    const fs         = require("fs");
    const archiveDir = path.join(__dirname, "archive");
    if (!fs.existsSync(archiveDir)) return res.json({ ok: true, source: "files", quarters: [] });

    const files   = fs.readdirSync(archiveDir).filter(f => f.startsWith("quarter_") && f.endsWith(".json"));
    const quarters = files.map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(archiveDir, f), "utf8"));
        return {
          TrimestreID:             f,
          QuarterLabel:            data.quarterLabel || f,
          FechaReset:              data.archivedAt,
          TotalProyectos:          data.projects?.length || 0,
          ActividadesArchivadas:   null,
          ActividadesTransferidas: null,
        };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => new Date(b.FechaReset) - new Date(a.FechaReset));

    return res.json({ ok: true, source: "files", quarters });
  } catch (e) {
    res.status(500).json(errorBody("Error leyendo trimestres archivados", e));
  }
});

// ── API: Datos completos de un trimestre archivado ────────────────────────────
//
// GET /api/quarters/:id
//   :id puede ser un TrimestreID numérico (desde SQL) o el nombre del archivo físico.
//   Devuelve el JSON completo del trimestre para mostrarlo en la app (modo lectura).

app.get("/api/quarters/:id", async (req, res) => {
  const { id } = req.params;

  // Si es numérico, buscar en SQL
  if (/^\d+$/.test(id)) {
    try {
      const mssql  = require("mssql");
      const config = {
        user:              process.env.DB_USER,
        password:          process.env.DB_PASSWORD,
        server:            process.env.DB_SERVER || "localhost",
        port:              1433,
        database:          process.env.DB_NAME,
        connectionTimeout: 15000,
        requestTimeout:    30000,
        options:           { encrypt: true, trustServerCertificate: process.env.NODE_ENV !== "production" },
      };
      const pool   = await mssql.connect(config);
      const result = await pool.request()
        .input("id", mssql.Int, parseInt(id))
        .query(`SELECT ArchivedDataJSON, QuarterLabel, FechaInicio, FechaReset FROM Trimestres_Archivo WHERE TrimestreID = @id`);
      await pool.close();

      if (!result.recordset.length) return res.status(404).json({ error: "Trimestre no encontrado" });

      const row  = result.recordset[0];
      const data = JSON.parse(row.ArchivedDataJSON);
      return res.json({ ok: true, source: "sql", quarterLabel: row.QuarterLabel, ...data });
    } catch (sqlErr) {
      console.warn("[QUARTER] SQL falló, intentando archivo físico:", sqlErr.message);
    }
  }

  // Fallback o ID de archivo: leer desde archive/
  try {
    const fs         = require("fs");
    const archiveDir = path.join(__dirname, "archive");
    // El id puede ser el nombre del archivo (quarter_Q2_2026.json) o el quarterLabel.
    // Se valida contra un charset seguro antes de tocar el filesystem para evitar
    // path traversal vía "../" — path.join() por sí solo NO bloquea esto.
    if (!/^[\w.\-]+$/.test(id)) {
      return res.status(400).json({ error: "ID de trimestre inválido" });
    }
    const fileName   = id.endsWith(".json") ? id : `${id}.json`;
    const filePath   = path.join(archiveDir, fileName);

    // Cinturón y tirantes: confirma que la ruta resuelta sigue dentro de archiveDir.
    if (!filePath.startsWith(archiveDir + path.sep)) {
      return res.status(400).json({ error: "Ruta de trimestre inválida" });
    }

    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Archivo de trimestre no encontrado" });

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return res.json({ ok: true, source: "file", ...data });
  } catch (e) {
    res.status(500).json(errorBody("Error leyendo trimestre", e));
  }
});

init().then(() => {
  http.createServer(app).listen(PORT, "0.0.0.0", () => {
    console.log(`Servidor en puerto ${PORT}`);
  });
}).catch(e => {
  console.error("Error en inicialización:", e.message);
  process.exit(1);
});
