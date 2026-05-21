// db-operations.cjs — Escritura de reportes semanales en SQL Server.
//
// Este módulo es llamado por server.cjs cada vez que el usuario guarda un reporte.
// Opera en paralelo al guardado en JSON: si falla, el error es silencioso y el
// usuario no lo nota. El JSON siempre es la fuente de verdad primaria.
//
// CONFIGURACIÓN (variables en .env):
//   DB_SERVER   → nombre del servidor, ej: mi-servidor.database.windows.net
//   DB_USER     → usuario SQL con permisos db_datareader + db_datawriter
//   DB_PASSWORD → contraseña del usuario
//   DB_NAME     → nombre de la base de datos
//
// TABLAS QUE USA:
//   Proyectos, Ingenieros, Actividades, ReportesSemanales,
//   Estado_Actividades_Reporte, Indicadores, Riesgos_Impedimentos,
//   Eventos_Reporte, Estadisticas_Ingeniero_Semana
//
// NOTA SOBRE encrypt: true — Azure SQL requiere TLS obligatoriamente.
// Para SQL Server local sin certificado, cambiar a: encrypt: false, trustServerCertificate: true

"use strict";

require("dotenv/config");
const sql = require("mssql");

// ── Conexión ──────────────────────────────────────────────────────────────────

