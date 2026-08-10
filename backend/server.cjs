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
require("dotenv/config");
const { toArray } = require("./utils.cjs");
const { computeQuarterStats, buildResetProjects } = require("./quarter-reset.cjs");

// Middlewares extraídos (Fase 2.3). El ORDEN en que se montan más abajo es
// parte del contrato de seguridad — ver los comentarios de cada módulo.
const { requireApiKey }                    = require("./middleware/api-key.cjs");
const { montarRateLimits }                 = require("./middleware/rate-limits.cjs");
const { crearResolverSesion, requireAdmin } = require("./middleware/session.cjs");

// Carga defensiva de los módulos opcionales — ver config/modules.cjs. Antes
// eran 4 bloques IIFE aquí mismo, cada uno con su lista de nulls a mano; esa
// lista ya había divergido (le faltaba syncExternalContactToSQL, ver el
// handler de /api/external-contacts/sync-one).
const { db, ai, auth, reportsRouter } = require("./config/modules.cjs");

const { getPool, saveWeekReportToDB, syncEngineerToSQL, syncEngineerTaskToSQL,
        deleteEngineerTaskFromSQL, syncActividadesDetalle, syncExternalContactToSQL,
        saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB,
        rebuildDataJsonFromSQL, maxSqlSavedAt,
        listUsers, createUser, updateUser } = db;

const { parseCookies, hashPassword, verifyPassword, createSession,
        getSessionUser, deleteSession, SESSION_COOKIE } = auth;

const { generateReportWithAI, generateStatusSummaryWithAI, generateGlobalStatusWithAI } = ai;

// ── Configuración ─────────────────────────────────────────────────────────────
// La resolución del directorio de datos y los helpers de lectura/escritura
// viven en lib/json-store.cjs. OJO: ese módulo ancla la ruta al directorio del
// backend con path.join(__dirname, ".."), porque su propio __dirname es
// backend/lib — usarlo a secas escribiría los datos en el sitio equivocado.

const { DATA_DIR, DATA_FILE, HISTORY_FILE, readJson, writeJson } = require("./lib/json-store.cjs");
const { errorBody, asyncHandler, requireModulo } = require("./middleware/error-handler.cjs");

// config/env.cjs valida FRONTEND_URL y API_KEY al cargarse: en producción hace
// process.exit(1) si faltan, antes de que la app acepte peticiones.
const { isProduction, API_KEY, PORT, FRONTEND_URL } = require("./config/env.cjs");

// toArray viene de utils.cjs
// Migraciones de datos legados y arranque — extraídos a lib/ (Fase 2.4).
// legacy-migrations.cjs está aislado para poder BORRARLO cuando se confirme
// que no queda ningún data.json en formato pre-migración.
const { crearInit } = require("./lib/bootstrap.cjs");

const init = crearInit({ rebuildDataJsonFromSQL, maxSqlSavedAt });


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

app.use(cors({
  origin: FRONTEND_URL,
  credentials: true, // necesario para que el navegador mande/reciba la cookie de sesión (Fase 9)
}));

// ── Logging de eventos de seguridad ───────────────────────────────────────────
// Formato JSON de una línea (fácil de grep/parsear) para los eventos que
// importan para detectar abuso: fallos de auth y límites de rate excedidos.
// No reemplaza el console.log/error operacional existente en el resto del
// archivo — es un canal aparte, específico para auditoría de seguridad.
const { logSecurityEvent } = require("./middleware/security-log.cjs");

// ── Autenticación: API key compartida ─────────────────────────────────────────
// Herramienta interna: todos los clientes autorizados comparten la misma clave,
// enviada en el header X-API-Key. No distingue usuarios individuales — para eso
// se necesitaría un sistema de login completo, fuera del alcance actual.
//
// API_KEY debe estar definida en .env. Sin ella, el servidor no arranca en
// producción (falla cerrado) — la validación vive en config/env.cjs y corre al
// cargar ese módulo, antes de que la app acepte peticiones.

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
//
// Los 4 limitadores viven en middleware/rate-limits.cjs. Se montan aquí, tras
// requireApiKey y el body parser, y antes de la resolución de sesión.
montarRateLimits(app);

