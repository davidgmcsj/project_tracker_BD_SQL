"use strict";

// blob-storage.cjs — Adjuntos en Azure Blob Storage (Fase 10, ver
// plan-blob-storage.md). El backend es el ÚNICO que habla con Blob — el
// frontend nunca recibe una URL de Azure directa, sigue pasando por
// GET/POST /api/attachments/* con X-API-Key, igual que cuando los bytes
// vivían en SQL. El contenedor debe existir ya, creado como Private.
//
// getContainerClient() se resuelve perezoso (no al cargar el módulo): si
// AZURE_STORAGE_CONNECTION_STRING no está configurada, el resto de la app
// (proyectos, reportes, etc.) debe poder arrancar igual — el error solo
// aparece si de verdad se intenta subir/bajar/borrar un adjunto.

const { BlobServiceClient } = require("@azure/storage-blob");

const CONTAINER = process.env.AZURE_STORAGE_CONTAINER || "actividad-adjuntos";
let _client = null;

function getContainerClient() {
  if (_client) return _client;
  const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connStr) throw new Error("AZURE_STORAGE_CONNECTION_STRING no configurada");
  const service = BlobServiceClient.fromConnectionString(connStr);
  _client = service.getContainerClient(CONTAINER);
  return _client;
}

// El nombre del blob es appAdjuntoID (ej. "att_xxx"), no NombreArchivo: ya
// es único y estable, evita tener que sanitizar/deduplicar nombres de
// archivo reales. El nombre original se guarda aparte en SQL y solo se usa
// para el header Content-Disposition al descargar.
async function uploadBlob(appAdjuntoID, buffer, mime) {
  const container = getContainerClient();
  const blob = container.getBlockBlobClient(appAdjuntoID);
  await blob.uploadData(buffer, { blobHTTPHeaders: { blobContentType: mime || "application/octet-stream" } });
  return blob.url;
}

async function downloadBlob(appAdjuntoID) {
  const container = getContainerClient();
  const blob = container.getBlockBlobClient(appAdjuntoID);
  const download = await blob.download();
  const chunks = [];
  for await (const chunk of download.readableStreamBody) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function deleteBlob(appAdjuntoID) {
  const container = getContainerClient();
  await container.getBlockBlobClient(appAdjuntoID).deleteIfExists();
}

module.exports = { uploadBlob, downloadBlob, deleteBlob };
