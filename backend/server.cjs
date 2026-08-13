// server.cjs — Servidor Express que expone la API REST.
//
// Las rutas viven en routes/*.cjs (Fase 2.5 de la refactorización), montadas
// más abajo en un orden deliberado: de lo más aislado (diagnostics, ai) a lo
// más acoplado (auth, de la que depende req.user en el resto de la API).
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
// VARIABLE DE ENTORNO PORT: si no está definida, usa 3002 por defecto.
// En Azure App Service, PORT se inyecta automáticamente.

const express = require("express");
const http    = require("http");
require("dotenv/config");
const { computeQuarterStats, buildResetProjects } = require("./quarter-reset.cjs");

// Middlewares extraídos (Fase 2.3). El ORDEN en que se montan más abajo es
// parte del contrato de seguridad — ver los comentarios de cada módulo.
const { requireApiKey }                     = require("./middleware/api-key.cjs");
const { montarRateLimits }                  = require("./middleware/rate-limits.cjs");
const { crearResolverSesion, requireAdmin, requireAuth } = require("./middleware/session.cjs");
const { logSecurityEvent }                  = require("./middleware/security-log.cjs");
const { errorBody }                         = require("./middleware/error-handler.cjs");

// Carga defensiva de los módulos opcionales — ver config/modules.cjs. Antes
// eran 4 bloques IIFE aquí mismo, cada uno con su lista de nulls a mano; esa
// lista ya había divergido (le faltaba syncExternalContactToSQL, ver
// engineers.routes.cjs).
const { db, ai, auth, reportsRouter } = require("./config/modules.cjs");

const { getPool, saveWeekReportToDB, syncEngineerToSQL, syncEngineerTaskToSQL,
        deleteEngineerTaskFromSQL, syncActividadesDetalle, syncExternalContactToSQL,
        saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB,
        rebuildDataJsonFromSQL, maxSqlSavedAt,
        listUsers, createUser, updateUser } = db;

const { parseCookies, verifyPassword, createSession,
        getSessionUser, deleteSession, SESSION_COOKIE } = auth;

const { generateReportWithAI, generateStatusSummaryWithAI, generateGlobalStatusWithAI } = ai;

// ── Configuración ─────────────────────────────────────────────────────────────
// La resolución del directorio de datos y los helpers de lectura/escritura
// viven en lib/json-store.cjs. OJO: ese módulo ancla la ruta al directorio del
// backend con path.join(__dirname, ".."), porque su propio __dirname es
// backend/lib — usarlo a secas escribiría los datos en el sitio equivocado.
const { BACKEND_DIR, DATA_DIR, DATA_FILE, HISTORY_FILE, readJson, writeJson } = require("./lib/json-store.cjs");

// config/env.cjs valida FRONTEND_URL y API_KEY al cargarse: en producción hace
// process.exit(1) si faltan, antes de que la app acepte peticiones.
const { isProduction, PORT, FRONTEND_URL } = require("./config/env.cjs");

// Migraciones de datos legados y arranque — extraídos a lib/ (Fase 2.4).
const { crearInit } = require("./lib/bootstrap.cjs");
const init = crearInit({ rebuildDataJsonFromSQL, maxSqlSavedAt });

// ── Routers (Fase 2.5) ───────────────────────────────────────────────────────
const { crearDiagnosticsRouter }  = require("./routes/diagnostics.routes.cjs");
const { crearAiRouter }           = require("./routes/ai.routes.cjs");
const { crearUsersRouter }        = require("./routes/users.routes.cjs");
const { crearAttachmentsRouter }  = require("./routes/attachments.routes.cjs");
const { crearEngineersRouter }    = require("./routes/engineers.routes.cjs");
const { crearHistoryRouter }      = require("./routes/history.routes.cjs");
const { crearQuartersRouter }     = require("./routes/quarters.routes.cjs");
const { crearMaintenanceRouter }  = require("./routes/maintenance.routes.cjs");
const { crearProjectsRouter }     = require("./routes/projects.routes.cjs");
const { crearAuthRouter }         = require("./routes/auth.routes.cjs");

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

