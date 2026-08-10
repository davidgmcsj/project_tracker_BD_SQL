# Plan de diseño — Adjuntos en Azure Blob Storage

**Estado: diseño listo, sin implementar.** No hay cuenta de Azure Storage disponible todavía. Este documento queda listo para ejecutar en cuanto exista — es la Fase 10 del roadmap de `plan-modulo-reportes-FASES.md` (riesgo 10.4), detallada contra el código real.

---

## 1. Por qué

Hoy los adjuntos (`Actividad_Adjuntos.Contenido`) viven como `VARBINARY(MAX)` dentro de Azure SQL. Cada archivo subido infla la base de datos transaccional con bytes que no son datos relacionales — encarece el storage de SQL (más caro por GB que Blob Storage), infla los backups, y hace más lento cualquier operación que toque esa tabla en bloque (el backfill de eventos, por ejemplo, ya evita tocarla a propósito).

Mover los bytes a Blob Storage y dejar solo la URL en SQL es el patrón estándar para este problema — Azure SQL para lo relacional, Blob para archivos.

## 2. Estado actual (verificado contra el código)

| Pieza | Ubicación | Qué hace |
|---|---|---|
| Tabla | `Actividad_Adjuntos` (migración 007) | `AdjuntoID, AppAdjuntoID, AppActividadID, ProyectoAppID, NombreArchivo, TipoMime, Tamano, Contenido VARBINARY(MAX), FechaSubida` |
| Subida | `db-operations.cjs:saveAttachmentToDB` + `POST /api/attachments/upload` (server.cjs:724) | Recibe base64 en JSON, límite 10 MB, `MERGE` upsert por `AppAdjuntoID` |
| Descarga | `db-operations.cjs:getAttachmentFromDB` + `GET /api/attachments/:id` (server.cjs:748) | Lee el buffer completo de SQL y lo transmite con `Content-Disposition` (RFC 5987, soporta acentos/ñ) |
| Borrado | `db-operations.cjs:deleteAttachmentFromDB` + `POST /api/attachments/delete` (server.cjs:772) | `DELETE` por `AppAdjuntoID` |
| Frontend | `storage.js: uploadAttachment / downloadAttachment / deleteAttachment` | El frontend nunca ve la BD directo — todo pasa por estos tres endpoints con `X-API-Key` |

**Esto es clave para el diseño:** el frontend ya está completamente desacoplado del almacenamiento real — solo conoce `appAdjuntoID` y tres endpoints. Migrar a Blob Storage es 100% un cambio de backend. **El frontend no cambia ni una línea.**

## 3. Arquitectura objetivo

```
Frontend ──(X-API-Key, como hoy)──▶ backend/server.cjs ──▶ Azure Blob Storage
                                          │                  (contenedor privado)
                                          └──▶ Azure SQL (solo metadata + BlobUrl)
```

**El contenedor de Blob queda privado** (sin acceso público ni SAS de larga duración). El backend sigue siendo el único que habla con Blob Storage — hace de proxy autenticado, igual que hoy hace de proxy hacia SQL. Esto preserva exactamente el modelo de seguridad actual: `X-API-Key` sigue siendo lo único que protege el acceso a un adjunto, y el navegador nunca recibe una URL de Azure directamente.

Se descarta deliberadamente exponer URLs públicas o SAS tokens de larga duración al frontend — cambiaría el modelo de auth (cualquiera con la URL podría descargar el archivo sin pasar por `requireApiKey`) sin ninguna ganancia real, dado que ya existe un proxy funcionando.

## 4. Qué necesita el usuario antes de ejecutar esto

1. **Una Storage Account de Azure** (Standard, LRS o GRS según el presupuesto/tolerancia a pérdida de región — GRS si los adjuntos son importantes de verdad).
2. **Un contenedor privado** dentro de esa cuenta (ej. `actividad-adjuntos`), con **Public access level = Private**.
3. **La cadena de conexión** (`AZURE_STORAGE_CONNECTION_STRING`) o, preferido para producción, una **Managed Identity** de la App Service con rol `Storage Blob Data Contributor` sobre esa cuenta (evita guardar una clave en `.env`).
4. Decidir **el nombre del contenedor** y si se quiere una política de lifecycle (ej. mover a tier "Cool" adjuntos de más de 90 días sin acceso — opcional, no bloqueante para la primera versión).

Sin esto no hay nada que ejecutar — el resto del documento asume que ya existe la cuenta y el contenedor.

## 5. Cambios a implementar (cuando haya acceso)

### 5.1 Dependencia

```
npm i @azure/storage-blob
```

### 5.2 Migración 019 — columnas nuevas, sin borrar nada

```sql
-- migrations/019_add_attachment_blob_url.sql
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.Actividad_Adjuntos') AND name = 'BlobUrl')
BEGIN
  ALTER TABLE dbo.Actividad_Adjuntos ADD BlobUrl NVARCHAR(1000) NULL;
END

-- Contenido pasa a NULLABLE — pero NO se borra el dato existente. Los adjuntos
-- ya subidos siguen sirviéndose desde SQL hasta que el backfill (5.5) los mueva.
IF EXISTS (
  SELECT 1 FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.Actividad_Adjuntos') AND name = 'Contenido' AND is_nullable = 0
)
BEGIN
  ALTER TABLE dbo.Actividad_Adjuntos ALTER COLUMN Contenido VARBINARY(MAX) NULL;
END
```

### 5.3 `backend/blob-storage.cjs` (nuevo)

```js
"use strict";
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

async function uploadBlob(appAdjuntoID, buffer, mime) {
  const container = getContainerClient();
  const blob = container.getBlockBlobClient(appAdjuntoID); // nombre = id estable, sin info del usuario
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
```

