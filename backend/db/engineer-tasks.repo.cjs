"use strict";

// engineer-tasks.repo.cjs — Tareas sueltas del ingeniero, no asociadas a
// ningún proyecto/reporte. Cada tarea tiene un id local estable (etask_xxx,
// AppTaskID en SQL). Upsert por ese id: si ya existe la fila, se actualiza;
// si no, se inserta. Esto permite consultar en SQL qué tenía un ingeniero en
// una fecha/rango, en proyectos (Estadisticas_Ingeniero_Semana) Y en tareas
// sueltas (esta tabla), por separado.

const sql = require("mssql");
const { getPool } = require("./pool.cjs");

// Extrae las 3 fechas de estado desde el historial de la tarea, con respaldo
// al campo legacy `date` para la fecha de inscripción de tareas antiguas.
function taskDates(task) {
  const h = task.history || {};
  return {
    inscrita:   h.added       || task.date || null,
    inicio:     h.in_progress || null,
    completada: h.completed   || null,
  };
}

// Registra en un request los inputs de los campos ricos (detalle, objetivos,
// solución, fechas de plan, progreso, horas y el JSON de checklist/notas/
// fechas clave). Compartido por INSERT y UPDATE para no duplicar.
function bindTaskRichInputs(request, task) {
  const extra = JSON.stringify({
    checklist: Array.isArray(task.checklist) ? task.checklist : [],
    notes:     Array.isArray(task.notes)     ? task.notes     : [],
    key_dates: Array.isArray(task.key_dates) ? task.key_dates : [],
  });
  return request
    .input("detalle",   sql.NVarChar,       task.detail     || "")
    .input("objetivos", sql.NVarChar,       task.objectives || "")
    .input("solucion",  sql.NVarChar,       task.solution   || "")
    .input("fInicioP",  sql.Date,           task.start_date || null)
    .input("fFinP",     sql.Date,           task.due_date   || null)
    .input("progreso",  sql.Int,            Math.max(0, Math.min(100, Number(task.progress) || 0)))
    .input("horas",     sql.Decimal(8, 2),  Math.max(0, Number(task.planned_hours) || 0))
    .input("extra",     sql.NVarChar,       extra);
}

const RICH_SET_CLAUSE =
  "Detalle=@detalle, Objetivos=@objetivos, Solucion=@solucion, " +
  "FechaInicioPlan=@fInicioP, FechaFinPlan=@fFinP, Progreso=@progreso, " +
  "HorasPlaneadas=@horas, DatosExtra=@extra";

async function updateEngineerTaskByAppId(task) {
  const pool = await getPool();
  const d = taskDates(task);
  const req = bindTaskRichInputs(pool.request(), task)
    .input("appId",   sql.NVarChar(50), task.id)
    .input("desc",    sql.NVarChar,     task.description || "")
    .input("estado",  sql.NVarChar(50), task.status || "not_started")
    .input("fecha",   sql.Date,         d.inscrita)
    .input("finsc",   sql.Date,         d.inscrita)
    .input("finicio", sql.Date,         d.inicio)
    .input("fcomp",   sql.Date,         d.completada);
  const upd = await req.query(`UPDATE Tareas_Sueltas_Ingeniero
            SET Descripcion=@desc, Estado=@estado, Fecha=@fecha,
                FechaInscrita=@finsc, FechaInicio=@finicio, FechaCompletada=@fcomp,
                ${RICH_SET_CLAUSE},
                UltimaActualizacion=GETDATE()
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
    const d = taskDates(task);
    const req = bindTaskRichInputs(pool.request(), task)
      .input("ingId",   sql.Int,          engineerSqlId)
      .input("appId",   sql.NVarChar(50), task.id)
      .input("desc",    sql.NVarChar,     task.description || "")
      .input("estado",  sql.NVarChar(50), task.status || "not_started")
      .input("fecha",   sql.Date,         d.inscrita)
      .input("finsc",   sql.Date,         d.inscrita)
      .input("finicio", sql.Date,         d.inicio)
      .input("fcomp",   sql.Date,         d.completada);
    const ins = await req.query(`INSERT INTO Tareas_Sueltas_Ingeniero
                (IngenieroID, AppTaskID, Descripcion, Estado, Fecha, FechaInscrita, FechaInicio, FechaCompletada,
                 Detalle, Objetivos, Solucion, FechaInicioPlan, FechaFinPlan, Progreso, HorasPlaneadas, DatosExtra)
              OUTPUT INSERTED.TareaID
              VALUES (@ingId, @appId, @desc, @estado, @fecha, @finsc, @finicio, @fcomp,
                 @detalle, @objetivos, @solucion, @fInicioP, @fFinP, @progreso, @horas, @extra)`);
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

module.exports = { syncEngineerTaskToSQL, deleteEngineerTaskFromSQL };