// ── Autenticación: API key compartida ─────────────────────────────────────────
// Herramienta interna: todos los clientes autorizados comparten la misma clave,
// enviada en el header X-API-Key. No distingue usuarios individuales — para eso
// están las sesiones (auth.routes.cjs) y los roles (requireAdmin).
//
// API_KEY debe estar definida en .env. Sin ella, el servidor no arranca en
// producción (falla cerrado) — la validación vive en config/env.cjs y corre al
// cargar ese módulo, antes de que la app acepte peticiones.
app.use("/api", requireApiKey);

// Body parser: límite pequeño para toda la API excepto /api/attachments/upload,
// que monta su propio parser con límite ampliado (ver attachments.routes.cjs)
// antes de que el body llegue aquí. Express ejecuta los parsers en orden de
// registro, así que basta con excluir esa ruta del parser genérico para que
// no choquen.
//
// ⚠️ Esta comparación usa req.path EXACTO. Si /api/attachments/upload se
// montara bajo un prefijo adicional (ej. otro router padre), req.path perdería
// ese prefijo y la exclusión dejaría de aplicar en silencio — el upload
// pasaría por este parser de 2 MB y moriría con 413. Cubierto por un test de
// contrato (routes-contract.test.cjs: "acepta cuerpos mayores al límite general").
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

// ── Sesión ────────────────────────────────────────────────────────────────
// Convive con X-API-Key (requireApiKey arriba lo sigue exigiendo en todo
// /api/*): esto agrega identidad real ENCIMA, no la reemplaza. req.user queda
// disponible para el resto de rutas (ej. autor real en notas de proyecto) sin
// bloquear la request si no hay sesión.
app.use("/api", crearResolverSesion({ getPool, getSessionUser, parseCookies, SESSION_COOKIE }));

// ── Montaje de routers ────────────────────────────────────────────────────
// Orden: de lo más aislado a lo más acoplado. auth va al final porque de ella
// depende req.user, que ya consumen requireAdmin (users) y reports/index.cjs
// — moverla temprano haría que un fallo se manifestara en un módulo distinto.

app.use("/api", crearDiagnosticsRouter({ isProduction, getPool, saveWeekReportToDB }));

app.use("/api", crearAiRouter({ generateReportWithAI, generateStatusSummaryWithAI, generateGlobalStatusWithAI, errorBody }));

app.use("/api/users", crearUsersRouter({ requireAdmin, listUsers, createUser, updateUser, errorBody }));

app.use("/api/attachments", crearAttachmentsRouter({ attachmentJsonParser, saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB, errorBody }));

app.use("/api", crearEngineersRouter({ syncExternalContactToSQL, syncEngineerToSQL, syncEngineerTaskToSQL, deleteEngineerTaskFromSQL, errorBody }));

app.use("/api", crearHistoryRouter({ DATA_FILE, HISTORY_FILE, readJson, writeJson, saveWeekReportToDB, errorBody, requireAdmin }));

app.use("/api", crearQuartersRouter({ BACKEND_DIR, DATA_FILE, readJson, writeJson, getPool, computeQuarterStats, buildResetProjects, errorBody, requireAdmin }));

app.use("/api", crearMaintenanceRouter({ DATA_FILE, readJson, writeJson, rebuildDataJsonFromSQL, errorBody, requireAdmin }));

app.use("/api/projects", crearProjectsRouter({ DATA_FILE, readJson, writeJson, syncActividadesDetalle, requireAuth }));

app.use("/api/auth", crearAuthRouter({
  jsonParser, getPool, createSession, deleteSession, verifyPassword, parseCookies,
  SESSION_COOKIE, isProduction, logSecurityEvent, errorBody,
}));

// Router de reportes: montado aquí para heredar requireApiKey y generalLimiter
// (ambos aplicados por prefijo "/api" arriba) sin tocar el resto de rutas.
if (reportsRouter) app.use("/api/reports", reportsRouter);

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