**Por qué el nombre del blob es `appAdjuntoID` y no `NombreArchivo`:** `appAdjuntoID` (`att_xxx`) ya es único y estable; usar el nombre real del archivo como key del blob obligaría a sanitizar/deduplicar nombres y complicaría el borrado. El nombre original ya se guarda en SQL (`NombreArchivo`) y se usa solo para el header `Content-Disposition` al descargar.

### 5.4 `db-operations.cjs` — compatibilidad total durante la transición

```js
async function saveAttachmentToDB({ appAdjuntoID, appActividadID, proyectoAppID, nombre, mime, size, buffer }) {
  const { uploadBlob } = require("./blob-storage.cjs");
  const blobUrl = await uploadBlob(appAdjuntoID, buffer, mime); // si falla, lanza y el endpoint responde error — no hay escritura parcial
  const pool = await getPool();
  await pool.request()
    .input("appId", sql.NVarChar(60), appAdjuntoID)
    /* ...campos existentes... */
    .input("blobUrl", sql.NVarChar(1000), blobUrl)
    .query(`
      MERGE dbo.Actividad_Adjuntos AS t
      USING (SELECT @appId AS AppAdjuntoID) AS s ON t.AppAdjuntoID = s.AppAdjuntoID
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
  const r = await pool.request().input("appId", sql.NVarChar(60), appAdjuntoID)
    .query(`SELECT NombreArchivo, TipoMime, Tamano, Contenido, BlobUrl FROM dbo.Actividad_Adjuntos WHERE AppAdjuntoID = @appId`);
  const row = r.recordset[0];
  if (!row) return null;

  // Compatibilidad: si ya tiene BlobUrl, lee de Blob. Si no (adjunto viejo,
  // todavía no migrado por el backfill), sigue leyendo de SQL como hoy.
  const buffer = row.BlobUrl
    ? await require("./blob-storage.cjs").downloadBlob(appAdjuntoID)
    : row.Contenido;

  return { nombre: row.NombreArchivo, mime: row.TipoMime, size: row.Tamano, buffer };
}

async function deleteAttachmentFromDB(appAdjuntoID) {
  const pool = await getPool();
  await require("./blob-storage.cjs").deleteBlob(appAdjuntoID).catch(() => {}); // no bloquear el borrado en SQL si el blob ya no existe
  await pool.request().input("appId", sql.NVarChar(60), appAdjuntoID)
    .query(`DELETE FROM dbo.Actividad_Adjuntos WHERE AppAdjuntoID = @appId`);
}
```

`server.cjs` no necesita ningún cambio — sigue llamando a las mismas tres funciones de `db-operations.cjs` con la misma firma.

### 5.5 Script de backfill — mover lo que ya existe

```
backend/scripts/backfill-attachments-to-blob.cjs --dry-run
backend/scripts/backfill-attachments-to-blob.cjs --apply
```

Mismo patrón que `backfill-events.cjs` (Fase 1B): recorre `Actividad_Adjuntos WHERE BlobUrl IS NULL AND Contenido IS NOT NULL`, sube cada `Contenido` a Blob con `uploadBlob`, actualiza `BlobUrl` y pone `Contenido = NULL` en SQL. Idempotente por construcción — una fila con `BlobUrl` ya poblado no se vuelve a tocar.

**Verificar:** correr con `--dry-run` primero (cuenta cuántos adjuntos y bytes se moverían, sin escribir nada); confirmar que `SELECT SUM(DATALENGTH(Contenido))` baja a 0 después de `--apply`; descargar un adjunto migrado desde la UI y confirmar que el archivo abre igual que antes.

### 5.6 Migración 020 (semanas después, ya todo verificado)

```sql
-- Solo después de confirmar en producción que TODOS los adjuntos tienen
-- BlobUrl y se descargan bien. No forma parte de esta entrega.
ALTER TABLE dbo.Actividad_Adjuntos DROP COLUMN Contenido;
```

## 6. Variables de entorno nuevas

| Variable | Dónde | Ejemplo |
|---|---|---|
| `AZURE_STORAGE_CONNECTION_STRING` | `.env` del backend | `DefaultEndpointsProtocol=https;AccountName=...;AccountKey=...;EndpointSuffix=core.windows.net` |
| `AZURE_STORAGE_CONTAINER` | `.env` del backend (opcional, default `actividad-adjuntos`) | `actividad-adjuntos` |

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Falla la subida a Blob a mitad de un guardado | `uploadBlob` se llama ANTES del `MERGE` en SQL — si falla, no se escribe nada en SQL tampoco; el usuario ve el error y puede reintentar. No hay estado a medio migrar. |
| El backfill se corta a mitad de camino | Idempotente por diseño (`WHERE BlobUrl IS NULL`) — correrlo de nuevo retoma donde quedó. |
| Cuenta de Storage mal configurada (pública por error) | Contenedor se crea explícitamente como Private; el backend nunca genera SAS tokens para el frontend, así que no hay URL pública que filtrar aunque alguien la adivine. |
| Costo inesperado | Blob Storage cobra por GB almacenado + transacciones — mucho más barato que SQL para este uso, pero vale poner una alerta de presupuesto en el Azure Portal la primera semana. |

## 8. Fuera de alcance de esta fase

- Lifecycle policies (mover adjuntos viejos a tier frío) — se puede agregar después sin tocar código, es configuración de Azure Portal.
- CDN delante del contenedor — no aplica mientras el acceso siga siendo autenticado vía backend, no público.
- Migración 020 (drop de `Contenido`) — deliberadamente en una entrega separada, semanas después, solo cuando el backfill esté verificado en producción.