const config = {
  user:              process.env.DB_USER,
  password:          process.env.DB_PASSWORD,
  server:            process.env.DB_SERVER || "localhost",
  port:              1433,
  database:          process.env.DB_NAME,
  connectionTimeout: 15000,
  requestTimeout:    30000,
  options:           { encrypt: true, trustServerCertificate: true },
  pool:              { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

// Singleton de pool: se crea una sola vez y se reutiliza en todas las llamadas
let _pool = null;

async function getPool() {
  if (_pool) return _pool;
  try {
    _pool = await sql.connect(config);
  } catch (e) {
    _pool = null;
    throw e;
  }
  return _pool;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function safeArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  return val.split("\n").map(s => s.trim()).filter(Boolean);
}

function getWeekNumber(dateStr) {
  // Cálculo ISO 8601: la semana empieza el lunes, la semana 1 contiene el primer jueves del año.
  // Coincide exactamente con DATEPART(ISO_WEEK, ...) en SQL Server.
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay() || 7; // domingo=7
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// Busca un ingeniero por match de al menos 1 nombre y 1 apellido.
// Si no existe lo crea. Devuelve el IngenieroID.
async function resolveEngineer(pool, rawName) {
  const name = (rawName || "").trim();
  if (!name || name === "Otro...") return null;

  const parts = name.split(/\s+/).filter(Boolean);

  // Buscar por nombre exacto primero
  const exact = await pool.request()
    .input("nombre", sql.NVarChar, name)
    .query("SELECT IngenieroID FROM Ingenieros WHERE Nombre = @nombre");
  if (exact.recordset.length) return exact.recordset[0].IngenieroID;

  // Buscar por coincidencia parcial (al menos 2 palabras del nombre están en el registro)
  const all = await pool.request()
    .query("SELECT IngenieroID, Nombre FROM Ingenieros WHERE Estado = 1");

  for (const row of all.recordset) {
    const dbParts = row.Nombre.split(/\s+/).filter(Boolean);
    const matches = parts.filter(p => dbParts.some(d => d.toLowerCase() === p.toLowerCase()));
    if (matches.length >= 2) return row.IngenieroID;
  }

  // No existe — crear
  const ins = await pool.request()
    .input("nombre", sql.NVarChar, name)
    .query("INSERT INTO Ingenieros (Nombre) OUTPUT INSERTED.IngenieroID VALUES (@nombre)");
  return ins.recordset[0].IngenieroID;
}

// Busca o crea un proyecto por AppID. Devuelve el ProyectoID.
async function resolveProject(pool, project) {
  const appId = project.id || "";
  const name  = project.project_name || "Sin nombre";
  const url   = project.planner_url  || "";

  const existing = await pool.request()
    .input("appId", sql.NVarChar, appId)
    .query("SELECT ProyectoID FROM Proyectos WHERE AppID = @appId");

  if (existing.recordset.length) {
    const pid = existing.recordset[0].ProyectoID;
    // Actualizar nombre/url si cambiaron
    await pool.request()
      .input("pid",  sql.Int,      pid)
      .input("name", sql.NVarChar, name)
      .input("url",  sql.NVarChar, url)
      .query("UPDATE Proyectos SET NombreProyecto = @name, URLPlanner = @url WHERE ProyectoID = @pid");
    return pid;
  }

  const ins = await pool.request()
    .input("appId", sql.NVarChar, appId)
    .input("name",  sql.NVarChar, name)
    .input("url",   sql.NVarChar, url)
    .query("INSERT INTO Proyectos (AppID, NombreProyecto, URLPlanner) OUTPUT INSERTED.ProyectoID VALUES (@appId, @name, @url)");
  return ins.recordset[0].ProyectoID;
}

// Sincroniza el listado de actividades identificadas de un proyecto.
// Inserta las nuevas, no borra las viejas (son el catálogo maestro).
async function syncActividades(pool, proyectoID, activitiesArr) {
  const acts = safeArr(activitiesArr);
  for (let i = 0; i < acts.length; i++) {
    const desc = acts[i].trim();
    if (!desc) continue;
    const exists = await pool.request()
      .input("pid",  sql.Int,      proyectoID)
      .input("desc", sql.NVarChar, desc)
      .query("SELECT ActividadID FROM Actividades WHERE ProyectoID = @pid AND DescripcionActividad = @desc");
    if (!exists.recordset.length) {
      await pool.request()
        .input("pid",   sql.Int,      proyectoID)
        .input("desc",  sql.NVarChar, desc)
        .input("orden", sql.Int,      i)
        .query("INSERT INTO Actividades (ProyectoID, DescripcionActividad, Orden) VALUES (@pid, @desc, @orden)");
    }
  }
}

// ── Guardar reporte semanal (INSERT o UPDATE por semana) ──────────────────────

async function saveWeekReportToDB(projects, weekLabel, savedAt) {
  const pool = await getPool();

  for (const project of projects) {
    const proyectoID  = await resolveProject(pool, project);
    const reportDate  = project.report_date || new Date().toISOString().slice(0, 10);
    const semana      = getWeekNumber(reportDate);
    const anio        = new Date(reportDate + "T12:00:00").getFullYear();
    const m           = project.manual_metrics || {};
    const total       = Number(m.total_tasks           || 0);
    const completadas = Number(m.completed_tasks        || 0);
    const enProceso   = Number(m.in_progress_tasks      || 0);
    const compartidas = Number(m.shared_tasks_discount  || 0);
    const avance      = total > 0
      ? Math.min(((completadas + enProceso * 0.5) / total) * 100, 100)
      : 0;

    await syncActividades(pool, proyectoID, project.activities_identified);

    // ── UPSERT de ReportesSemanales ────────────────────────────────────────────
    const existing = await pool.request()
      .input("pid",    sql.Int, proyectoID)
      .input("semana", sql.Int, semana)
      .input("anio",   sql.Int, anio)
      .query("SELECT ReporteID FROM ReportesSemanales WHERE ProyectoID = @pid AND NumeroSemana = @semana AND Anio = @anio");

    let reporteID;

    const rawJson = JSON.stringify(project);

    if (existing.recordset.length) {
      reporteID = existing.recordset[0].ReporteID;
      await pool.request()
        .input("rid",          sql.Int,          reporteID)
        .input("fechaRep",     sql.Date,         reportDate)
        .input("estado",       sql.NVarChar(50), project.status || "on-track")
        .input("total",        sql.Int,          total)
        .input("completadas",  sql.Int,          completadas)
        .input("enProceso",    sql.Int,          enProceso)
        .input("compartidas",  sql.Int,          compartidas)
        .input("avance",       sql.Decimal(5,2), Math.round(avance * 100) / 100)
        .input("mostrar",      sql.Bit,          project.show_closing_fields ? 1 : 0)
        .input("logros",       sql.NVarChar,     JSON.stringify(safeArr(project.weekly_achievements)))
        .input("plan",         sql.NVarChar,     JSON.stringify(safeArr(project.next_week_plan)))
        .input("weekLabel",    sql.NVarChar(100),weekLabel || "")
        .input("savedAt",      sql.DateTime2,    new Date(savedAt || Date.now()))
        .input("rawJson",      sql.NVarChar,     rawJson)
        .query(`UPDATE ReportesSemanales SET
          FechaReporte = @fechaRep, EstadoProyecto = @estado,
          Metrica_Total = @total, Metrica_Completadas = @completadas,
          Metrica_EnProceso = @enProceso, Metrica_Compartidas = @compartidas,
          AvancePromedio = @avance, MostrarCierre = @mostrar,
          LogrosSemana = @logros, PlanProximaSemana = @plan,
          WeekLabel = @weekLabel, SavedAt = @savedAt, RawDataJSON = @rawJson
          WHERE ReporteID = @rid`);

      // Limpiar detalles previos (ON DELETE CASCADE lo haría, pero lo hacemos explícito)
      await pool.request().input("rid", sql.Int, reporteID).query(`
        DELETE FROM Estado_Actividades_Reporte WHERE ReporteID = @rid;
        DELETE FROM Indicadores                 WHERE ReporteID = @rid;
        DELETE FROM Riesgos_Impedimentos        WHERE ReporteID = @rid;
        DELETE FROM Eventos_Reporte             WHERE ReporteID = @rid;
        DELETE FROM Estadisticas_Ingeniero_Semana WHERE ReporteID = @rid;
      `);
    } else {
      const ins = await pool.request()
        .input("pid",         sql.Int,          proyectoID)
        .input("semana",      sql.Int,          semana)
        .input("anio",        sql.Int,          anio)
        .input("fechaRep",    sql.Date,         reportDate)
        .input("estado",      sql.NVarChar(50), project.status || "on-track")
        .input("total",       sql.Int,          total)
        .input("completadas", sql.Int,          completadas)
        .input("enProceso",   sql.Int,          enProceso)
        .input("compartidas", sql.Int,          compartidas)
        .input("avance",      sql.Decimal(5,2), Math.round(avance * 100) / 100)
        .input("mostrar",     sql.Bit,          project.show_closing_fields ? 1 : 0)
        .input("logros",      sql.NVarChar,     JSON.stringify(safeArr(project.weekly_achievements)))
        .input("plan",        sql.NVarChar,     JSON.stringify(safeArr(project.next_week_plan)))
        .input("weekLabel",   sql.NVarChar(100),weekLabel || "")
        .input("savedAt",     sql.DateTime2,    new Date(savedAt || Date.now()))
        .input("rawJson",     sql.NVarChar,     rawJson)
        .query(`INSERT INTO ReportesSemanales
          (ProyectoID, NumeroSemana, Anio, FechaReporte, EstadoProyecto,
           Metrica_Total, Metrica_Completadas, Metrica_EnProceso, Metrica_Compartidas,
           AvancePromedio, MostrarCierre, LogrosSemana, PlanProximaSemana,
           WeekLabel, SavedAt, RawDataJSON)
          OUTPUT INSERTED.ReporteID
          VALUES (@pid, @semana, @anio, @fechaRep, @estado,
           @total, @completadas, @enProceso, @compartidas,
           @avance, @mostrar, @logros, @plan,
           @weekLabel, @savedAt, @rawJson)`);
      reporteID = ins.recordset[0].ReporteID;
    }

    // ── Estado de actividades (task_status) ────────────────────────────────────
    const ts = project.task_status || {};
    const statusMap = {
      completed:   "Completada",
      in_progress: "En_Proceso",
      not_started: "No_Iniciada",
    };
    for (const [key, label] of Object.entries(statusMap)) {
      for (const texto of safeArr(ts[key])) {
        await pool.request()
          .input("rid",    sql.Int,      reporteID)
          .input("texto",  sql.NVarChar, texto)
          .input("estado", sql.NVarChar(50), label)
          .query("INSERT INTO Estado_Actividades_Reporte (ReporteID, DescripcionTexto, Estado) VALUES (@rid, @texto, @estado)");
      }
    }

    // ── Indicadores ────────────────────────────────────────────────────────────
    for (const ind of (project.indicators || [])) {
      if (!ind.name) continue;
      await pool.request()
        .input("rid",   sql.Int,      reporteID)
        .input("name",  sql.NVarChar, ind.name)
        .input("total", sql.Int,      Number(ind.total       || 0))
        .input("comp",  sql.Int,      Number(ind.completed   || 0))
        .input("wip",   sql.Int,      Number(ind.in_progress || 0))
        .query("INSERT INTO Indicadores (ReporteID, NombreIndicador, Total, Completadas, EnProceso) VALUES (@rid, @name, @total, @comp, @wip)");
    }

    // ── Riesgos e impedimentos ─────────────────────────────────────────────────
    for (const imp of (project.impediments || [])) {
      if (!imp.description) continue;
      await pool.request()
        .input("rid",  sql.Int,      reporteID)
        .input("tipo", sql.NVarChar(50), imp.category || "blocker")
        .input("desc", sql.NVarChar, imp.description)
        .input("imp",  sql.NVarChar, imp.impact || "")
        .query("INSERT INTO Riesgos_Impedimentos (ReporteID, Tipo, Descripcion, Impacto) VALUES (@rid, @tipo, @desc, @imp)");
    }

    // ── Fechas clave (milestones) ──────────────────────────────────────────────
    for (const ms of (project.milestones || [])) {
      if (!ms.date && !ms.note) continue;
      await pool.request()
        .input("rid",      sql.Int,      reporteID)
        .input("tipo",     sql.NVarChar(50), "FECHA_CLAVE")
        .input("act",      sql.NVarChar, ms.activity || "")
        .input("fecha",    sql.Date,     ms.date || null)
        .input("contenido",sql.NVarChar, ms.note || "")
        .query("INSERT INTO Eventos_Reporte (ReporteID, Tipo, ActividadRelacionada, FechaEvento, Contenido) VALUES (@rid, @tipo, @act, @fecha, @contenido)");
    }

    // ── Comentarios ────────────────────────────────────────────────────────────
    for (const cm of (project.comments || [])) {
      if (!cm.text) continue;
      await pool.request()
        .input("rid",      sql.Int,      reporteID)
        .input("tipo",     sql.NVarChar(50), "COMENTARIO")
        .input("act",      sql.NVarChar, cm.activity || "")
        .input("fecha",    sql.Date,     cm.date || null)
        .input("contenido",sql.NVarChar, cm.text || "")
        .query("INSERT INTO Eventos_Reporte (ReporteID, Tipo, ActividadRelacionada, FechaEvento, Contenido) VALUES (@rid, @tipo, @act, @fecha, @contenido)");
    }

    // ── Estadísticas de ingenieros ─────────────────────────────────────────────
    for (const eng of (project.engineers || [])) {
      const rawName   = eng.engineer_id === "Otro..." ? (eng.custom_name || "") : (eng.engineer_id || "");
      const ingenieroID = await resolveEngineer(pool, rawName);
      if (!ingenieroID) continue;

      await pool.request()
        .input("rid",       sql.Int,      reporteID)
        .input("ingId",     sql.Int,      ingenieroID)
        .input("asig",      sql.Int,      Number(eng.assigned    || 0))
        .input("comp",      sql.Int,      Number(eng.completed   || 0))
        .input("wip",       sql.Int,      Number(eng.in_progress || 0))
        .input("semTotal",  sql.Int,      Number(eng.weekly_total|| 0))
        .input("semDet",    sql.NVarChar, JSON.stringify(safeArr(eng.weekly_detail)))
        .query(`INSERT INTO Estadisticas_Ingeniero_Semana
          (ReporteID, IngenieroID, Global_Asignadas, Global_Completadas, Global_EnProceso, Semana_Total, Semana_Detalle)
          VALUES (@rid, @ingId, @asig, @comp, @wip, @semTotal, @semDet)`);
    }
  }
}

// ── Exportar ──────────────────────────────────────────────────────────────────

module.exports = { saveWeekReportToDB };
