"use strict";

// ── Registro de consultas del módulo de reportes (Fase 2) ───────────────────
//
// Cada "consulta" es una vista fija: el `from` (con sus JOINs) está escrito
// aquí, en el backend, y nunca se construye a partir de lo que mande el
// usuario. Lo único que el frontend puede elegir es qué `filtros` aplicar
// (de una lista cerrada) y qué `columnas` proyectar (de otra lista cerrada).
// query-builder.cjs valida ambas contra este registro antes de tocar SQL.
//
// Nombrado "registro" y no "catálogo" a propósito: backend/project-catalog.json
// ya existe y es otra cosa (contexto para prompts de IA en gemini-report.cjs).
//
// Alcance de esta fase: 4 consultas con tablas que ya existen. La quinta
// ("notas") se agrega en la Fase 3 junto con la tabla Proyecto_Notas.
// "ingenieros" usa Estado_Actividades_Reporte (asignación por reporte
// semanal) porque es la única tabla que hoy liga actividad+ingeniero+fecha —
// Actividades_Detalle no guarda asignación, y Actividad_Eventos todavía no
// audita cambios de asignación (ver nota en activity-events.cjs).

const sql = require("mssql");

const REGISTRY = {
  // "¿Qué actividades se movieron esta semana / este proyecto?" — sobre el
  // event log de la Fase 1.
  actividades: {
    from: `Actividad_Eventos ae
           LEFT JOIN Actividades_Detalle ad ON ad.AppActividadID = ae.AppActividadID
           LEFT JOIN Proyectos p            ON p.AppID = ae.AppProyectoID`,
    filtros: {
      semana_iso:   { columna: "ae.SemanaISO",    tipo: "texto",       sqlType: sql.Char(8),      operador: ["="] },
      proyecto_id:  { columna: "ae.AppProyectoID", tipo: "lista",       sqlType: sql.NVarChar(60), operador: ["=", "in"] },
      tipo:         { columna: "ae.Tipo",          tipo: "lista",       sqlType: sql.NVarChar(30), operador: ["=", "in"] },
      origen:       { columna: "ae.Origen",        tipo: "lista",       sqlType: sql.NVarChar(30), operador: ["=", "in"] },
      fecha_evento: { columna: "ae.FechaEvento",   tipo: "rango_fecha", sqlType: sql.Date,         operador: ["between", "=", ">=", "<="] },
    },
    columnasPermitidas: {
      proyecto:       "p.NombreProyecto",
      proyecto_id:    "ae.AppProyectoID",
      actividad:      "ad.TextoActividad",
      actividad_id:   "ae.AppActividadID",
      tipo:           "ae.Tipo",
      valor_anterior: "ae.ValorAnterior",
      valor_nuevo:    "ae.ValorNuevo",
      fecha_evento:   "ae.FechaEvento",
      semana_iso:     "ae.SemanaISO",
      origen:         "ae.Origen",
    },
    columnasDefault: ["proyecto", "actividad", "tipo", "valor_anterior", "valor_nuevo", "fecha_evento"],
    ordenDefault: [{ campo: "fecha_evento", direccion: "desc" }],
  },

  // "¿Qué está haciendo cada ingeniero?" — asignación por reporte semanal.
  ingenieros: {
    from: `Estado_Actividades_Reporte ear
           JOIN ReportesSemanales rs ON rs.ReporteID = ear.ReporteID
           JOIN Proyectos p          ON p.ProyectoID = rs.ProyectoID
           LEFT JOIN Ingenieros i    ON i.IngenieroID = ear.AsignadoIngenieroID`,
    filtros: {
      ingeniero_id:  { columna: "ear.AsignadoIngenieroID", tipo: "lista",       sqlType: sql.Int,          operador: ["=", "in"] },
      proyecto_id:   { columna: "p.AppID",                 tipo: "lista",       sqlType: sql.NVarChar(60), operador: ["=", "in"] },
      estado:        { columna: "ear.Estado",              tipo: "lista",       sqlType: sql.NVarChar(50), operador: ["=", "in"] },
      anio:          { columna: "rs.Anio",                 tipo: "numero",      sqlType: sql.Int,          operador: ["="] },
      semana:        { columna: "rs.NumeroSemana",         tipo: "numero",      sqlType: sql.Int,          operador: ["="] },
      fecha_reporte: { columna: "rs.FechaReporte",         tipo: "rango_fecha", sqlType: sql.Date,         operador: ["between", ">=", "<="] },
      grupo_trabajo: { columna: "i.GrupoTrabajo",          tipo: "lista",       sqlType: sql.NVarChar(100),operador: ["=", "in"] },
    },
    columnasPermitidas: {
      ingeniero:     "i.Nombre",
      proyecto:      "p.NombreProyecto",
      actividad:     "ear.DescripcionTexto",
      estado:        "ear.Estado",
      fecha_reporte: "rs.FechaReporte",
      semana:        "rs.NumeroSemana",
      anio:          "rs.Anio",
      week_label:    "rs.WeekLabel",
      grupo_trabajo: "i.GrupoTrabajo",
    },
    columnasDefault: ["ingeniero", "proyecto", "actividad", "estado", "fecha_reporte"],
    ordenDefault: [{ campo: "fecha_reporte", direccion: "desc" }],
  },

  // "¿Cuáles son los proyectos y en qué estado están ahora?" — último reporte
  // semanal de cada proyecto.
  proyectos: {
    from: `Proyectos p
           OUTER APPLY (
             SELECT TOP 1 rs2.EstadoProyecto, rs2.AvancePromedio, rs2.FechaReporte, rs2.WeekLabel
             FROM ReportesSemanales rs2
             WHERE rs2.ProyectoID = p.ProyectoID
             ORDER BY rs2.Anio DESC, rs2.NumeroSemana DESC
           ) rs`,
    filtros: {
      proyecto_id:   { columna: "p.AppID",          tipo: "lista",   sqlType: sql.NVarChar(60), operador: ["=", "in"] },
      estado:        { columna: "rs.EstadoProyecto", tipo: "lista",   sqlType: sql.NVarChar(50), operador: ["=", "in"] },
      prioridad:     { columna: "p.Prioridad",       tipo: "lista",   sqlType: sql.TinyInt,      operador: ["=", "in"] },
      grupo_trabajo: { columna: "p.GrupoTrabajo",    tipo: "lista",   sqlType: sql.NVarChar(100),operador: ["=", "in"] },
    },
    columnasPermitidas: {
      proyecto:      "p.NombreProyecto",
      proyecto_id:   "p.AppID",
      estado:        "rs.EstadoProyecto",
      avance:        "rs.AvancePromedio",
      fecha_reporte: "rs.FechaReporte",
      week_label:    "rs.WeekLabel",
      url_planner:   "p.URLPlanner",
      prioridad:     "p.Prioridad",
      grupo_trabajo: "p.GrupoTrabajo",
    },
    columnasDefault: ["proyecto", "estado", "avance", "fecha_reporte"],
    ordenDefault: [{ campo: "proyecto", direccion: "asc" }],
  },

  // Notas y comentarios fechados de proyecto (Fase 3).
  notas: {
    from: `Proyecto_Notas pn
           LEFT JOIN Proyectos p ON p.AppID = pn.AppProyectoID`,
    filtros: {
      proyecto_id: { columna: "pn.AppProyectoID", tipo: "lista",       sqlType: sql.NVarChar(60), operador: ["=", "in"] },
      tipo:        { columna: "pn.Tipo",           tipo: "lista",       sqlType: sql.NVarChar(20), operador: ["=", "in"] },
      fecha:       { columna: "pn.Fecha",          tipo: "rango_fecha", sqlType: sql.Date,         operador: ["between", ">=", "<="] },
    },
    columnasPermitidas: {
      proyecto:   "p.NombreProyecto",
      fecha:      "pn.Fecha",
      autor:      "pn.Autor",
      tipo:       "pn.Tipo",
      texto:      "pn.Texto",
    },
    columnasDefault: ["proyecto", "fecha", "autor", "tipo", "texto"],
    ordenDefault: [{ campo: "fecha", direccion: "desc" }],
  },

  // "Actividades vencidas" — sobre el estado operacional vivo, no el event log.
  vencidas: {
    from: `Actividades_Detalle ad
           LEFT JOIN Proyectos p ON p.AppID = ad.ProyectoAppID`,
    where: "ad.FechaFin < CAST(GETDATE() AS DATE) AND ad.Estado <> 'completed'",
    filtros: {
      proyecto_id: { columna: "ad.ProyectoAppID", tipo: "lista", sqlType: sql.NVarChar(60), operador: ["=", "in"] },
    },
    columnasPermitidas: {
      proyecto:     "p.NombreProyecto",
      actividad:    "ad.TextoActividad",
      estado:       "ad.Estado",
      fecha_fin:    "ad.FechaFin",
      fecha_inicio: "ad.FechaInicio",
    },
    columnasDefault: ["proyecto", "actividad", "estado", "fecha_fin"],
    ordenDefault: [{ campo: "fecha_fin", direccion: "asc" }],
  },
};

module.exports = { REGISTRY };
