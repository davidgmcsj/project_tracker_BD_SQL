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
  connectionTimeout: 60000,
  requestTimeout:    60000,
  options:           { encrypt: true, trustServerCertificate: true },
  pool:              { max: 20, min: 0, idleTimeoutMillis: 60000 },
};

let _pool = null;

async function getPool() {
  if (_pool) return _pool;
  try {
    _pool = await sql.connect(config);
    _pool.on("error", () => { _pool = null; });
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
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay() || 7;
  d.setDate(d.getDate() + 4 - day);
  const yearStart = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// ── Pre-carga global en una sola query ────────────────────────────────────────

async function preloadCaches(pool, projects) {
  const appIds = projects.map(p => `'${(p.id || "").replace(/'/g, "''")}'`).join(",");

  const [engsRes, proysRes] = await Promise.all([
    pool.request().query("SELECT IngenieroID, Nombre FROM Ingenieros WHERE Estado = 1"),
    appIds.length
      ? pool.request().query(`SELECT ProyectoID, AppID, NombreProyecto, URLPlanner FROM Proyectos WHERE AppID IN (${appIds})`)
      : Promise.resolve({ recordset: [] }),
  ]);

  return {
    engCache:  engsRes.recordset,
    proyCache: proysRes.recordset,
  };
}

// ── Resolve helpers (sin queries adicionales cuando hay cache hit) ────────────

async function resolveEngineer(pool, rawName, engCache) {
  const name = (rawName || "").trim();
  if (!name || name === "Otro...") return null;

  const parts = name.split(/\s+/).filter(Boolean);

  const exact = engCache.find(r => r.Nombre === name);
  if (exact) return exact.IngenieroID;

  for (const row of engCache) {
    const dbParts = row.Nombre.split(/\s+/).filter(Boolean);
    const matches = parts.filter(p => dbParts.some(d => d.toLowerCase() === p.toLowerCase()));
    if (matches.length >= 2) return row.IngenieroID;
  }

  const ins = await pool.request()
    .input("nombre", sql.NVarChar, name)
    .query("INSERT INTO Ingenieros (Nombre) OUTPUT INSERTED.IngenieroID VALUES (@nombre)");
  const newId = ins.recordset[0].IngenieroID;
  engCache.push({ IngenieroID: newId, Nombre: name });
  return newId;
}

async function resolveProject(pool, project, proyCache) {
  const appId = project.id || "";
  const name  = project.project_name || "Sin nombre";
  const url   = project.planner_url  || "";

  const cached = proyCache.find(r => r.AppID === appId);

  if (cached) {
    // Actualizar solo si cambió algo — evita un UPDATE innecesario
    if (cached.NombreProyecto !== name || cached.URLPlanner !== url) {
      await pool.request()
        .input("pid",  sql.Int,      cached.ProyectoID)
        .input("name", sql.NVarChar, name)
        .input("url",  sql.NVarChar, url)
        .query("UPDATE Proyectos SET NombreProyecto = @name, URLPlanner = @url WHERE ProyectoID = @pid");
    }
    return cached.ProyectoID;
  }

  const ins = await pool.request()
    .input("appId", sql.NVarChar, appId)
    .input("name",  sql.NVarChar, name)
    .input("url",   sql.NVarChar, url)
    .query("INSERT INTO Proyectos (AppID, NombreProyecto, URLPlanner) OUTPUT INSERTED.ProyectoID VALUES (@appId, @name, @url)");
  const newId = ins.recordset[0].ProyectoID;
  proyCache.push({ ProyectoID: newId, AppID: appId, NombreProyecto: name, URLPlanner: url });
  return newId;
}

// Inserta actividades nuevas en un solo INSERT multi-row
async function syncActividades(pool, proyectoID, activitiesArr) {
  const acts = safeArr(activitiesArr).map(a => a.trim()).filter(Boolean);
  if (!acts.length) return;

  const existing = await pool.request()
    .input("pid", sql.Int, proyectoID)
    .query("SELECT DescripcionActividad FROM Actividades WHERE ProyectoID = @pid");

  const existingSet = new Set(existing.recordset.map(r => r.DescripcionActividad));
  const nuevas = acts.filter((a, i) => !existingSet.has(a));
  if (!nuevas.length) return;

  // INSERT multi-row: una sola query para todas las actividades nuevas
  const req = pool.request().input("pid", sql.Int, proyectoID);
  const rows = nuevas.map((desc, i) => {
    req.input(`desc${i}`,  sql.NVarChar, desc);
    req.input(`orden${i}`, sql.Int,      acts.indexOf(desc));
    return `(@pid, @desc${i}, @orden${i})`;
  });
  await req.query(`INSERT INTO Actividades (ProyectoID, DescripcionActividad, Orden) VALUES ${rows.join(",")}`);
}

// ── Guardar un proyecto: todas las sub-queries en paralelo donde es posible ───

async function saveProject(pool, project, weekLabel, savedAt, engCache, proyCache) {
  const proyectoID  = await resolveProject(pool, project, proyCache);
  const reportDate  = project.report_date || new Date().toISOString().slice(0, 10);
  const semana      = getWeekNumber(reportDate);
  const anio        = new Date(reportDate + "T12:00:00").getFullYear();
  const m           = project.manual_metrics || {};
  const total       = Number(m.total_tasks          || 0);
  const completadas = Number(m.completed_tasks       || 0);
  const enProceso   = Number(m.in_progress_tasks     || 0);
  const compartidas = Number(m.shared_tasks_discount || 0);
  const avance      = total > 0 ? Math.min(((completadas + enProceso * 0.5) / total) * 100, 100) : 0;
  const rawJson     = JSON.stringify(project);

  // syncActividades y lookup del reporte existente en paralelo
  const [, existingRes] = await Promise.all([
    syncActividades(pool, proyectoID, project.activities_identified),
    pool.request()
      .input("pid",    sql.Int, proyectoID)
      .input("semana", sql.Int, semana)
      .input("anio",   sql.Int, anio)
      .query("SELECT ReporteID FROM ReportesSemanales WHERE ProyectoID = @pid AND NumeroSemana = @semana AND Anio = @anio"),
  ]);

  let reporteID;

  if (existingRes.recordset.length) {
    reporteID = existingRes.recordset[0].ReporteID;

    // UPDATE del reporte y DELETE de detalles en paralelo
    await Promise.all([
      pool.request()
        .input("rid",         sql.Int,           reporteID)
        .input("fechaRep",    sql.Date,           reportDate)
        .input("estado",      sql.NVarChar(50),   project.status || "on-track")
        .input("total",       sql.Int,            total)
        .input("completadas", sql.Int,            completadas)
        .input("enProceso",   sql.Int,            enProceso)
        .input("compartidas", sql.Int,            compartidas)
        .input("avance",      sql.Decimal(5, 2),  Math.round(avance * 100) / 100)
        .input("mostrar",     sql.Bit,            project.show_closing_fields ? 1 : 0)
        .input("logros",      sql.NVarChar,       JSON.stringify(safeArr(project.weekly_achievements)))
        .input("plan",        sql.NVarChar,       JSON.stringify(safeArr(project.next_week_plan)))
        .input("weekLabel",   sql.NVarChar(100),  weekLabel || "")
        .input("savedAt",     sql.DateTime2,      new Date(savedAt || Date.now()))
        .input("rawJson",     sql.NVarChar,       rawJson)
        .query(`UPDATE ReportesSemanales SET
          FechaReporte=@fechaRep, EstadoProyecto=@estado,
          Metrica_Total=@total, Metrica_Completadas=@completadas,
          Metrica_EnProceso=@enProceso, Metrica_Compartidas=@compartidas,
          AvancePromedio=@avance, MostrarCierre=@mostrar,
          LogrosSemana=@logros, PlanProximaSemana=@plan,
          WeekLabel=@weekLabel, SavedAt=@savedAt, RawDataJSON=@rawJson
          WHERE ReporteID=@rid`),
      pool.request().input("rid", sql.Int, reporteID).query(`
        DELETE FROM Estado_Actividades_Reporte    WHERE ReporteID=@rid;
        DELETE FROM Indicadores                   WHERE ReporteID=@rid;
        DELETE FROM Riesgos_Impedimentos          WHERE ReporteID=@rid;
        DELETE FROM Eventos_Reporte               WHERE ReporteID=@rid;
        DELETE FROM Estadisticas_Ingeniero_Semana WHERE ReporteID=@rid;
      `),
    ]);
  } else {
    const ins = await pool.request()
      .input("pid",         sql.Int,           proyectoID)
      .input("semana",      sql.Int,           semana)
      .input("anio",        sql.Int,           anio)
      .input("fechaRep",    sql.Date,          reportDate)
      .input("estado",      sql.NVarChar(50),  project.status || "on-track")
      .input("total",       sql.Int,           total)
      .input("completadas", sql.Int,           completadas)
      .input("enProceso",   sql.Int,           enProceso)
      .input("compartidas", sql.Int,           compartidas)
      .input("avance",      sql.Decimal(5, 2), Math.round(avance * 100) / 100)
      .input("mostrar",     sql.Bit,           project.show_closing_fields ? 1 : 0)
      .input("logros",      sql.NVarChar,      JSON.stringify(safeArr(project.weekly_achievements)))
      .input("plan",        sql.NVarChar,      JSON.stringify(safeArr(project.next_week_plan)))
      .input("weekLabel",   sql.NVarChar(100), weekLabel || "")
      .input("savedAt",     sql.DateTime2,     new Date(savedAt || Date.now()))
      .input("rawJson",     sql.NVarChar,      rawJson)
      .query(`INSERT INTO ReportesSemanales
        (ProyectoID,NumeroSemana,Anio,FechaReporte,EstadoProyecto,
         Metrica_Total,Metrica_Completadas,Metrica_EnProceso,Metrica_Compartidas,
         AvancePromedio,MostrarCierre,LogrosSemana,PlanProximaSemana,
         WeekLabel,SavedAt,RawDataJSON)
        OUTPUT INSERTED.ReporteID
        VALUES (@pid,@semana,@anio,@fechaRep,@estado,
         @total,@completadas,@enProceso,@compartidas,
         @avance,@mostrar,@logros,@plan,
         @weekLabel,@savedAt,@rawJson)`);
    reporteID = ins.recordset[0].ReporteID;
  }

  // ── Construir todos los INSERTs de detalle como multi-row ─────────────────

  const inserts = [];

  // Estado de actividades
  const ts = project.task_status || {};
  const statusMap = { completed: "Completada", in_progress: "En_Proceso", not_started: "No_Iniciada" };
  const taskRows = [];
  const taskReq  = pool.request().input("rid", sql.Int, reporteID);
  let ti = 0;
  for (const [key, label] of Object.entries(statusMap)) {
    for (const texto of safeArr(ts[key])) {
      taskReq.input(`ttexto${ti}`, sql.NVarChar,     texto);
      taskReq.input(`testado${ti}`, sql.NVarChar(50), label);
      taskRows.push(`(@rid, @ttexto${ti}, @testado${ti})`);
      ti++;
    }
  }
  if (taskRows.length) {
    inserts.push(taskReq.query(`INSERT INTO Estado_Actividades_Reporte (ReporteID,DescripcionTexto,Estado) VALUES ${taskRows.join(",")}`));
  }

  // Indicadores
  const indItems = (project.indicators || []).filter(ind => ind.name);
  if (indItems.length) {
    const indReq  = pool.request().input("rid", sql.Int, reporteID);
    const indRows = indItems.map((ind, i) => {
      indReq.input(`iname${i}`,  sql.NVarChar, ind.name);
      indReq.input(`itotal${i}`, sql.Int,      Number(ind.total       || 0));
      indReq.input(`icomp${i}`,  sql.Int,      Number(ind.completed   || 0));
      indReq.input(`iwip${i}`,   sql.Int,      Number(ind.in_progress || 0));
      return `(@rid,@iname${i},@itotal${i},@icomp${i},@iwip${i})`;
    });
    inserts.push(indReq.query(`INSERT INTO Indicadores (ReporteID,NombreIndicador,Total,Completadas,EnProceso) VALUES ${indRows.join(",")}`));
  }

  // Riesgos
  const riskItems = (project.impediments || []).filter(imp => imp.description);
  if (riskItems.length) {
    const riskReq  = pool.request().input("rid", sql.Int, reporteID);
    const riskRows = riskItems.map((imp, i) => {
      riskReq.input(`rtipo${i}`, sql.NVarChar(50), imp.category || "blocker");
      riskReq.input(`rdesc${i}`, sql.NVarChar,     imp.description);
      riskReq.input(`rimp${i}`,  sql.NVarChar,     imp.impact || "");
      return `(@rid,@rtipo${i},@rdesc${i},@rimp${i})`;
    });
    inserts.push(riskReq.query(`INSERT INTO Riesgos_Impedimentos (ReporteID,Tipo,Descripcion,Impacto) VALUES ${riskRows.join(",")}`));
  }

  // Eventos (milestones + comentarios)
  const eventoItems = [
    ...(project.milestones || []).filter(ms => ms.date || ms.note).map(ms => ({ tipo: "FECHA_CLAVE", act: ms.activity || "", fecha: ms.date || null, contenido: ms.note || "" })),
    ...(project.comments   || []).filter(cm => cm.text).map(cm =>             ({ tipo: "COMENTARIO",  act: cm.activity || "", fecha: cm.date || null, contenido: cm.text || "" })),
  ];
  if (eventoItems.length) {
    const evReq  = pool.request().input("rid", sql.Int, reporteID);
    const evRows = eventoItems.map((ev, i) => {
      evReq.input(`etipo${i}`,     sql.NVarChar(50), ev.tipo);
      evReq.input(`eact${i}`,      sql.NVarChar,     ev.act);
      evReq.input(`efecha${i}`,    sql.Date,         ev.fecha);
      evReq.input(`econtenido${i}`,sql.NVarChar,     ev.contenido);
      return `(@rid,@etipo${i},@eact${i},@efecha${i},@econtenido${i})`;
    });
    inserts.push(evReq.query(`INSERT INTO Eventos_Reporte (ReporteID,Tipo,ActividadRelacionada,FechaEvento,Contenido) VALUES ${evRows.join(",")}`));
  }

  // Ingenieros — resolve en paralelo, luego INSERT multi-row
  const engItems = (project.engineers || []).filter(e => e.engineer_id || e.custom_name);
  if (engItems.length) {
    const resolvedEngs = await Promise.all(
      engItems.map(eng => {
        const rawName = eng.engineer_id === "Otro..." ? (eng.custom_name || "") : (eng.engineer_id || "");
        return resolveEngineer(pool, rawName, engCache).then(id => ({ id, eng }));
      })
    );
    const validEngs = resolvedEngs.filter(r => r.id);
    if (validEngs.length) {
      const engReq  = pool.request().input("rid", sql.Int, reporteID);
      const engRows = validEngs.map(({ id, eng }, i) => {
        engReq.input(`eingId${i}`,    sql.Int,      id);
        engReq.input(`esemTotal${i}`, sql.Int,      Number(eng.weekly_total|| 0));
        engReq.input(`esemDet${i}`,   sql.NVarChar, JSON.stringify(safeArr(eng.weekly_detail)));
        return `(@rid,@eingId${i},@esemTotal${i},@esemDet${i})`;
      });
      inserts.push(engReq.query(`INSERT INTO Estadisticas_Ingeniero_Semana (ReporteID,IngenieroID,Semana_Total,Semana_Detalle) VALUES ${engRows.join(",")}`));
    }
  }

  // Ejecutar todos los INSERTs de detalle en paralelo
  await Promise.all(inserts);
}

// ── Guardar todos los proyectos en paralelo ───────────────────────────────────

async function saveWeekReportToDB(projects, weekLabel, savedAt) {
  const pool = await getPool();

  const { engCache, proyCache } = await preloadCaches(pool, projects);

  // Procesar todos los proyectos en paralelo
  await Promise.all(
    projects.map(project => saveProject(pool, project, weekLabel, savedAt, engCache, proyCache))
  );
}

// ── Exportar ──────────────────────────────────────────────────────────────────

module.exports = { saveWeekReportToDB };