// ── Login por base de datos (Fase 9 revisada) ─────────────────────────────
// Convive con X-API-Key (requireApiKey arriba lo sigue exigiendo en todo
// /api/*): esto agrega identidad real ENCIMA, no la reemplaza. Sin roles
// todavía — cualquier usuario logueado puede hacer lo mismo que ya permite
// la API_KEY. req.user queda disponible para el resto de rutas (ej. Autor
// real en notas de proyecto) sin bloquear la request si no hay sesión.
app.use("/api", crearResolverSesion({ getPool, getSessionUser, parseCookies, SESSION_COOKIE }));

// Capa de autorización (migración 019) — distinta de requireApiKey (que
// sigue siendo el candado general) y de "estar logueado" (que solo exige
// req.user truthy). Va DESPUÉS del middleware de arriba porque depende de
// req.user ya resuelto. Solo se aplica a los endpoints de administración de
// usuarios — nada más del API cambia de comportamiento.

app.post("/api/auth/login", jsonParser, async (req, res) => {
  if (!createSession) return res.status(503).json({ error: "Módulo de autenticación no disponible" });
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Usuario y contraseña son obligatorios" });

  try {
    const pool = await getPool();
    const result = await pool.request()
      .input("usuario", require("mssql").NVarChar(100), String(username).trim())
      .query("SELECT UsuarioID, NombreCompleto, Email, PasswordHash, PasswordSalt, Activo, IngenieroID, EsAdmin FROM Usuarios WHERE NombreUsuario = @usuario");
    const row = result.recordset[0];

    if (!row || !row.Activo || !verifyPassword(password, row.PasswordSalt, row.PasswordHash)) {
      logSecurityEvent("login_failed", req, { username: String(username).slice(0, 100) });
      return res.status(401).json({ error: "Usuario o contraseña incorrectos" });
    }

    const { token, expiraEn } = await createSession(pool, row.UsuarioID);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, secure: isProduction, sameSite: "lax", expires: expiraEn, path: "/",
    });
    // Mismos campos que getSessionUser (auth.cjs) — así App.jsx no depende
    // de un segundo round-trip a /api/auth/me para saber si es admin y
    // decidir qué navegación mostrar.
    res.json({
      ok: true,
      user: { name: row.NombreCompleto, email: row.Email || "", ingenieroId: row.IngenieroID ?? null, esAdmin: !!row.EsAdmin },
    });
  } catch (e) {
    console.error("[AUTH] Error en login:", e.message);
    res.status(500).json(errorBody("Error iniciando sesión", e));
  }
});

app.post("/api/auth/logout", async (req, res) => {
  try {
    if (deleteSession) {
      const pool = await getPool();
      const { [SESSION_COOKIE]: token } = parseCookies(req);
      await deleteSession(pool, token);
    }
  } catch (e) {
    console.warn("[AUTH] No se pudo borrar la sesión en BD:", e.message);
  }
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  if (!req.user) return res.status(401).json({ error: "No autenticado" });
  res.json({ user: req.user });
});

