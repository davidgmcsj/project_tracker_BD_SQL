"use strict";

// ── Event log de actividades (Fase 1) ────────────────────────────────────────
// snapshotFromRows / snapshotFromProject / diffSnapshots son funciones puras,
// sin SQL — el corazón testeable de esta pieza. insertEvents es la única
// función de este archivo que toca la base de datos.
//
// Alcance de esta fase: el diff solo cubre las columnas que ya existen en
// Actividades_Detalle (Estado, Progreso, FechaInicio, FechaFin,
// HorasPlaneadas). Asignación de ingenieros y notas NO se auditan aquí
// todavía: Actividades_Detalle no guarda esas relaciones, así que un SELECT
// previo sobre esa tabla no puede decir "quién estaba asignado antes". Hacerlo
// bien requeriría una tabla puente nueva o capturar el proyecto completo antes
// de sobreescribirlo — evaluar en una fase posterior si se necesita.

const crypto = require("crypto");
const sql = require("mssql");
const { isoWeek, todayISO } = require("./utils.cjs");

const TIPOS = ["estado", "progreso", "fecha_inicio", "fecha_fin", "horas"];

function toISODate(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

// Filas de `SELECT AppActividadID, Estado, Progreso, FechaInicio, FechaFin,
// HorasPlaneadas FROM Actividades_Detalle WHERE ProyectoAppID = @proyId`
// → Map(actividadId -> snapshot). Es el estado "antes" del guardado.
function snapshotFromRows(rows) {
  const map = new Map();
  (Array.isArray(rows) ? rows : []).forEach(r => {
    if (!r?.AppActividadID) return;
    map.set(r.AppActividadID, {
      estado:         r.Estado || "not_started",
      progreso:       Number(r.Progreso) || 0,
      fechaInicio:    toISODate(r.FechaInicio),
      fechaFin:       toISODate(r.FechaFin),
      horasPlaneadas: Number(r.HorasPlaneadas) || 0,
    });
  });
  return map;
}

function statusOfActivity(taskStatus, actId) {
  const ts = taskStatus || {};
  if ((ts.completed   || []).includes(actId)) return "completed";
  if ((ts.in_progress || []).includes(actId)) return "in_progress";
  return "not_started";
}

// Objeto `project` (forma del JSON del frontend) → Map(actividadId -> snapshot),
// misma forma que snapshotFromRows. Es el estado "después" del guardado.
function snapshotFromProject(project) {
  const map = new Map();
  const acts = Array.isArray(project?.activities_identified) ? project.activities_identified : [];
  const ts = project?.task_status || {};
  acts.forEach(act => {
    if (!act?.id) return;
    map.set(act.id, {
      estado:         statusOfActivity(ts, act.id),
      progreso:       Math.max(0, Math.min(100, Math.round(Number(act.progress) || 0))),
      fechaInicio:    act.start_date || "",
      fechaFin:       act.due_date || "",
      horasPlaneadas: Math.max(0, Number(act.planned_hours) || 0),
    });
  });
  return map;
}

function hashEvento(partes) {
  return crypto.createHash("sha256").update(partes.join("|"), "utf8").digest("hex");
}

// diffSnapshots: compara dos snapshots y devuelve la lista de eventos a
// insertar. Cada campo que cambió genera un evento independiente. Función
// pura — no abre conexión ni conoce mssql.
function diffSnapshots(prevMap, nextMap, ctx = {}) {
  const { proyectoAppID = null, fechaEvento = todayISO(), origen = "app" } = ctx;
  const semanaISO = isoWeek(fechaEvento);
  const eventos = [];

  const push = (actId, tipo, valorAnterior, valorNuevo) => {
    const va = valorAnterior === "" || valorAnterior == null ? null : String(valorAnterior);
    const vn = valorNuevo === "" || valorNuevo == null ? null : String(valorNuevo);
    eventos.push({
      appActividadID: actId,
      appProyectoID:  proyectoAppID,
      appIngenieroID: null,
      tipo,
      valorAnterior:  va,
      valorNuevo:     vn,
      fechaEvento,
      semanaISO,
      origen,
      hashCambio: hashEvento([actId, tipo, va ?? "", vn ?? "", fechaEvento, origen]),
    });
  };

  for (const [actId, next] of nextMap.entries()) {
    const prev = prevMap.get(actId);

    if (!prev) {
      // Actividad nueva para el event log (no estaba en Actividades_Detalle
      // todavía). Solo se registra si ya trae algo distinto del estado inicial.
      if (next.estado !== "not_started")      push(actId, "estado", "not_started", next.estado);
      if (next.progreso > 0)                  push(actId, "progreso", 0, next.progreso);
      if (next.fechaInicio)                   push(actId, "fecha_inicio", "", next.fechaInicio);
      if (next.fechaFin)                      push(actId, "fecha_fin", "", next.fechaFin);
      if (next.horasPlaneadas > 0)            push(actId, "horas", 0, next.horasPlaneadas);
      continue;
    }

    if (prev.estado !== next.estado)                 push(actId, "estado", prev.estado, next.estado);
    if (prev.progreso !== next.progreso)             push(actId, "progreso", prev.progreso, next.progreso);
    if (prev.fechaInicio !== next.fechaInicio)       push(actId, "fecha_inicio", prev.fechaInicio, next.fechaInicio);
    if (prev.fechaFin !== next.fechaFin)             push(actId, "fecha_fin", prev.fechaFin, next.fechaFin);
    if (prev.horasPlaneadas !== next.horasPlaneadas) push(actId, "horas", prev.horasPlaneadas, next.horasPlaneadas);
  }

  return eventos;
}

const BATCH_SIZE = 150; // 10 params/evento × 150 ≈ 1500, bajo el límite de 2100 params de SQL Server

// Inserta eventos en lotes. Usa MERGE sobre HashCambio para que reprocesar el
// mismo lote (reintento de red, re-corrida del backfill) no duplique filas.
async function insertEvents(pool, eventos) {
  if (!Array.isArray(eventos) || !eventos.length) return;

  for (let start = 0; start < eventos.length; start += BATCH_SIZE) {
    const batch = eventos.slice(start, start + BATCH_SIZE);
    const req = pool.request();
    const rows = batch.map((ev, i) => {
      req.input(`eActId${i}`,   sql.NVarChar(60), ev.appActividadID);
      req.input(`eProyId${i}`,  sql.NVarChar(60), ev.appProyectoID);
      req.input(`eIngId${i}`,   sql.NVarChar(60), ev.appIngenieroID);
      req.input(`eTipo${i}`,    sql.NVarChar(30), ev.tipo);
      req.input(`eVA${i}`,      sql.NVarChar(sql.MAX), ev.valorAnterior);
      req.input(`eVN${i}`,      sql.NVarChar(sql.MAX), ev.valorNuevo);
      req.input(`eFEvento${i}`, sql.Date, ev.fechaEvento);
      req.input(`eSemana${i}`,  sql.Char(8), ev.semanaISO);
      req.input(`eOrigen${i}`,  sql.NVarChar(30), ev.origen);
      req.input(`eHash${i}`,    sql.Char(64), ev.hashCambio);
      return `(@eActId${i},@eProyId${i},@eIngId${i},@eTipo${i},@eVA${i},@eVN${i},@eFEvento${i},@eSemana${i},@eOrigen${i},@eHash${i})`;
    });

    await req.query(`
      MERGE Actividad_Eventos AS t
      USING (VALUES ${rows.join(",")}) AS s
        (AppActividadID,AppProyectoID,AppIngenieroID,Tipo,ValorAnterior,ValorNuevo,FechaEvento,SemanaISO,Origen,HashCambio)
      ON t.HashCambio = s.HashCambio
      WHEN NOT MATCHED THEN
        INSERT (AppActividadID,AppProyectoID,AppIngenieroID,Tipo,ValorAnterior,ValorNuevo,FechaEvento,SemanaISO,Origen,HashCambio)
        VALUES (s.AppActividadID,s.AppProyectoID,s.AppIngenieroID,s.Tipo,s.ValorAnterior,s.ValorNuevo,s.FechaEvento,s.SemanaISO,s.Origen,s.HashCambio);
    `);
  }
}

module.exports = { TIPOS, snapshotFromRows, snapshotFromProject, diffSnapshots, insertEvents, hashEvento };
