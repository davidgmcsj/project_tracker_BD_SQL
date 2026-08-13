"use strict";

// attachments.repo.cjs — Adjuntos de actividades.
//
// Fase 10 (ver ../../plan-blob-storage.md, migración 021): los bytes se
// suben a Azure Blob Storage y en SQL (Actividad_Adjuntos) solo queda la
// metadata + BlobUrl. Se mantiene compatibilidad con lo YA subido antes de
// este cambio (Contenido poblado, BlobUrl null): getAttachmentFromDB decide
// de dónde leer según cuál de los dos esté poblado — sin backfill no hay
// adjuntos rotos, sin importar cuándo se suban.
//
// Orden deliberado en saveAttachmentToDB: sube a Blob PRIMERO, escribe en
// SQL DESPUÉS. Si Blob falla, no se escribe nada en SQL — no queda un
// registro apuntando a un blob que nunca se subió.

const sql = require("mssql");
const { getPool } = require("./pool.cjs");
const { uploadBlob, downloadBlob, deleteBlob } = require("../blob-storage.cjs");

async function saveAttachmentToDB({ appAdjuntoID, appActividadID, proyectoAppID, nombre, mime, size, buffer }) {
  const blobUrl = await uploadBlob(appAdjuntoID, buffer, mime);
  const pool = await getPool();
  await pool.request()
    .input("appId",   sql.NVarChar(60),  appAdjuntoID)
    .input("actId",   sql.NVarChar(60),  appActividadID)
    .input("proyId",  sql.NVarChar(60),  proyectoAppID || null)
    .input("nombre",  sql.NVarChar(400), nombre)
    .input("mime",    sql.NVarChar(200), mime || null)
    .input("size",    sql.BigInt,        size || 0)
    .input("blobUrl", sql.NVarChar(1000), blobUrl)
    .query(`
      MERGE dbo.Actividad_Adjuntos AS t
      USING (SELECT @appId AS AppAdjuntoID) AS s
      ON t.AppAdjuntoID = s.AppAdjuntoID
      WHEN MATCHED THEN UPDATE SET
        NombreArchivo=@nombre, TipoMime=@mime, Tamano=@size,
        Contenido=NULL, BlobUrl=@blobUrl, AppActividadID=@actId, ProyectoAppID=@proyId
      WHEN NOT MATCHED THEN INSERT
        (AppAdjuntoID, AppActividadID, ProyectoAppID, NombreArchivo, TipoMime, Tamano, Contenido, BlobUrl)
        VALUES (@appId, @actId, @proyId, @nombre, @mime, @size, NULL, @blobUrl);
    `);
}

async function getAttachmentFromDB(appAdjuntoID) {
  const pool = await getPool();
  const r = await pool.request()
    .input("appId", sql.NVarChar(60), appAdjuntoID)
    .query(`SELECT NombreArchivo, TipoMime, Tamano, Contenido, BlobUrl
            FROM dbo.Actividad_Adjuntos WHERE AppAdjuntoID = @appId`);
  const row = r.recordset[0];
  if (!row) return null;

  // Compatibilidad: adjunto ya migrado (BlobUrl poblado) lee de Blob; uno
  // viejo, todavía no tocado por el backfill, sigue leyendo de SQL.
  const buffer = row.BlobUrl ? await downloadBlob(appAdjuntoID) : row.Contenido;
  return { nombre: row.NombreArchivo, mime: row.TipoMime, size: row.Tamano, buffer };
}

async function deleteAttachmentFromDB(appAdjuntoID) {
  const pool = await getPool();
  // No bloquea el borrado en SQL si el blob ya no existe (adjunto viejo
  // que nunca se migró, o ya se había borrado antes).
  await deleteBlob(appAdjuntoID).catch(() => {});
  await pool.request()
    .input("appId", sql.NVarChar(60), appAdjuntoID)
    .query(`DELETE FROM dbo.Actividad_Adjuntos WHERE AppAdjuntoID = @appId`);
}

module.exports = { saveAttachmentToDB, getAttachmentFromDB, deleteAttachmentFromDB };