// Router de reportes: montado aquí para heredar requireApiKey y generalLimiter
// (ambos aplicados por prefijo "/api" arriba) sin tocar el resto de rutas.
if (reportsRouter) app.use("/api/reports", reportsRouter);

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
    const pool   = await getPool();
    const result = await pool.request().query("SELECT @@SERVERNAME AS srv, DB_NAME() AS db");
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
    const incomingProjects = Array.isArray(req.body?.projects) ? req.body.projects : [];
    const changedId        = req.body?.changedProjectId || null;
    const expectedVersion  = req.body?.expectedVersion;

    // Control de versión optimista (Fase 8 — riesgo 10.1): solo se activa
    // cuando el llamador manda expectedVersion. Los call-sites que ya
    // mandaban changedProjectId sin expectedVersion (autosave de modales,
    // toggles del dashboard) siguen guardando sin chequeo, igual que antes
    // — el contrato es aditivo, no reemplaza nada.
    if (changedId && expectedVersion != null) {
      const current = await readJson(DATA_FILE, null);
      const serverProject = current?.projects?.find(p => p.id === changedId);
      const serverVersion = serverProject?.version || 1;
      if (serverProject && serverVersion !== expectedVersion) {
        return res.status(409).json({ error: "conflict", serverProject });
      }
    }

    // Incrementar la versión del proyecto identificado — pasa en CUALQUIER
    // guardado que traiga changedProjectId (no solo los que chequean
    // versión), para que un guardado sin chequeo no deje "invisible" un
    // cambio real y genere un falso negativo en el próximo chequeo.
    const projectsToSave = changedId
      ? incomingProjects.map(p => (p.id === changedId ? { ...p, version: (p.version || 1) + 1 } : p))
      : incomingProjects;

    // savedAt: permite comparar data.json contra el máximo SavedAt de SQL al
    // arrancar (warnIfDataFileStale) sin cambiar el contrato de la respuesta
    // ni la latencia percibida — sigue siendo fire-and-forget hacia SQL.
    await writeJson(DATA_FILE, { ...req.body, projects: projectsToSave, savedAt: new Date().toISOString() });
    const savedVersion = changedId ? projectsToSave.find(p => p.id === changedId)?.version : undefined;
    res.json({ ok: true, version: savedVersion });

    // Sync operacional: solo el proyecto que cambió (identificado por changedProjectId)
    if (syncActividadesDetalle) {
      const toSync = changedId
        ? projectsToSave.filter(p => p.id === changedId)
        : projectsToSave;

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

// ── API: Administración de usuarios (migración 019 — solo admins) ────────────
// No hay endpoint de auto-registro (ver backend/scripts/create-user.cjs):
// crear/editar usuarios pasa por requireAdmin, así que solo un admin ya
// logueado puede provisionar cuentas nuevas — no reabre el hueco que
// create-user.cjs documenta evitar.

app.get("/api/users", requireAdmin, async (req, res) => {
  if (!listUsers) return res.status(503).json({ error: "Módulo de BD no disponible" });
  try {
    res.json(await listUsers());
  } catch (e) {
    console.error("[USERS] Error listando usuarios:", e.message);
    res.status(500).json(errorBody("Error listando usuarios", e));
  }
});

app.post("/api/users", requireAdmin, async (req, res) => {
  if (!createUser) return res.status(503).json({ error: "Módulo de BD no disponible" });
  try {
    const id = await createUser(req.body || {});
    res.json({ ok: true, id });
  } catch (e) {
    // Errores de validación (usuario/nombre/contraseña faltante, contraseña
    // corta) vienen de createUser como Error simple — se devuelven tal cual
    // al frontend en vez de un genérico 500, igual que query-builder.cjs.
    const isValidation = /obligatorio|al menos 8 caracteres/.test(e.message);
    if (isValidation) return res.status(400).json({ error: e.message });
    console.error("[USERS] Error creando usuario:", e.message);
    res.status(500).json(errorBody("Error creando usuario", e));
  }
});

app.post("/api/users/:id", requireAdmin, async (req, res) => {
  if (!updateUser) return res.status(503).json({ error: "Módulo de BD no disponible" });
  try {
    await updateUser(Number(req.params.id), req.body || {});
    res.json({ ok: true });
  } catch (e) {
    const isValidation = /obligatorio|al menos 8 caracteres/.test(e.message);
    if (isValidation) return res.status(400).json({ error: e.message });
    console.error("[USERS] Error actualizando usuario:", e.message);
    res.status(500).json(errorBody("Error actualizando usuario", e));
  }
});

// ── API: Adjuntos de actividades ──────────────────────────────────────────────
// Los archivos se guardan como bytes en SQL (tabla Actividad_Adjuntos).
// El frontend envía el contenido en base64. Límite ~10 MB por archivo.

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024; // 10 MB

// Limpia el nombre de archivo antes de guardarlo: quita caracteres de control
// (que podrían usarse para inyección de headers al descargarlo) y lo recorta
// a una longitud razonable. No restringe el charset a ASCII — nombres con
// acentos/ñ son normales en este contexto — solo bloquea lo peligroso.
function sanitizeFilename(name) {
  return String(name || "")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 255) || "adjunto";
}

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
      nombre: sanitizeFilename(nombre), mime, size: buffer.length, buffer,
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
    const safeName = sanitizeFilename(att.nombre);
    // RFC 5987: filename* con UTF-8 percent-encoded, más robusto para nombres
    // con acentos/ñ que el solo encodeURIComponent en el atributo filename clásico.
    // Se incluyen ambas variantes para compatibilidad con navegadores antiguos.
    res.setHeader("Content-Type", att.mime || "application/octet-stream");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
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
  if (!rebuildDataJsonFromSQL) {
    return res.status(503).json({ error: "Módulo de BD no disponible" });
  }
  try {
    const rebuilt = await rebuildDataJsonFromSQL();
    if (!rebuilt) {
      return res.status(404).json({ error: "No hay datos de respaldo en la base de datos" });
    }

    // A diferencia del rebuild de arranque (donde no hay nada que preservar),
    // acá sí hay un data.json vivo — se conservan weekLabel/engineers/
    // externalContacts actuales y solo se reemplazan los proyectos.
    const currentData = await readJson(DATA_FILE, { projects: [], weekLabel: null });
    await writeJson(DATA_FILE, { ...currentData, projects: rebuilt.projects, savedAt: new Date().toISOString() });

    console.log(`[RESTORE] ✓ Restaurados ${rebuilt.projects.length} proyectos desde la BD`);
    res.json({ ok: true, restored: rebuilt.projects.length });
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
    const { totalArchivadas, totalTransferidas } = computeQuarterStats(projects);

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
      const mssql = require("mssql");
      const pool  = await getPool();
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
      console.log(`[QUARTER] ✓ Snapshot guardado en SQL: ${quarterLabel}`);
    } catch (sqlErr) {
      // SQL falló pero el archivo físico ya está guardado — el reset continúa igual
      console.warn(`[QUARTER] ⚠ SQL falló (archivo físico disponible como respaldo): ${sqlErr.message}`);
    }

    // ── 4. Construir el nuevo estado limpio para el nuevo trimestre ─────────
    const newProjects = buildResetProjects(projects);

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
    const pool   = await getPool();
    const result = await pool.request().query(`
      SELECT TrimestreID, QuarterLabel, FechaInicio, FechaReset,
             TotalProyectos, ActividadesArchivadas, ActividadesTransferidas, CreadoEn
      FROM Trimestres_Archivo
      ORDER BY FechaReset DESC
    `);
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
      const pool   = await getPool();
      const result = await pool.request()
        .input("id", mssql.Int, parseInt(id))
        .query(`SELECT ArchivedDataJSON, QuarterLabel, FechaInicio, FechaReset FROM Trimestres_Archivo WHERE TrimestreID = @id`);

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

// ── Arranque ──────────────────────────────────────────────────────────────────
// Solo se abre el puerto cuando este archivo es el punto de entrada
// (`node server.cjs`). Al importarlo con require() —como hacen los tests de
// contrato de tests/routes/— se exportan `app` e `init` sin escuchar en ningún
// puerto, que es lo que permite montar la app en un puerto efímero y probar
// las rutas sin ocupar el 3002 de desarrollo.

async function start() {
  await init();
  return new Promise(resolve => {
    const server = http.createServer(app);
    server.listen(PORT, "0.0.0.0", () => {
      console.log(`Servidor en puerto ${PORT}`);
      resolve(server);
    });
  });
}

if (require.main === module) {
  start().catch(e => {
    console.error("Error en inicialización:", e.message);
    process.exit(1);
  });
}

module.exports = { app, init, start };
