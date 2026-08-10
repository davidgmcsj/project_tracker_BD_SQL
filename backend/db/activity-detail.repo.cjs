"use strict";

// activity-detail.repo.cjs — Sync del detalle operacional de actividades
// (Actividades_Detalle, Actividad_Checklist, Actividad_Notas,
// Actividad_FechasClave). Estrategia bulk: DELETE por ProyectoAppID/actividad
// + INSERT de todas las filas en una sola query por tabla. Total: 8 queries
// fijas sin importar el tamaño del proyecto.
//
// Distinta de "Actividades" (projects.repo.cjs), tabla legada de solo texto.

const sql = require("mssql");
const { getPool } = require("./pool.cjs");
const { todayISO } = require("../utils.cjs");
const { snapshotFromRows, snapshotFromProject, diffSnapshots, insertEvents } = require("../activity-events.cjs");
const { syncProjectMeta } = require("./projects.repo.cjs");

const toDateOrNull = (v) => (v && typeof v === "string" && v.trim() ? new Date(v) : null);

async function syncActividadesDetalle(project) {
  const pool = await getPool();

  await syncProjectMeta(pool, project);

  const proyectoAppID = project.id || "";

  // Fase 1 — SELECT previo para el event log. Degradación explícita: si falla,
  // el guardado normal de abajo procede idéntico a como funcionaba antes de
  // esta fase — se pierde el evento, nunca el dato operacional.
  let prevSnapshot = null;
  try {
    const prevRes = await pool.request()
      .input("proyId", sql.NVarChar(60), proyectoAppID)
      .query(`SELECT AppActividadID, Estado, Progreso, FechaInicio, FechaFin, HorasPlaneadas
              FROM Actividades_Detalle WHERE ProyectoAppID = @proyId`);
    prevSnapshot = snapshotFromRows(prevRes.recordset);
  } catch (e) {
    console.warn(`[EVENTOS] ⚠ SELECT previo falló para ${proyectoAppID}:`, e.message);
    prevSnapshot = null;
  }

  const acts = Array.isArray(project.activities_identified) ? project.activities_identified : [];
  const ts   = project.task_status || {};
  const hist = ts.status_history   || {};

  const statusOf = (actId) => {
    if ((ts.completed   || []).includes(actId)) return "completed";
    if ((ts.in_progress || []).includes(actId)) return "in_progress";
    if ((ts.not_started || []).includes(actId)) return "not_started";
    return "not_started";
  };

  // Construir filas para cada tabla como placeholders parametrizados —
  // cada valor se liga vía .input(), nunca se interpola directo en el SQL.
  const detReq = pool.request();
  const detRows = [];
  const chkReq = pool.request();
  const chkRows = [];
  const notaReq = pool.request();
  const notaRows = [];
  const kdReq = pool.request();
  const kdRows = [];
  let di = 0, ci = 0, ni = 0, ki = 0;

  for (const act of acts) {
    if (!act?.id) continue;
    const actHist = hist[act.id] || {};
    const estado  = statusOf(act.id);

    const progreso = Math.max(0, Math.min(100, Math.round(Number(act.progress) || 0)));
    const horas    = Math.max(0, Number(act.planned_hours) || 0);

    detReq.input(`dActId${di}`,     sql.NVarChar(60),  act.id);
    detReq.input(`dProyId${di}`,    sql.NVarChar(60),  proyectoAppID);
    detReq.input(`dTexto${di}`,     sql.NVarChar,      act.text || "");
    detReq.input(`dFInicio${di}`,   sql.Date,          toDateOrNull(act.start_date));
    detReq.input(`dFFin${di}`,      sql.Date,          toDateOrNull(act.due_date));
    detReq.input(`dDesc${di}`,      sql.NVarChar,      act.description || "");
    detReq.input(`dObj${di}`,       sql.NVarChar,      act.objectives || "");
    detReq.input(`dSol${di}`,       sql.NVarChar,      act.solution || "");
    detReq.input(`dEstado${di}`,    sql.NVarChar(50),  estado);
    detReq.input(`dFInsc${di}`,     sql.Date,          toDateOrNull(actHist.added));
    detReq.input(`dFEnProc${di}`,   sql.Date,          toDateOrNull(actHist.in_progress));
    detReq.input(`dFComp${di}`,     sql.Date,          toDateOrNull(actHist.completed));
    detReq.input(`dProgreso${di}`,  sql.Int,           progreso);
    detReq.input(`dHoras${di}`,     sql.Decimal(8, 2), horas);
    detRows.push(
      `(@dActId${di},@dProyId${di},@dTexto${di},@dFInicio${di},@dFFin${di},` +
      `@dDesc${di},@dObj${di},@dSol${di},@dEstado${di},` +
      `@dFInsc${di},@dFEnProc${di},@dFComp${di},GETDATE(),@dProgreso${di},@dHoras${di})`
    );
    di++;

    (act.checklist || []).forEach((item, idx) => {
      if (!item?.id) return;
      chkReq.input(`cActId${ci}`, sql.NVarChar(60), act.id);
      chkReq.input(`cItemId${ci}`, sql.NVarChar(60), item.id);
      chkReq.input(`cTexto${ci}`, sql.NVarChar, item.text || "");
      chkReq.input(`cHecho${ci}`, sql.Bit, item.done ? 1 : 0);
      chkReq.input(`cOrden${ci}`, sql.Int, idx);
      chkRows.push(`(@cActId${ci},@cItemId${ci},@cTexto${ci},@cHecho${ci},@cOrden${ci})`);
      ci++;
    });

    (act.notes || []).forEach(nota => {
      if (!nota?.id) return;
      notaReq.input(`nActId${ni}`, sql.NVarChar(60), act.id);
      notaReq.input(`nNotaId${ni}`, sql.NVarChar(60), nota.id);
      notaReq.input(`nFecha${ni}`, sql.Date, toDateOrNull(nota.date));
      notaReq.input(`nTexto${ni}`, sql.NVarChar, nota.text || "");
      notaRows.push(`(@nActId${ni},@nNotaId${ni},@nFecha${ni},@nTexto${ni})`);
      ni++;
    });

    (act.key_dates || []).forEach(kd => {
      if (!kd?.id) return;
      kdReq.input(`kActId${ki}`, sql.NVarChar(60), act.id);
      kdReq.input(`kFechaId${ki}`, sql.NVarChar(60), kd.id);
      kdReq.input(`kFecha${ki}`, sql.Date, toDateOrNull(kd.date));
      kdReq.input(`kEtiqueta${ki}`, sql.NVarChar, kd.label || "");
      kdRows.push(`(@kActId${ki},@kFechaId${ki},@kFecha${ki},@kEtiqueta${ki})`);
      ki++;
    });
  }

  // actIds parametrizados, para los 3 DELETE ... WHERE AppActividadID IN (...).
  // Cada mssql.Request solo se puede ejecutar una vez, así que se genera una
  // request nueva por cada DELETE reutilizando la misma lista de placeholders.
  const actIdList = acts.filter(a => a?.id).map(a => a.id);
  const idPlaceholders = actIdList.map((_, i) => `@aid${i}`);
  const deleteByActIds = (table) => {
    if (!idPlaceholders.length) return Promise.resolve();
    const req = pool.request();
    actIdList.forEach((id, i) => req.input(`aid${i}`, sql.NVarChar(60), id));
    return req.query(`DELETE FROM ${table} WHERE AppActividadID IN (${idPlaceholders.join(",")})`);
  };

  try {
    // Tabla Actividades_Detalle: DELETE por proyecto + INSERT bulk parametrizado
    await pool.request().input("proyId", sql.NVarChar(60), proyectoAppID)
      .query(`DELETE FROM Actividades_Detalle WHERE ProyectoAppID = @proyId`);
    if (detRows.length) {
      await detReq.query(
        `INSERT INTO Actividades_Detalle
           (AppActividadID,ProyectoAppID,TextoActividad,FechaInicio,FechaFin,
            Descripcion,Objetivos,Solucion,Estado,FechaInscripcion,FechaEnProceso,FechaCompletada,UltimaActualizacion,
            Progreso,HorasPlaneadas)
         VALUES ${detRows.join(",")}`
      );
    }

    // Tabla Actividad_Checklist: DELETE por actividades del proyecto + INSERT bulk
    await deleteByActIds("Actividad_Checklist");
    if (chkRows.length) {
      await chkReq.query(
        `INSERT INTO Actividad_Checklist (AppActividadID,AppChecklistID,Texto,Hecho,Orden) VALUES ${chkRows.join(",")}`
      );
    }

    // Tabla Actividad_Notas
    await deleteByActIds("Actividad_Notas");
    if (notaRows.length) {
      await notaReq.query(
        `INSERT INTO Actividad_Notas (AppActividadID,AppNotaID,Fecha,Texto) VALUES ${notaRows.join(",")}`
      );
    }

    // Tabla Actividad_FechasClave
    await deleteByActIds("Actividad_FechasClave");
    if (kdRows.length) {
      await kdReq.query(
        `INSERT INTO Actividad_FechasClave (AppActividadID,AppFechaID,Fecha,Etiqueta) VALUES ${kdRows.join(",")}`
      );
    }
  } catch (e) {
    console.error(`[SQL] ✗ Error en bulk sync proyecto ${proyectoAppID}:`, e.message);
    throw e;
  }

  // Fase 1 — insertar eventos como efecto secundario, sin bloquear el guardado
  // (sin await, con .catch propio: si falla, se reintenta en el próximo save).
  if (prevSnapshot) {
    const nextSnapshot = snapshotFromProject(project);
    const eventos = diffSnapshots(prevSnapshot, nextSnapshot, { proyectoAppID, fechaEvento: todayISO(), origen: "app" });
    if (eventos.length) {
      insertEvents(pool, eventos).catch(e => console.warn(`[EVENTOS] ⚠ Insert falló para ${proyectoAppID}:`, e.message));
    }
  }
}

module.exports = { syncActividadesDetalle };
