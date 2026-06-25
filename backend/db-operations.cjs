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

// activities_identified es un array de {id, text}. task_status, weekly_detail,
// milestones.activity y comments.activity referencian el id, no el texto —
// estas tablas SQL son reportes de solo texto, así que se resuelve antes de escribir.
function buildActivityIndex(activities) {
  const map = new Map();
  (Array.isArray(activities) ? activities : []).forEach(a => {
    if (a && a.id != null) map.set(a.id, a.text || "");
  });
  return map;
}
function resolveActText(index, id) { return index.get(id) ?? id ?? ""; }
function resolveActArr(index, ids) { return safeArr(ids).map(id => resolveActText(index, id)); }

// engineers[].engineer_id es ahora un id del catálogo data.engineers, no un nombre libre.
// Si el ingeniero ya tiene sql_id (sincronizado), se usa directo. Si no, se cae al
// fuzzy-match de resolveEngineer por nombre (compatibilidad con ingenieros aún no sincronizados).
function buildEngineerCatalogIndex(engineersCatalog) {
  const map = new Map();
  (Array.isArray(engineersCatalog) ? engineersCatalog : []).forEach(e => {
    if (e && e.id != null) map.set(e.id, { name: e.name || "", sqlId: e.sql_id || null });
  });
  return map;
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

// ── Sync directo del catálogo local (data.engineers) con la tabla Ingenieros ──
// Cada ingeniero del catálogo local guarda un sql_id (IngenieroID real de SQL).
// Crear/editar/desactivar en la app empuja el cambio a SQL de inmediato — ya no
// se depende del fuzzy-match de resolveEngineer para estos ingenieros.

async function syncEngineerToSQL(engineer) {
  const pool = await getPool();
  const name   = (engineer.name || "").trim();
  const role   = engineer.role || "";
  const active = engineer.active !== false;

  if (engineer.sql_id) {
    await pool.request()
      .input("id",     sql.Int,          engineer.sql_id)
      .input("nombre", sql.NVarChar(150),name)
      .input("cargo",  sql.NVarChar(100),role)
      .input("estado", sql.Bit,          active)
      .query("UPDATE Ingenieros SET Nombre=@nombre, Cargo=@cargo, Estado=@estado WHERE IngenieroID=@id");
    return engineer.sql_id;
  }

  const ins = await pool.request()
    .input("nombre", sql.NVarChar(150), name)
    .input("cargo",  sql.NVarChar(100), role)
    .input("estado", sql.Bit,           active)
    .query("INSERT INTO Ingenieros (Nombre, Cargo, Estado) OUTPUT INSERTED.IngenieroID VALUES (@nombre, @cargo, @estado)");
  return ins.recordset[0].IngenieroID;
}

// ── Sync de colaboradores externos ───────────────────────────────────────────
// Crea o actualiza un registro en Colaboradores_Externos.
// Devuelve el ColaboradorID de SQL para guardarlo como sql_id en el catálogo local.

async function syncExternalContactToSQL(contact) {
  const pool    = await getPool();
  const name    = (contact.name    || "").trim();
  const company = (contact.company || "").trim();
  const active  = contact.active !== false ? 1 : 0;

  if (contact.sql_id) {
    await pool.request()
      .input("id",      sql.Int,           contact.sql_id)
      .input("nombre",  sql.NVarChar(150),  name)
      .input("empresa", sql.NVarChar(150),  company)
      .input("activo",  sql.Bit,            active)
      .query("UPDATE Colaboradores_Externos SET Nombre=@nombre, Empresa=@empresa, Activo=@activo WHERE ColaboradorID=@id");
    return contact.sql_id;
  }

  const ins = await pool.request()
    .input("nombre",  sql.NVarChar(150), name)
    .input("empresa", sql.NVarChar(150), company)
    .input("activo",  sql.Bit,           active)
    .query("INSERT INTO Colaboradores_Externos (Nombre, Empresa, Activo) OUTPUT INSERTED.ColaboradorID VALUES (@nombre, @empresa, @activo)");
  return ins.recordset[0].ColaboradorID;
}

// ── Tareas sueltas del ingeniero (no asociadas a ningún proyecto/reporte) ─────
// Cada tarea tiene un id local estable (etask_xxx, AppTaskID en SQL). Upsert por
// ese id: si ya existe la fila, se actualiza; si no, se inserta. Esto permite
// consultar en SQL qué tenía un ingeniero en una fecha/rango, en proyectos
// (Estadisticas_Ingeniero_Semana) Y en tareas sueltas (esta tabla), por separado.

async function updateEngineerTaskByAppId(task) {
  const pool = await getPool();
  const upd = await pool.request()
    .input("appId", sql.NVarChar(50), task.id)
    .input("desc",  sql.NVarChar,     task.description || "")
    .input("estado",sql.NVarChar(50), task.status || "not_started")
    .input("fecha", sql.Date,         task.date || null)
    .query(`UPDATE Tareas_Sueltas_Ingeniero
            SET Descripcion=@desc, Estado=@estado, Fecha=@fecha, UltimaActualizacion=GETDATE()
            OUTPUT INSERTED.TareaID
            WHERE AppTaskID=@appId`);
  return upd.recordset[0]?.TareaID ?? null;
}

// Upsert con manejo de condición de carrera: si dos guardados casi simultáneos
// (ej. el usuario edita rápido dos veces) llegan aquí a la vez, ambos pueden ver
// la fila como "no existe" e intentar INSERT — el segundo choca con la constraint
// UNIQUE(AppTaskID). En ese caso se reintenta como UPDATE en vez de fallar.
async function syncEngineerTaskToSQL(engineerSqlId, task) {
  const pool = await getPool();
  const existing = await pool.request()
    .input("appId", sql.NVarChar(50), task.id)
    .query("SELECT TareaID FROM Tareas_Sueltas_Ingeniero WHERE AppTaskID = @appId");

  if (existing.recordset.length) {
    return updateEngineerTaskByAppId(task);
  }

  try {
    const ins = await pool.request()
      .input("ingId", sql.Int,          engineerSqlId)
      .input("appId", sql.NVarChar(50), task.id)
      .input("desc",  sql.NVarChar,     task.description || "")
      .input("estado",sql.NVarChar(50), task.status || "not_started")
      .input("fecha", sql.Date,         task.date || null)
      .query(`INSERT INTO Tareas_Sueltas_Ingeniero (IngenieroID, AppTaskID, Descripcion, Estado, Fecha)
              OUTPUT INSERTED.TareaID
              VALUES (@ingId, @appId, @desc, @estado, @fecha)`);
    return ins.recordset[0].TareaID;
  } catch (e) {
    if (e.number === 2627 || e.number === 2601) return updateEngineerTaskByAppId(task);
    throw e;
  }
}

async function deleteEngineerTaskFromSQL(appTaskId) {
  const pool = await getPool();
  await pool.request()
    .input("appId", sql.NVarChar(50), appTaskId)
    .query("DELETE FROM Tareas_Sueltas_Ingeniero WHERE AppTaskID = @appId");
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
  const acts = safeArr(activitiesArr).map(a => (a?.text || "").trim()).filter(Boolean);
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

async function saveProject(pool, project, weekLabel, savedAt, engCache, proyCache, engineerCatalogIndex) {
  const proyectoID  = await resolveProject(pool, project, proyCache);
  const reportDate  = new Date().toISOString().slice(0, 10);
  const semana      = getWeekNumber(reportDate);
  const anio        = new Date(reportDate + "T12:00:00").getFullYear();
  const m           = project.manual_metrics || {};
  const total       = Number(m.total_tasks          || 0);
  const completadas = Number(m.completed_tasks       || 0);
  const enProceso   = Number(m.in_progress_tasks     || 0);
  const compartidas = Number(m.shared_tasks_discount || 0);
  const avance      = total > 0 ? Math.min(((completadas + enProceso * 0.5) / total) * 100, 100) : 0;
  const rawJson     = JSON.stringify(project);
  const actIndex    = buildActivityIndex(project.activities_identified);

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
        .input("logros",      sql.NVarChar,       JSON.stringify(resolveActArr(actIndex, project.weekly_achievements)))
        .input("plan",        sql.NVarChar,       JSON.stringify(resolveActArr(actIndex, project.next_week_plan)))
        .input("weekLabel",   sql.NVarChar(100),  weekLabel || "")
        .input("savedAt",     sql.DateTime2,      new Date())
        .input("rawJson",     sql.NVarChar,       rawJson)
        .input("statusNotes", sql.NVarChar,       project.status_notes || "")
        .query(`UPDATE ReportesSemanales SET
          FechaReporte=@fechaRep, EstadoProyecto=@estado,
          Metrica_Total=@total, Metrica_Completadas=@completadas,
          Metrica_EnProceso=@enProceso, Metrica_Compartidas=@compartidas,
          AvancePromedio=@avance, MostrarCierre=@mostrar,
          LogrosSemana=@logros, PlanProximaSemana=@plan,
          WeekLabel=@weekLabel, SavedAt=@savedAt, RawDataJSON=@rawJson,
          StatusNotes=@statusNotes
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
      .input("logros",      sql.NVarChar,      JSON.stringify(resolveActArr(actIndex, project.weekly_achievements)))
      .input("plan",        sql.NVarChar,      JSON.stringify(resolveActArr(actIndex, project.next_week_plan)))
      .input("weekLabel",   sql.NVarChar(100), weekLabel || "")
      .input("savedAt",     sql.DateTime2,     new Date(savedAt || Date.now()))
      .input("rawJson",     sql.NVarChar,      rawJson)
      .input("statusNotes", sql.NVarChar,      project.status_notes || "")
      .query(`INSERT INTO ReportesSemanales
        (ProyectoID,NumeroSemana,Anio,FechaReporte,EstadoProyecto,
         Metrica_Total,Metrica_Completadas,Metrica_EnProceso,Metrica_Compartidas,
         AvancePromedio,MostrarCierre,LogrosSemana,PlanProximaSemana,
         WeekLabel,SavedAt,RawDataJSON,StatusNotes)
        OUTPUT INSERTED.ReporteID
        VALUES (@pid,@semana,@anio,@fechaRep,@estado,
         @total,@completadas,@enProceso,@compartidas,
         @avance,@mostrar,@logros,@plan,
         @weekLabel,@savedAt,@rawJson,@statusNotes)`);
    reporteID = ins.recordset[0].ReporteID;
  }

  // ── Construir todos los INSERTs de detalle como multi-row ─────────────────

  const inserts = [];

  // Estado de actividades
  const ts = project.task_status || {};
  const completedDates  = ts.completed_dates  || {};
  const statusHistory   = ts.status_history   || {};
  const completedBy     = ts.completed_by     || {};
  const statusMap = { completed: "Completada", in_progress: "En_Proceso", not_started: "No_Iniciada" };

  // Índice actId → array de [{localEngId, engName}] (múltiples ingenieros por actividad)
  const actAssignMap = new Map();
  for (const act of (Array.isArray(project.activities_identified) ? project.activities_identified : [])) {
    if (act && act.id && Array.isArray(act.assigned_engineers) && act.assigned_engineers.length) {
      actAssignMap.set(act.id, act.assigned_engineers.map(e => ({ localEngId: e.id, engName: e.name || "" })));
    }
  }

  const taskRows = [];
  const taskReq  = pool.request().input("rid", sql.Int, reporteID);
  let ti = 0;
  for (const [key, label] of Object.entries(statusMap)) {
    for (const actId of safeArr(ts[key])) {
      const hist        = statusHistory[actId] || {};
      const fechaComp   = key === "completed" ? (completedDates[actId] || hist.completed || null) : null;
      const fechaInsc   = hist.added       || null;
      const fechaEnProc = hist.in_progress || null;

      // Para múltiples ingenieros guardamos los nombres concatenados; el primer sqlId resuelto va a AsignadoIngenieroID
      const cbEntries   = key === "completed" && Array.isArray(completedBy[actId]) ? completedBy[actId] : null;
      const assignInfos = cbEntries || actAssignMap.get(actId) || [];
      const engNameStr  = assignInfos.map(e => e.engineer_name || e.engName || "").filter(Boolean).join(", ");
      const firstLocalId = assignInfos[0]?.engineer_id || assignInfos[0]?.localEngId || null;
      const catalogEntr  = firstLocalId ? engineerCatalogIndex.get(firstLocalId) : null;
      const engSqlId     = catalogEntr?.sqlId || null;

      taskReq.input(`ttexto${ti}`,   sql.NVarChar,      resolveActText(actIndex, actId));
      taskReq.input(`testado${ti}`,  sql.NVarChar(50),  label);
      taskReq.input(`tfecha${ti}`,   sql.Date,          fechaComp);
      taskReq.input(`tfinsc${ti}`,   sql.Date,          fechaInsc);
      taskReq.input(`tfenproc${ti}`, sql.Date,          fechaEnProc);
      taskReq.input(`tengid${ti}`,   sql.Int,           engSqlId);
      taskReq.input(`tengname${ti}`, sql.NVarChar(500), engNameStr);
      taskRows.push(`(@rid,@ttexto${ti},@testado${ti},@tfecha${ti},@tfinsc${ti},@tfenproc${ti},@tengid${ti},@tengname${ti})`);
      ti++;
    }
  }
  if (taskRows.length) {
    inserts.push(taskReq.query(`INSERT INTO Estado_Actividades_Reporte (ReporteID,DescripcionTexto,Estado,FechaCompletado,FechaInscripcion,FechaEnProceso,AsignadoIngenieroID,AsignadoNombre) VALUES ${taskRows.join(",")}`));
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
    ...(project.milestones || []).filter(ms => ms.date || ms.note).map(ms => ({ tipo: "FECHA_CLAVE", act: ms.activity ? resolveActText(actIndex, ms.activity) : "", fecha: ms.date || null, contenido: ms.note || "" })),
    ...(project.comments   || []).filter(cm => cm.text).map(cm =>             ({ tipo: "COMENTARIO",  act: cm.activity ? resolveActText(actIndex, cm.activity) : "", fecha: cm.date || null, contenido: cm.text || "" })),
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

  // Ingenieros — usa sql_id directo si el ingeniero ya está sincronizado;
  // si no, cae al fuzzy-match de resolveEngineer por nombre (compatibilidad).
  const engItems = (project.engineers || []).filter(e => e.engineer_id);
  if (engItems.length) {
    const resolvedEngs = await Promise.all(
      engItems.map(eng => {
        const catalogEntry = engineerCatalogIndex.get(eng.engineer_id);
        if (catalogEntry?.sqlId) return Promise.resolve({ id: catalogEntry.sqlId, eng });
        return resolveEngineer(pool, catalogEntry?.name || "", engCache).then(id => ({ id, eng }));
      })
    );
    const validEngs = resolvedEngs.filter(r => r.id);
    if (validEngs.length) {
      const engReq  = pool.request().input("rid", sql.Int, reporteID);
      const engRows = validEngs.map(({ id, eng }, i) => {
        engReq.input(`eingId${i}`,    sql.Int,      id);
        engReq.input(`esemTotal${i}`, sql.Int,      Number(eng.weekly_total|| 0));
        engReq.input(`esemDet${i}`,   sql.NVarChar, JSON.stringify(resolveActArr(actIndex, eng.weekly_detail)));
        return `(@rid,@eingId${i},@esemTotal${i},@esemDet${i})`;
      });
      inserts.push(engReq.query(`INSERT INTO Estadisticas_Ingeniero_Semana (ReporteID,IngenieroID,Semana_Total,Semana_Detalle) VALUES ${engRows.join(",")}`));
    }
  }

  // Ejecutar todos los INSERTs de detalle en paralelo
  await Promise.all(inserts);
}

// ── Guardar todos los proyectos en paralelo ───────────────────────────────────

async function saveWeekReportToDB(projects, weekLabel, savedAt, engineersCatalog) {
  const pool = await getPool();

  const { engCache, proyCache } = await preloadCaches(pool, projects);
  const engineerCatalogIndex = buildEngineerCatalogIndex(engineersCatalog);

  // Procesar todos los proyectos en paralelo
  await Promise.all(
    projects.map(project => saveProject(pool, project, weekLabel, savedAt, engCache, proyCache, engineerCatalogIndex))
  );
}

// ── Exportar ──────────────────────────────────────────────────────────────────

module.exports = { saveWeekReportToDB, syncEngineerToSQL, syncEngineerTaskToSQL, deleteEngineerTaskFromSQL, syncExternalContactToSQL };
