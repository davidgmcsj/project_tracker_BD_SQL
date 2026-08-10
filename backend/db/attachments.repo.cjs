"use strict";

// attachments.repo.cjs — Adjuntos de actividades. Los bytes viven SOLO en SQL
// (tabla Actividad_Adjuntos). En data.json/la actividad se guarda únicamente
// la metadata (id, nombre, tipo, tamaño).

const sql = require("mssql");
const { getPool } = require("./pool.cjs");

async function saveAttachmentToDB({ appAdjuntoID, appActividadID, proyectoAppID, nombre, mime, size, buffer }) {
  const pool = await getPool();
  await pool.request()
    .input("appId",   sql.NVarChar(60),  appAdjuntoID)
    .input("actId",   sql.NVarChar(60),  appActividadID)
    .input("proyId",  sql.NVarChar(60),  proyectoAppID || null)
    .input("nombre",  sql.NVarChar(400), nombre)
    .input("mime",    sql.NVarChar(200), mime || null)
    .input("size",    sql.BigInt,        size || 0)
    .input("contenido", sql.VarBinary(sql.MAX), buffer)
    .query(`
      MERGE dbo.Actividad_Adjuntos AS t
      USING (SELECT @appId AS AppAdjuntoID) AS s
      ON t.AppAdjuntoID = s.AppAdjuntoID
      WHEN MATCHED THEN UPDATE SET
        NombreArchivo=@nombre, TipoMime=@mime, Tamano=@size,
        Contenido=@contenido, AppActividadID=@actId, ProyectoAppID=@proyId
      WHEN NOT MATCHED THEN INSERT
        (AppAdjuntoID, AppActividadID, ProyectoAppID, NombreArchivo, TipoMime, Tamano, Contenido)
        VALUES (@appId, @actId, @proyId, @nombre, @mime, @size, @contenido);
    `);
}

async function getAttachmentFromDB(appAdjuntoID) {
  const pool = await getPool();
  const r = await pool.request()
    .input("appId", sql.NVarChar(60), appAdjuntoID)
    .query(`SELECT NombreArchivo, TipoMime, Tamano, Contenido
            FROM dbo.Actividad_Adjuntos WHERE AppAdjuntoID = @appId`);
  const row = r.recordset[0];
  if (!row) return null;
  return { nombre: row.NombreArchivo, mime: row.TipoMime, size: row.Tamano, buffer: row.Contenido };
}

async function deleteAttachmentFromDB(appAdjuntoID) {
  const pool = await getPool();
  await pool.request()
    .input("appId", sql.NVarChar(60), appAdjuntoID)
    .query(`DELETE FROM dbo.Actividad_Adjuntos WHERE AppAdjuntoID = @appId`);
}

module.exports = { saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB };
