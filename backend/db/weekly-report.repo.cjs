"use strict";

// weekly-report.repo.cjs — Guardado del reporte semanal (cierre de semana):
// ReportesSemanales + su detalle (Estado_Actividades_Reporte, Indicadores,
// Riesgos_Impedimentos, Eventos_Reporte, Estadisticas_Ingeniero_Semana).
//
// Distinto de activity-detail.repo.cjs: ese sincroniza el estado OPERACIONAL
// vivo de las actividades en cada guardado normal; este congela un snapshot
// del reporte al cerrar la semana, con su propio detalle histórico.

const sql = require("mssql");
const { getPool } = require("./pool.cjs");
const { buildActivityIndexFlat, buildEngineerIndex, resolveActText, resolveActArr, isoWeekNumber, isoYearOf, toArray } = require("../utils.cjs");
const { preloadCaches, resolveProject, syncActividades } = require("./projects.repo.cjs");
const { resolveEngineer } = require("./engineers.repo.cjs");

// ── Guardar un proyecto: todas las sub-queries en paralelo donde es posible ───

async function saveProject(pool, project, weekLabel, savedAt, engCache, proyCache, engineerCatalogIndex) {
  const proyectoID  = await resolveProject(pool, project, proyCache);
  const reportDate  = new Date().toISOString().slice(0, 10);
  const semana      = isoWeekNumber(reportDate);
  const anio        = isoYearOf(reportDate);
  const m           = project.manual_metrics || {};
  const total       = Number(m.total_tasks          || 0);
  const completadas = Number(m.completed_tasks       || 0);
  const enProceso   = Number(m.in_progress_tasks     || 0);
  const compartidas = Number(m.shared_tasks_discount || 0);
  const avance      = total > 0 ? Math.min(((completadas + enProceso * 0.5) / total) * 100, 100) : 0;
  const rawJson     = JSON.stringify(project);
  const actIndex    = buildActivityIndexFlat(project.activities_identified);

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
  // El valor guardado es el slug interno (no un label a medias) para que
  // estado-labels.cjs (translateEstado) lo traduzca correctamente en
  // pantalla y en Excel/PDF — antes se guardaba un label parcial con
  // guión bajo ("En_Proceso") que no coincidía con ninguna clave de
  // ESTADO_ACTIVIDAD_LABEL, así que el reporte de ingenieros mostraba el
  // valor crudo sin traducir.
  const statusMap = {
    completed:            "completed",
    ambiente_produccion:  "ambiente_produccion",
    ambiente_pruebas:     "ambiente_pruebas",
    in_progress:          "in_progress",
    not_started:          "not_started",
  };

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
  for (const [key, estadoSlug] of Object.entries(statusMap)) {
    for (const actId of toArray(ts[key])) {
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
      taskReq.input(`testado${ti}`,  sql.NVarChar(50),  estadoSlug);
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
  const engineerCatalogIndex = buildEngineerIndex(engineersCatalog);

  // Procesar todos los proyectos en paralelo
  await Promise.all(
    projects.map(project => saveProject(pool, project, weekLabel, savedAt, engCache, proyCache, engineerCatalogIndex))
  );
}

module.exports = { saveWeekReportToDB };
